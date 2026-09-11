// Auto-Updater Renderer Module
const UpdaterModule = {
  currentUpdate: null,
  isDownloaded: false,

  async init() {
    this.modal = document.getElementById('update-modal');
    this.closeBtn = document.getElementById('update-modal-close-btn');
    this.cancelBtn = document.getElementById('update-cancel-btn');
    this.actionBtn = document.getElementById('update-action-btn');
    this.actionBtnText = document.getElementById('update-action-btn-text');

    this.newVersionText = document.getElementById('update-new-version-text');
    this.currentVersionText = document.getElementById('update-current-version-text');
    this.releaseNotesEl = document.getElementById('update-release-notes');

    this.progressSection = document.getElementById('update-progress-section');
    this.progressBar = document.getElementById('update-progress-bar');
    this.progressPercent = document.getElementById('update-progress-percent');
    this.progressBytes = document.getElementById('update-progress-bytes');

    this.btnCheckManual = document.getElementById('btn-check-updates-manual');
    this.settingsUpdateStatus = document.getElementById('settings-update-status');
    this.settingsAppVersion = document.getElementById('settings-app-version');

    this.bindEvents();
    this.loadCurrentVersion();

    // Listen for update notifications from main process
    if (window.qtracker && window.qtracker.onUpdateAvailable) {
      window.qtracker.onUpdateAvailable((info) => {
        this.showUpdateModal(info);
      });
    }

    if (window.qtracker && window.qtracker.onUpdateProgress) {
      window.qtracker.onUpdateProgress((progress) => {
        this.onProgress(progress);
      });
    }
  },

  async loadCurrentVersion() {
    try {
      if (window.qtracker && window.qtracker.getAppVersion) {
        const ver = await window.qtracker.getAppVersion();
        if (this.settingsAppVersion) {
          this.settingsAppVersion.textContent = `Версия: v${ver}`;
        }
      }
    } catch (e) {}
  },

  bindEvents() {
    if (this.closeBtn) {
      this.closeBtn.addEventListener('click', () => this.closeModal());
    }
    if (this.cancelBtn) {
      this.cancelBtn.addEventListener('click', () => this.closeModal());
    }
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal && !this.isDownloading) {
          this.closeModal();
        }
      });
    }

    if (this.actionBtn) {
      this.actionBtn.addEventListener('click', () => this.handleActionClick());
    }

    if (this.btnCheckManual) {
      this.btnCheckManual.addEventListener('click', () => this.checkManual());
    }
  },

  showUpdateModal(info) {
    this.currentUpdate = info;
    this.isDownloaded = false;
    this.isDownloading = false;

    this.newVersionText.textContent = `Новая версия: v${info.latestVersion}`;
    this.currentVersionText.textContent = `Текущая версия: v${info.currentVersion}`;
    this.releaseNotesEl.textContent = info.releaseNotes || 'Список изменений не указан.';

    this.progressSection.style.display = 'none';
    this.progressBar.style.width = '0%';
    this.progressPercent.textContent = '0%';
    this.actionBtn.disabled = false;
    this.actionBtnText.textContent = 'Скачать и обновить';
    this.cancelBtn.style.display = 'inline-block';

    this.modal.style.display = 'flex';
    setTimeout(() => {
      this.modal.classList.add('active');
    }, 10);
  },

  closeModal() {
    if (this.isDownloading) return; // Prevent closing while downloading
    this.modal.classList.remove('active');
    setTimeout(() => {
      this.modal.style.display = 'none';
    }, 200);
  },

  async handleActionClick() {
    if (!this.currentUpdate) return;

    if (this.isDownloaded) {
      // Install update and restart
      this.actionBtn.disabled = true;
      this.actionBtnText.textContent = 'Запуск установки...';
      try {
        await window.qtracker.installUpdate();
      } catch (err) {
        alert(`Ошибка запуска установщика: ${err.message}`);
        this.actionBtn.disabled = false;
      }
      return;
    }

    // Start download
    this.isDownloading = true;
    this.actionBtn.disabled = true;
    this.actionBtnText.textContent = 'Загрузка...';
    this.cancelBtn.style.display = 'none';
    this.progressSection.style.display = 'block';

    try {
      const res = await window.qtracker.downloadUpdate({
        assetUrl: this.currentUpdate.assetUrl,
        assetName: this.currentUpdate.assetName
      });

      if (res.success) {
        this.isDownloaded = true;
        this.isDownloading = false;
        this.actionBtn.disabled = false;
        this.actionBtnText.textContent = 'Перезапустить и обновить';
        this.progressPercent.textContent = '100% — Готово к установке';
        this.progressBar.style.width = '100%';
        this.progressBar.style.background = 'var(--accent-success)';
      } else {
        throw new Error(res.error || 'Download failed');
      }
    } catch (err) {
      this.isDownloading = false;
      this.actionBtn.disabled = false;
      this.cancelBtn.style.display = 'inline-block';
      this.actionBtnText.textContent = 'Попробовать снова';
      alert(`Не удалось скачать обновление: ${err.message}`);
    }
  },

  onProgress(progress) {
    if (!this.progressSection) return;
    const percent = progress.percent || 0;
    this.progressBar.style.width = `${percent}%`;
    this.progressPercent.textContent = `${percent}%`;

    const downloadedMb = (progress.downloaded / (1024 * 1024)).toFixed(1);
    const totalMb = (progress.total / (1024 * 1024)).toFixed(1);
    this.progressBytes.textContent = `${downloadedMb} / ${totalMb} МБ`;
  },

  async checkManual() {
    if (!this.settingsUpdateStatus) return;

    this.btnCheckManual.disabled = true;
    this.settingsUpdateStatus.textContent = 'Проверка наличия обновлений на сервере...';
    this.settingsUpdateStatus.style.color = 'var(--text-secondary)';

    try {
      const res = await window.qtracker.checkForUpdates();
      this.btnCheckManual.disabled = false;

      if (res.updateAvailable) {
        this.settingsUpdateStatus.textContent = `Доступна новая версия: v${res.latestVersion}!`;
        this.settingsUpdateStatus.style.color = 'var(--accent-success)';
        this.showUpdateModal(res);
      } else if (res.error) {
        this.settingsUpdateStatus.textContent = `Ошибка проверки обновлений: ${res.error}`;
        this.settingsUpdateStatus.style.color = 'var(--accent-danger)';
      } else {
        this.settingsUpdateStatus.textContent = `У вас установлена самая последняя версия (v${res.currentVersion}).`;
        this.settingsUpdateStatus.style.color = 'var(--accent-success)';
      }
    } catch (err) {
      this.btnCheckManual.disabled = false;
      this.settingsUpdateStatus.textContent = `Ошибка: ${err.message}`;
      this.settingsUpdateStatus.style.color = 'var(--accent-danger)';
    }
  }
};
