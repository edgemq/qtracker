const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor() {
    this.userDataPath = (app && app.getPath) 
      ? app.getPath('userData') 
      : path.join(process.env.APPDATA || process.cwd(), 'QTracker');
    
    const downloadsPath = (app && app.getPath)
      ? app.getPath('downloads')
      : path.join(process.env.USERPROFILE || process.cwd(), 'Downloads');

    this.settingsFile = path.join(this.userDataPath, 'qtracker-settings.json');
    this.downloadsFile = path.join(this.userDataPath, 'qtracker-downloads.json');
    
    this.defaultSettings = {
      downloadDir: path.join(downloadsPath, 'QTracker'),
      mirror: 'https://rutracker.org',
      availableMirrors: [
        'https://rutracker.org',
        'https://rutracker.net',
        'https://rutracker.nl'
      ],
      auth: {
        username: '',
        sessionCookie: '', // bb_session
        bbData: '',
        isLoggedIn: false
      },
      proxy: {
        enabled: false,
        type: 'socks5', // 'socks5' | 'http'
        host: '127.0.0.1',
        port: 1080,
        username: '',
        password: ''
      },
      engineMode: 'builtin', // 'builtin' | 'qbittorrent'
      qbitConfig: {
        host: '127.0.0.1',
        port: 8080,
        username: 'admin',
        password: ''
      },
      autoInstallPrompt: true,
      maxDownloadSpeed: 0, // 0 = unlimited, in KB/s
      maxUploadSpeed: 0
    };

    this.settings = this.loadJSON(this.settingsFile, this.defaultSettings);
    this.downloads = this.loadJSON(this.downloadsFile, []);

    // Ensure default download directory exists
    try {
      if (!fs.existsSync(this.settings.downloadDir)) {
        fs.mkdirSync(this.settings.downloadDir, { recursive: true });
      }
    } catch (err) {
      console.error('Failed to create default download directory:', err);
    }
  }

  loadJSON(filePath, defaultValue) {
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(data);
        if (Array.isArray(defaultValue)) {
          return Array.isArray(parsed) ? parsed : defaultValue;
        }
        return { ...defaultValue, ...parsed };
      }
    } catch (err) {
      console.error(`Failed to load ${filePath}:`, err);
    }
    return defaultValue;
  }

  saveJSON(filePath, data) {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error(`Failed to save ${filePath}:`, err);
    }
  }

  getSettings() {
    return this.settings;
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveJSON(this.settingsFile, this.settings);
    return this.settings;
  }

  getDownloads() {
    return this.downloads;
  }

  saveDownloads(downloadsList) {
    this.downloads = downloadsList;
    this.saveJSON(this.downloadsFile, this.downloads);
  }
}

module.exports = new Store();
