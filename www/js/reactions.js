/*
 * reactions.js — XamePage v2.1.1
 *
 * Provides (plain globals, no import/export):
 *   reactionsModule  — singleton ReactionsModule instance
 *
 * Usage from messaging.js after rendering each bubble:
 *   reactionsModule.attachToMessage(bubbleEl, msg.id);
 *
 * After login / chat_history received:
 *   reactionsModule.loadReactions(reactionsData);
 *   reactionsModule.connectSocket();   // call once socket is live
 *
 * Depends on globals (must load after):
 *   socket  ← state.js  (may be null; connectSocket() re-binds)
 *   USER    ← state.js  (.xameId used as the current-user identifier)
 *
 * Load order: after state.js — before messaging.js, app.js
 */

const _REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'];

class _ReactionsModule {
  constructor() {
    // messageId → Map<emoji, Set<userId>>
    this._reactions     = new Map();
    this._pickerVisible = null; // messageId with open picker

    this._injectStyles();
    this._bindGlobalEvents();
  }

  // ── Called once the socket is connected (from socket.js / app.js) ────────────
  connectSocket() {
    this._bindSocketEvents();
  }

  // ── Attach reactions to a rendered message bubble ────────────────────────────

  /**
   * Call this after building each .bubble element in messaging.js.
   * @param {HTMLElement} messageEl  the .bubble element
   * @param {string}      messageId
   */
  attachToMessage(messageEl, messageId) {
    if (!messageEl) return;
    messageEl.dataset.messageId = messageId;

    // Double-tap opens the emoji picker
    let lastTap = 0;
    let touchDownTime = 0;
    messageEl.addEventListener('touchstart', () => { touchDownTime = Date.now(); }, { passive: true });
    messageEl.addEventListener('touchend', () => {
      const holdDuration = Date.now() - touchDownTime;
      if (holdDuration > 450) return; // was a long-press, ignore
      if (window.__xame_longpress_fired) { window.__xame_longpress_fired = false; return; }
      const now = Date.now();
      if (now - lastTap < 300) this._showPicker(messageEl, messageId);
      lastTap = now;
    }, { passive: true });
    messageEl.addEventListener('dblclick', () => this._showPicker(messageEl, messageId));

    // Render any reactions already loaded for this message
    this._renderReactionBar(messageEl, messageId);
  }

  // ── Picker ───────────────────────────────────────────────────────────────────

  _showPicker(anchor, messageId) {
    this._hidePicker();
    this._pickerVisible = messageId;

    const picker = document.createElement('div');
    picker.id        = 'reactionPicker';
    picker.className = 'reaction-picker';
    picker.innerHTML = _REACTION_EMOJIS.map(e =>
      `<button class="reaction-pick-btn" data-emoji="${e}" data-message-id="${messageId}">${e}</button>`
    ).join('');

    document.body.appendChild(picker);

    // Position above or below the bubble, clamped to viewport
    const rect    = anchor.getBoundingClientRect();
    const pickerW = 280;
    let left = rect.left + rect.width / 2 - pickerW / 2;
    left     = Math.max(8, Math.min(left, window.innerWidth - pickerW - 8));
    const top = rect.top > 80 ? rect.top - 56 : rect.bottom + 8;
    picker.style.cssText = `left:${left}px;top:${top}px;`;

    requestAnimationFrame(() => picker.classList.add('visible'));
  }

  _hidePicker() {
    const el = document.getElementById('reactionPicker');
    if (el) { el.classList.remove('visible'); setTimeout(() => el.remove(), 200); }
    this._pickerVisible = null;
  }

  _bindGlobalEvents() {
    document.addEventListener('click', e => {
      // Emoji pick button
      const pickBtn = e.target.closest('.reaction-pick-btn');
      if (pickBtn) {
        this._toggleReaction(pickBtn.dataset.messageId, pickBtn.dataset.emoji);
        this._hidePicker();
        return;
      }
      // Existing reaction chip (re-toggle)
      const chip = e.target.closest('.reaction-chip');
      if (chip) {
        this._toggleReaction(chip.dataset.messageId, chip.dataset.emoji);
        return;
      }
      // Click outside → close picker
      if (!e.target.closest('#reactionPicker')) this._hidePicker();
    });

    document.addEventListener('keydown', e => { if (e.key === 'Escape') this._hidePicker(); });
  }

  // ── Toggle a reaction ────────────────────────────────────────────────────────

  _toggleReaction(messageId, emoji) {
    if (!messageId || !emoji) return;
    // USER is the bare global from state.js, set after login
    const userId = USER?.xameId;
    if (!userId) return;

    if (!this._reactions.has(messageId)) this._reactions.set(messageId, new Map());
    const emojiMap = this._reactions.get(messageId);
    if (!emojiMap.has(emoji)) emojiMap.set(emoji, new Set());
    const users = emojiMap.get(emoji);

    if (users.has(userId)) {
      users.delete(userId);
      if (users.size === 0) emojiMap.delete(emoji);
    } else {
      users.add(userId);
    }

    // Optimistic UI update
    const bubbleEl = document.querySelector(`[data-message-id="${messageId}"]`);
    this._renderReactionBar(bubbleEl, messageId);
    this._animateReaction(messageId, emoji);

    // Sync to server — socket is the bare global from state.js
    socket?.emit('reaction:toggle', { messageId, emoji, userId });
  }

  // ── Render reaction bar below a bubble ───────────────────────────────────────

  _renderReactionBar(messageEl, messageId) {
    if (!messageEl) return;
    messageEl.querySelector('.reaction-bar')?.remove();

    const emojiMap = this._reactions.get(messageId);
    if (!emojiMap || emojiMap.size === 0) return;

    const userId = USER?.xameId;
    const bar    = document.createElement('div');
    bar.className = 'reaction-bar';

    for (const [emoji, users] of emojiMap) {
      const isMine = userId ? users.has(userId) : false;
      const chip   = document.createElement('button');
      chip.className         = `reaction-chip${isMine ? ' mine' : ''}`;
      chip.dataset.messageId = messageId;
      chip.dataset.emoji     = emoji;
      chip.title             = [...users].join(', ');
      chip.innerHTML         = `<span>${emoji}</span><span class="reaction-count">${users.size}</span>`;
      bar.appendChild(chip);
    }

    messageEl.appendChild(bar);
  }

  _animateReaction(messageId, emoji) {
    const el = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!el) return;
    const floaty = document.createElement('span');
    floaty.className   = 'reaction-float';
    floaty.textContent = emoji;
    el.appendChild(floaty);
    setTimeout(() => floaty.remove(), 900);
  }

  // ── Socket sync ──────────────────────────────────────────────────────────────

  _bindSocketEvents() {
    if (typeof socket === 'undefined' || !socket) return;

    socket.off('reaction:update');
    socket.on('reaction:update', ({ messageId, emoji, userId, action }) => {
      if (!this._reactions.has(messageId)) this._reactions.set(messageId, new Map());
      const emojiMap = this._reactions.get(messageId);
      if (!emojiMap.has(emoji)) emojiMap.set(emoji, new Set());

      if (action === 'add') {
        emojiMap.get(emoji).add(userId);
      } else {
        emojiMap.get(emoji).delete(userId);
        if (emojiMap.get(emoji).size === 0) emojiMap.delete(emoji);
      }

      this._renderReactionBar(
        document.querySelector(`[data-message-id="${messageId}"]`),
        messageId
      );
    });
  }

  // ── Load existing reactions (call after chat_history socket event) ────────────
  /**
   * @param {object} reactionsData  { messageId: { emoji: [userId, ...] } }
   */
  loadReactions(reactionsData) {
    if (!reactionsData || typeof reactionsData !== 'object') return;
    for (const [messageId, emojiMap] of Object.entries(reactionsData)) {
      const map = new Map();
      for (const [emoji, users] of Object.entries(emojiMap)) {
        map.set(emoji, new Set(users));
      }
      this._reactions.set(messageId, map);
    }
  }

  // ── Injected styles ──────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('reactions-style')) return;
    const s = document.createElement('style');
    s.id = 'reactions-style';
    s.textContent = `
      .reaction-picker {
        position: fixed; z-index: 9999;
        display: flex; gap: 4px; align-items: center;
        background: var(--color-surface, #1e2732);
        border: 1px solid var(--color-border, #38444d);
        border-radius: 999px; padding: 6px 10px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        opacity: 0; transform: scale(0.85) translateY(4px);
        transition: opacity 0.18s ease, transform 0.18s ease;
        pointer-events: none;
      }
      .reaction-picker.visible { opacity:1; transform:scale(1) translateY(0); pointer-events:all; }
      .reaction-pick-btn {
        background: none; border: none; cursor: pointer;
        font-size: 22px; padding: 2px 4px; border-radius: 8px;
        transition: transform 0.12s ease;
      }
      .reaction-pick-btn:hover { transform: scale(1.3); }
      .reaction-bar { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
      .reaction-chip {
        display: inline-flex; align-items: center; gap: 3px;
        background: var(--color-surface-variant, #263340);
        border: 1px solid var(--color-border, #38444d);
        border-radius: 999px; padding: 2px 8px; font-size: 13px;
        cursor: pointer; transition: background 0.15s;
      }
      .reaction-chip.mine {
        background: var(--color-primary, #0084ff);
        border-color: var(--color-primary, #0084ff);
        color: #fff;
      }
      .reaction-chip:hover { background: var(--color-surface-hover, #1a2535); }
      .reaction-count { font-size: 11px; font-weight: 600; }
      .reaction-float {
        position: absolute; font-size: 24px; pointer-events: none;
        animation: reaction-float-up 0.9s ease forwards;
        bottom: 100%; left: 50%;
      }
      @keyframes reaction-float-up {
        0%   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-40px) scale(1.4); }
      }
    `;
    document.head.appendChild(s);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────
const reactionsModule = new _ReactionsModule();

// Re-bind socket handlers whenever the socket (re)connects
document.addEventListener('xame:socket-ready', () => reactionsModule.connectSocket());
