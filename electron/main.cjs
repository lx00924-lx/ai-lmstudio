const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

// 引导配置文件：记录用户自定义的缓存与数据存储目录
const bootConfigDir = path.join(app.getPath('appData'), 'AI智能助手');
const bootConfigFile = path.join(bootConfigDir, 'storage_config.json');

function getCustomUserDataPath() {
  try {
    if (fs.existsSync(bootConfigFile)) {
      const content = fs.readFileSync(bootConfigFile, 'utf-8');
      const data = JSON.parse(content);
      if (data && data.customUserDataPath && typeof data.customUserDataPath === 'string') {
        const targetPath = data.customUserDataPath.trim();
        if (targetPath) {
          if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
          }
          return targetPath;
        }
      }
    }
  } catch (err) {
    console.error('读取存储目录引导配置失败:', err);
  }
  return null;
}

// 在 app ready 之前尽早重定向用户数据路径
const customUserDataPath = getCustomUserDataPath();
if (customUserDataPath) {
  try {
    app.setPath('userData', customUserDataPath);
  } catch (err) {
    console.error('设置 userData 路径失败:', err);
  }
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 420,
    minHeight: 600,
    title: 'AI 智能助手',
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  // 优雅展示：等待页面准备好再展示窗口，避免白屏闪烁
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 外部超链接使用系统默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // 判断是否为开发环境
  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// 注册 IPC 存储目录管理通信
ipcMain.handle('get-storage-info', async () => {
  const currentPath = app.getPath('userData');
  const defaultPath = path.join(app.getPath('appData'), app.getName() || 'AI智能助手');
  const savedCustomPath = getCustomUserDataPath();

  return {
    currentPath,
    defaultPath,
    isCustom: !!savedCustomPath,
    configuredPath: savedCustomPath || defaultPath,
  };
});

ipcMain.handle('select-storage-path', async () => {
  if (!mainWindow) return { canceled: true };

  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 AI 智能助手缓存与数据存储目录',
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    buttonLabel: '选择此目录',
  });

  if (result.canceled || !result.filePaths.length) {
    return { canceled: true };
  }

  return { canceled: false, selectedPath: result.filePaths[0] };
});

ipcMain.handle('set-storage-path', async (event, newPath) => {
  try {
    if (!fs.existsSync(bootConfigDir)) {
      fs.mkdirSync(bootConfigDir, { recursive: true });
    }

    if (newPath && typeof newPath === 'string' && newPath.trim()) {
      const targetDir = newPath.trim();
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      fs.writeFileSync(
        bootConfigFile,
        JSON.stringify({ customUserDataPath: targetDir, updatedAt: new Date().toISOString() }, null, 2),
        'utf-8'
      );
    } else {
      // 恢复默认：删除引导配置文件
      if (fs.existsSync(bootConfigFile)) {
        fs.unlinkSync(bootConfigFile);
      }
    }

    return { success: true };
  } catch (err) {
    console.error('写入存储目录配置失败:', err);
    return { success: false, error: err.message || '配置保存失败' };
  }
});

ipcMain.handle('open-storage-folder', async (event, targetPath) => {
  try {
    const dirToOpen = targetPath || app.getPath('userData');
    if (!fs.existsSync(dirToOpen)) {
      fs.mkdirSync(dirToOpen, { recursive: true });
    }
    await shell.openPath(dirToOpen);
    return { success: true };
  } catch (err) {
    console.error('打开目录失败:', err);
    return { success: false, error: err.message || '打开目录失败' };
  }
});

ipcMain.handle('relaunch-app', () => {
  app.relaunch();
  app.exit(0);
});

// 应用内原生下载并自动执行 Windows .exe 安装包
ipcMain.handle('download-and-install-update', async (event, { url, fileName }) => {
  const https = require('https');
  const http = require('http');
  const { spawn } = require('child_process');

  const tempDir = app.getPath('temp');
  const targetFileName = fileName || 'AI-Assistant-Update.exe';
  const saveFilePath = path.join(tempDir, targetFileName);

  return new Promise((resolve) => {
    try {
      // 若已有旧文件则先清理
      if (fs.existsSync(saveFilePath)) {
        try { fs.unlinkSync(saveFilePath); } catch (e) {}
      }

      const fileStream = fs.createWriteStream(saveFilePath);

      function downloadWithRedirect(downloadUrl, redirectCount = 0) {
        if (redirectCount > 8) {
          fileStream.close();
          return resolve({ success: false, error: '重定向次数过多，下载失败' });
        }

        let parsedUrl;
        try {
          parsedUrl = new URL(downloadUrl);
        } catch (e) {
          fileStream.close();
          return resolve({ success: false, error: '无效的下载链接' });
        }

        const client = parsedUrl.protocol === 'https:' ? https : http;
        
        const req = client.get(parsedUrl, { headers: { 'User-Agent': 'AI-Assistant-Updater' } }, (res) => {
          // 处理 301 / 302 / 307 / 308 重定向
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const nextUrl = new URL(res.headers.location, downloadUrl).href;
            return downloadWithRedirect(nextUrl, redirectCount + 1);
          }

          if (res.statusCode !== 200) {
            fileStream.close();
            return resolve({ success: false, error: `下载失败: HTTP ${res.statusCode}` });
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
          let receivedBytes = 0;

          res.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (totalBytes > 0 && mainWindow && !mainWindow.isDestroyed()) {
              const progress = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
              mainWindow.webContents.send('download-progress', {
                progress,
                receivedBytes,
                totalBytes,
              });
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close(async () => {
              try {
                // 优先使用 shell.openPath 唤起 Windows 安装程序（可无缝触发 UAC 管理员提权确认）
                const openError = await shell.openPath(saveFilePath);
                if (openError) {
                  // 兜底：使用 spawn 启动
                  const child = spawn(saveFilePath, [], {
                    detached: true,
                    stdio: 'ignore'
                  });
                  child.unref();
                }

                // 短暂延迟后退出当前应用，让安装程序覆盖安装
                setTimeout(() => {
                  app.quit();
                }, 1500);

                resolve({ success: true });
              } catch (runErr) {
                console.error('启动更新程序失败:', runErr);
                await shell.openPath(saveFilePath);
                resolve({ success: true, fallbackOpened: true });
              }
            });
          });
        });

        req.on('error', (err) => {
          fileStream.close();
          console.error('更新下载网络错误:', err);
          resolve({ success: false, error: err.message || '网络连接异常' });
        });
      }

      downloadWithRedirect(url);
    } catch (err) {
      console.error('下载更新未知异常:', err);
      resolve({ success: false, error: err.message || '下载更新失败' });
    }
  });
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
