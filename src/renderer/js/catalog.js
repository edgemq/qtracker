// Catalog & Search Module with Dynamic Forum Filtering
const CatalogModule = {
  allItems: [],
  activeForum: 'all',
  currentTopicForDownload: null,

  init() {
    this.searchInput = document.getElementById('catalog-search-input');
    this.searchBtn = document.getElementById('catalog-search-btn');
    this.sortSelect = document.getElementById('catalog-sort-select');
    this.forumSelect = document.getElementById('catalog-forum-select');
    this.forumSelectWrapper = document.getElementById('forum-select-wrapper');
    this.forumFiltersBar = document.getElementById('forum-filters-bar');
    this.forumChipsContainer = document.getElementById('forum-filter-chips');
    this.resultsList = document.getElementById('catalog-results-list');
    this.resultsCountText = document.getElementById('results-count-text');

    // Modals
    this.previewModal = document.getElementById('preview-modal');
    this.modalCloseBtn = document.getElementById('modal-close-btn');
    this.modalCancelBtn = document.getElementById('modal-cancel-btn');
    this.modalDownloadBtn = document.getElementById('modal-download-btn');
    this.modalTitle = document.getElementById('modal-topic-title');
    this.modalDescription = document.getElementById('modal-description-text');

    // In-App Image Lightbox
    this.lightbox = document.getElementById('image-lightbox');
    this.lightboxImg = document.getElementById('lightbox-img');
    this.lightboxCloseBtn = document.getElementById('lightbox-close-btn');

    this.bindEvents();
  },

  bindEvents() {
    // Search button and Enter key
    this.searchBtn.addEventListener('click', () => this.performSearch());
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.performSearch();
    });

    // Sort select change
    this.sortSelect.addEventListener('change', () => this.performSearch());

    // Forum dropdown filter change
    this.forumSelect.addEventListener('change', (e) => {
      this.filterByForum(e.target.value);
    });

    // Modal close
    this.modalCloseBtn.addEventListener('click', () => this.closePreview());
    this.modalCancelBtn.addEventListener('click', () => this.closePreview());
    this.previewModal.addEventListener('click', (e) => {
      if (e.target === this.previewModal) this.closePreview();
    });

    // Lightbox close
    this.lightboxCloseBtn.addEventListener('click', () => this.closeLightbox());
    this.lightbox.addEventListener('click', (e) => {
      if (e.target !== this.lightboxImg) this.closeLightbox();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.lightbox.style.display !== 'none') this.closeLightbox();
        else if (this.previewModal.classList.contains('active')) this.closePreview();
      }
    });

    // Modal download button
    this.modalDownloadBtn.addEventListener('click', () => {
      if (this.currentTopicForDownload) {
        this.startDownload(this.currentTopicForDownload.id, this.currentTopicForDownload.title);
        this.closePreview();
      }
    });
  },

  async performSearch() {
    const query = this.searchInput.value.trim();
    if (!query) {
      this.resultsCountText.textContent = 'Введите поисковый запрос';
      return;
    }

    const sort = this.sortSelect.value;
    this.activeForum = 'all';

    // Show loading spinner
    this.resultsList.innerHTML = `
      <div class="state-placeholder">
        <div class="spinner"></div>
        <p>Поиск раздач по всему RuTracker...</p>
        <span style="font-size: 12px; color: var(--text-muted);">Запрос выполняется через защищенную сессию трекера</span>
      </div>
    `;
    this.resultsCountText.textContent = 'Выполняется поиск...';
    this.forumFiltersBar.style.display = 'none';
    this.forumSelectWrapper.style.display = 'none';

    try {
      const res = await window.qtracker.search({ query, sort, page: 1 });

      if (!res.success) {
        if (res.needsAuth) {
          this.renderAuthRequired();
          this.resultsCountText.textContent = 'Требуется авторизация';
          return;
        }

        this.resultsList.innerHTML = `
          <div class="state-placeholder">
            <svg viewBox="0 0 24 24" width="48" height="48" stroke="var(--accent-danger)" fill="none" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p style="color: var(--accent-danger);">Не удалось получить результаты поиска.</p>
            <span style="font-size: 13px; color: var(--text-muted);">${res.error || res.message || 'Проверьте доступность трекера или обновите сессию'}</span>
          </div>
        `;
        this.resultsCountText.textContent = 'Ошибка соединения';
        return;
      }

      this.allItems = res.items || [];

      if (this.allItems.length === 0) {
        this.resultsList.innerHTML = `
          <div class="state-placeholder">
            <svg viewBox="0 0 24 24" width="48" height="48" stroke="var(--text-muted)" fill="none" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <p>Ничего не найдено по запросу «${this.escapeHtml(query)}».</p>
            <span style="font-size: 12px; color: var(--text-muted);">Проверьте правильность написания или используйте другое ключевое слово</span>
          </div>
        `;
        this.resultsCountText.textContent = 'Найдено: 0 раздач';
        return;
      }

      // Build Dynamic Forum Filters
      this.buildForumFilters(res.forums || []);
      this.filterByForum('all');
    } catch (err) {
      console.error('Search error:', err);
      this.resultsList.innerHTML = `
        <div class="state-placeholder">
          <p style="color: var(--accent-danger);">Ошибка: ${err.message}</p>
        </div>
      `;
    }
  },

  buildForumFilters(forumsList) {
    this.forumChipsContainer.innerHTML = '';
    this.forumSelect.innerHTML = `<option value="all">Все форумы (${this.allItems.length})</option>`;

    // Add "All Forums" chip
    const allChip = document.createElement('div');
    allChip.className = 'forum-chip active';
    allChip.dataset.forum = 'all';
    allChip.innerHTML = `<span>Все</span> <span class="forum-chip-count">${this.allItems.length}</span>`;
    allChip.addEventListener('click', () => this.filterByForum('all'));
    this.forumChipsContainer.appendChild(allChip);

    // Add individual forum chips & dropdown options
    forumsList.forEach(item => {
      // Add to select dropdown
      const opt = document.createElement('option');
      opt.value = item.name;
      opt.textContent = `${item.name} (${item.count})`;
      this.forumSelect.appendChild(opt);

      // Add chip
      const chip = document.createElement('div');
      chip.className = 'forum-chip';
      chip.dataset.forum = item.name;
      chip.innerHTML = `<span>${this.escapeHtml(item.name)}</span> <span class="forum-chip-count">${item.count}</span>`;
      chip.addEventListener('click', () => this.filterByForum(item.name));
      this.forumChipsContainer.appendChild(chip);
    });

    this.forumFiltersBar.style.display = 'flex';
    this.forumSelectWrapper.style.display = 'flex';
  },

  filterByForum(forumName) {
    this.activeForum = forumName;

    // Sync dropdown
    this.forumSelect.value = forumName;

    // Sync chips active class
    this.forumChipsContainer.querySelectorAll('.forum-chip').forEach(chip => {
      if (chip.dataset.forum === forumName) {
        chip.classList.add('active');
        // Scroll chip into view smoothly
        chip.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } else {
        chip.classList.remove('active');
      }
    });

    // Filter items
    const filtered = forumName === 'all' 
      ? this.allItems 
      : this.allItems.filter(item => item.forum === forumName);

    if (forumName === 'all') {
      this.resultsCountText.textContent = `Найдено раздач: ${filtered.length}`;
    } else {
      this.resultsCountText.textContent = `Раздач в «${forumName}»: ${filtered.length} (из ${this.allItems.length})`;
    }

    this.renderResults(filtered);
  },

  renderResults(items) {
    this.resultsList.innerHTML = '';

    items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'torrent-card';

      card.innerHTML = `
        <div class="torrent-main-info">
          <div class="torrent-title-row">
            <span class="torrent-category-badge" style="cursor: pointer;" title="Фильтровать по форуму «${this.escapeHtml(item.forum)}»">${this.escapeHtml(item.forum || 'Общий')}</span>
            <span class="torrent-title" title="${this.escapeHtml(item.title)}">${this.escapeHtml(item.title)}</span>
          </div>
          <div class="torrent-meta-row">
            <div class="meta-item">
              <span>Размер:</span>
              <strong style="color: var(--text-primary);">${item.sizeText || '—'}</strong>
            </div>
            <div class="meta-item">
              <span>Сиды:</span>
              <span class="meta-seeds">▲ ${item.seeds}</span>
            </div>
            <div class="meta-item">
              <span>Личи:</span>
              <span class="meta-leeches">▼ ${item.leeches}</span>
            </div>
            ${item.author ? `
            <div class="meta-item">
              <span>Автор:</span>
              <span style="color: var(--text-secondary);">${this.escapeHtml(item.author)}</span>
            </div>
            ` : ''}
            <div class="meta-item">
              <span>Добавлено:</span>
              <span>${item.added}</span>
            </div>
          </div>
        </div>

        <div class="torrent-actions-row">
          <button class="btn-preview" data-id="${item.id}">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            <span>Инфо</span>
          </button>
          <button class="btn-download-quick" data-id="${item.id}" data-title="${this.escapeHtml(item.title)}">
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            <span>Скачать</span>
          </button>
        </div>
      `;

      // Forum badge click filters instantly
      card.querySelector('.torrent-category-badge').addEventListener('click', (e) => {
        e.stopPropagation();
        this.filterByForum(item.forum);
      });

      card.querySelector('.btn-preview').addEventListener('click', () => {
        this.openPreview(item.id, item.title);
      });
      card.querySelector('.torrent-title').addEventListener('click', () => {
        this.openPreview(item.id, item.title);
      });
      card.querySelector('.btn-download-quick').addEventListener('click', () => {
        this.startDownload(item.id, item.title);
      });

      this.resultsList.appendChild(card);
    });
  },

  renderAuthRequired() {
    this.resultsList.innerHTML = `
      <div class="auth-card-block" style="background: var(--bg-card); border: 1px solid rgba(99, 102, 241, 0.4); border-radius: var(--radius-lg); padding: 32px 24px; text-align: center; max-width: 580px; margin: 40px auto; display: flex; flex-direction: column; align-items: center; gap: 16px; box-shadow: var(--shadow-lg);">
        <div style="width: 56px; height: 56px; border-radius: 50%; background: rgba(99, 102, 241, 0.15); display: flex; align-items: center; justify-content: center; color: var(--accent-primary);">
          <svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" fill="none" stroke-width="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <h3 style="font-size: 18px; font-weight: 700; color: #fff;">Требуется авторизация на RuTracker.org</h3>
        <p style="font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin: 0 10px;">
          RuTracker.org блокирует гостевой поиск (IS_GUEST=1) и разрешает поиск раздач только зарегистрированным пользователям.<br>
          Войдите в свой аккаунт или вставьте cookie bb_session из вашего браузера.
        </p>
        <div style="display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; margin-top: 8px;">
          <button class="btn-primary" id="catalog-btn-web-login" style="display: flex; align-items: center; gap: 8px; padding: 10px 20px;">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <span>Войти через встроенный браузер</span>
          </button>
          <button class="btn-secondary" id="catalog-btn-cookie-login" style="display: flex; align-items: center; gap: 8px; padding: 10px 18px;">
            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" stroke-width="2">
              <path d="M21 2l-2 2m-2-2l2 2m7 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
            </svg>
            <span>Вставить cookie bb_session</span>
          </button>
        </div>
      </div>
    `;

    document.getElementById('catalog-btn-web-login').addEventListener('click', async () => {
      const res = await window.qtracker.openWebAuth();
      if (res && res.success) {
        this.performSearch();
      }
    });

    document.getElementById('catalog-btn-cookie-login').addEventListener('click', async () => {
      const cookie = prompt('Вставьте значение cookie bb_session из вашего браузера (где вы авторизованы):');
      if (cookie && cookie.trim()) {
        const res = await window.qtracker.loginCookie(cookie.trim());
        if (res.success) {
          alert(`Авторизован как: ${res.username}`);
          this.performSearch();
        } else {
          alert(res.message);
        }
      }
    });
  },

  async openPreview(topicId, title) {
    this.currentTopicForDownload = { id: topicId, title };
    this.modalTitle.textContent = title;
    this.modalDescription.innerHTML = '<div class="spinner" style="margin: 40px auto;"></div>';
    this.previewModal.classList.add('active');

    try {
      const res = await window.qtracker.getPreview(topicId);
      if (!res.success) {
        this.modalDescription.innerHTML = `<p style="color: var(--accent-danger);">Не удалось загрузить предпросмотр: ${res.error || 'Ошибка сети'}</p>`;
        return;
      }

      this.modalDescription.innerHTML = res.descriptionHtml;

      // Bind interactive spoiler toggles
      this.modalDescription.querySelectorAll('.sp-head').forEach(head => {
        head.addEventListener('click', () => {
          head.classList.toggle('folded');
        });
      });

      // Intercept all image clicks to show in Lightbox & external links to open safely
      this.modalDescription.querySelectorAll('img, a').forEach(el => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();

          let imgSrc = '';
          if (el.tagName === 'IMG') {
            imgSrc = el.src;
            const parentA = el.closest('a');
            if (parentA && parentA.href && parentA.href.match(/\.(jpg|jpeg|png|webp)($|\?)/i)) {
              imgSrc = parentA.href;
            }
          } else if (el.tagName === 'A') {
            const href = el.href || '';
            if (href.match(/\.(jpg|jpeg|png|webp)($|\?)/i)) {
              imgSrc = href;
            } else {
              const childImg = el.querySelector('img');
              if (childImg) {
                imgSrc = childImg.src;
              } else {
                // External site link -> open in user's default system browser
                window.qtracker.openExternal(href);
                return;
              }
            }
          }

          if (imgSrc) {
            CatalogModule.openLightbox(imgSrc);
          }
        });
      });
    } catch (err) {
      this.modalDescription.innerHTML = `<p style="color: var(--accent-danger);">Ошибка: ${err.message}</p>`;
    }
  },

  openLightbox(src) {
    if (!src) return;
    this.lightboxImg.src = src;
    this.lightbox.style.display = 'flex';
  },

  closeLightbox() {
    this.lightbox.style.display = 'none';
    this.lightboxImg.src = '';
  },

  closePreview() {
    this.previewModal.classList.remove('active');
  },

  async startDownload(topicId, title) {
    try {
      const settings = await window.qtracker.getSettings();
      if (!settings.auth || !settings.auth.sessionCookie) {
        const proceed = confirm('Для скачивания торрента с RuTracker требуется авторизация.\nПерейти во вкладку «Настройки / Аккаунт» для входа?');
        if (proceed) {
          document.getElementById('nav-settings').click();
        }
        return;
      }

      // Visual feedback on download buttons
      const btn = document.querySelector(`.btn-download-quick[data-id="${topicId}"]`);
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>Добавление...</span>`;
      }

      const res = await window.qtracker.downloadTopic(topicId, title);

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <span>Скачать</span>
        `;
      }

      if (!res.success) {
        alert(`Ошибка при добавлении торрента: ${res.error || 'Неизвестная ошибка'}`);
        return;
      }

      // Succeeded! Navigate to downloads tab and refresh list
      document.getElementById('nav-downloads').click();
      const allTorrents = await window.qtracker.getAllTorrents();
      if (typeof DownloadsModule !== 'undefined') {
        DownloadsModule.updateTorrentsList(allTorrents);
      }
    } catch (err) {
      alert(`Ошибка: ${err.message}`);
    }
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
