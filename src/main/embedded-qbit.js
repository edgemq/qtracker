const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

const DEFAULT_PORT = 8999;
const DEFAULT_HOST = '127.0.0.1';

class EmbeddedQBittorrent {
  constructor() {
    this.process = null;
    this.port = DEFAULT_PORT;
    this.host = DEFAULT_HOST;
    this.isReady = false;
    this._startPromise = null;
  }

  getExecutablePath() {
    // 1. Check packaged app.asar.unpacked path first
    if (process.resourcesPath) {
      const unpackedCandidate = path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'bin', 'qbittorrent', 'qbittorrent.exe');
      if (fs.existsSync(unpackedCandidate)) {
        return unpackedCandidate;
      }
      const resourcesCandidate = path.join(process.resourcesPath, 'bin', 'qbittorrent', 'qbittorrent.exe');
      if (fs.existsSync(resourcesCandidate)) {
        return resourcesCandidate;
      }
    }

    // 2. Development mode path
    const devPath = path.join(__dirname, '..', 'bin', 'qbittorrent', 'qbittorrent.exe');
    if (fs.existsSync(devPath)) {
      return devPath;
    }

    const cwdPath = path.join(process.cwd(), 'src', 'bin', 'qbittorrent', 'qbittorrent.exe');
    if (fs.existsSync(cwdPath)) {
      return cwdPath;
    }

    return devPath;
  }

  getProfileDir() {
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME, 'Library', 'Application Support') : path.join(process.env.HOME, '.config'));
    const profileDir = path.join(appData, 'qtracker', 'qbit_profile');
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
    return profileDir;
  }

  ensureConfig(profileDir, downloadDir) {
    const configDir = path.join(profileDir, 'qBittorrent', 'config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const lockfile = path.join(configDir, 'lockfile');
    try {
      if (fs.existsSync(lockfile)) {
        fs.unlinkSync(lockfile);
      }
    } catch (e) {}

    const iniPath = path.join(configDir, 'qBittorrent.ini');
    const savePathFormatted = (downloadDir || 'C:/Users/edgem/Downloads/QTracker').replace(/\\/g, '/');

    const iniContent = `[Preferences]
General\\Locale=ru
UI\\TrayIcon=false
UI\\Splash=false
WebUI\\Enabled=true
WebUI\\Port=${this.port}
WebUI\\Address=${this.host}
WebUI\\LocalHostAuth=false
WebUI\\AuthSubnetWhitelistEnabled=true
WebUI\\AuthSubnetWhitelist=127.0.0.1/32
WebUI\\UseUPnP=false
WebUI\\ServerDomains=*
WebUI\\HostHeaderValidation=false
WebUI\\CSRFProtection=false
WebUI\\ClickjackingProtection=false
WebUI\\Username=admin
WebUI\\Password_PBKDF2=@ByteArray(qqOdt+UKaezDWLakRVIoCQ==:yIV7LJAEFwkIz2qpnmorKQayrj2VVAdM/4n02E0W+eGKpaHSJ7FjL8fovoSWmJTzwDNIbISqo6N1OuqQdNtWQQ==)
Downloads\\SavePath=${savePathFormatted}
Bittorrent\\MaxConns=500
Bittorrent\\MaxConnsPerTorrent=100

[Network]
Proxy\\Profiles\\Misc=true
Proxy\\Profiles\\RSS=true
Proxy\\Profiles\\BitTorrent=true
Proxy\\HostnameLookupEnabled=false

[BitTorrent]
Session\\QueueingSystemEnabled=true
Session\\DefaultSavePath=${savePathFormatted}

[GUI]
Log\\Enabled=false

[Meta]
MigrationVersion=8

[LegalNotice]
Accepted=true
`;

    try {
      fs.writeFileSync(iniPath, iniContent, 'utf8');
    } catch (e) {
      console.warn('Could not write qBittorrent.ini:', e.message);
    }
  }

  async checkOnline() {
    return new Promise((resolve) => {
      const req = http.request({
        hostname: this.host,
        port: this.port,
        path: '/api/v2/app/version',
        method: 'GET',
        timeout: 1000
      }, (res) => {
        resolve(res.statusCode === 200);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.end();
    });
  }

  async start(downloadDir) {
    if (this._startPromise) return this._startPromise;

    this._startPromise = (async () => {
      // 1. Check if an instance is already running and responding
      const alreadyOnline = await this.checkOnline();
      if (alreadyOnline) {
        this.isReady = true;
        return true;
      }

      const exePath = this.getExecutablePath();
      if (!fs.existsSync(exePath)) {
        throw new Error(`Embedded qBittorrent executable not found at: ${exePath}`);
      }

      const exeDir = path.dirname(exePath);
      const profileDir = this.getProfileDir();
      this.ensureConfig(profileDir, downloadDir);

      // Clean up any stale profile left in bin directory
      try {
        const staleProfile = path.join(exeDir, 'profile');
        if (fs.existsSync(staleProfile)) {
          fs.rmSync(staleProfile, { recursive: true, force: true });
        }
      } catch (e) {}

      // 2. Launch qBittorrent pointing strictly to user's AppData profile
      this.process = spawn(exePath, ['--no-splash', `--profile=${profileDir}`], {
        cwd: exeDir,
        windowsHide: true,
        detached: false,
        stdio: 'ignore'
      });

      this.process.on('exit', (code) => {
        console.log(`Embedded qBittorrent process exited with code ${code}`);
        this.isReady = false;
        this.process = null;
      });

      // 3. Wait for WebUI to become ready (max 15 attempts, 500ms intervals)
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 500));
        const online = await this.checkOnline();
        if (online) {
          this.isReady = true;
          return true;
        }
      }

      throw new Error('Timed out waiting for embedded qBittorrent WebUI to respond');
    })();

    return this._startPromise;
  }

  async shutdown() {
    const pid = this.process ? this.process.pid : null;

    try {
      // 1. Graceful WebAPI shutdown command (save checkpoints)
      await new Promise((resolve) => {
        const req = http.request({
          hostname: this.host,
          port: this.port,
          path: '/api/v2/app/shutdown',
          method: 'POST',
          timeout: 1000
        }, () => resolve());
        req.on('error', () => resolve());
        req.on('timeout', () => {
          req.destroy();
          resolve();
        });
        req.end();
      });
      // Short delay for qBittorrent to flush fastresume files
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {}

    // 2. Kill the process and any subprocesses
    if (pid) {
      try {
        const { execSync } = require('child_process');
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      } catch (e) {
        if (this.process) {
          try { this.process.kill('SIGKILL'); } catch (e2) {}
        }
      }
    }

    this.process = null;
    this.isReady = false;
    this._startPromise = null;
  }
}

const instance = new EmbeddedQBittorrent();

// Ensure process is killed even on sudden parent exit
process.on('exit', () => {
  if (instance.process && instance.process.pid) {
    try {
      const { execSync } = require('child_process');
      execSync(`taskkill /F /T /PID ${instance.process.pid}`, { stdio: 'ignore' });
    } catch (e) {}
  }
});

module.exports = instance;
