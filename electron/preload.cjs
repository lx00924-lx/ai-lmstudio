const { contextBridge, ipcRenderer } = require('electron');

// 安全地向渲染进程暴露能力
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
  getStorageInfo: () => ipcRenderer.invoke('get-storage-info'),
  selectStoragePath: () => ipcRenderer.invoke('select-storage-path'),
  setStoragePath: (newPath) => ipcRenderer.invoke('set-storage-path', newPath),
  openStorageFolder: (targetPath) => ipcRenderer.invoke('open-storage-folder', targetPath),
  relaunchApp: () => ipcRenderer.invoke('relaunch-app'),
  downloadAndInstallUpdate: (params) => ipcRenderer.invoke('download-and-install-update', params),
  onDownloadProgress: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('download-progress', handler);
    return () => ipcRenderer.removeListener('download-progress', handler);
  },
});
