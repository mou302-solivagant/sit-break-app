const Store = require('electron-store');
const defaultContent = require('./defaultContent');

// 統一管理所有設定與狀態，存在本地 userData/config.json
const store = new Store({
  name: 'config',
  defaults: {
    // 提醒間隔（分鐘）
    intervalMinutes: 30,
    // 鎖定時長（分鐘，1-10）
    lockMinutes: 3,
    // 是否允許跳過本次提醒
    allowSkip: true,
    // 跳過通知等待秒數，逾時自動鎖定
    skipWindowSeconds: 20,
    // 啟用時間區段（空陣列 = 全天啟用）
    // 例如 [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }]
    activeRanges: [],
    // 開機自動啟動
    autoLaunch: false,
    // 音效/通知開關
    soundEnabled: true,
    notifyBeforeLock: true,
    // 學習內容清單（預設帶入四張文獻卡片，使用者可新增自己的圖片/文字）
    contentItems: defaultContent,
    // 內部狀態：上次「真正完成休息」的時間戳（ms），用來計算下一次提醒時間
    lastRestCompletedAt: Date.now(),
    // 下一次應該提醒的時間戳（ms）；跳過時不會被展延，只有真正完成休息才會重算
    nextReminderAt: Date.now() + 30 * 60 * 1000,
    // 統計
    stats: {
      totalCompletedBreaks: 0,
      totalSkips: 0,
      totalEmergencySkips: 0,
      todayDate: '',
      todaySkips: 0,
      todayEmergencySkips: 0,
      todayCompletedBreaks: 0
    }
  }
});

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// 確保「今日統計」跨日會重置
function ensureTodayStats() {
  const stats = store.get('stats');
  const today = todayStr();
  if (stats.todayDate !== today) {
    stats.todayDate = today;
    stats.todaySkips = 0;
    stats.todayEmergencySkips = 0;
    stats.todayCompletedBreaks = 0;
    store.set('stats', stats);
  }
  return store.get('stats');
}

module.exports = { store, ensureTodayStats, todayStr };
