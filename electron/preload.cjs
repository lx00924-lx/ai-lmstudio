const { contextBridge, ipcRenderer } = require('electron');

// 安全地向渲染进程暴露能力
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
});
