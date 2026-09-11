process.env.UV_THREADPOOL_SIZE = '32';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const store = require('./store');
const proxyManager = require('./proxy-manager');
const rutracker = require('./rutracker');
const torrentEngine = require('./torrent-engine');
const installerModule = require('./installer');
const qbitApi = require('./qbit-api');
const autoUpdater = require('./auto-updater');

let mainWindow = null;
let updateInterval = null;

// Initialize proxy from stored settings
const currentSettings = store.getSettings();
if (currentSettings.proxy && currentSettings.proxy.enabled) {
  proxyManager.configure(currentSettings.proxy);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 650,
    backgroundColor: '#0a0e17',
    title: 'QTracker — RuTracker Catalog & Torrent Client',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Remove default menu for clean modern look
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Prevent mainWindow from ever navigating to external websites
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isLocal = url.startsWith('file://') || url.includes('localhost') || url.includes('127.0.0.1');
    if (!isLocal) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Open external web links in user's default browser
    shell.openExternal(url);
    return { action: 'deny' };
  });

  let isQuitting = false;
  mainWindow.on('close', async (e) => {
    if (!isQuitting) {
      e.preventDefault();
      isQuitting = true;
      if (updateInterval) {
        clearInterval(updateInterval);
        updateInterval = null;
      }
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.hide();
        }
      } catch (err) {}

      try {
        if (torrentEngine) {
          await torrentEngine.shutdown();
        }
      } catch (err) {}

      app.exit(0);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Ensure single instance lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    createWindow();

    // Initialize torrent engine with live updates
    try {
      await torrentEngine.init((torrentsList) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('torrent:update', torrentsList);
        }
      });
    } catch (err) {
      console.error('Failed to initialize TorrentEngine:', err);
    }

    // Periodic heartbeat to send torrent stats (speed, eta) to UI
    updateInterval = setInterval(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const torrents = torrentEngine.getAllTorrents();
        mainWindow.webContents.send('torrent:update', torrents);
      }
    }, 1000);

    // Initial auth status check
    try {
      if (store.getSettings().auth.sessionCookie) {
        rutracker.checkAuthStatus().then(status => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auth:status', status);
          }
        });
      }
    } catch (e) {}

    // Auto-check for updates 3 seconds after launch
    setTimeout(async () => {
      try {
        const updateInfo = await autoUpdater.checkForUpdates();
        if (updateInfo && updateInfo.updateAvailable && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('updater:available', updateInfo);
        }
      } catch (e) {}
    }, 3500);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ================= IPC HANDLERS =================

// --- RuTracker Handlers ---
ipcMain.handle('rutracker:search', async (event, params) => {
  return await rutracker.search(params);
});

ipcMain.handle('rutracker:get-preview', async (event, topicId) => {
  return await rutracker.getTopicPreview(topicId);
});

ipcMain.handle('rutracker:login', async (event, { username, password }) => {
  const res = await rutracker.login(username, password);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:status', {
      isLoggedIn: res.success,
      username: res.username || username
    });
  }
  return res;
});

ipcMain.handle('rutracker:login-cookie', async (event, cookie) => {
  const res = await rutracker.loginWithCookie(cookie);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:status', {
      isLoggedIn: res.success,
      username: res.username || 'Пользователь RuTracker'
    });
  }
  return res;
});

ipcMain.handle('rutracker:open-web-auth', (event) => {
  return new Promise((resolve) => {
    rutracker.openWebAuthWindow(
      (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('auth:status', {
            isLoggedIn: true,
            username: data.username
          });
        }
        resolve(data);
      },
      (err) => resolve({ success: false, message: err.message })
    );
  });
});

ipcMain.handle('rutracker:check-auth', async () => {
  return await rutracker.checkAuthStatus();
});

ipcMain.handle('rutracker:logout', () => {
  const res = rutracker.logout();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('auth:status', { isLoggedIn: false, username: '' });
  }
  return res;
});

// --- Torrent Engine Handlers ---
ipcMain.handle('torrent:download-topic', async (event, { topicId, title }) => {
  try {
    const settings = store.getSettings();

    // Check if qBittorrent mode is selected
    if (settings.engineMode === 'qbittorrent') {
      const torrentBuf = await rutracker.downloadTorrentFile(topicId);
      const added = await qbitApi.addTorrent(torrentBuf, settings.downloadDir);
      return { success: added, engine: 'qbittorrent' };
    }

    // Default Autonomous Built-in Engine
    const torrentBuf = await rutracker.downloadTorrentFile(topicId);
    const item = await torrentEngine.addTorrent(torrentBuf, {
      topicId,
      name: title,
      path: settings.downloadDir
    });

    return { success: true, torrent: item, engine: 'builtin' };
  } catch (err) {
    console.error('Download torrent error:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('torrent:add-magnet', async (event, { magnetUri, title }) => {
  try {
    const settings = store.getSettings();
    const item = await torrentEngine.addTorrent(magnetUri, {
      name: title,
      path: settings.downloadDir
    });
    return { success: true, torrent: item };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('torrent:get-all', () => {
  return torrentEngine.getAllTorrents();
});

ipcMain.handle('torrent:pause', async (event, infoHash) => {
  const settings = store.getSettings();
  if (settings.engineMode === 'qbittorrent') {
    return await qbitApi.pauseTorrent(infoHash);
  }
  return torrentEngine.pauseTorrent(infoHash);
});

ipcMain.handle('torrent:resume', async (event, infoHash) => {
  const settings = store.getSettings();
  if (settings.engineMode === 'qbittorrent') {
    return await qbitApi.resumeTorrent(infoHash);
  }
  return torrentEngine.resumeTorrent(infoHash);
});

ipcMain.handle('torrent:remove', async (event, { infoHash, deleteFiles }) => {
  const settings = store.getSettings();
  if (settings.engineMode === 'qbittorrent') {
    await qbitApi.deleteTorrent(infoHash, deleteFiles);
    return { success: true };
  }
  return await torrentEngine.removeTorrent(infoHash, deleteFiles);
});

// --- Explorer Handlers ---
ipcMain.handle('installer:open-folder', (event, targetPath) => {
  installerModule.openFolder(targetPath);
  return { success: true };
});

// --- Settings & Proxy Handlers ---
ipcMain.handle('settings:get', () => {
  return store.getSettings();
});

ipcMain.handle('settings:save', async (event, newSettings) => {
  const updated = store.updateSettings(newSettings);
  if (updated.proxy) {
    proxyManager.configure(updated.proxy);
  }
  if (updated.autoStopSeeding && torrentEngine) {
    const list = torrentEngine.getAllTorrents() || [];
    for (const t of list) {
      if ((t.progress >= 1 || t.status === 'seeding') && t.status !== 'paused' && t.infoHash) {
        try {
          await torrentEngine.pauseTorrent(t.infoHash);
        } catch (e) {}
      }
    }
  }
  return updated;
});

ipcMain.handle('settings:choose-folder', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите папку для сохранения загрузок',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: store.getSettings().downloadDir
  });

  if (!res.canceled && res.filePaths.length > 0) {
    const selected = res.filePaths[0];
    store.updateSettings({ downloadDir: selected });
    return selected;
  }
  return null;
});

ipcMain.handle('proxy:test', async (event, testUrl) => {
  const mirror = store.getSettings().mirror || 'https://rutracker.org';
  return await proxyManager.testConnection(testUrl || `${mirror}/forum/index.php`);
});

ipcMain.handle('app:open-external', async (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
  }
  return true;
});

ipcMain.handle('qbit:test', async () => {
  return await qbitApi.testConnection();
});

// --- Auto-Updater Handlers ---
ipcMain.handle('updater:get-version', () => {
  return autoUpdater.getCurrentVersion();
});

ipcMain.handle('updater:check', async () => {
  return await autoUpdater.checkForUpdates();
});

ipcMain.handle('updater:download', async (event, { assetUrl, assetName }) => {
  try {
    const res = await autoUpdater.downloadUpdate(assetUrl, assetName, (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('updater:progress', progress);
      }
    });
    return { success: true, filePath: res.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('updater:install', async () => {
  try {
    return autoUpdater.installUpdate();
  } catch (err) {
    return { success: false, error: err.message };
  }
});

app.on('will-quit', async () => {
  if (torrentEngine) {
    try {
      await torrentEngine.shutdown();
    } catch (e) {}
  }
});


