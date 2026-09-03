const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { session } = require('electron');

class ProxyManager {
  constructor() {
    this.agent = null;
    this.proxyConfig = null;
  }

  configure(proxyConfig) {
    this.proxyConfig = proxyConfig;
    if (!proxyConfig || !proxyConfig.enabled) {
      this.agent = null;
      this.applyToElectronSession(null);
      return;
    }

    const { type, host, port, username, password } = proxyConfig;
    let auth = '';
    if (username && password) {
      auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
    }

    try {
      if (type === 'socks5') {
        const proxyUri = `socks5://${auth}${host}:${port}`;
        this.agent = new SocksProxyAgent(proxyUri);
      } else if (type === 'http') {
        const proxyUri = `http://${auth}${host}:${port}`;
        this.agent = new HttpsProxyAgent(proxyUri);
      }
      this.applyToElectronSession(proxyConfig);
    } catch (err) {
      console.error('Failed to create proxy agent:', err);
      this.agent = null;
    }
  }

  applyToElectronSession(proxyConfig) {
    if (!session || !session.defaultSession) return;

    if (!proxyConfig || !proxyConfig.enabled) {
      session.defaultSession.setProxy({ mode: 'direct' });
      return;
    }

    const { type, host, port } = proxyConfig;
    const proxyRules = `${type === 'socks5' ? 'socks5' : 'http'}://${host}:${port}`;
    session.defaultSession.setProxy({ proxyRules });
  }

  getAgent() {
    return this.agent;
  }

  async testConnection(testUrl = 'https://rutracker.org/forum/index.php') {
    const startTime = Date.now();
    try {
      const fetch = (await import('node-fetch')).default || globalThis.fetch;
      const options = {
        method: 'HEAD',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };

      if (this.agent) {
        options.agent = this.agent;
      }

      const res = await fetch(testUrl, options);
      const latency = Date.now() - startTime;
      return {
        success: res.ok || res.status === 301 || res.status === 302 || res.status === 403,
        status: res.status,
        latency,
        message: `Подключение успешно (${latency} мс)`
      };
    } catch (err) {
      return {
        success: false,
        latency: Date.now() - startTime,
        message: `Ошибка подключения: ${err.message}`
      };
    }
  }
}

module.exports = new ProxyManager();
