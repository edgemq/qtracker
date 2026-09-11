// Settings & RuTracker Account Module
const SettingsModule = {
  currentSettings: null,

  init() {
    this.authStatusText = document.getElementById('settings-auth-status-text');
    this.authStatusBanner = document.getElementById('auth-status-banner');
    this.btnLogout = document.getElementById('btn-logout');
    this.loginFormArea = document.getElementById('login-form-area');
    this.usernameInput = document.getElementById('login-username');
    this.passwordInput = document.getElementById('login-password');
    this.btnSubmitLogin = document.getElementById('btn-submit-login');
    this.btnOpenWebLogin = document.getElementById('btn-open-web-login');
    this.bbSessionInput = document.getElementById('input-bb-session');
    this.btnApplyCookie = document.getElementById('btn-apply-cookie');

    this.mirrorSelect = document.getElementById('settings-mirror-select');
    this.customMirrorGroup = document.getElementById('custom-mirror-group');
    this.customMirrorInput = document.getElementById('settings-custom-mirror');
    this.currentMirrorDisplay = document.getElementById('current-mirror-display');

    this.proxyTypeSelect = document.getElementById('settings-proxy-type');
    this.proxyFields = document.querySelectorAll('.proxy-field');
    this.proxyHostInput = document.getElementById('settings-proxy-host');
    this.proxyPortInput = document.getElementById('settings-proxy-port');
    this.btnTestProxy = document.getElementById('btn-test-proxy');
    this.proxyTestResult = document.getElementById('proxy-test-result');

    this.downloadDirInput = document.getElementById('settings-download-dir');
    this.btnBrowseFolder = document.getElementById('btn-browse-folder');
    this.engineModeSelect = document.getElementById('settings-engine-mode');
    this.autoStopSeedingInput = document.getElementById('settings-auto-stop-seeding');
    this.btnSaveSettings = document.getElementById('btn-save-settings');
    this.saveIndicator = document.getElementById('settings-save-indicator');

    this.bindEvents();
    this.loadSettings();

    // Listen for auth status changes
    window.qtracker.onAuthStatus((status) => {
      this.updateAuthUI(status);
    });
  },

  bindEvents() {
    // Login form
    this.btnSubmitLogin.addEventListener('click', () => this.handlePasswordLogin());
    this.btnOpenWebLogin.addEventListener('click', () => this.handleWebLogin());
    this.btnApplyCookie.addEventListener('click', () => this.handleCookieLogin());
    this.btnLogout.addEventListener('click', () => this.handleLogout());

    // Mirror change
    this.mirrorSelect.addEventListener('change', () => {
      if (this.mirrorSelect.value === 'custom') {
        this.customMirrorGroup.style.display = 'flex';
      } else {
        this.customMirrorGroup.style.display = 'none';
      }
    });

    // Proxy type change
    this.proxyTypeSelect.addEventListener('change', () => {
      const type = this.proxyTypeSelect.value;
      const isProxy = type === 'socks5' || type === 'http';
      this.proxyFields.forEach(f => f.style.display = isProxy ? 'flex' : 'none');
    });

    // Test proxy connection
    this.btnTestProxy.addEventListener('click', () => this.testConnection());

    // Choose download folder
    this.btnBrowseFolder.addEventListener('click', async () => {
      const folder = await window.qtracker.chooseFolder();
      if (folder) {
        this.downloadDirInput.value = folder;
      }
    });

    // Save all settings
    this.btnSaveSettings.addEventListener('click', () => this.saveSettings());
  },

  async loadSettings() {
    this.currentSettings = await window.qtracker.getSettings();

    // Fill mirror
    if (this.mirrorSelect) {
      const mirror = this.currentSettings.mirror || 'https://rutracker.org';
      if (['https://rutracker.org', 'https://rutracker.net', 'https://rutracker.nl'].includes(mirror)) {
        this.mirrorSelect.value = mirror;
        this.customMirrorGroup.style.display = 'none';
      } else {
        this.mirrorSelect.value = 'custom';
        this.customMirrorGroup.style.display = 'flex';
        this.customMirrorInput.value = mirror;
      }
      this.currentMirrorDisplay.textContent = `Зеркало: ${new URL(mirror).hostname}`;
    }

    // Fill proxy
    const proxy = this.currentSettings.proxy || {};
    if (proxy.enabled) {
      this.proxyTypeSelect.value = proxy.type || 'socks5';
      this.proxyFields.forEach(f => f.style.display = 'flex');
      this.proxyHostInput.value = proxy.host || '127.0.0.1';
      this.proxyPortInput.value = proxy.port || 1080;
    } else {
      this.proxyTypeSelect.value = 'direct';
      this.proxyFields.forEach(f => f.style.display = 'none');
    }

    // Fill paths and engine
    this.downloadDirInput.value = this.currentSettings.downloadDir || '';
    this.engineModeSelect.value = this.currentSettings.engineMode || 'builtin';
    if (this.autoStopSeedingInput) {
      this.autoStopSeedingInput.checked = !!this.currentSettings.autoStopSeeding;
    }

    // Check auth status
    const auth = this.currentSettings.auth || {};
    if (auth.sessionCookie) {
      this.bbSessionInput.value = auth.sessionCookie;
    }
    this.updateAuthUI(auth);
  },

  updateAuthUI(auth) {
    const sidebarLabel = document.getElementById('sidebar-auth-label');
    const sidebarUser = document.getElementById('sidebar-auth-user');
    const sidebarDot = document.getElementById('sidebar-auth-dot');

    if (auth && auth.isLoggedIn) {
      const username = auth.username || 'Пользователь';
      this.authStatusText.innerHTML = `<strong>Авторизован как:</strong> <span style="color: var(--accent-success);">${username}</span>`;
      this.authStatusBanner.style.background = 'rgba(16, 185, 129, 0.1)';
      this.authStatusBanner.style.borderColor = 'rgba(16, 185, 129, 0.4)';
      this.btnLogout.style.display = 'inline-block';
      this.loginFormArea.style.opacity = '0.5';

      sidebarUser.textContent = username;
      sidebarLabel.textContent = 'RuTracker Авторизован';
      sidebarDot.classList.add('online');
    } else {
      this.authStatusText.textContent = 'Статус: Не авторизован';
      this.authStatusBanner.style.background = 'rgba(99, 102, 241, 0.1)';
      this.authStatusBanner.style.borderColor = 'rgba(99, 102, 241, 0.3)';
      this.btnLogout.style.display = 'none';
      this.loginFormArea.style.opacity = '1';

      sidebarUser.textContent = 'Не авторизован';
      sidebarLabel.textContent = 'Статус RuTracker';
      sidebarDot.classList.remove('online');
    }
  },

  async handlePasswordLogin() {
    const username = this.usernameInput.value.trim();
    const password = this.passwordInput.value;

    if (!username || !password) {
      alert('Пожалуйста, введите логин и пароль.');
      return;
    }

    this.btnSubmitLogin.textContent = 'Проверка...';
    this.btnSubmitLogin.disabled = true;

    try {
      const res = await window.qtracker.login(username, password);
      if (res.success) {
        alert(`Авторизация успешна! Добро пожаловать, ${res.username || username}!`);
        this.passwordInput.value = '';
      } else {
        if (res.needsCaptcha) {
          const openWeb = confirm(`${res.message}\n\nОткрыть встроенное окно браузера для прохождения проверки?`);
          if (openWeb) {
            this.handleWebLogin();
          }
        } else {
          alert(`Ошибка входа: ${res.message}`);
        }
      }
    } catch (err) {
      alert(`Ошибка сети: ${err.message}`);
    } finally {
      this.btnSubmitLogin.textContent = 'Войти по логину и паролю';
      this.btnSubmitLogin.disabled = false;
    }
  },

  async handleCookieLogin() {
    const cookie = this.bbSessionInput.value.trim();
    if (!cookie) {
      alert('Пожалуйста, введите значение cookie bb_session.');
      return;
    }

    this.btnApplyCookie.textContent = 'Проверка...';
    this.btnApplyCookie.disabled = true;

    try {
      const res = await window.qtracker.loginCookie(cookie);
      if (res.success) {
        alert(`Сессия подтверждена! Авторизован как: ${res.username}`);
      } else {
        alert(`Ошибка проверки cookie: ${res.message}`);
      }
    } catch (err) {
      alert(`Ошибка: ${err.message}`);
    } finally {
      this.btnApplyCookie.textContent = 'Применить cookie';
      this.btnApplyCookie.disabled = false;
    }
  },

  async handleWebLogin() {
    this.btnOpenWebLogin.textContent = 'Окно авторизации открыто...';
    this.btnOpenWebLogin.disabled = true;

    try {
      const res = await window.qtracker.openWebAuth();
      if (res.success) {
        alert(`Авторизация успешно завершена! Добро пожаловать, ${res.username}!`);
      }
    } catch (err) {
      console.error(err);
    } finally {
      this.btnOpenWebLogin.textContent = '🌐 Войти через встроенное окно браузера';
      this.btnOpenWebLogin.disabled = false;
    }
  },

  async handleLogout() {
    if (confirm('Вы уверены, что хотите выйти из учетной записи RuTracker?')) {
      await window.qtracker.logout();
      this.bbSessionInput.value = '';
    }
  },

  async testConnection() {
    this.proxyTestResult.textContent = 'Тестирование соединения...';
    this.proxyTestResult.style.color = 'var(--text-highlight)';

    try {
      const mirror = this.getSelectedMirror();
      const res = await window.qtracker.testProxy(`${mirror}/forum/index.php`);

      if (res.success) {
        this.proxyTestResult.textContent = `✓ ${res.message}`;
        this.proxyTestResult.style.color = 'var(--accent-success)';
      } else {
        this.proxyTestResult.textContent = `✕ ${res.message}`;
        this.proxyTestResult.style.color = 'var(--accent-danger)';
      }
    } catch (err) {
      this.proxyTestResult.textContent = `✕ Ошибка: ${err.message}`;
      this.proxyTestResult.style.color = 'var(--accent-danger)';
    }
  },

  getSelectedMirror() {
    if (this.mirrorSelect.value === 'custom') {
      return this.customMirrorInput.value.trim() || 'https://rutracker.org';
    }
    return this.mirrorSelect.value;
  },

  async saveSettings() {
    const mirror = this.getSelectedMirror();
    const proxyType = this.proxyTypeSelect.value;
    const isProxyEnabled = proxyType === 'socks5' || proxyType === 'http';

    const proxyConfig = {
      enabled: isProxyEnabled,
      type: proxyType,
      host: this.proxyHostInput.value.trim() || '127.0.0.1',
      port: parseInt(this.proxyPortInput.value || '1080', 10),
      username: '',
      password: ''
    };

    const newSettings = {
      mirror,
      proxy: proxyConfig,
      downloadDir: this.downloadDirInput.value.trim(),
      engineMode: this.engineModeSelect.value,
      autoStopSeeding: this.autoStopSeedingInput ? this.autoStopSeedingInput.checked : false
    };

    const saved = await window.qtracker.saveSettings(newSettings);
    this.currentSettings = saved;
    this.currentMirrorDisplay.textContent = `Зеркало: ${new URL(mirror).hostname}`;

    // Show indicator
    this.saveIndicator.style.display = 'inline';
    setTimeout(() => {
      this.saveIndicator.style.display = 'none';
    }, 2500);
  }
};
