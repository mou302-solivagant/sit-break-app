let settings = null;

async function load() {
  settings = await window.api.getSettings();
  const stats = await window.api.getStats();
  const contentItems = await window.api.getContentItems();

  document.getElementById('intervalMinutes').value = settings.intervalMinutes;
  document.getElementById('lockMinutes').value = settings.lockMinutes;
  document.getElementById('lockMinutesVal').textContent = settings.lockMinutes;
  document.getElementById('allowSkip').checked = settings.allowSkip;
  document.getElementById('autoLaunch').checked = settings.autoLaunch;
  document.getElementById('soundEnabled').checked = settings.soundEnabled;

  renderRanges(settings.activeRanges || []);
  renderContent(contentItems || []);

  document.getElementById('statCompleted').textContent = stats.todayCompletedBreaks || 0;
  document.getElementById('statSkips').textContent = stats.todaySkips || 0;
  document.getElementById('statEmergency').textContent = stats.todayEmergencySkips || 0;
}

function renderRanges(ranges) {
  const el = document.getElementById('rangeList');
  el.innerHTML = '';
  if (!ranges.length) {
    el.innerHTML = '<div class="hint">目前為全天啟用</div>';
    return;
  }
  ranges.forEach((r, idx) => {
    const div = document.createElement('div');
    div.className = 'range-item';
    div.innerHTML = `<span>${r.start} ～ ${r.end}</span>`;
    const btn = document.createElement('button');
    btn.className = 'danger';
    btn.textContent = '刪除';
    btn.onclick = async () => {
      const next = ranges.filter((_, i) => i !== idx);
      settings = await window.api.updateSettings({ activeRanges: next });
      renderRanges(settings.activeRanges);
    };
    div.appendChild(btn);
    el.appendChild(div);
  });
}

function renderContent(items) {
  const el = document.getElementById('contentList');
  el.innerHTML = '';
  items.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'content-item';
    const label = item.title || (item.type === 'image' ? '[圖片]' : '[文字]');
    const isDefault = item.id.startsWith('default-');
    div.innerHTML = `<span>${label}${isDefault ? '（內建）' : ''}</span>`;
    if (!isDefault) {
      const btn = document.createElement('button');
      btn.className = 'danger';
      btn.textContent = '刪除';
      btn.onclick = async () => {
        const next = await window.api.removeContentItem(item.id);
        renderContent(next);
      };
      div.appendChild(btn);
    }
    el.appendChild(div);
  });
}

document.getElementById('lockMinutes').addEventListener('input', (e) => {
  document.getElementById('lockMinutesVal').textContent = e.target.value;
});

// 提醒間隔、鎖定時長不再用change事件即時存檔（容易因為視窗被直接關掉而沒觸發到，
// 造成「調整後又變回原本設定」的錯覺），改成統一交給下面的「儲存設定」按鈕處理

document.getElementById('allowSkip').addEventListener('change', async (e) => {
  settings = await window.api.updateSettings({ allowSkip: e.target.checked });
});
document.getElementById('autoLaunch').addEventListener('change', async (e) => {
  settings = await window.api.updateSettings({ autoLaunch: e.target.checked });
});
document.getElementById('soundEnabled').addEventListener('change', async (e) => {
  settings = await window.api.updateSettings({ soundEnabled: e.target.checked });
});

document.getElementById('addRangeBtn').addEventListener('click', async () => {
  const start = document.getElementById('rangeStart').value;
  const end = document.getElementById('rangeEnd').value;
  if (!start || !end) return;
  const next = [...(settings.activeRanges || []), { start, end }];
  settings = await window.api.updateSettings({ activeRanges: next });
  renderRanges(settings.activeRanges);
});

document.getElementById('addContentBtn').addEventListener('click', async () => {
  const items = await window.api.addContentFiles();
  renderContent(items);
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const intervalMinutes = Number(document.getElementById('intervalMinutes').value);
  const lockMinutes = Number(document.getElementById('lockMinutes').value);
  settings = await window.api.updateSettings({ intervalMinutes, lockMinutes });

  // 重新從主行程拿一次最新設定，確保畫面顯示的一定是「真的已經存進去」的值
  settings = await window.api.getSettings();
  document.getElementById('intervalMinutes').value = settings.intervalMinutes;
  document.getElementById('lockMinutes').value = settings.lockMinutes;
  document.getElementById('lockMinutesVal').textContent = settings.lockMinutes;

  const statusEl = document.getElementById('saveStatus');
  statusEl.style.opacity = '1';
  setTimeout(() => { statusEl.style.opacity = '0'; }, 1800);
});

load();
