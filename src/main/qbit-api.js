const http = require('http');
const store = require('./store');

class QBitApi {
  constructor() {
    this.sid = null;
    this.defaultPort = 8999;
    this.defaultHost = '127.0.0.1';
  }

  getConfig() {
    const settings = store.getSettings();
    const cfg = settings.qbitConfig || {};
    // When using built-in autonomous engine, always route to embedded qBittorrent on 8999
    if (settings.engineMode !== 'qbittorrent') {
      return {
        host: '127.0.0.1',
        port: this.defaultPort,
        username: 'admin',
        password: ''
      };
    }
    return {
      host: cfg.host || this.defaultHost,
      port: cfg.port || this.defaultPort,
      username: cfg.username || 'admin',
      password: cfg.password || ''
    };
  }

  request(path, method = 'GET', data = null, headers = {}) {
    const config = this.getConfig();
    const host = config.host || this.defaultHost;
    const port = config.port || this.defaultPort;

    return new Promise((resolve, reject) => {
      const reqHeaders = { ...headers };
      if (this.sid) {
        reqHeaders['Cookie'] = `SID=${this.sid}`;
      }

      let body = data;
      if (data && typeof data === 'object' && !Buffer.isBuffer(data) && !headers['Content-Type']) {
        body = new URLSearchParams(data).toString();
        reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
      }

      if (body) {
        reqHeaders['Content-Length'] = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
      }

      const req = http.request({
        hostname: host,
        port: port,
        path,
        method,
        headers: reqHeaders,
        timeout: 6000
      }, (res) => {
        const setCookies = res.headers['set-cookie'] || [];
        for (const c of setCookies) {
          const m = c.match(/SID=([^;]+)/);
          if (m) this.sid = m[1];
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode,
            text,
            json: () => {
              try { return JSON.parse(text); } catch (e) { return null; }
            }
          });
        });
      });

      req.on('error', err => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('qBittorrent WebAPI timeout'));
      });

      if (body) req.write(body);
      req.end();
    });
  }

  async testConnection() {
    try {
      const res = await this.request('/api/v2/app/version');
      return {
        online: res.status === 200 || res.status === 403,
        version: res.text || 'qBittorrent'
      };
    } catch (err) {
      return { online: false, error: err.message };
    }
  }

  async login() {
    const config = this.getConfig();
    try {
      const res = await this.request('/api/v2/auth/login', 'POST', {
        username: config.username || 'admin',
        password: config.password || 'adminadmin'
      });
      return res.text === 'Ok.' || this.sid !== null;
    } catch (err) {
      return false;
    }
  }

  async getTorrents() {
    try {
      let res = await this.request('/api/v2/torrents/info');
      if (res.status === 403) {
        await this.login();
        res = await this.request('/api/v2/torrents/info');
      }
      return res.json() || [];
    } catch (err) {
      return [];
    }
  }

  async addTorrent(torrentSource, savepath, options = {}) {
    try {
      // If it's a magnet link or HTTP URL
      if (typeof torrentSource === 'string' && (torrentSource.startsWith('magnet:') || torrentSource.startsWith('http'))) {
        const params = {
          urls: torrentSource
        };
        if (savepath) params.savepath = savepath;
        if (options.tags) params.tags = options.tags;
        if (options.category) params.category = options.category;

        const res = await this.request('/api/v2/torrents/add', 'POST', params);
        return res.status === 200 || res.text === 'Ok.';
      }

      // If it's a torrent file Buffer
      const torrentBuffer = Buffer.isBuffer(torrentSource) ? torrentSource : Buffer.from(torrentSource);
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      const parts = [];

      parts.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="download.torrent"\r\nContent-Type: application/x-bittorrent\r\n\r\n`),
        torrentBuffer,
        Buffer.from('\r\n')
      );

      if (savepath) {
        parts.push(
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="savepath"\r\n\r\n${savepath}\r\n`)
        );
      }

      if (options.tags) {
        parts.push(
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="tags"\r\n\r\n${options.tags}\r\n`)
        );
      }

      parts.push(Buffer.from(`--${boundary}--\r\n`));
      const fullBody = Buffer.concat(parts);

      const res = await this.request('/api/v2/torrents/add', 'POST', fullBody, {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      });

      return res.status === 200 || res.text === 'Ok.';
    } catch (err) {
      console.error('qBittorrent addTorrent error:', err);
      return false;
    }
  }

  async pauseTorrent(hash) {
    try {
      // In qB 5.x: stop, fallback pause
      let res = await this.request('/api/v2/torrents/stop', 'POST', { hashes: hash });
      if (res.status !== 200) {
        res = await this.request('/api/v2/torrents/pause', 'POST', { hashes: hash });
      }
      return res.status === 200;
    } catch (e) {
      return false;
    }
  }

  async resumeTorrent(hash) {
    try {
      // In qB 5.x: start, fallback resume
      let res = await this.request('/api/v2/torrents/start', 'POST', { hashes: hash });
      if (res.status !== 200) {
        res = await this.request('/api/v2/torrents/resume', 'POST', { hashes: hash });
      }
      return res.status === 200;
    } catch (e) {
      return false;
    }
  }

  async deleteTorrent(hash, deleteFiles = false) {
    try {
      const res = await this.request('/api/v2/torrents/delete', 'POST', {
        hashes: hash,
        deleteFiles: deleteFiles ? 'true' : 'false'
      });
      return res.status === 200;
    } catch (e) {
      return false;
    }
  }

  async setPreferences(prefs) {
    try {
      const res = await this.request('/api/v2/app/setPreferences', 'POST', {
        json: JSON.stringify(prefs)
      });
      return res.status === 200;
    } catch (e) {
      return false;
    }
  }
}

module.exports = new QBitApi();
