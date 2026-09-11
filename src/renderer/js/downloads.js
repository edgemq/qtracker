// Downloads Module
const DownloadsModule = {
  torrents: [],

  init() {
    this.container = document.getElementById('downloads-container');
    this.emptyState = document.getElementById('downloads-empty-state');
    this.totalCountEl = document.getElementById('summary-total-count');
    this.activeCountEl = document.getElementById('summary-active-count');
    this.completedCountEl = document.getElementById('summary-completed-count');
    this.sidebarCounterEl = document.getElementById('active-downloads-count');
    this.globalDownSpeedEl = document.getElementById('global-down-speed');
    this.globalUpSpeedEl = document.getElementById('global-up-speed');
    this.btnOpenDownloadDir = document.getElementById('btn-open-download-dir');

    this.bindEvents();

    // Subscribe to live torrent updates from backend
    window.qtracker.onTorrentUpdate((list) => {
      this.updateTorrentsList(list);
    });

    // Initial load
    window.qtracker.getAllTorrents().then(list => {
      this.updateTorrentsList(list);
    });
  },

  bindEvents() {
    this.btnOpenDownloadDir.addEventListener('click', async () => {
      const settings = await window.qtracker.getSettings();
      window.qtracker.openFolder(settings.downloadDir);
    });
  },

  updateTorrentsList(torrentsList) {
    if (!Array.isArray(torrentsList)) return;
    this.torrents = torrentsList;

    let totalDown = 0;
    let totalUp = 0;
    let activeCount = 0;
    let completedCount = 0;

    this.torrents.forEach(t => {
      totalDown += (t.downloadSpeed || 0);
      totalUp += (t.uploadSpeed || 0);
      if (t.status === 'downloading') activeCount++;
      if (t.status === 'completed' || t.status === 'seeding' || (t.progress >= 1)) completedCount++;
    });

    // Update global speed gauges
    this.globalDownSpeedEl.textContent = this.formatSpeed(totalDown);
    this.globalUpSpeedEl.textContent = this.formatSpeed(totalUp);

    // Update summary counts
    this.totalCountEl.textContent = this.torrents.length;
    this.activeCountEl.textContent = activeCount;
    this.completedCountEl.textContent = completedCount;

    // Update sidebar counter
    if (activeCount > 0) {
      this.sidebarCounterEl.textContent = activeCount;
      this.sidebarCounterEl.classList.add('show');
    } else {
      this.sidebarCounterEl.classList.remove('show');
    }

    this.render();
  },

  renderActionButtons(t, isDone) {
    const isPaused = t.status === 'paused';
    let pauseResumeBtn = '';

    if (!isDone) {
      pauseResumeBtn = `
        <button class="btn-card-action btn-pause-resume" data-action="${isPaused ? 'resume' : 'pause'}" data-infohash="${t.infoHash}" title="${isPaused ? 'Возобновить скачивание' : 'Пауза'}">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2">
            ${isPaused ? '<polygon points="5 3 19 12 5 21 5 3"/>' : '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'}
          </svg>
          <span>${isPaused ? 'Возобновить' : 'Пауза'}</span>
        </button>
      `;
    } else {
      pauseResumeBtn = `
        <button class="btn-card-action btn-pause-resume ${isPaused ? '' : 'btn-stop-seed'}" data-action="${isPaused ? 'resume' : 'pause'}" data-infohash="${t.infoHash}" title="${isPaused ? 'Включить раздачу' : 'Выключить раздачу'}">
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2">
            ${isPaused ? '<polygon points="5 3 19 12 5 21 5 3"/>' : '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'}
          </svg>
          <span>${isPaused ? 'Раздавать' : 'Остановить раздачу'}</span>
        </button>
      `;
    }

    return `
      <button class="btn-card-action" data-action="open-folder" data-infohash="${t.infoHash}" title="Открыть папку с файлами в проводнике">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span>Открыть папку</span>
      </button>

      ${pauseResumeBtn}

      <button class="btn-card-action danger" data-action="delete" data-infohash="${t.infoHash}" title="Удалить раздачу">
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        <span>Удалить</span>
      </button>
    `;
  },

  render() {
    if (this.torrents.length === 0) {
      this.container.innerHTML = '';
      this.container.appendChild(this.emptyState);
      this.emptyState.style.display = 'flex';
      return;
    }

    this.emptyState.style.display = 'none';

    // Track existing cards
    const existingCards = new Map();
    this.container.querySelectorAll('.download-card').forEach(card => {
      existingCards.set(card.dataset.infohash, card);
    });

    const activeHashes = new Set();

    this.torrents.forEach(t => {
      activeHashes.add(t.infoHash);
      let card = existingCards.get(t.infoHash);

      const isDone = t.status === 'completed' || t.status === 'seeding' || (t.progress >= 1);
      const isChecking = t.status === 'checking';
      const isPaused = t.status === 'paused';
      const percent = Math.min(100, Math.round((t.progress || 0) * 100));

      const downloadedStr = this.formatBytes(t.downloaded || 0);
      const totalStr = this.formatBytes(t.total || 0);

      let speedStr = '—';
      if (isChecking) {
        speedStr = 'Сверка хэшей диска...';
      } else if (!isDone) {
        speedStr = `Скорость: ${this.formatSpeed(t.downloadSpeed || 0)}`;
      } else {
        if (isPaused) {
          speedStr = 'Раздача остановлена';
        } else if (t.uploadSpeed && t.uploadSpeed > 0) {
          speedStr = `Раздача: ${this.formatSpeed(t.uploadSpeed)}`;
        } else {
          speedStr = 'Раздача: 0 Б/с';
        }
      }

      const etaStr = isDone ? 'Готово' : (isChecking ? `Проверено ${percent}%` : (t.downloadSpeed > 2048 ? this.formatETA(t.timeRemaining || 0) : '—'));

      let statusLabel = 'Скачивание';
      let statusClass = 'status-downloading';

      if (isDone) {
        if (isPaused) {
          statusLabel = 'Завершено (пауза)';
          statusClass = 'status-paused';
        } else if (t.status === 'seeding' || (t.uploadSpeed && t.uploadSpeed > 0)) {
          statusLabel = 'Раздаётся';
          statusClass = 'status-seeding';
        } else {
          statusLabel = 'Завершено';
          statusClass = 'status-completed';
        }
      } else if (isChecking) {
        statusLabel = `Проверка файлов (${percent}%)`;
        statusClass = 'status-checking';
      } else if (isPaused) {
        statusLabel = 'На паузе';
        statusClass = 'status-paused';
      } else if (t.status === 'error') {
        statusLabel = 'Ошибка';
        statusClass = 'status-error';
      }

      const stateKey = `${t.status}_${isDone ? 1 : 0}`;

      // If card doesn't exist yet, create its full DOM structure once
      if (!card) {
        card = document.createElement('div');
        card.className = `download-card ${isDone ? 'completed' : ''} ${isChecking ? 'checking' : ''}`;
        card.dataset.infohash = t.infoHash;

        card.innerHTML = `
          <div class="download-card-header">
            <div class="download-title-group">
              <div class="download-type-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" stroke-width="2">
                  ${isDone ? '<polyline points="20 6 9 17 4 12"/>' : (isChecking ? '<circle cx="12" cy="12" r="9"/><polyline points="12 6 12 12 16 14"/>' : '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>')}
                </svg>
              </div>
              <span class="download-name" title="${this.escapeHtml(t.name)}">${this.escapeHtml(t.name)}</span>
            </div>
            <span class="download-status-badge ${statusClass}">${statusLabel}</span>
          </div>

          <div class="progress-bar-container">
            <div class="progress-bar-fill ${isChecking ? 'checking' : ''}" style="width: ${percent}%;"></div>
          </div>

          <div class="download-metrics-row">
            <div class="metrics-left">
              <span class="metric-progress"><strong>${percent}%</strong> (${downloadedStr} / ${totalStr})</span>
              <span class="metric-speed">${speedStr}</span>
              <span class="metric-eta">Осталось: ${etaStr}</span>
              <span class="metric-peers">Сиды/Пиры: ${t.numPeers || 0}${t.totalPeers && t.totalPeers > (t.numPeers || 0) ? ` (${t.totalPeers})` : ''}</span>
            </div>
          </div>

          <div class="download-actions-row">
            ${this.renderActionButtons(t, isDone)}
          </div>
        `;

        // Cache element references
        card._progressFill = card.querySelector('.progress-bar-fill');
        card._statusBadge = card.querySelector('.download-status-badge');
        card._metricProgress = card.querySelector('.metric-progress');
        card._metricSpeed = card.querySelector('.metric-speed');
        card._metricEta = card.querySelector('.metric-eta');
        card._metricPeers = card.querySelector('.metric-peers');
        card._lastStateKey = stateKey;

        // Bind button actions
        this.bindCardActions(card);

        this.container.appendChild(card);
      } else {
        if (card._progressFill) card._progressFill.style.width = `${percent}%`;
        if (card._metricProgress) card._metricProgress.innerHTML = `<strong>${percent}%</strong> (${downloadedStr} / ${totalStr})`;
        if (card._metricSpeed) card._metricSpeed.textContent = speedStr;
        if (card._metricEta) card._metricEta.textContent = `Осталось: ${etaStr}`;
        if (card._metricPeers) {
          const peersLabel = (t.totalPeers && t.totalPeers > (t.numPeers || 0))
            ? `${t.numPeers || 0} (${t.totalPeers})`
            : `${t.numPeers || 0}`;
          card._metricPeers.textContent = isDone ? `Пиры: ${t.numPeers || 0}` : `Сиды/Пиры: ${peersLabel}`;
        }

        // Keep checking progress dynamic in badge
        if (isChecking && card._statusBadge) {
          card._statusBadge.textContent = statusLabel;
        }

        // If status changed, update badge and re-render action buttons
        if (card._lastStateKey !== stateKey) {
          card._lastStateKey = stateKey;
          card.className = `download-card ${isDone ? 'completed' : ''} ${isChecking ? 'checking' : ''}`;
          if (card._progressFill) {
            card._progressFill.className = `progress-bar-fill ${isChecking ? 'checking' : (isDone ? 'completed' : '')}`;
          }
          if (card._statusBadge) {
            card._statusBadge.className = `download-status-badge ${statusClass}`;
            card._statusBadge.textContent = statusLabel;
          }
          const actionsRow = card.querySelector('.download-actions-row');
          if (actionsRow) {
            actionsRow.innerHTML = this.renderActionButtons(t, isDone);
            this.bindCardActions(card);
          }
        }
      }
    });

    // Remove deleted cards
    existingCards.forEach((card, hash) => {
      if (!activeHashes.has(hash)) {
        card.remove();
      }
    });
  },

  bindCardActions(card) {
    card.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const hash = btn.dataset.infohash;
        this.handleAction(action, hash);
      });
    });
  },

  async handleAction(action, infoHash) {
    const torrent = this.torrents.find(t => t.infoHash === infoHash);
    if (!torrent) return;

    if (action === 'pause') {
      await window.qtracker.pauseTorrent(infoHash);
    } else if (action === 'resume') {
      await window.qtracker.resumeTorrent(infoHash);
    } else if (action === 'open-folder') {
      // Prioritize exact contentPath from torrent engine
      let target = torrent.contentPath;
      if (!target && torrent.path) {
        if (torrent.torrentName) {
          target = `${torrent.path}\\${torrent.torrentName}`;
        } else {
          target = torrent.path;
        }
      }
      window.qtracker.openFolder(target || torrent.path || '');
    } else if (action === 'delete') {
      const confirmed = confirm(`Удалить раздачу «${torrent.name}» из списка?`);
      if (!confirmed) return;

      const deleteDiskFiles = confirm(`Удалить также скачанные файлы с диска?\n\n• ОК — удалить раздачу И стереть файлы с диска\n• Отмена — удалить ТОЛЬКО из списка QTracker (файлы останутся)`);

      // Optimistically remove card immediately from screen
      this.torrents = this.torrents.filter(t => t.infoHash !== infoHash);
      this.render();

      try {
        await window.qtracker.removeTorrent(infoHash, deleteDiskFiles);
      } catch (err) {
        console.error('Failed to remove torrent:', err);
      }
      const updatedList = await window.qtracker.getAllTorrents();
      this.updateTorrentsList(updatedList);
    }
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec === 0) return '0.0 КБ/с';
    if (bytesPerSec >= 1024 * 1024) {
      return (bytesPerSec / (1024 * 1024)).toFixed(1) + ' МБ/с';
    }
    return (bytesPerSec / 1024).toFixed(0) + ' КБ/с';
  },

  formatETA(ms) {
    if (!ms || ms <= 0 || !isFinite(ms)) return '—';
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const minutes = Math.floor((totalSecs % 3600) / 60);
    const seconds = totalSecs % 60;

    if (hours > 0) {
      return `${hours}ч ${minutes}м`;
    }
    if (minutes > 0) {
      return `${minutes}м ${seconds}с`;
    }
    return `${seconds}с`;
  },

  escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};
