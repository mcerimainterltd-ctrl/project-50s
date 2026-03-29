/*
 * themes.js — XamePage v2.1.1
 *
 * Provides (plain globals, no import/export):
 *   themeModule  — singleton ThemeModule instance
 *
 * Usage:
 *   themeModule.init()                  // call once on app start
 *   themeModule.apply('dark')           // switch theme programmatically
 *   themeModule.showThemePicker()       // open the picker overlay
 *   themeModule.applyWallpaper({...})   // set chat wallpaper
 *
 * Depends on globals (must load after):
 *   settingsStore  ← settings.js  (.get / .set / .on)
 *   storage        ← storage.js   (.get / .set)
 *   escapeHtml     ← utils.js
 *
 * Load order: after settings.js, storage.js, utils.js — before app.js
 */

const _WALLPAPER_KEY = 'xame:wallpaper';

// ─────────────────────────────────────────────────────────────────────────────
// Theme definitions
// ─────────────────────────────────────────────────────────────────────────────
const _THEMES = {
  dark: {
    id: 'dark', name: 'Dark', isDark: true,
    vars: {
      '--color-bg':               '#0f1419',
      '--color-surface':          '#1e2732',
      '--color-surface-variant':  '#263340',
      '--color-primary':          '#0084ff',
      '--color-primary-hover':    '#1a91ff',
      '--color-primary-pressed':  '#0073e6',
      '--color-text':             '#ffffff',
      '--color-text-secondary':   '#8899a6',
      '--color-text-tertiary':    '#536471',
      '--color-success':          '#00ba7c',
      '--color-warning':          '#ffad1f',
      '--color-error':            '#f4212e',
      '--color-info':             '#1d9bf0',
      '--color-border':           '#38444d',
      '--color-border-light':     '#2f3336',
      '--color-overlay':          'rgba(0,0,0,0.6)',
      '--color-scrim':            'rgba(0,0,0,0.8)',
      '--color-bubble-sent':      '#0084ff',
      '--color-bubble-received':  '#1e2732',
      '--color-bubble-sent-text': '#ffffff',
      '--color-bubble-recv-text': '#ffffff',
      '--color-header-bg':        '#1e2732',
      '--color-input-bg':         '#263340',
      '--shadow-sm':              '0 1px 2px rgba(0,0,0,0.3)',
      '--shadow-md':              '0 4px 6px rgba(0,0,0,0.4)',
      '--shadow-lg':              '0 10px 15px rgba(0,0,0,0.5)',
    },
  },

  light: {
    id: 'light', name: 'Light', isDark: false,
    vars: {
      '--color-bg':               '#ffffff',
      '--color-surface':          '#f7f9fa',
      '--color-surface-variant':  '#eff3f4',
      '--color-primary':          '#0084ff',
      '--color-primary-hover':    '#1a91ff',
      '--color-primary-pressed':  '#0073e6',
      '--color-text':             '#0f1419',
      '--color-text-secondary':   '#536471',
      '--color-text-tertiary':    '#8899a6',
      '--color-success':          '#00ba7c',
      '--color-warning':          '#ffad1f',
      '--color-error':            '#f4212e',
      '--color-info':             '#1d9bf0',
      '--color-border':           '#eff3f4',
      '--color-border-light':     '#cfd9de',
      '--color-overlay':          'rgba(0,0,0,0.4)',
      '--color-scrim':            'rgba(0,0,0,0.6)',
      '--color-bubble-sent':      '#0084ff',
      '--color-bubble-received':  '#eff3f4',
      '--color-bubble-sent-text': '#ffffff',
      '--color-bubble-recv-text': '#0f1419',
      '--color-header-bg':        '#f7f9fa',
      '--color-input-bg':         '#eff3f4',
      '--shadow-sm':              '0 1px 2px rgba(0,0,0,0.05)',
      '--shadow-md':              '0 4px 6px rgba(0,0,0,0.1)',
      '--shadow-lg':              '0 10px 15px rgba(0,0,0,0.15)',
    },
  },

  midnight: {
    id: 'midnight', name: 'Midnight Blue', isDark: true,
    vars: {
      '--color-bg':               '#070d1a',
      '--color-surface':          '#0d1b2e',
      '--color-surface-variant':  '#112440',
      '--color-primary':          '#4f8ef7',
      '--color-primary-hover':    '#6ba0f9',
      '--color-primary-pressed':  '#3a7cf5',
      '--color-text':             '#e8edf5',
      '--color-text-secondary':   '#7a9bc4',
      '--color-text-tertiary':    '#4a6a8a',
      '--color-success':          '#00c87e',
      '--color-warning':          '#f5a623',
      '--color-error':            '#e8394a',
      '--color-info':             '#4f8ef7',
      '--color-border':           '#1a2e48',
      '--color-border-light':     '#112240',
      '--color-overlay':          'rgba(0,5,20,0.7)',
      '--color-scrim':            'rgba(0,5,20,0.85)',
      '--color-bubble-sent':      '#1a3a6e',
      '--color-bubble-received':  '#0d1b2e',
      '--color-bubble-sent-text': '#e8edf5',
      '--color-bubble-recv-text': '#e8edf5',
      '--color-header-bg':        '#0d1b2e',
      '--color-input-bg':         '#112440',
      '--shadow-sm':              '0 1px 2px rgba(0,0,0,0.5)',
      '--shadow-md':              '0 4px 6px rgba(0,0,0,0.6)',
      '--shadow-lg':              '0 10px 15px rgba(0,0,0,0.7)',
    },
  },

  forest: {
    id: 'forest', name: 'Forest Green', isDark: true,
    vars: {
      '--color-bg':               '#0a140d',
      '--color-surface':          '#111e14',
      '--color-surface-variant':  '#172b1a',
      '--color-primary':          '#2ecc71',
      '--color-primary-hover':    '#45d980',
      '--color-primary-pressed':  '#27b860',
      '--color-text':             '#e0ede2',
      '--color-text-secondary':   '#7aaa82',
      '--color-text-tertiary':    '#4a7a52',
      '--color-success':          '#2ecc71',
      '--color-warning':          '#f0b429',
      '--color-error':            '#e84040',
      '--color-info':             '#3aafcc',
      '--color-border':           '#1e3a22',
      '--color-border-light':     '#152a18',
      '--color-overlay':          'rgba(5,15,8,0.7)',
      '--color-scrim':            'rgba(5,15,8,0.85)',
      '--color-bubble-sent':      '#1a4a22',
      '--color-bubble-received':  '#111e14',
      '--color-bubble-sent-text': '#e0ede2',
      '--color-bubble-recv-text': '#e0ede2',
      '--color-header-bg':        '#111e14',
      '--color-input-bg':         '#172b1a',
      '--shadow-sm':              '0 1px 2px rgba(0,0,0,0.4)',
      '--shadow-md':              '0 4px 6px rgba(0,0,0,0.5)',
      '--shadow-lg':              '0 10px 15px rgba(0,0,0,0.6)',
    },
  },

  // 'system' is a meta-theme — resolved at runtime to dark or light
  system: {
    id: 'system', name: 'System Default', isDark: null, inherits: 'dark',
  },
};

// Wallpaper gradient presets
const _WALLPAPER_GRADIENTS = [
  { id: 'gradient-1', label: 'Ocean',  value: 'linear-gradient(135deg,#0f2027,#203a43,#2c5364)' },
  { id: 'gradient-2', label: 'Sunset', value: 'linear-gradient(135deg,#f093fb,#f5576c)' },
  { id: 'gradient-3', label: 'Forest', value: 'linear-gradient(135deg,#134e5e,#71b280)' },
  { id: 'gradient-4', label: 'Violet', value: 'linear-gradient(135deg,#4776e6,#8e54e9)' },
  { id: 'gradient-5', label: 'Dusk',   value: 'linear-gradient(135deg,#373b44,#4286f4)' },
  { id: 'gradient-6', label: 'Peach',  value: 'linear-gradient(135deg,#f7971e,#ffd200)' },
  { id: 'none',       label: 'None',   value: null },
];

// ─────────────────────────────────────────────────────────────────────────────
// ThemeModule
// ─────────────────────────────────────────────────────────────────────────────
class _ThemeModule {
  constructor() {
    this._activeThemeId    = 'dark';
    this._wallpaper        = null;
    this._styleEl          = null;
    this._pickerEl         = null;
    this._systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  init() {
    this._injectStyleTag();
    this._loadAndApply();
    this._watchSystemPreference();
    this._watchSettingsStore();
    console.log('[ThemeModule] Initialized with theme:', this._activeThemeId);
  }

  /** Apply a theme by id ('dark' | 'light' | 'midnight' | 'forest' | 'system') */
  apply(themeId) {
    const resolved = this._resolve(themeId);
    if (!resolved) { console.warn('[ThemeModule] Unknown theme:', themeId); return; }

    this._activeThemeId = themeId;
    this._applyVars(resolved);
    this._applyDataAttr(resolved);

    // Keep settingsStore in sync without triggering a re-apply loop
    if (settingsStore.get('appearance.theme') !== themeId) {
      settingsStore.set('appearance.theme', themeId, false);
    }
  }

  /** Toggle the theme picker overlay */
  showThemePicker() {
    if (this._pickerEl) { this._pickerEl.remove(); this._pickerEl = null; return; }
    this._renderPicker();
  }

  /** Apply a wallpaper: { type: 'gradient'|'color'|'image'|'none', value: string|null } */
  applyWallpaper(wallpaper) {
    this._wallpaper = wallpaper;
    this._applyWallpaperToDOM(wallpaper);
    storage.set(_WALLPAPER_KEY, wallpaper);
  }

  getActive() { return this._resolve(this._activeThemeId); }
  getAll()    { return Object.values(_THEMES); }

  // ── Internal ──────────────────────────────────────────────────────────────────

  _injectStyleTag() {
    this._styleEl = document.getElementById('xame-theme-vars');
    if (!this._styleEl) {
      this._styleEl    = document.createElement('style');
      this._styleEl.id = 'xame-theme-vars';
      document.head.appendChild(this._styleEl);
    }
  }

  _loadAndApply() {
    const stored = settingsStore.get('appearance.theme') || 'dark';
    this.apply(stored);

    const wallpaper = storage.get(_WALLPAPER_KEY, null);
    if (wallpaper) { this._wallpaper = wallpaper; this._applyWallpaperToDOM(wallpaper); }
  }

  _resolve(themeId) {
    if (themeId === 'system') {
      return _THEMES[this._systemMediaQuery.matches ? 'dark' : 'light'];
    }
    return _THEMES[themeId] || null;
  }

  _applyVars(theme) {
    if (!this._styleEl) return;
    const css = Object.entries(theme.vars).map(([p, v]) => `  ${p}: ${v};`).join('\n');
    this._styleEl.textContent = `:root {\n${css}\n}`;
  }

  _applyDataAttr(theme) {
    const html = document.documentElement;
    html.dataset.theme       = theme.isDark ? 'dark' : 'light';
    html.dataset.themeId     = theme.id;
    html.dataset.fontSize    = settingsStore.get('appearance.fontSize')    || 'normal';
    html.dataset.bubbleStyle = settingsStore.get('appearance.bubbleStyle') || 'modern';

    const reducedMotion = settingsStore.get('appearance.reducedMotion');
    const highContrast  = settingsStore.get('appearance.highContrast');
    if (reducedMotion) html.dataset.reducedMotion = 'true'; else delete html.dataset.reducedMotion;
    if (highContrast)  html.dataset.highContrast  = 'true'; else delete html.dataset.highContrast;
  }

  _watchSystemPreference() {
    this._systemMediaQuery.addEventListener('change', () => {
      if (this._activeThemeId === 'system') this.apply('system');
    });
  }

  _watchSettingsStore() {
    settingsStore.on('appearance.theme',        themeId => { if (themeId !== this._activeThemeId) this.apply(themeId); });
    settingsStore.on('appearance.fontSize',     val => { document.documentElement.dataset.fontSize    = val; });
    settingsStore.on('appearance.bubbleStyle',  val => { document.documentElement.dataset.bubbleStyle = val; });
    settingsStore.on('appearance.reducedMotion', val => {
      document.documentElement.dataset.reducedMotion = val ? 'true' : 'false';
      document.body.classList.toggle('reduce-motion', !!val);
    });
    settingsStore.on('appearance.highContrast', val => {
      document.documentElement.dataset.highContrast = val ? 'true' : 'false';
      document.body.classList.toggle('high-contrast', !!val);
    });
  }

  // ── Wallpaper ─────────────────────────────────────────────────────────────────

  _applyWallpaperToDOM(wallpaper) {
    const chatBg = document.querySelector('.chat-bg');
    if (!chatBg) return;

    chatBg.style.background         = '';
    chatBg.style.backgroundImage    = '';
    chatBg.style.backgroundSize     = '';
    chatBg.style.backgroundPosition = '';
    chatBg.style.backgroundRepeat   = '';

    if (!wallpaper || wallpaper.type === 'none' || !wallpaper.value) return;

    if (wallpaper.type === 'gradient' || wallpaper.type === 'color') {
      chatBg.style.background = wallpaper.value;
    } else if (wallpaper.type === 'image') {
      chatBg.style.backgroundImage    = `url(${wallpaper.value})`;
      chatBg.style.backgroundSize     = 'cover';
      chatBg.style.backgroundPosition = 'center';
      chatBg.style.backgroundRepeat   = 'no-repeat';
    }
  }

  // ── Theme Picker UI ───────────────────────────────────────────────────────────

  _renderPicker() {
    const overlay     = document.createElement('div');
    overlay.className = 'theme-picker-overlay dialog-backdrop';
    overlay.id        = 'themePicker';

    overlay.innerHTML = `
      <div class="dialog fade-in theme-picker-dialog" style="max-width:460px;max-height:85vh;overflow-y:auto;">
        <div class="theme-picker-header">
          <h3>Appearance</h3>
          <button class="icon-btn" id="themePickerClose">✕</button>
        </div>

        <div class="theme-picker-section-title">Theme</div>
        <div class="theme-grid" id="themeGrid">
          ${Object.values(_THEMES).map(t => this._renderThemeCard(t)).join('')}
        </div>

        <div class="theme-picker-section-title" style="margin-top:20px;">Font Size</div>
        <div class="theme-font-row" id="themeFontRow">
          ${['small','normal','large'].map(size => `
            <button class="theme-font-btn${settingsStore.get('appearance.fontSize') === size ? ' active' : ''}"
                    data-font="${escapeHtml(size)}">
              ${size.charAt(0).toUpperCase() + size.slice(1)}
            </button>
          `).join('')}
        </div>

        <div class="theme-picker-section-title" style="margin-top:20px;">Bubble Style</div>
        <div class="theme-font-row" id="themeBubbleRow">
          ${['modern','classic'].map(style => `
            <button class="theme-font-btn${settingsStore.get('appearance.bubbleStyle') === style ? ' active' : ''}"
                    data-bubble="${escapeHtml(style)}">
              ${style.charAt(0).toUpperCase() + style.slice(1)}
            </button>
          `).join('')}
        </div>

        <div class="theme-picker-section-title" style="margin-top:20px;">Chat Wallpaper</div>
        <div class="wallpaper-grid" id="wallpaperGrid">
          ${_WALLPAPER_GRADIENTS.map(g => `
            <button class="wallpaper-swatch${this._isActiveWallpaper(g) ? ' active' : ''}"
                    data-wallpaper-id="${escapeHtml(g.id)}"
                    title="${escapeHtml(g.label)}"
                    style="${g.value ? `background:${escapeHtml(g.value)}` : 'background:var(--color-surface)'}">
              ${g.id === 'none' ? '<span style="font-size:18px">✕</span>' : ''}
              ${this._isActiveWallpaper(g) ? '<span class="wallpaper-check">✓</span>' : ''}
            </button>
          `).join('')}
          <button class="wallpaper-swatch wallpaper-upload" id="wallpaperUpload" title="Custom image">
            <span style="font-size:18px">🖼️</span>
          </button>
          <button class="wallpaper-swatch wallpaper-color" id="wallpaperColor" title="Solid color">
            <span style="font-size:18px">🎨</span>
          </button>
        </div>

        <div class="theme-picker-section-title" style="margin-top:20px;">Accessibility</div>
        <div class="theme-picker-toggles">
          <label class="settings-item" style="cursor:pointer;">
            <div class="settings-item-label">Reduce Motion</div>
            <label class="settings-toggle">
              <input type="checkbox" id="pickerReducedMotion"
                     ${settingsStore.get('appearance.reducedMotion') ? 'checked' : ''} />
              <span class="settings-toggle-slider"></span>
            </label>
          </label>
          <label class="settings-item" style="cursor:pointer;">
            <div class="settings-item-label">High Contrast</div>
            <label class="settings-toggle">
              <input type="checkbox" id="pickerHighContrast"
                     ${settingsStore.get('appearance.highContrast') ? 'checked' : ''} />
              <span class="settings-toggle-slider"></span>
            </label>
          </label>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this._pickerEl = overlay;
    this._attachPickerListeners(overlay);
  }

  _renderThemeCard(theme) {
    const isActive  = this._activeThemeId === theme.id;
    const resolved  = this._resolve(theme.id);
    const bgColor   = resolved?.vars['--color-bg']      || '#0f1419';
    const primColor = resolved?.vars['--color-primary']  || '#0084ff';
    const surfColor = resolved?.vars['--color-surface']  || '#1e2732';

    return `
      <button class="theme-card${isActive ? ' active' : ''}"
              data-theme-id="${escapeHtml(theme.id)}"
              title="${escapeHtml(theme.name)}">
        <div class="theme-card-preview" style="background:${escapeHtml(bgColor)};">
          <div class="theme-preview-header" style="background:${escapeHtml(surfColor)};"></div>
          <div class="theme-preview-bubble sent" style="background:${escapeHtml(primColor)};"></div>
          <div class="theme-preview-bubble recv" style="background:${escapeHtml(surfColor)};"></div>
        </div>
        <div class="theme-card-label">
          ${escapeHtml(theme.name)}${isActive ? ' ✓' : ''}
        </div>
      </button>
    `;
  }

  _isActiveWallpaper(gradient) {
    if (!this._wallpaper) return gradient.id === 'none';
    if (gradient.id === 'none') return !this._wallpaper.value;
    return this._wallpaper.type === 'gradient' && this._wallpaper.value === gradient.value;
  }

  _attachPickerListeners(overlay) {
    // Close button and backdrop click
    overlay.querySelector('#themePickerClose')?.addEventListener('click', () => {
      overlay.remove(); this._pickerEl = null;
    });
    overlay.addEventListener('click', e => {
      if (e.target === overlay) { overlay.remove(); this._pickerEl = null; }
    });

    // Theme cards
    overlay.querySelector('#themeGrid')?.addEventListener('click', e => {
      const card = e.target.closest('[data-theme-id]');
      if (!card) return;
      this.apply(card.dataset.themeId);
      overlay.querySelectorAll('.theme-card').forEach(c => {
        c.classList.toggle('active', c.dataset.themeId === this._activeThemeId);
        const label = c.querySelector('.theme-card-label');
        if (label) {
          const t = _THEMES[c.dataset.themeId];
          label.textContent = t
            ? t.name + (c.dataset.themeId === this._activeThemeId ? ' ✓' : '')
            : c.dataset.themeId;
        }
      });
    });

    // Font size
    overlay.querySelector('#themeFontRow')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-font]');
      if (!btn) return;
      settingsStore.set('appearance.fontSize', btn.dataset.font);
      overlay.querySelectorAll('[data-font]').forEach(b =>
        b.classList.toggle('active', b.dataset.font === btn.dataset.font)
      );
    });

    // Bubble style
    overlay.querySelector('#themeBubbleRow')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-bubble]');
      if (!btn) return;
      settingsStore.set('appearance.bubbleStyle', btn.dataset.bubble);
      overlay.querySelectorAll('[data-bubble]').forEach(b =>
        b.classList.toggle('active', b.dataset.bubble === btn.dataset.bubble)
      );
    });

    // Wallpaper gradient swatches
    overlay.querySelector('#wallpaperGrid')?.addEventListener('click', e => {
      const swatch = e.target.closest('[data-wallpaper-id]');
      if (!swatch) return;
      const gradient = _WALLPAPER_GRADIENTS.find(g => g.id === swatch.dataset.wallpaperId);
      if (!gradient) return;
      this.applyWallpaper(gradient.value
        ? { type: 'gradient', value: gradient.value }
        : { type: 'none', value: null }
      );
      // Refresh active states
      overlay.querySelectorAll('[data-wallpaper-id]').forEach(s => {
        s.classList.toggle('active', s.dataset.wallpaperId === swatch.dataset.wallpaperId);
        s.querySelector('.wallpaper-check')?.remove();
        if (s.dataset.wallpaperId === swatch.dataset.wallpaperId) {
          const tick = document.createElement('span');
          tick.className = 'wallpaper-check'; tick.textContent = '✓';
          s.appendChild(tick);
        }
      });
    });

    // Custom image upload
    overlay.querySelector('#wallpaperUpload')?.addEventListener('click', () => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
      input.addEventListener('change', e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload  = ev => this.applyWallpaper({ type: 'image', value: ev.target.result });
        reader.onerror = ()  => console.error('[ThemeModule] Failed to read wallpaper image');
        reader.readAsDataURL(file);
      });
      input.click();
    });

    // Solid color picker
    overlay.querySelector('#wallpaperColor')?.addEventListener('click', () => {
      const input = Object.assign(document.createElement('input'), { type: 'color', value: '#1a2332' });
      input.addEventListener('input',  e => this.applyWallpaper({ type: 'color', value: e.target.value }));
      input.addEventListener('change', e => this.applyWallpaper({ type: 'color', value: e.target.value }));
      input.click();
    });

    // Accessibility toggles
    overlay.querySelector('#pickerReducedMotion')?.addEventListener('change', e => {
      settingsStore.set('appearance.reducedMotion', e.target.checked);
    });
    overlay.querySelector('#pickerHighContrast')?.addEventListener('change', e => {
      settingsStore.set('appearance.highContrast', e.target.checked);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────
const themeModule = new _ThemeModule();

// Open theme picker when ui.js fires xame:open-theme-picker
document.addEventListener('xame:open-theme-picker', () => themeModule.showThemePicker());
