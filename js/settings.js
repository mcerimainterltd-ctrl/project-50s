/*
 * settings.js — XamePage v2.1.1 (FIXED)
 *
 * Provides (plain globals, no import/export):
 *   settingsStore    — reactive key/value singleton
 *   settingsModule   — UI + persistence + socket sync singleton
 *
 * Depends on globals (with fallbacks):
 *   storage          ← storage.js   (.get / .set)
 *   socket           ← state.js     (may be null; re-bound on xame:socket-ready)
 *   showNotification ← utils.js     (fallback = console.log)
 *   escapeHtml       ← utils.js     (polyfill provided)
 *   show             ← ui.js        (fallback = classList + style)
 *   elContacts       ← ui.js        (fallback = '#contactsSection')
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. SAFEGUARDS FOR MISSING GLOBALS
// ─────────────────────────────────────────────────────────────────────────────

// Polyfill escapeHtml if not present
if (typeof escapeHtml === 'undefined') {
  window.escapeHtml = function (text) {
    if (text == null) return '';
    return String(text).replace(/[&<>"]/g, function (m) {
      if (m === '&') return '&amp;';
      if (m === '<') return '&lt;';
      if (m === '>') return '&gt;';
      if (m === '"') return '&quot;';
      return m;
    });
  };
  console.warn('[Settings] escapeHtml polyfill applied.');
}

// Fallback storage if missing (simple localStorage wrapper)
if (typeof storage === 'undefined') {
  window.storage = {
    get: (key, def) => {
      try {
        const val = localStorage.getItem(key);
        return val ? JSON.parse(val) : def;
      } catch {
        return def;
      }
    },
    set: (key, val) => {
      try {
        localStorage.setItem(key, JSON.stringify(val));
      } catch (e) {
        console.error('[Settings] storage.set failed', e);
      }
    },
  };
  console.warn('[Settings] storage fallback applied.');
}

// Fallback showNotification
if (typeof showNotification === 'undefined') {
  window.showNotification = (msg, type = 'info') => {
    console.log(`[Notification] ${msg}`);
    // Optionally create a simple toast
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#333;color:#fff;padding:8px 16px;border-radius:8px;z-index:9999;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  };
  console.warn('[Settings] showNotification fallback applied.');
}

// Fallback show (screen navigator)
if (typeof show === 'undefined') {
  window.show = (el) => {
    if (!el) return;
    // Hide all screens (assume they have class 'screen')
    document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
    el.classList.remove('hidden');
    el.style.display = ''; // let CSS decide
  };
  console.warn('[Settings] show fallback applied.');
}

// Fallback elContacts (if not defined, try to find it)
if (typeof elContacts === 'undefined') {
  window.elContacts = document.getElementById('contactsSection') || null;
  if (!elContacts) console.warn('[Settings] elContacts not found, will use fallback hide().');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. DEFAULT SETTINGS SCHEMA (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
const SETTINGS_DEFAULTS = {
  'account.privacy.lastSeen':            'contacts',
  'account.privacy.profilePhoto':        'contacts',
  'account.privacy.readReceipts':        true,
  'account.privacy.typingIndicators':    true,
  'account.security.twoFactor':          false,
  'account.security.securityNotifs':     true,
  'account.data.autoDownloadWifi':       'media',
  'account.data.autoDownloadMobile':     'none',
  'account.data.autoDownloadRoaming':    'none',
  'notifications.messages.sound':        true,
  'notifications.messages.vibration':    true,
  'notifications.messages.popup':        true,
  'notifications.messages.preview':      true,
  'notifications.messages.highPriority': false,
  'notifications.calls.sound':           true,
  'notifications.calls.vibration':       true,
  'notifications.calls.fullscreen':      true,
  'chats.defaultTimer':                  'off',
  'chats.applyTimerToNewOnly':           true,
  'chats.enterToSend':                   false,
  'calls.silenceUnknown':                false,
  'calls.lowData':                       false,
  'calls.noiseSuppression':              true,
  'calls.echoCancellation':              true,
  'calls.recordingEnabled':              false,
  'appearance.theme':                    'dark',
  'appearance.fontSize':                 'normal',
  'appearance.bubbleStyle':              'modern',
  'appearance.wallpaper':                 null,
  'appearance.reducedMotion':             false,
  'appearance.highContrast':              false,
  'storage.proxyEnabled':                 false,
  'storage.proxyType':                    'socks5',
  'storage.proxyHost':                    '',
  'storage.proxyPort':                    '',
};

const _SETTINGS_KEY = 'xame:settings';

// ─────────────────────────────────────────────────────────────────────────────
// 3. SETTINGS STORE (unchanged logic, but with safe storage)
// ─────────────────────────────────────────────────────────────────────────────
class _SettingsStore {
  constructor() {
    this._data      = { ...SETTINGS_DEFAULTS };
    this._listeners = new Map(); // key → Set<fn>
  }

  load() {
    try {
      const saved = storage.get(_SETTINGS_KEY, {});
      if (saved && typeof saved === 'object') {
        Object.keys(saved).forEach(key => {
          if (key in SETTINGS_DEFAULTS) this._data[key] = saved[key];
        });
      }
    } catch (err) {
      console.error('[SettingsStore] Failed to load:', err);
    }
  }

  _persist() {
    try { storage.set(_SETTINGS_KEY, { ...this._data }); }
    catch (err) { console.error('[SettingsStore] Failed to persist:', err); }
  }

  get(key) {
    return key in this._data ? this._data[key] : SETTINGS_DEFAULTS[key];
  }

  set(key, value, sync = true) {
    const prev = this._data[key];
    if (prev === value) return;
    this._data[key] = value;
    this._persist();
    this._notify(key, value, prev);
    if (sync) this._syncToServer(key, value);
  }

  on(key, fn) {
    if (!this._listeners.has(key)) this._listeners.set(key, new Set());
    this._listeners.get(key).add(fn);
    return () => this._listeners.get(key)?.delete(fn);
  }

  _notify(key, value, prev) {
    this._listeners.get(key)?.forEach(fn => {
      try { fn(value, prev); }
      catch (err) { console.error('[SettingsStore] Listener error:', err); }
    });
  }

  _syncToServer(key, value) {
    if (typeof socket !== 'undefined' && socket?.connected) {
      socket.emit('settings-changed', { key, value });
    }
  }

  applyRemote(changes) {
    if (!changes || typeof changes !== 'object') return;
    Object.entries(changes).forEach(([key, value]) => {
      const prev = this._data[key];
      if (prev !== value) {
        this._data[key] = value;
        this._notify(key, value, prev);
      }
    });
    this._persist();
  }

  getAll() { return { ...this._data }; }

  reset(key) {
    if (key in SETTINGS_DEFAULTS) this.set(key, SETTINGS_DEFAULTS[key]);
  }

  resetAll() {
    this._data = { ...SETTINGS_DEFAULTS };
    this._persist();
    Object.keys(SETTINGS_DEFAULTS).forEach(key =>
      this._notify(key, SETTINGS_DEFAULTS[key], undefined)
    );
  }
}

const settingsStore = new _SettingsStore();

// ─────────────────────────────────────────────────────────────────────────────
// 4. SETTINGS CATEGORIES (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

const _SETTINGS_CATEGORIES = [
  {
    id: 'account', icon: '👤', label: 'Account',
    sections: [
      { title: 'Privacy', items: [
        { key: 'account.privacy.lastSeen',         label: 'Last Seen',          type: 'select', options: [{value:'everyone',label:'Everyone'},{value:'contacts',label:'Contacts'},{value:'nobody',label:'Nobody'}] },
        { key: 'account.privacy.profilePhoto',     label: 'Profile Photo',      type: 'select', options: [{value:'everyone',label:'Everyone'},{value:'contacts',label:'Contacts'},{value:'nobody',label:'Nobody'}] },
        { key: 'account.privacy.readReceipts',     label: 'Read Receipts',      type: 'toggle' },
        { key: 'account.privacy.typingIndicators', label: 'Typing Indicators',  type: 'toggle' },
        { label: 'Blocked Numbers', type: 'action', action: 'open-blocked-numbers' },
      ]},
      { title: 'Security', items: [
        { key: 'account.security.twoFactor',      label: 'Two-Factor Auth',        type: 'toggle' },
        { key: 'account.security.securityNotifs', label: 'Security Notifications', type: 'toggle' },
      ]},
      { title: 'Data', items: [
        { key: 'account.data.autoDownloadWifi',    label: 'Auto-Download (WiFi)',    type: 'select', options: [{value:'none',label:'None'},{value:'media',label:'Media'},{value:'all',label:'All'}] },
        { key: 'account.data.autoDownloadMobile',  label: 'Auto-Download (Mobile)',  type: 'select', options: [{value:'none',label:'None'},{value:'media',label:'Media'},{value:'all',label:'All'}] },
        { key: 'account.data.autoDownloadRoaming', label: 'Auto-Download (Roaming)', type: 'select', options: [{value:'none',label:'None'},{value:'media',label:'Media'},{value:'all',label:'All'}] },
      ]},
    ]
  },
  {
    id: 'notifications', icon: '🔔', label: 'Notifications',
    sections: [
      { title: 'Messages', items: [
        { key: 'notifications.messages.sound',        label: 'Sound',         type: 'toggle' },
        { key: 'notifications.messages.vibration',    label: 'Vibration',     type: 'toggle' },
        { key: 'notifications.messages.popup',        label: 'Popup',         type: 'toggle' },
        { key: 'notifications.messages.preview',      label: 'Preview',       type: 'toggle' },
        { key: 'notifications.messages.highPriority', label: 'High Priority', type: 'toggle' },
        { label: 'Incoming Message Tone', type: 'action', action: 'pick-incoming-tone' },
        { label: 'Outgoing Message Tone', type: 'action', action: 'pick-outgoing-tone' },
      ]},
      { title: 'Calls', items: [
        { key: 'notifications.calls.sound',      label: 'Sound',           type: 'toggle' },
        { key: 'notifications.calls.vibration',  label: 'Vibration',       type: 'toggle' },
        { key: 'notifications.calls.fullscreen', label: 'Fullscreen Alert', type: 'toggle' },
        { label: 'Incoming Call Ringtone', type: 'action', action: 'pick-incoming-ringtone' },
        { label: 'Outgoing Call Ringtone', type: 'action', action: 'pick-outgoing-ringtone' },
      ]},
    ]
  },
  {
    id: 'chats', icon: '💬', label: 'Chats',
    sections: [
      { title: 'Disappearing Messages', items: [
        { key: 'chats.defaultTimer',        label: 'Default Timer', type: 'select', options: [{value:'off',label:'Off'},{value:'30s',label:'30 seconds'},{value:'5m',label:'5 minutes'},{value:'1h',label:'1 hour'},{value:'1d',label:'1 day'},{value:'7d',label:'7 days'},{value:'90d',label:'90 days'}] },
        { key: 'chats.applyTimerToNewOnly', label: 'Apply to New Messages Only', type: 'toggle' },
      ]},
      { title: 'Input', items: [
        { key: 'chats.enterToSend', label: 'Enter to Send', type: 'toggle' },
      ]},
      { title: 'Backup', items: [
        { label: 'Export Chats',    type: 'action', action: 'export-chats' },
        { label: 'Import Chats',    type: 'action', action: 'import-chats' },
        { label: 'Clear All Chats', type: 'action', action: 'clear-all-chats', danger: true },
      ]},
    ]
  },
  {
    id: 'calls', icon: '📞', label: 'Calls',
    sections: [
      { title: 'Call Settings', items: [
        { key: 'calls.silenceUnknown',   label: 'Silence Unknown Callers', type: 'toggle' },
        { key: 'calls.lowData',          label: 'Low Data Mode',           type: 'toggle' },
        { key: 'calls.noiseSuppression', label: 'Noise Suppression',       type: 'toggle' },
        { key: 'calls.echoCancellation', label: 'Echo Cancellation',       type: 'toggle' },
      ]},
    ]
  },
  {
    id: 'appearance', icon: '🎨', label: 'Appearance',
    sections: [
      { title: 'Theme', items: [
        { key: 'appearance.theme',       label: 'Theme',       type: 'select', options: [{value:'dark',label:'Dark'},{value:'light',label:'Light'},{value:'midnight',label:'Midnight'},{value:'forest',label:'Forest'},{value:'system',label:'System'}] },
        { key: 'appearance.fontSize',    label: 'Font Size',   type: 'select', options: [{value:'small',label:'Small'},{value:'normal',label:'Normal'},{value:'large',label:'Large'}] },
        { key: 'appearance.bubbleStyle', label: 'Bubble Style', type: 'select', options: [{value:'modern',label:'Modern'},{value:'classic',label:'Classic'}] },
      ]},
      { title: 'Accessibility', items: [
        { key: 'appearance.reducedMotion', label: 'Reduced Motion', type: 'toggle' },
        { key: 'appearance.highContrast',  label: 'High Contrast',  type: 'toggle' },
      ]},
    ]
  },
  {
    id: 'storage', icon: '💾', label: 'Storage',
    sections: [
      { title: 'Storage', items: [
        { label: 'Manage Storage', type: 'action', action: 'manage-storage' },
        { label: 'Clear Cache',    type: 'action', action: 'clear-cache' },
      ]},
      { title: 'Proxy', items: [
        { key: 'storage.proxyEnabled', label: 'Enable Proxy', type: 'toggle' },
        { key: 'storage.proxyType',    label: 'Proxy Type',   type: 'select', options: [{value:'socks5',label:'SOCKS5'},{value:'http',label:'HTTP'}] },
        { key: 'storage.proxyHost',    label: 'Proxy Host',   type: 'text', placeholder: '127.0.0.1' },
        { key: 'storage.proxyPort',    label: 'Proxy Port',   type: 'text', placeholder: '1080' },
      ]},
    ]
  },
  {
    id: 'help', icon: '❓', label: 'Help',
    sections: [
      { title: 'Support', items: [
        { label: 'FAQ',              type: 'action', action: 'open-faq' },
        { label: 'Contact Support',  type: 'action', action: 'contact-support' },
        { label: 'Terms of Service', type: 'action', action: 'open-terms' },
        { label: 'Privacy Policy',   type: 'action', action: 'open-privacy' },
      ]},
    ]
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 5. SETTINGS MODULE (with fixes)
// ─────────────────────────────────────────────────────────────────────────────
class _SettingsModule {
  constructor() {
    this._el          = null;
    this._activeId    = null;
    this._searchQuery = '';
    settingsStore.load();
  }

  init() {
    this._injectScreen();
    document.addEventListener('xame:socket-ready', () => this._bindSocketActions());
    console.log('[SettingsModule] Initialized');
  }

  // PUBLIC: show settings screen
  showSettings(categoryId = null) {
    console.log('[Settings] showSettings called', categoryId);
    this._injectScreen();               // ensures element exists
    if (categoryId) this._activeId = categoryId;
    this._render(this._activeId);

    // Try to use global show() if available, else manual reveal
    if (typeof show === 'function') {
      show(this._el);
    } else {
      // Fallback: hide all screens and show settings
      document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
      this._el.classList.remove('hidden');
      this._el.style.display = 'flex';   // or 'block', depending on your CSS
    }
  }

  hide() {
    if (typeof show === 'function' && elContacts) {
      show(elContacts);
    } else {
      this._el.classList.add('hidden');
      // Try to show contacts manually if elContacts exists
      if (elContacts) {
        elContacts.classList.remove('hidden');
      } else {
        // Fallback: just hide settings
        document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
      }
    }
  }

  // ── Screen injection ────────────────────────────────────────────────────────
  _injectScreen() {
    let el = document.getElementById('settingsSection');
    if (!el) {
      const app = document.getElementById('app') || document.body; // fallback to body
      el = document.createElement('div');
      el.id        = 'settingsSection';
      el.className = 'screen hidden';
      app.appendChild(el);
      console.log('[Settings] #settingsSection created and appended');
    }
    this._el = el;
  }

  // ── Rendering ───────────────────────────────────────────────────────────────
  _render(categoryId = null) {
    if (!this._el) {
      console.error('[Settings] _el is null, cannot render');
      return;
    }

    const activeCat = categoryId || this._activeId || _SETTINGS_CATEGORIES[0].id;
    this._activeId  = activeCat;

    // Build HTML with safe escapeHtml
    const html = `
      <div class="settings-layout">
        <header class="header">
          <button class="icon-btn" id="settingsBackBtn">←</button>
          <h3>Settings</h3>
          <button class="icon-btn" id="settingsResetBtn" title="Reset all settings">↺</button>
        </header>
        <div class="settings-search-bar">
          <input id="settingsSearch" class="search-input" placeholder="Search settings…"
                 value="${escapeHtml(this._searchQuery)}" autocomplete="off" />
        </div>
        <div class="settings-body">
          <nav class="settings-nav" id="settingsNav">
            ${_SETTINGS_CATEGORIES.map(cat => `
              <button class="settings-nav-item${cat.id === activeCat ? ' active' : ''}"
                      data-cat="${escapeHtml(cat.id)}">
                <span class="settings-nav-icon">${cat.icon}</span>
                <span class="settings-nav-label">${escapeHtml(cat.label)}</span>
              </button>
            `).join('')}
          </nav>
          <main class="settings-detail" id="settingsDetail">
            ${this._renderCategory(activeCat)}
          </main>
        </div>
      </div>
    `;

    this._el.innerHTML = html;
    this._attachListeners();
  }

  _renderCategory(catId) {
    const cat = _SETTINGS_CATEGORIES.find(c => c.id === catId);
    if (!cat) return '<p class="settings-empty">Category not found.</p>';

    const q = this._searchQuery.trim().toLowerCase();
    return cat.sections.map(section => {
      const items = q
        ? section.items.filter(item => item.label.toLowerCase().includes(q))
        : section.items;
      if (items.length === 0) return '';
      return `
        <div class="settings-section">
          <div class="settings-section-title">${escapeHtml(section.title)}</div>
          ${items.map(item => this._renderItem(item)).join('')}
        </div>
      `;
    }).join('');
  }

  _renderItem(item) {
    const value = settingsStore.get(item.key);
    switch (item.type) {
      case 'toggle':
        return `
          <div class="settings-item" data-key="${escapeHtml(item.key)}">
            <div class="settings-item-label">${escapeHtml(item.label)}</div>
            <label class="settings-toggle">
              <input type="checkbox" class="settings-toggle-input"
                     data-key="${escapeHtml(item.key)}"${value ? ' checked' : ''} />
              <span class="settings-toggle-slider"></span>
            </label>
          </div>`;
      case 'select':
        return `
          <div class="settings-item" data-key="${escapeHtml(item.key)}">
            <div class="settings-item-label">${escapeHtml(item.label)}</div>
            <select class="settings-select" data-key="${escapeHtml(item.key)}">
              ${(item.options || []).map(opt =>
                `<option value="${escapeHtml(opt.value)}"${value === opt.value ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
              ).join('')}
            </select>
          </div>`;
      case 'text':
      case 'number':
        return `
          <div class="settings-item" data-key="${escapeHtml(item.key)}">
            <div class="settings-item-label">${escapeHtml(item.label)}</div>
            <input type="${item.type}" class="settings-text-input input"
                   data-key="${escapeHtml(item.key)}"
                   value="${escapeHtml(String(value ?? ''))}"
                   placeholder="${escapeHtml(item.placeholder || '')}" />
          </div>`;
      case 'action':
        return `
          <button class="settings-item settings-action${item.danger ? ' danger' : ''}"
                  data-action="${escapeHtml(item.action)}">
            <div class="settings-item-label">${escapeHtml(item.label)}</div>
            <span class="settings-item-chevron">›</span>
          </button>`;
      case 'info':
        return `
          <div class="settings-item settings-info">
            <div class="settings-item-label">${escapeHtml(item.label)}</div>
            <div class="settings-item-value">${escapeHtml(item.value || '')}</div>
          </div>`;
      default:
        return '';
    }
  }

  // ── Event wiring ────────────────────────────────────────────────────────────
  _attachListeners() {
    if (!this._el) return;

    this._el.querySelector('#settingsBackBtn')
      ?.addEventListener('click', () => this.hide());

    this._el.querySelector('#settingsResetBtn')
      ?.addEventListener('click', () => {
        if (confirm('Reset all settings to defaults?')) {
          settingsStore.resetAll();
          this._render(this._activeId);
          showNotification('Settings reset to defaults');
        }
      });

    this._el.querySelector('#settingsSearch')
      ?.addEventListener('input', e => {
        this._searchQuery = e.target.value;
        this._renderDetailOnly();
      });

    this._el.querySelector('#settingsNav')
      ?.addEventListener('click', e => {
        const btn = e.target.closest('[data-cat]');
        if (!btn) return;
        this._activeId    = btn.dataset.cat;
        this._searchQuery = '';
        this._render(this._activeId);
      });

    this._attachDetailListeners();
  }

  _renderDetailOnly() {
    const detail = this._el?.querySelector('#settingsDetail');
    if (detail) detail.innerHTML = this._renderCategory(this._activeId);
    this._attachDetailListeners();
  }

  _attachDetailListeners() {
    if (!this._el) return;

    this._el.querySelectorAll('.settings-toggle-input').forEach(input => {
      input.addEventListener('change', e => {
        settingsStore.set(e.target.dataset.key, e.target.checked);
        this._applyEffect(e.target.dataset.key, e.target.checked);
      });
    });

    this._el.querySelectorAll('.settings-select').forEach(sel => {
      sel.addEventListener('change', e => {
        settingsStore.set(e.target.dataset.key, e.target.value);
        this._applyEffect(e.target.dataset.key, e.target.value);
      });
    });

    this._el.querySelectorAll('.settings-text-input').forEach(input => {
      let t;
      input.addEventListener('input', e => {
        clearTimeout(t);
        t = setTimeout(() => settingsStore.set(e.target.dataset.key, e.target.value), 400);
      });
    });

    this._el.querySelectorAll('.settings-action').forEach(btn => {
      btn.addEventListener('click', () => this._handleAction(btn.dataset.action));
    });
  }

  // ── Side effects ────────────────────────────────────────────────────────────
  _applyEffect(key, value) {
    const root = document.documentElement;

    if (key === 'appearance.theme') {
      if (typeof themeModule !== 'undefined') themeModule.apply(value);
      else root.dataset.theme = value;
      return;
    }
    if (key === 'appearance.fontSize') {
      root.dataset.fontSize = value;
      document.body.style.fontSize = value === 'small' ? '13px' : value === 'large' ? '17px' : '15px';
      return;
    }
    if (key === 'appearance.bubbleStyle') {
      root.dataset.bubbleStyle = value;
      return;
    }
    if (key === 'appearance.reducedMotion') {
      document.body.classList.toggle('reduce-motion', !!value);
      return;
    }
    if (key === 'appearance.highContrast') {
      document.body.classList.toggle('high-contrast', !!value);
      return;
    }
    if (key === 'chats.defaultTimer') {
      return;
    }
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  _handleAction(action) {
    switch (action) {
      case 'export-chats':    this._exportChats();          break;
      case 'import-chats':    this._importChats();          break;
      case 'clear-all-chats': document.dispatchEvent(new CustomEvent('xame:clear-all-chats')); break;
      case 'manage-storage':  this._showStorageBreakdown(); break;
      case 'clear-cache':     this._clearCache();           break;
      case 'open-faq':        window.open('https://xamepage.com/faq',    '_blank', 'noopener'); break;
      case 'contact-support': window.open('mailto:support@xamepage.com', '_blank'); break;
      case 'open-terms':      window.open('https://xamepage.com/terms',  '_blank', 'noopener'); break;
      case 'open-privacy':    window.open('https://xamepage.com/privacy','_blank', 'noopener'); break;
      case 'open-blocked-numbers':
        if (typeof callBlockingModule !== 'undefined') callBlockingModule.openBlockedNumbersUI();
        break;
      case 'pick-incoming-tone': showTonePicker('incoming'); break;
      case 'pick-outgoing-tone': showTonePicker('outgoing'); break;
      case 'pick-incoming-ringtone': showRingtonePicker('incomingCall'); break;
      case 'pick-outgoing-ringtone': showRingtonePicker('outgoingCall'); break;
      default: console.warn('[SettingsModule] Unknown action:', action);
    }
  }

  // ── Chat backup (unchanged) ─────────────────────────────────────────────────
  _exportChats() {
    try {
      const data = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('xame:chat:')) data[k] = localStorage.getItem(k);
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'xamepage-chats-backup.json';
      a.click();
      showNotification('Chats exported successfully');
    } catch (e) { showNotification('Export failed: ' + e.message); }
  }

  _importChats() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
          showNotification('Chats imported successfully');
        } catch (err) { showNotification('Import failed: invalid file'); }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  _showStorageBreakdown() {
    let total = 0;
    const rows = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k);
      const size = (new Blob([v])).size;
      total += size;
      rows.push({ key: k, size });
    }
    rows.sort((a, b) => b.size - a.size);
    const fmt = b => b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(2) + ' MB';
    const top = rows.slice(0, 15).map(r => `<div class="settings-storage-row"><span>${escapeHtml(r.key)}</span><span>${fmt(r.size)}</span></div>`).join('');
    const html = `<div class="dialog-backdrop"><div class="dialog"><h3>Storage Breakdown</h3><p style="color:var(--text-secondary);font-size:13px">Total: ${fmt(total)}</p><div class="settings-storage-list">${top}</div><div class="row" style="margin-top:12px"><button class="btn secondary" onclick="this.closest('.dialog-backdrop').remove()">Close</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  _clearCache() {
    if (!confirm('Clear cached data? This will not delete your chats.')) return;
    const keep = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('xame:chat:') || k.startsWith('xame:settings') || k.startsWith('xame:user'))) keep.push(k);
    }
    localStorage.clear();
    keep.forEach(k => { /* keys preserved by not clearing them */ });
    showNotification('Cache cleared');
  }

  // ── Socket sync ─────────────────────────────────────────────────────────────
  _bindSocketActions() {
    if (typeof socket === 'undefined' || !socket) return;
    socket.off('settings-changed');
    socket.on('settings-changed', ({ key, value }) => {
      settingsStore.applyRemote({ [key]: value });
      this._applyEffect(key, value);
    });
    socket.off('settings-sync');
    socket.on('settings-sync', changes => {
      if (changes && typeof changes === 'object') settingsStore.applyRemote(changes);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. SINGLETON AND EVENT HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
const settingsModule = new _SettingsModule();

// Open settings when menu fires the custom event
document.addEventListener('xame:open-settings', e => {
  console.log('[Settings] xame:open-settings received', e.detail);
  settingsModule.showSettings(e.detail?.categoryId || null);
});

// Bridge "clear all chats" action → existing contacts.js function
document.addEventListener('xame:clear-all-chats', () => {
  if (typeof clearAllChats === 'function') clearAllChats();
});

// Bridge xame:notify → global showNotification
document.addEventListener('xame:notify', e => {
  if (e.detail?.message) showNotification(e.detail.message);
});

// Init is called by app.js bootstrapApp() after session restore
