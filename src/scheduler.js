const { EventEmitter } = require('events');
const { store, ensureTodayStats } = require('./store');

const CHECK_INTERVAL_MS = 5000; // 每5秒檢查一次，不需要精確到毫秒

/**
 * 計時排程引擎
 *
 * 核心規則：
 * 1. nextReminderAt = lastRestCompletedAt + intervalMinutes
 *    只有「鎖定倒數跑完」才算真正完成一次休息，此時才會重設 lastRestCompletedAt 並往後展延下一個完整週期
 * 2. 使用者點「跳過本次」：不會重設 lastRestCompletedAt，nextReminderAt 維持原訂時間，
 *    下一次到點會再次提醒（不會因為跳過而重新獲得一個完整30分鐘）
 * 3. 若目前不在「啟用時間區段」內，暫停倒數；區段外經過的時間不計入，
 *    做法是：不在區段內時持續把 nextReminderAt 往後平移，等同於「暫停」
 */
class Scheduler extends EventEmitter {
  constructor() {
    super();
    this._timer = null;
    this._lastTick = Date.now();
  }

  start() {
    this._lastTick = Date.now();
    this._timer = setInterval(() => this._tick(), CHECK_INTERVAL_MS);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  isWithinActiveRange(date = new Date()) {
    const ranges = store.get('activeRanges');
    if (!ranges || ranges.length === 0) return true; // 沒設定 = 全天啟用
    const hm = date.getHours() * 60 + date.getMinutes();
    return ranges.some(({ start, end }) => {
      const [sh, sm] = start.split(':').map(Number);
      const [eh, em] = end.split(':').map(Number);
      const s = sh * 60 + sm;
      const e = eh * 60 + em;
      if (e === s) return true; // start===end視為全天（避免使用者手殘設成同一時間變成永遠不啟用）
      if (e > s) {
        // 一般情況，例如 09:00～18:00
        return hm >= s && hm < e;
      }
      // 跨半夜的情況，例如 22:00～02:00：只要在[22:00, 24:00)或[00:00, 02:00)都算啟用
      return hm >= s || hm < e;
    });
  }

  _tick() {
    const now = Date.now();
    const elapsed = now - this._lastTick;
    this._lastTick = now;

    const withinRange = this.isWithinActiveRange();

    if (!withinRange) {
      // 不在啟用時段內：把 nextReminderAt 往後平移相同的經過時間，等同暫停計時
      const nextReminderAt = store.get('nextReminderAt') + elapsed;
      store.set('nextReminderAt', nextReminderAt);
      this.emit('tick', { withinRange, remainingMs: nextReminderAt - now });
      return;
    }

    const nextReminderAt = store.get('nextReminderAt');
    const remainingMs = nextReminderAt - now;
    this.emit('tick', { withinRange, remainingMs });

    if (remainingMs <= 0) {
      this.emit('reminder-due');
    }
  }

  // 使用者跳過這一次提醒：不重設完成時間戳，只是把下一次提醒往後延一小段緩衝，避免馬上又跳出來
  skip() {
    const stats = ensureTodayStats();
    stats.totalSkips = (stats.totalSkips || 0) + 1;
    stats.todaySkips = (stats.todaySkips || 0) + 1;
    store.set('stats', stats);

    // 跳過後，下一次提醒沿用「原訂週期」，但給一個短暫緩衝（5分鐘）避免立刻再跳出
    const bufferMs = 5 * 60 * 1000;
    store.set('nextReminderAt', Date.now() + bufferMs);
    this.emit('skipped');
  }

  // 鎖定倒數正常跑完：這才是「真正完成一次休息」，重設時間戳並展延下一個完整週期
  completeBreak() {
    const now = Date.now();
    const intervalMs = store.get('intervalMinutes') * 60 * 1000;
    store.set('lastRestCompletedAt', now);
    store.set('nextReminderAt', now + intervalMs);

    const stats = ensureTodayStats();
    stats.totalCompletedBreaks = (stats.totalCompletedBreaks || 0) + 1;
    stats.todayCompletedBreaks = (stats.todayCompletedBreaks || 0) + 1;
    store.set('stats', stats);
    this.emit('break-completed');
  }

  // 使用者在鎖定畫面用「緊急跳過」提早解鎖：仍視為完成本次週期起點重算（避免馬上又鎖一次），
  // 但另外累計「緊急跳過次數」讓使用者自己看得到用了幾次
  emergencySkip() {
    const now = Date.now();
    const intervalMs = store.get('intervalMinutes') * 60 * 1000;
    store.set('lastRestCompletedAt', now);
    store.set('nextReminderAt', now + intervalMs);

    const stats = ensureTodayStats();
    stats.totalEmergencySkips = (stats.totalEmergencySkips || 0) + 1;
    stats.todayEmergencySkips = (stats.todayEmergencySkips || 0) + 1;
    store.set('stats', stats);
    this.emit('emergency-skip');
  }
}

module.exports = Scheduler;
