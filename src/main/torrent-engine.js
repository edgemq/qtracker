const path = require('path');
const { Notification } = require('electron');
const store = require('./store');
const installerModule = require('./installer');
const embeddedQBit = require('./embedded-qbit');
const qbitApi = require('./qbit-api');

class TorrentEngine {
  constructor() {
    this.cachedTorrents = [];
    this.onUpdateCallback = null;
    this.metaMap = new Map(); // infoHash -> { topicId, name, torrentName, path }
    this.completedHashes = new Set();
    this.pollInterval = null;
    this.isInitialized = false;
    this.rutracker = null; // dynamically loaded to avoid cyclic deps
  }

  getRuTracker() {
    if (!this.rutracker) {
      try {
        this.rutracker = require('./rutracker');
      } catch (e) {}
    }
    return this.rutracker;
  }

  async init(onUpdate) {
    if (onUpdate) this.onUpdateCallback = onUpdate;
    if (this.isInitialized) return;

    // 1. Immediately load any previously saved downloads into cache so UI shows them instantly
    const saved = store.getDownloads();
    if (Array.isArray(saved) && saved.length > 0) {
      this.cachedTorrents = saved.map(item => ({
        topicId: item.topicId || '',
        name: item.name || item.torrentName || 'Загрузка',
        torrentName: item.torrentName || item.name || '',
        infoHash: (item.infoHash || '').toLowerCase(),
        path: item.path || '',
        progress: typeof item.progress === 'number' ? item.progress : 0,
        downloaded: item.downloaded || 0,
        total: item.total || 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        timeRemaining: 0,
        numPeers: 0,
        totalPeers: 0,
        status: item.status || 'paused'
      }));

      for (const item of saved) {
        if (item.infoHash) {
          const hashLower = item.infoHash.toLowerCase();
          this.metaMap.set(hashLower, {
            topicId: item.topicId || '',
            name: item.name || item.torrentName || '',
            torrentName: item.torrentName || item.name || '',
            path: item.path || ''
          });
          if (item.status === 'completed' || item.progress >= 1) {
            this.completedHashes.add(hashLower);
          }
        }
      }

      if (this.onUpdateCallback) {
        this.onUpdateCallback(this.cachedTorrents);
      }
    }

    const settings = store.getSettings();
    const downloadDir = settings.downloadDir || path.join(store.userDataPath, 'Downloads');

    console.log('Initializing embedded native qBittorrent engine...');
    try {
      await embeddedQBit.start(downloadDir);
      console.log('Embedded qBittorrent is online on port', embeddedQBit.port);
    } catch (err) {
      console.error('Failed to start embedded qBittorrent:', err);
    }

    // 2. Auto-restore previously saved downloads into qBittorrent
    this._restorePreviousDownloads(saved).catch(e => {
      console.warn('Error during torrent auto-restore:', e.message);
    });

    // 3. High performance 1-second polling ticker
    this.pollInterval = setInterval(async () => {
      await this._pollTorrents();
    }, 1000);

    // Initial immediate poll
    await this._pollTorrents();
    this.isInitialized = true;
  }

  async _restorePreviousDownloads(saved) {
    if (!Array.isArray(saved) || saved.length === 0) return;

    try {
      const qbList = await qbitApi.getTorrents();
      const existingHashes = new Set((qbList || []).map(t => (t.hash || '').toLowerCase()));

      for (const item of saved) {
        if (!item.infoHash) continue;
        const hashLower = item.infoHash.toLowerCase();

        if (!existingHashes.has(hashLower)) {
          console.log(`Auto-restoring download "${item.name}" into qBittorrent...`);
          let added = false;

          // Attempt 1: Re-fetch original .torrent file from RuTracker
          if (item.topicId) {
            const rt = this.getRuTracker();
            if (rt && typeof rt.downloadTorrentFile === 'function') {
              try {
                const buf = await rt.downloadTorrentFile(item.topicId);
                if (buf && buf.length > 0) {
                  added = await qbitApi.addTorrent(buf, item.path, { tags: item.topicId });
                  console.log(`Re-added torrent via RuTracker .torrent file: ${added}`);
                }
              } catch (err) {
                console.warn(`Could not fetch .torrent for topic ${item.topicId}:`, err.message);
              }
            }
          }

          // Attempt 2: Fallback via magnet link with hash and announce trackers
          if (!added && item.infoHash) {
            const trackers = [
              'http://bt.t-ru.org/ann?magnet',
              'http://retracker.local/announce',
              'udp://tracker.opentrackr.org:1337/announce'
            ].map(t => `&tr=${encodeURIComponent(t)}`).join('');

            const magnetUri = `magnet:?xt=urn:btih:${item.infoHash}&dn=${encodeURIComponent(item.torrentName || item.name || 'download')}${trackers}`;
            added = await qbitApi.addTorrent(magnetUri, item.path, { tags: item.topicId });
            console.log(`Re-added torrent via magnet URI: ${added}`);
          }
        }
      }
    } catch (e) {
      console.warn('Failed restoring previous downloads:', e);
    }
  }

  async _pollTorrents() {
    try {
      const qbList = await qbitApi.getTorrents();
      if (!Array.isArray(qbList)) return;

      const formattedList = [];
      const seenHashes = new Set();

      for (const t of qbList) {
        const hash = (t.hash || '').toLowerCase();
        seenHashes.add(hash);
        const meta = this.metaMap.get(hash) || {};

        let status = 'downloading';
        const state = (t.state || '').toLowerCase();
        const isPaused = state.includes('pause') || state.includes('stop');

        if (isPaused) {
          status = 'paused';
        } else if (state.includes('up') || t.progress >= 1) {
          status = 'seeding';
        } else if (state.includes('check')) {
          status = 'checking';
        } else if (state.includes('error')) {
          status = 'error';
        }

        const isNewlyCompleted = (status === 'seeding' || status === 'completed') && !this.completedHashes.has(hash);
        if (isNewlyCompleted && t.progress >= 1) {
          this.completedHashes.add(hash);
          this._handleTorrentCompleted(t, meta);
        }

        const isDoneOrSeeding = status === 'completed' || status === 'seeding' || (isPaused && t.progress >= 1);
        const etaMs = typeof t.eta === 'number' && t.eta > 0 && t.eta < 8640000 ? t.eta * 1000 : 0;
        const totalPeers = (t.num_leechs || 0) + (t.num_seeds || 0);
        const swarmPeers = (t.num_incomplete || 0) + (t.num_complete || 0);

        formattedList.push({
          topicId: meta.topicId || t.tags || '',
          name: meta.name || t.name || 'Загрузка',
          torrentName: t.name || meta.torrentName || '',
          infoHash: hash,
          path: t.save_path || meta.path || '',
          contentPath: t.content_path || '',
          progress: typeof t.progress === 'number' ? t.progress : 0,
          downloaded: t.downloaded || 0,
          total: t.total_size || t.size || 0,
          downloadSpeed: isDoneOrSeeding ? 0 : (t.dlspeed || 0),
          uploadSpeed: isPaused ? 0 : (t.upspeed || 0),
          timeRemaining: isDoneOrSeeding ? 0 : etaMs,
          numPeers: totalPeers,
          totalPeers: Math.max(totalPeers, swarmPeers),
          status
        });
      }

      // Preserve any previously cached items that might still be restoring into qBittorrent
      for (const prev of this.cachedTorrents) {
        if (!seenHashes.has(prev.infoHash)) {
          formattedList.push(prev);
        }
      }

      this.cachedTorrents = formattedList;
      if (this.onUpdateCallback) {
        this.onUpdateCallback(this.cachedTorrents);
      }

      // Persist snapshot to store
      this._persistSnapshot();
    } catch (err) {
      // Silent error during shutdown
    }
  }

  async _handleTorrentCompleted(torrent, meta) {
    const torrentName = meta.name || torrent.name || 'Раздача';

    try {
      const settings = store.getSettings();
      if (settings.autoStopSeeding) {
        const hash = (torrent.hash || '').toLowerCase();
        if (hash) {
          await qbitApi.pauseTorrent(hash);
        }
      }
    } catch (e) {
      console.warn('Auto-stop seeding failed:', e.message);
    }

    // Show clean Windows desktop notification without installer prompts
    try {
      new Notification({
        title: 'QTracker — Загрузка завершена!',
        body: `«${torrentName}» успешно загружена.`
      }).show();
    } catch (e) {}
  }

  _persistSnapshot() {
    if (!this.cachedTorrents) return;
    const toSave = this.cachedTorrents.map(t => ({
      topicId: t.topicId,
      name: t.name,
      torrentName: t.torrentName,
      infoHash: t.infoHash,
      status: t.status,
      path: t.path,
      total: t.total,
      downloaded: t.downloaded,
      progress: t.progress,
      addedAt: Date.now()
    }));
    store.saveDownloads(toSave);
  }

  getAllTorrents() {
    return this.cachedTorrents;
  }

  async addTorrent(torrentSource, options = {}) {
    const settings = store.getSettings();
    const downloadPath = options.path || settings.downloadDir;

    const success = await qbitApi.addTorrent(torrentSource, downloadPath, {
      tags: options.topicId || ''
    });

    if (!success) {
      throw new Error('Failed to add torrent to embedded qBittorrent');
    }

    // Refresh torrents list
    await new Promise(r => setTimeout(r, 600));
    const list = await qbitApi.getTorrents();
    if (Array.isArray(list) && list.length > 0) {
      const latest = list[list.length - 1];
      if (latest && latest.hash) {
        const hash = latest.hash.toLowerCase();
        this.metaMap.set(hash, {
          topicId: options.topicId || '',
          name: options.name || latest.name || '',
          torrentName: latest.name || '',
          path: downloadPath
        });
      }
    }

    await this._pollTorrents();

    const matching = this.cachedTorrents.find(t =>
      (options.name && t.name.includes(options.name)) ||
      (options.topicId && t.topicId === options.topicId)
    ) || this.cachedTorrents[this.cachedTorrents.length - 1];

    return matching || {
      topicId: options.topicId || '',
      name: options.name || 'Загрузка',
      infoHash: '',
      status: 'downloading',
      progress: 0,
      total: 0
    };
  }

  async pauseTorrent(infoHash) {
    const success = await qbitApi.pauseTorrent(infoHash);
    const rec = this.cachedTorrents.find(t => t.infoHash.toLowerCase() === infoHash.toLowerCase());
    if (rec) {
      rec.status = 'paused';
      rec.downloadSpeed = 0;
      rec.uploadSpeed = 0;
      if (this.onUpdateCallback) this.onUpdateCallback(this.cachedTorrents);
    }
    return { success };
  }

  async resumeTorrent(infoHash) {
    const success = await qbitApi.resumeTorrent(infoHash);
    const rec = this.cachedTorrents.find(t => t.infoHash.toLowerCase() === infoHash.toLowerCase());
    if (rec) {
      rec.status = (rec.progress >= 1) ? 'seeding' : 'downloading';
      if (this.onUpdateCallback) this.onUpdateCallback(this.cachedTorrents);
    }
    return { success };
  }

  async removeTorrent(infoHash, deleteFiles = false) {
    const hashLower = infoHash.toLowerCase();
    const success = await qbitApi.deleteTorrent(hashLower, deleteFiles);
    this.cachedTorrents = this.cachedTorrents.filter(t => t.infoHash.toLowerCase() !== hashLower);
    this.metaMap.delete(hashLower);
    this.completedHashes.delete(hashLower);

    // Also remove saved .torrent file from disk
    try {
      const torrentPath = path.join(store.userDataPath, 'torrents', `${hashLower}.torrent`);
      if (fs.existsSync(torrentPath)) {
        fs.unlinkSync(torrentPath);
      }
    } catch (e) {}

    this._persistSnapshot();
    if (this.onUpdateCallback) this.onUpdateCallback(this.cachedTorrents);
    return { success };
  }

  async shutdown() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    await embeddedQBit.shutdown();
  }
}

module.exports = new TorrentEngine();
