const { BrowserWindow, session, net } = require('electron');
const cheerio = require('cheerio');
const store = require('./store');

class RuTrackerClient {
  constructor() {
    this.authWindow = null;
    this.workerWindow = null;
  }

  getMirror() {
    return store.getSettings().mirror || 'https://rutracker.org';
  }

  getWorker() {
    if (!this.workerWindow || this.workerWindow.isDestroyed()) {
      this.workerWindow = new BrowserWindow({
        show: false,
        width: 1024,
        height: 768,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false
        }
      });
    }
    return this.workerWindow;
  }

  /**
   * Syncs stored session cookies into Electron's session so Chromium automatically uses them
   */
  async syncSessionCookies() {
    const auth = store.getSettings().auth;
    const mirror = this.getMirror();
    const hostname = new URL(mirror).hostname;

    if (auth.sessionCookie) {
      try {
        await session.defaultSession.cookies.set({
          url: mirror,
          domain: hostname,
          path: '/forum/',
          name: 'bb_session',
          value: auth.sessionCookie,
          httpOnly: true,
          secure: mirror.startsWith('https')
        });
      } catch (e) {
        console.error('Failed to set bb_session in session:', e);
      }
    }

    if (auth.bbData) {
      try {
        await session.defaultSession.cookies.set({
          url: mirror,
          domain: hostname,
          path: '/forum/',
          name: 'bb_data',
          value: auth.bbData,
          httpOnly: true,
          secure: mirror.startsWith('https')
        });
      } catch (e) {}
    }
  }

  /**
   * Loads a URL via the Chromium worker window to transparently handle Cloudflare Turnstile, TLS, and cookies
   */
  async loadPageViaWorker(url, timeoutMs = 30000) {
    await this.syncSessionCookies();
    const win = this.getWorker();

    return new Promise((resolve, reject) => {
      let resolved = false;
      let checkInterval = null;

      const cleanup = () => {
        if (checkInterval) clearInterval(checkInterval);
        clearTimeout(timer);
      };

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error('Превышено время ожидания ответа от RuTracker (Timeout)'));
        }
      }, timeoutMs);

      const isChallenge = (title, html) => {
        const t = (title || '').toLowerCase();
        if (t.includes('момент') || t.includes('moment') || t.includes('cloudflare') || t.includes('security check') || t.includes('проверки безопасности')) {
          return true;
        }
        if (html && (html.includes('cf-chl-widget') || html.includes('challenge-error-text') || html.includes('cf-turnstile-response'))) {
          if (html.includes('tor-tbl') || html.includes('search-results') || html.includes('post_body')) return false;
          return true;
        }
        return false;
      };

      const checkPage = async () => {
        if (resolved) return;
        try {
          const title = win.getTitle();
          const currentUrl = win.webContents.getURL();

          if (!currentUrl || currentUrl === 'about:blank') return;

          const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
          if (isChallenge(title, html)) {
            return;
          }

          resolved = true;
          cleanup();
          resolve({ url: currentUrl, title, html });
        } catch (e) {
          // Ignore transient script errors during page transitions
        }
      };

      checkInterval = setInterval(checkPage, 800);

      win.loadURL(url).catch(err => {
        const isAborted = err.errno === -3 || err.code === 'ERR_ABORTED' || (err.message && err.message.includes('ERR_ABORTED'));
        if (isAborted) return;
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(err);
        }
      });
    });
  }

  /**
   * Searches RuTracker via tracker.php across all forums with sorting
   */
  async search({ query = '', forumId = '', sort = 'seeds', page = 1 }) {
    const auth = store.getSettings().auth;

    // Check if user has an authorized session
    if (!auth || !auth.sessionCookie || !auth.isLoggedIn) {
      return {
        success: false,
        needsAuth: true,
        message: 'Для поиска раздач на RuTracker.org требуется вход в аккаунт.'
      };
    }

    try {
      const mirror = this.getMirror();

      // Sorting: o=10 (seeds), o=1 (date), o=7 (size), s=2 (desc)
      let o = 10;
      if (sort === 'date') o = 1;
      else if (sort === 'size') o = 7;

      let queryParams = `nm=${encodeURIComponent(query)}&o=${o}&s=2&all=1`;
      if (forumId) {
        queryParams += `&f[]=${forumId}`;
      }

      if (page > 1) {
        const start = (page - 1) * 50;
        queryParams += `&start=${start}`;
      }

      const searchUrl = `${mirror}/forum/tracker.php?${queryParams}`;
      const pageResult = await this.loadPageViaWorker(searchUrl);

      // Check if redirected to login page
      if (pageResult.url.includes('login.php')) {
        return {
          success: false,
          needsAuth: true,
          message: 'Сессия RuTracker устарела или недействительна. Пожалуйста, выполните повторный вход.'
        };
      }

      const $ = cheerio.load(pageResult.html);
      const items = [];
      const forumsMap = new Map();

      $('#tor-tbl tbody tr.hl-tr').each((idx, el) => {
        const row = $(el);

        const titleLink = row.find('a.tLink, a[data-topic_id], .t-title a').first();
        const title = titleLink.text().trim();
        const topicId = row.attr('data-topic_id') || titleLink.attr('data-topic_id') || (titleLink.attr('href') || '').match(/t=(\d+)/)?.[1];

        if (!topicId || !title) return;

        const forumLink = row.find('.f-name a, td.f-name-col a').first();
        const forumName = forumLink.text().trim() || 'Общий';
        const forumHref = forumLink.attr('href') || '';
        const forumIdMatch = forumHref.match(/f=(\d+)/);
        const fId = forumIdMatch ? forumIdMatch[1] : '';

        const author = row.find('.u-name a, td.u-name-col a').first().text().trim() || '';

        const sizeEl = row.find('td.tor-size');
        const sizeText = sizeEl.text().replace(/\s+/g, ' ').trim();
        const sizeBytes = parseInt(sizeEl.attr('data-ts_text') || '0', 10);

        const seeds = parseInt(row.find('b.seedmed, td.seedmed').first().text().replace(/\D/g, '') || '0', 10);
        const leeches = parseInt(row.find('td.leechmed').first().text().replace(/\D/g, '') || '0', 10);

        const dateEl = row.find('td').last();
        const added = dateEl.text().trim() || '—';

        forumsMap.set(forumName, (forumsMap.get(forumName) || 0) + 1);

        items.push({
          id: topicId,
          title,
          category: forumName,
          forum: forumName,
          forumId: fId,
          author,
          sizeText,
          sizeBytes,
          seeds,
          leeches,
          added
        });
      });

      const forumsList = Array.from(forumsMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      return {
        success: true,
        items,
        forums: forumsList,
        page,
        count: items.length
      };
    } catch (err) {
      console.error('RuTracker search error:', err);
      return { success: false, items: [], forums: [], error: err.message };
    }
  }

  /**
   * Retrieves full topic preview with normalized screenshots, posters, and formatted description
   */
  async getTopicPreview(topicId) {
    try {
      const mirror = this.getMirror();
      const topicUrl = `${mirror}/forum/viewtopic.php?t=${topicId}`;
      const pageResult = await this.loadPageViaWorker(topicUrl);

      const $ = cheerio.load(pageResult.html);
      const title = $('h1.maintitle, #topic-title').first().text().trim() || $('title').text().trim();
      const postBody = $('div.post_body').first();

      if (!postBody || postBody.length === 0) {
        return { success: false, error: 'Не удалось загрузить содержимое раздачи' };
      }

      // 1. Normalization: convert <var class="postImg" title="URL"> into real <img> elements
      postBody.find('var.postImg').each((i, el) => {
        const url = $(el).attr('title') || $(el).attr('data-src');
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          $(el).replaceWith(`<img class="postImg normalized-img" src="${url}" loading="lazy" alt="Изображение">`);
        }
      });

      // 2. Extract full-size screenshots from spoiler or links
      const screenshots = [];
      postBody.find('a.postLink, a').each((i, el) => {
        const href = $(el).attr('href') || '';
        if (href.match(/\.(jpg|jpeg|png|webp)($|\?)/i) || href.includes('i.ibb.co') || href.includes('fastpic') || href.includes('imageban')) {
          if (!href.includes('capsule_') && !href.includes('header.') && !href.includes('logo')) {
            screenshots.push(href);
          }
        }
      });

      // Also grab postImg srcs if screenshots list is small
      postBody.find('img.postImg, img').each((i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
          if (!src.includes('smiles') && !src.includes('icon_') && !src.includes('clear.gif') && !src.includes('capsule_')) {
            screenshots.push(src);
          }
        }
      });

      // 3. Remove bottom ad links
      postBody.find('a[href*="/go/"]').closest('span').remove();

      // 4. Sanitize post styles: remove garish background colors, bgcolor attributes, and unreadable neon text
      postBody.find('*').each((i, el) => {
        $(el).removeAttr('bgcolor');
        const style = $(el).attr('style');
        if (style) {
          let cleanStyle = style
            .replace(/background(-color)?\s*:[^;]+;?/gi, '')
            .replace(/color\s*:\s*(#ff[0-9a-f]{2,4}|yellow|lime|cyan)[^;]*;?/gi, '')
            .trim();
          if (cleanStyle) {
            $(el).attr('style', cleanStyle);
          } else {
            $(el).removeAttr('style');
          }
        }
      });

      // 5. Clean up HTML and structure
      let cleanHtml = postBody.html() || '<p>Описание отсутствует</p>';

      return {
        success: true,
        topicId,
        title,
        screenshots: Array.from(new Set(screenshots)).slice(0, 10),
        descriptionHtml: cleanHtml
      };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Downloads .torrent file for a topic using in-DOM fetch inside the authorized Chromium worker
   */
  async downloadTorrentFile(topicId) {
    await this.syncSessionCookies();
    const mirror = this.getMirror();
    const win = this.getWorker();

    // Ensure worker is on mirror domain so in-DOM fetch has valid cookies and TLS session
    const currentUrl = win.webContents.getURL();
    if (!currentUrl || !currentUrl.includes(new URL(mirror).hostname)) {
      await this.loadPageViaWorker(`${mirror}/forum/viewtopic.php?t=${topicId}`);
    }

    const data = await win.webContents.executeJavaScript(`
      fetch('/forum/dl.php?t=${topicId}')
        .then(async res => {
          if (res.status !== 200) {
            throw new Error('Ошибка HTTP ' + res.status);
          }
          const buf = await res.arrayBuffer();
          return Array.from(new Uint8Array(buf));
        })
    `);

    const buffer = Buffer.from(data);
    const checkStr = buffer.slice(0, 100).toString('ascii').toLowerCase();
    if (checkStr.includes('<!doctype') || checkStr.includes('<html')) {
      throw new Error('Сессия устарела. Выполните повторный вход на RuTracker.');
    }

    return buffer;
  }

  /**
   * Login with cookie bb_session
   */
  async loginWithCookie(bbSession) {
    if (!bbSession || !bbSession.trim()) {
      return { success: false, message: 'Cookie bb_session не может быть пустым.' };
    }

    const cleanCookie = bbSession.trim();
    store.updateSettings({
      auth: {
        username: 'Пользователь RuTracker',
        sessionCookie: cleanCookie,
        bbData: '',
        isLoggedIn: true
      }
    });

    await this.syncSessionCookies();
    const status = await this.checkAuthStatus();
    return {
      success: status.isLoggedIn,
      username: status.username || 'Пользователь RuTracker',
      bbSession: cleanCookie
    };
  }

  /**
   * Checks current auth status by loading index.php
   */
  async checkAuthStatus() {
    try {
      const mirror = this.getMirror();
      const pageResult = await this.loadPageViaWorker(`${mirror}/forum/index.php`);

      const $ = cheerio.load(pageResult.html);
      const usernameEl = $('#logged-in-username');
      if (usernameEl.length > 0) {
        const username = usernameEl.text().trim();
        store.updateSettings({
          auth: {
            ...store.getSettings().auth,
            username,
            isLoggedIn: true
          }
        });
        return { isLoggedIn: true, username };
      }

      const profileLink = $('a[href*="profile.php?mode=viewprofile"]');
      if (profileLink.length > 0) {
        const username = profileLink.first().text().trim();
        store.updateSettings({
          auth: {
            ...store.getSettings().auth,
            username,
            isLoggedIn: true
          }
        });
        return { isLoggedIn: true, username };
      }

      store.updateSettings({
        auth: { ...store.getSettings().auth, isLoggedIn: false }
      });
      return { isLoggedIn: false, username: '' };
    } catch (err) {
      return { isLoggedIn: false, error: err.message };
    }
  }

  /**
   * In-App Interactive Web Login Window
   */
  openWebAuthWindow(onSuccess, onError) {
    if (this.authWindow && !this.authWindow.isDestroyed()) {
      this.authWindow.focus();
      return;
    }

    const mirror = this.getMirror();
    this.authWindow = new BrowserWindow({
      width: 800,
      height: 800,
      title: 'Вход на RuTracker.org (QTracker)',
      backgroundColor: '#111827',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false
      }
    });

    this.authWindow.setMenuBarVisibility(false);
    this.authWindow.loadURL(`${mirror}/forum/login.php`);

    const checkCookies = async () => {
      try {
        const hostname = new URL(mirror).hostname;
        const cookies = await session.defaultSession.cookies.get({ domain: hostname });
        const bbSession = cookies.find(c => c.name === 'bb_session');
        const bbData = cookies.find(c => c.name === 'bb_data');

        if (bbSession && bbSession.value) {
          store.updateSettings({
            auth: {
              username: 'Пользователь RuTracker',
              sessionCookie: bbSession.value,
              bbData: bbData ? bbData.value : '',
              isLoggedIn: true
            }
          });

          const status = await this.checkAuthStatus();
          if (this.authWindow && !this.authWindow.isDestroyed()) {
            this.authWindow.close();
            this.authWindow = null;
          }
          if (onSuccess) onSuccess({ success: true, username: status.username, bbSession: bbSession.value });
        }
      } catch (err) {
        console.error('Error in web login:', err);
      }
    };

    this.authWindow.webContents.on('did-finish-load', checkCookies);
    this.authWindow.webContents.on('did-navigate', checkCookies);

    this.authWindow.on('closed', () => {
      this.authWindow = null;
    });
  }

  logout() {
    store.updateSettings({
      auth: {
        username: '',
        sessionCookie: '',
        bbData: '',
        isLoggedIn: false
      }
    });
    return { success: true };
  }
}

module.exports = new RuTrackerClient();
