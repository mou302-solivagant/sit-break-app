const { app, BrowserWindow, Tray, Menu, screen, ipcMain, Notification, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const AutoLaunch = require('auto-launch');
const { store, ensureTodayStats } = require('./store');
const Scheduler = require('./scheduler');

let tray = null;
let settingsWin = null;
let skipWin = null;
let lockWins = [];
let scheduler = null;
let awaitingSkipDecision = false;

const contentDir = path.join(app.getPath('userData'), 'content');
if (!fs.existsSync(contentDir)) fs.mkdirSync(contentDir, { recursive: true });

const autoLauncher = new AutoLaunch({ name: '起身休息提醒' });

// ---------- 雅思口說詞組：首次啟動時一次性加入學習內容（刪除後不會再加回來） ----------
function seedIeltsContent() {
  if (store.get('ieltsSeeded')) return;
  const items = store.get('contentItems');
  const existing = new Set(items.map((i) => i.id));
  const ielts = require('./ieltsContent').filter((c) => !existing.has(c.id));
  store.set('contentItems', items.concat(ielts));
  store.set('ieltsSeeded', true);
}
seedIeltsContent();

// ---------- 內容輪播資料（含使用者上傳圖片轉為 dataUrl 供鎖定畫面顯示） ----------
function getRenderableContentItems() {
  const items = store.get('contentItems');
  return items.map((item) => {
    if (item.type === 'image' && item.filePath) {
      try {
        const buf = fs.readFileSync(item.filePath);
        const ext = path.extname(item.filePath).slice(1) || 'png';
        const dataUrl = `data:image/${ext};base64,${buf.toString('base64')}`;
        return { ...item, dataUrl };
      } catch (e) {
        return item;
      }
    }
    return item;
  });
}

// ---------- 鎖定視窗 ----------
function openLockWindows() {
  closeLockWindows();
  const lockMinutes = store.get('lockMinutes');
  const endAt = Date.now() + lockMinutes * 60 * 1000;
  const items = getRenderableContentItems();

  const displays = screen.getAllDisplays();
  lockWins = displays.map((display) => {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      fullscreenable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(__dirname, 'windows', 'lock.html'));
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
      win.webContents.send('lock-init', { endAt, items });
    });
    win.on('closed', () => {
      lockWins = lockWins.filter((w) => w !== win);
    });
    return win;
  });

}

function closeLockWindows() {
  lockWins.forEach((w) => {
    w.destroy();
  });
  lockWins = [];
}

// ---------- 跳過提示小視窗 ----------
function openSkipWindow() {
  if (skipWin) return;
  awaitingSkipDecision = true;
  const display = screen.getPrimaryDisplay();
  skipWin = new BrowserWindow({
    width: 300,
    height: 150,
    x: display.workArea.x + display.workArea.width - 320,
    y: display.workArea.y + display.workArea.height - 180,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  skipWin.loadFile(path.join(__dirname, 'windows', 'skip.html'));
  skipWin.once('ready-to-show', () => {
    skipWin.show();
    skipWin.webContents.send('skip-init', { seconds: store.get('skipWindowSeconds') });
  });
  skipWin.on('closed', () => {
    skipWin = null;
  });

  if (store.get('notifyBeforeLock') && Notification.isSupported()) {
    new Notification({
      title: '該起身休息了',
      body: `已到提醒時間，${store.get('skipWindowSeconds')}秒後將自動鎖定螢幕`
    }).show();
  }
}

function closeSkipWindow() {
  if (skipWin) {
    skipWin.destroy();
    skipWin = null;
  }
  awaitingSkipDecision = false;
}

// ---------- Scheduler 綁定 ----------
function startScheduler() {
  scheduler = new Scheduler();
  scheduler.on('reminder-due', () => {
    if (awaitingSkipDecision || lockWins.length) return; // 避免重複觸發
    if (store.get('allowSkip')) {
      openSkipWindow();
    } else {
      openLockWindows();
    }
  });
  scheduler.on('tick', ({ withinRange, remainingMs }) => {
    updateTrayTooltip(withinRange, remainingMs);
  });
  scheduler.start();
  // 啟動當下先算一次，避免要等到第一個tick(最多5秒)才有內容
  updateTrayTooltip(
    scheduler.isWithinActiveRange(),
    store.get('nextReminderAt') - Date.now()
  );
}

ipcMain.on('skip-confirm', () => {
  closeSkipWindow();
  scheduler.skip();
});
ipcMain.on('skip-timeout', () => {
  closeSkipWindow();
  openLockWindows();
});
ipcMain.on('lock-break-completed', () => {
  closeLockWindows();
  scheduler.completeBreak();
});
ipcMain.on('lock-emergency-skip', () => {
  closeLockWindows();
  scheduler.emergencySkip();
});
ipcMain.on('request-reschedule', () => {
  // 設定變更後不強制重算，維持目前的 nextReminderAt 邏輯即可
});

// ---------- 設定/內容 IPC ----------
ipcMain.handle('get-settings', () => {
  return {
    intervalMinutes: store.get('intervalMinutes'),
    lockMinutes: store.get('lockMinutes'),
    allowSkip: store.get('allowSkip'),
    skipWindowSeconds: store.get('skipWindowSeconds'),
    activeRanges: store.get('activeRanges'),
    autoLaunch: store.get('autoLaunch'),
    soundEnabled: store.get('soundEnabled'),
    notifyBeforeLock: store.get('notifyBeforeLock')
  };
});

ipcMain.handle('update-settings', (_e, patch) => {
  Object.entries(patch).forEach(([key, value]) => {
    store.set(key, value);
  });
  if (Object.prototype.hasOwnProperty.call(patch, 'autoLaunch')) {
    if (patch.autoLaunch) autoLauncher.enable().catch(() => {});
    else autoLauncher.disable().catch(() => {});
  }
  return {
    intervalMinutes: store.get('intervalMinutes'),
    lockMinutes: store.get('lockMinutes'),
    allowSkip: store.get('allowSkip'),
    skipWindowSeconds: store.get('skipWindowSeconds'),
    activeRanges: store.get('activeRanges'),
    autoLaunch: store.get('autoLaunch'),
    soundEnabled: store.get('soundEnabled'),
    notifyBeforeLock: store.get('notifyBeforeLock')
  };
});

ipcMain.handle('get-content-items', () => store.get('contentItems'));

ipcMain.handle('get-stats', () => ensureTodayStats());

ipcMain.handle('remove-content-item', (_e, id) => {
  const items = store.get('contentItems').filter((i) => i.id !== id);
  store.set('contentItems', items);
  return items;
});

ipcMain.handle('add-content-files', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '圖片與文字', extensions: ['png', 'jpg', 'jpeg', 'gif', 'txt', 'md'] }
    ]
  });
  if (result.canceled || !result.filePaths.length) return store.get('contentItems');

  const items = store.get('contentItems');
  result.filePaths.forEach((srcPath) => {
    const ext = path.extname(srcPath).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif'].includes(ext);
    const destName = `${Date.now()}-${path.basename(srcPath)}`;
    const destPath = path.join(contentDir, destName);
    fs.copyFileSync(srcPath, destPath);

    if (isImage) {
      items.push({
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'image',
        title: path.basename(srcPath),
        filePath: destPath
      });
    } else {
      const body = fs.readFileSync(destPath, 'utf-8');
      items.push({
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'text',
        title: path.basename(srcPath),
        body
      });
    }
  });
  store.set('contentItems', items);
  return items;
});

// ---------- Tray ----------
function buildTrayMenu() {
  const remainingMs = store.get('nextReminderAt') - Date.now();
  const remainingMin = Math.max(0, Math.round(remainingMs / 60000));
  return Menu.buildFromTemplate([
    { label: `下次提醒約 ${remainingMin} 分鐘後`, enabled: false },
    { type: 'separator' },
    { label: '立即休息一次', click: () => openLockWindows() },
    { label: '開啟設定', click: () => openSettingsWindow() },
    { type: 'separator' },
    { label: '結束程式', click: () => { app.isQuiting = true; app.quit(); } }
  ]);
}

// 滑鼠移到選單列圖示上時（不用右鍵）就能看到的提示文字，
// 隨scheduler每次tick更新，所以停留在圖示上會看到「即時」的剩餘時間。
function updateTrayTooltip(withinRange, remainingMs) {
  if (!tray || tray.isDestroyed()) return;
  if (!withinRange) {
    tray.setToolTip('起身休息提醒（目前不在啟用時段）');
    return;
  }
  const remainingMin = Math.max(0, Math.round(remainingMs / 60000));
  tray.setToolTip(`起身休息提醒\n下次休息約 ${remainingMin} 分鐘後`);
}

function createTray() {
  const icon = nativeImage.createFromDataURL(trayIconDataUrl());
  // Mac選單列圖示建議設為template image比例(16x16)，這裡用resize確保尺寸正確
  tray = new Tray(icon.resize({ width: 18, height: 18 }));
  tray.setToolTip('起身休息提醒');
  // 不用 setContextMenu()：那會讓左鍵點擊也強制跳出選單，跟「左鍵開設定視窗」互搶事件，
  // 導致選單擋住設定視窗、滑鼠卡住要先點掉選單才能操作設定頁的bug。
  // 改成左鍵開設定視窗、右鍵才彈出小選單（Mac/Win使用者熟悉的標準Tray互動方式）。
  tray.on('click', () => openSettingsWindow());
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));
}

// 32x32藍色圓點PNG作為預設Tray圖示（之後可換成正式icon檔）；
// 注意：Mac的Tray不支援SVG格式的nativeImage，必須用PNG/JPG等已點陣化的圖片格式
function trayIconDataUrl() {
  return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAnklEQVR4nO2XSxJAQAwFwwFsHc75HM7WBdj65EuSSjHZGq97nikFwN+ns94wzMvGXV+n0ZSpXiyBn4qIi6xgq0gfCddkkAIecE0WKuAJlzJvAhFwLps9AxlzEojcPcWo00DG7jFWnQaaQBNoAtYvmTdzZNVpACCnhSujVgMAsS1g2WgDERJUJvkIPCW4LPYMeEhIGfV/TKwimS+0b8wOIJJENJhY8rQAAAAASUVORK5CYII='
}

// ---------- 設定視窗 ----------
function openSettingsWindow() {
  if (settingsWin) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 700,
    title: '起身休息提醒 — 設定',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  settingsWin.loadFile(path.join(__dirname, 'windows', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------- App生命週期 ----------
app.whenReady().then(() => {
  console.log('[startup] app ready, platform =', process.platform);
  try {
    if (process.platform === 'darwin') app.dock && app.dock.hide();
    console.log('[startup] creating tray...');
    createTray();
    console.log('[startup] tray created:', !!tray, 'isDestroyed:', tray && tray.isDestroyed && tray.isDestroyed());
    startScheduler();
    console.log('[startup] scheduler started');
    if (store.get('autoLaunch')) autoLauncher.enable().catch(() => {});
  } catch (err) {
    console.error('[startup] FAILED:', err);
  }
});

app.on('window-all-closed', () => {
  // 背景常駐App：關掉設定視窗（隱藏在Tray）不應該結束整個程式
  // macOS/Windows都靠Tray選單「結束程式」才真正離開
});

app.on('before-quit', () => {
  app.isQuiting = true;
});
