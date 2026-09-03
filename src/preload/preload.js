const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qtracker', {
  // RuTracker
  search: (params) => ipcRenderer.invoke('rutracker:search', params),
  getPreview: (topicId) => ipcRenderer.invoke('rutracker:get-preview', topicId),
  login: (username, password) => ipcRenderer.invoke('rutracker:login', { username, password }),
  loginCookie: (cookie) => ipcRenderer.invoke('rutracker:login-cookie', cookie),
  openWebAuth: () => ipcRenderer.invoke('rutracker:open-web-auth'),
  checkAuth: () => ipcRenderer.invoke('rutracker:check-auth'),
  logout: () => ipcRenderer.invoke('rutracker:logout'),

  // Torrent Engine
  downloadTopic: (topicId, title) => ipcRenderer.invoke('torrent:download-topic', { topicId, title }),
  addMagnet: (magnetUri, title) => ipcRenderer.invoke('torrent:add-magnet', { magnetUri, title }),
  getAllTorrents: () => ipcRenderer.invoke('torrent:get-all'),
  pauseTorrent: (infoHash) => ipcRenderer.invoke('torrent:pause', infoHash),
  resumeTorrent: (infoHash) => ipcRenderer.invoke('torrent:resume', infoHash),
  removeTorrent: (infoHash, deleteFiles) => ipcRenderer.invoke('torrent:remove', { infoHash, deleteFiles }),

  // Explorer
  openFolder: (targetPath) => ipcRenderer.invoke('installer:open-folder', targetPath),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),

  // Settings & Network
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  chooseFolder: () => ipcRenderer.invoke('settings:choose-folder'),
  testProxy: (testUrl) => ipcRenderer.invoke('proxy:test', testUrl),
  testQbit: () => ipcRenderer.invoke('qbit:test'),

  // Subscriptions / Events
  onTorrentUpdate: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('torrent:update', handler);
    return () => ipcRenderer.removeListener('torrent:update', handler);
  },
  onAuthStatus: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('auth:status', handler);
    return () => ipcRenderer.removeListener('auth:status', handler);
  }
});
