// 鎖定視窗的渲染邏輯：倒數、內容輪播、緊急跳過長按防呆

let endAt = 0;
let items = [];
let itemIndex = 0;
let carouselTimer = null;
let countdownTimer = null;

const countdownEl = document.getElementById('countdown');
const cardTitleEl = document.getElementById('cardTitle');
const cardBodyEl = document.getElementById('cardBody');
const cardEl = document.getElementById('card');

function formatTime(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60).toString().padStart(2, '0');
  const s = (totalSec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// 洗牌（Fisher-Yates）
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 雅思詞組卡片排前面，其餘卡片接在後面；兩組各自隨機排序，每次休息順序都不同
function orderItems(list) {
  const isIelts = (i) => typeof i.id === 'string' && i.id.startsWith('ielts-');
  return shuffle(list.filter(isIelts)).concat(shuffle(list.filter((i) => !isIelts(i))));
}

function renderCard() {
  if (!items.length) {
    cardTitleEl.textContent = '起身走走吧';
    cardBodyEl.textContent = '';
    return;
  }
  const item = items[itemIndex % items.length];
  if (item.type === 'image' && item.dataUrl) {
    cardTitleEl.textContent = item.title || '';
    cardBodyEl.innerHTML = '';
    const img = document.createElement('img');
    img.src = item.dataUrl;
    cardBodyEl.appendChild(img);
  } else {
    cardTitleEl.textContent = item.title || '';
    cardBodyEl.textContent = item.body || '';
  }
}

function nextCard() {
  cardEl.classList.add('fade-out');
  setTimeout(() => {
    itemIndex += 1;
    renderCard();
    cardEl.classList.remove('fade-out');
  }, 400);
}

function tickCountdown() {
  const remaining = endAt - Date.now();
  countdownEl.textContent = formatTime(remaining);
  if (remaining <= 0) {
    clearInterval(countdownTimer);
    clearInterval(carouselTimer);
    window.api.breakCompleted();
  }
}

window.api.onLockInit((data) => {
  endAt = data.endAt;
  items = orderItems(data.items || []);
  itemIndex = 0;
  renderCard();
  tickCountdown();
  countdownTimer = setInterval(tickCountdown, 250);
  carouselTimer = setInterval(nextCard, 20000); // 每20秒切換下一則內容
});

// ---- 緊急跳過：長按3秒 ----
const btn = document.getElementById('emergencyBtn');
const progress = document.getElementById('emergencyProgress');
const HOLD_MS = 3000;
let holdStart = null;
let holdRAF = null;

function startHold() {
  holdStart = Date.now();
  step();
}
function step() {
  const elapsed = Date.now() - holdStart;
  const pct = Math.min(100, (elapsed / HOLD_MS) * 100);
  progress.style.width = pct + '%';
  if (pct >= 100) {
    progress.style.width = '0%';
    window.api.emergencySkip();
    return;
  }
  holdRAF = requestAnimationFrame(step);
}
function cancelHold() {
  if (holdRAF) cancelAnimationFrame(holdRAF);
  holdRAF = null;
  holdStart = null;
  progress.style.width = '0%';
}

btn.addEventListener('mousedown', startHold);
btn.addEventListener('mouseup', cancelHold);
btn.addEventListener('mouseleave', cancelHold);
btn.addEventListener('touchstart', startHold);
btn.addEventListener('touchend', cancelHold);
