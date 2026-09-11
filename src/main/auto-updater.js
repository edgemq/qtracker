const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app } = require('electron');

class AutoUpdater {
  constructor() {
    this.repo = 'edgemq/qtracker';
    this.downloadedFilePath = null;
    this.isDownloading = false;
  }

  getCurrentVersion() {
    return app.getVersion();
  }

  isNewerVersion(latest, current) {
    const parse = (v) => (v || '').replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
    const [lMaj = 0, lMin = 0, lPatch = 0] = parse(latest);
    const [cMaj = 0, cMin = 0, cPatch = 0] = parse(current);

    if (lMaj !== cMaj) return lMaj > cMaj;
    if (lMin !== cMin) return lMin > cMin;
    return lPatch > cPatch;
  }

  isPortable() {
    return !!process.env.PORTABLE_EXECUTABLE_DIR || 
      path.basename(app.getPath('exe')).toLowerCase().includes('portable');
  }

  fetchJson(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: {
          'User-Agent': 'QTracker-App',
          'Accept': 'application/vnd.github.v3+json'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this.fetchJson(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`GitHub API returned status ${res.statusCode}`));
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => {
        req.destroy();
        reject(new Error('Connection timeout to update server'));
      });
    });
  }

  async checkForUpdates() {
    try {
      const release = await this.fetchJson(`https://api.github.com/repos/${this.repo}/releases/latest`);
      if (!release || !release.tag_name) {
        return { updateAvailable: false, error: 'No releases found' };
      }

      const latestVersion = release.tag_name.replace(/^v/, '');
      const currentVersion = this.getCurrentVersion();
      const updateAvailable = this.isNewerVersion(latestVersion, currentVersion);

      if (!updateAvailable) {
        return {
          updateAvailable: false,
          currentVersion,
          latestVersion
        };
      }

      const isPort = this.isPortable();
      const assets = release.assets || [];

      // Find matching asset
      let asset = null;
      if (isPort) {
        asset = assets.find(a => a.name.toLowerCase().includes('portable') && a.name.endsWith('.exe'));
      } else {
        asset = assets.find(a => a.name.toLowerCase().includes('setup') && a.name.endsWith('.exe'));
      }
      if (!asset) {
        asset = assets.find(a => a.name.endsWith('.exe'));
      }

      return {
        updateAvailable: true,
        currentVersion,
        latestVersion,
        releaseName: release.name || `QTracker v${latestVersion}`,
        releaseNotes: release.body || '',
        publishedAt: release.published_at,
        assetUrl: asset ? asset.browser_download_url : null,
        assetName: asset ? asset.name : null,
        assetSize: asset ? asset.size : 0,
        isPortable: isPort
      };
    } catch (err) {
      return {
        updateAvailable: false,
        error: err.message
      };
    }
  }

  downloadFile(url, targetPath, onProgress) {
    return new Promise((resolve, reject) => {
      const request = https.get(url, {
        headers: {
          'User-Agent': 'QTracker-App',
          'Accept': 'application/octet-stream'
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this.downloadFile(res.headers.location, targetPath, onProgress).then(resolve, reject);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
        let downloadedBytes = 0;
        let lastReport = 0;

        const fileStream = fs.createWriteStream(targetPath);

        res.on('data', chunk => {
          downloadedBytes += chunk.length;
          const now = Date.now();
          if (now - lastReport > 200 || downloadedBytes === totalBytes) {
            lastReport = now;
            const percent = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
            if (onProgress) {
              onProgress({
                percent,
                downloaded: downloadedBytes,
                total: totalBytes
              });
            }
          }
        });

        res.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => resolve(targetPath));
        });

        fileStream.on('error', err => {
          fs.unlink(targetPath, () => {});
          reject(err);
        });
      });

      request.on('error', err => {
        fs.unlink(targetPath, () => {});
        reject(err);
      });
    });
  }

  async downloadUpdate(assetUrl, assetName, onProgress) {
    if (this.isDownloading) {
      throw new Error('Update download is already in progress');
    }
    if (!assetUrl) {
      throw new Error('No download URL provided for update');
    }

    this.isDownloading = true;
    try {
      const tempDir = path.join(app.getPath('temp'), 'qtracker-update');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const fileName = assetName || `qtracker-update-${Date.now()}.exe`;
      const targetPath = path.join(tempDir, fileName);

      await this.downloadFile(assetUrl, targetPath, onProgress);
      this.downloadedFilePath = targetPath;
      this.isDownloading = false;
      return { success: true, filePath: targetPath };
    } catch (err) {
      this.isDownloading = false;
      throw err;
    }
  }

  installUpdate() {
    if (!this.downloadedFilePath || !fs.existsSync(this.downloadedFilePath)) {
      throw new Error('Downloaded update file not found');
    }

    const filePath = this.downloadedFilePath;
    const isPort = this.isPortable();

    try {
      if (isPort) {
        spawn(filePath, [], {
          detached: true,
          stdio: 'ignore'
        }).unref();
      } else {
        spawn(filePath, [], {
          detached: true,
          stdio: 'ignore'
        }).unref();
      }

      setTimeout(() => {
        app.quit();
      }, 500);

      return { success: true };
    } catch (err) {
      throw new Error(`Failed to launch updater: ${err.message}`);
    }
  }
}

module.exports = new AutoUpdater();
