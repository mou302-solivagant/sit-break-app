const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ---- 通用 ----
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (patch) => ipcRenderer.invoke('update-settings', patch),
  getContentItems: () => ipcRenderer.invoke('get-content-items'),
  addContentFiles: () => ipcRenderer.invoke('add-content-files'),
  removeContentItem: (id) => ipcRenderer.invoke('remove-content-item', id),
  getStats: () => ipcRenderer.invoke('get-stats'),

  // ---- 鎖定視窗專用 ----
  onLockInit: (cb) => ipcRenderer.on('lock-init', (_e, data) => cb(data)),
  emergencySkip: () => ipcRenderer.send('lock-emergency-skip'),
  breakCompleted: () => ipcRenderer.send('lock-break-completed'),

  // ---- 跳過通知視窗專用 ----
  onSkipInit: (cb) => ipcRenderer.on('skip-init', (_e, data) => cb(data)),
  skipThisTime: () => ipcRenderer.send('skip-confirm'),
  skipTimeout: () => ipcRenderer.send('skip-timeout'),

  // ---- 設定頁通知主行程重新排程 ----
  requestReschedule: () => ipcRenderer.send('request-reschedule')
});
