/*
 * disappearing.js — XamePage v2.1.1
 *
 * Provides (plain globals, no import/export):
 *   TIMER_OPTIONS       — array of timer preset objects (exported for UI use)
 *   disappearingModule  — singleton DisappearingModule instance
 *
 * Usage from messaging.js after rendering each bubble:
 *   if (msg.expiresAt) disappearingModule.scheduleDelete(msg.id, msg.expiresAt, bubbleEl);
 *
 * Usage from messaging.js / app.js when building outgoing messages:
 *   const outgoing = disappearingModule.stampMessage(msgObj, ACTIVE_ID);
 *
 * Usage from app.js on login/reload:
 *   disappearingModule.restoreTimers(allStoredMessages);
 *
 * Usage from chat.js (⏱️ Disappearing button in composer dropdown):
 *   disappearingModule.showTimerDialog();
 *
 * Depends on globals (must load after):
 *   socket        ← state.js   (bare global; may be null)
 *   ACTIVE_ID     ← state.js   (bare global)
 *   USER          ← state.js   (bare global)
 *   getChat       ← storage.js
 *   setChat       ← storage.js
 *   settingsStore ← settings.js  (.get('chats.defaultTimer'))
 *   escapeHtml    ← utils.js
 *
 * Load order: after state.js, storage.js, settings.js, utils.js
 *             before messaging.js, app.js
 */

// ─────────────────────────────────────────────────────────────────────────────
// Timer presets — plain global array, referenced by settings.js UI too
// ─────────────────────────────────────────────────────────────────────────────
const TIMER_OPTIONS = [
  { value: 'off', label: 'Off',      ms: 0 },
  { value: '30s', label: '30 sec',   ms: 30  * 1000 },
  { value: '5m',  label: '5 min',    ms: 5   * 60 * 1000 },
  { value: '1h',  label: '1 hour',   ms: 60  * 60 * 1000 },
  { value: '24h', label: '24 hours', ms: 24  * 60 * 60 * 1000 },
  { value: '7d',  label: '7 days',   ms: 7   * 24 * 60 * 60 * 1000 },
  { value: '90d', label: '90 days',  ms: 90  * 24 * 60 * 60 * 1000 },
];

// Per-chat localStorage key helper (not exported — internal use only)
const _chatTimerKey = contactId => `xame:disappear:${contactId}`;

// ─────────────────────────────────────────────────────────────────────────────
// DisappearingModule
// ─────────────────────────────────────────────────────────────────────────────
class _DisappearingModule {
  constructor() {
    // messageId → { timerId, contactId, expiresAt, el?, _countdownInterval? }
    this._activeTimers = new Map();
    this._injectStyles();
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Stamp an outgoing message with an expiresAt timestamp if a timer is set.
   * Call this in buildOutgoingMessage() before sending.
   */
  stampMessage(msg, contactId) {
    const timerMs = this._getTimerMs(contactId);
    if (!timerMs) return msg;
    return {
      ...msg,
      expiresAt:  Date.now() + timerMs,
      timerLabel: this._msToLabel(timerMs),
    };
  }

  /**
   * Schedule client-side deletion of a message bubble.
   * Call from messaging.js renderMessage() when msg.expiresAt is present.
   */
  scheduleDelete(messageId, expiresAt, bubbleEl) {
    this._cancelTimer(messageId);
    console.log('[Disappearing] scheduleDelete called:', messageId, 'remaining:', expiresAt - Date.now(), 'el:', !!bubbleEl);

    const remaining = expiresAt - Date.now();

    if (remaining <= 0) {
      this._deleteMessage(messageId, bubbleEl);
      return;
    }

    this._attachCountdown(bubbleEl, messageId, remaining);

    const timerId = setTimeout(() => {
      // Re-query DOM in case chat was opened after timer was set
      const el = bubbleEl?.isConnected ? bubbleEl : document.querySelector(`.bubble[data-id="${messageId}"]`);
      this._deleteMessage(messageId, el || null);
      // Also trigger re-render if chat is open
      if (typeof ACTIVE_ID !== 'undefined' && this._activeTimers.get(messageId)?.contactId === ACTIVE_ID) {
        if (typeof renderMessages === 'function') renderMessages();
      }
    }, remaining);

    this._activeTimers.set(messageId, {
      timerId,
      expiresAt,
      contactId: ACTIVE_ID, // bare global from state.js
      el: bubbleEl,
    });
  }

  /**
   * Restore timers from all stored messages on login/reload.
   * Call from app.js after history is loaded.
   */
  restoreTimers(messages) {
    if (!Array.isArray(messages)) return;
    let restored = 0;

    messages.forEach(msg => {
      if (!msg.expiresAt || !msg.id) return;
      const remaining = msg.expiresAt - Date.now();

      if (remaining <= 0) {
        // Already expired while the app was closed
        // onDelete callback is a no-op when no handler is supplied
        return;
      }

      const timerId = setTimeout(() => {
        const el = document.querySelector(`.bubble[data-id="${msg.id}"]`);
        this._deleteMessage(msg.id, el || null);
      }, remaining);

      this._activeTimers.set(msg.id, {
        timerId,
        expiresAt: msg.expiresAt,
        contactId: msg.contactId || null,
        el: null,
      });

      restored++;
    });

    if (restored > 0) console.log(`[DisappearingModule] Restored ${restored} timer(s)`);
  }

  /**
   * Open the disappearing-timer dialog for the current chat.
   * Wired to the ⏱️ Disappearing button in the composer dropdown.
   */
  showTimerDialog() {
    if (!ACTIVE_ID) return; // bare global from state.js

    const existing = document.getElementById('disappearTimerDialog');
    if (existing) { existing.remove(); return; } // toggle behaviour

    const current = this._getChatTimer(ACTIVE_ID);
    const overlay = document.createElement('div');
    overlay.id        = 'disappearTimerDialog';
    overlay.className = 'dialog-backdrop';
    overlay.innerHTML = `
      <div class="dialog fade-in" style="max-width:360px;">
        <h3>⏱️ Disappearing Messages</h3>
        <p class="subtitle" style="margin:8px 0 16px;">
          Messages sent in this chat will automatically disappear after the selected time.
        </p>
        <div class="disappear-options">
          ${TIMER_OPTIONS.map(opt => `
            <button class="disappear-option-btn${current === opt.value ? ' active' : ''}"
                    data-value="${escapeHtml(opt.value)}">
              ${escapeHtml(opt.label)}${current === opt.value ? ' ✓' : ''}
            </button>
          `).join('')}
        </div>
        <div style="display:flex;gap:8px;margin-top:16px;">
          <button class="btn secondary" id="disappearCancelBtn" style="flex:1;">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#disappearCancelBtn')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelectorAll('.disappear-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const value = btn.dataset.value;
        this._setChatTimer(ACTIVE_ID, value);

        // Update button states
        overlay.querySelectorAll('.disappear-option-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.value === value);
          const opt = TIMER_OPTIONS.find(o => o.value === b.dataset.value);
          b.textContent = opt ? opt.label + (b.dataset.value === value ? ' ✓' : '') : b.dataset.value;
        });

        const label = TIMER_OPTIONS.find(o => o.value === value)?.label || value;
        const msg   = value === 'off'
          ? 'Disappearing messages turned off'
          : `Messages will disappear after ${label}`;

        setTimeout(() => {
          overlay.remove();
          // xame:notify is handled in settings.js bridge → showNotification
          document.dispatchEvent(new CustomEvent('xame:notify', { detail: { message: msg } }));
        }, 600);

        // Notify server — socket is bare global from state.js
        socket?.emit('disappearing:timer-set', {
          contactId: ACTIVE_ID,
          userId:    USER?.xameId, // bare global from state.js
          value,
        });
      });
    });
  }

  // ── Socket handlers ───────────────────────────────────────────────────────────

  connectSocket() {
    if (typeof socket === 'undefined' || !socket) return;

    socket.off('disappearing:expired');
    socket.on('disappearing:expired', ({ messageId }) => {
      const entry    = this._activeTimers.get(messageId);
      const bubbleEl = entry?.el
        || document.querySelector(`.bubble[data-id="${messageId}"]`)
        || null;
      this._deleteMessage(messageId, bubbleEl);
    });

    socket.off('disappearing:timer-changed');
    socket.on('disappearing:timer-changed', ({ contactId, value, senderName }) => {
      this._setChatTimer(contactId, value);
      const label = TIMER_OPTIONS.find(o => o.value === value)?.label || value;
      const msg   = value === 'off'
        ? `${senderName} turned off disappearing messages`
        : `${senderName} set messages to disappear after ${label}`;
      document.dispatchEvent(new CustomEvent('xame:notify', { detail: { message: msg } }));
    });
  }

  // ── Timer config persistence ──────────────────────────────────────────────────

  _getChatTimer(contactId) {
    try {
      const stored = localStorage.getItem(_chatTimerKey(contactId));
      if (stored) return stored;
    } catch (_) {}
    // settingsStore is the bare global from settings.js
    return settingsStore.get('chats.defaultTimer') || 'off';
  }

  _setChatTimer(contactId, value) {
    try {
      if (value === 'off') {
        localStorage.removeItem(_chatTimerKey(contactId));
      } else {
        localStorage.setItem(_chatTimerKey(contactId), value);
      }
    } catch (err) {
      console.warn('[DisappearingModule] Failed to persist timer:', err);
    }
  }

  _getTimerMs(contactId) {
    return TIMER_OPTIONS.find(o => o.value === this._getChatTimer(contactId))?.ms || 0;
  }

  _msToLabel(ms) {
    return TIMER_OPTIONS.find(o => o.ms === ms)?.label || '';
  }

  // ── Deletion ──────────────────────────────────────────────────────────────────

  _deleteMessage(messageId, bubbleEl) {
    const contactId = this._activeTimers.get(messageId)?.contactId || ACTIVE_ID;
    this._cancelTimer(messageId);

    // Record deletion so intelligentMerge won't resurrect it
    try {
      const deleted = JSON.parse(localStorage.getItem('xame:deleted_msgs') || '[]');
      deleted.push(messageId);
      // Keep only last 500 to avoid unbounded growth
      if (deleted.length > 500) deleted.splice(0, deleted.length - 500);
      localStorage.setItem('xame:deleted_msgs', JSON.stringify(deleted));
    } catch(e) {}

    // Remove from local store
    if (contactId) {
      const chat    = getChat(contactId);
      const updated = chat.filter(m => m.id !== messageId);
      setChat(contactId, updated);
    }

    // Find bubble in DOM if not passed
    if (!bubbleEl || !bubbleEl.isConnected) {
      bubbleEl = document.querySelector(`.bubble[data-id="${messageId}"]`);
    }

    // Animate out, then remove from DOM
    if (bubbleEl && bubbleEl.isConnected) {
      bubbleEl.classList.add('disappearing-out');
      bubbleEl.addEventListener('animationend', () => bubbleEl.remove(), { once: true });
    }
  }

  _cancelTimer(messageId) {
    const entry = this._activeTimers.get(messageId);
    if (!entry) return;
    clearTimeout(entry.timerId);
    if (entry._countdownInterval) clearInterval(entry._countdownInterval);
    this._activeTimers.delete(messageId);
  }

  // ── Countdown UI ──────────────────────────────────────────────────────────────

  _attachCountdown(bubbleEl, messageId, remainingMs) {
    if (!bubbleEl) return;
    bubbleEl.querySelector('.disappear-indicator')?.remove();

    const indicator = document.createElement('div');
    indicator.className = 'disappear-indicator';

    const icon  = Object.assign(document.createElement('span'), {
      className: 'disappear-icon', textContent: '⏱️', title: 'This message will disappear',
    });
    const label = Object.assign(document.createElement('span'), { className: 'disappear-label' });

    indicator.appendChild(icon);
    indicator.appendChild(label);

    const timeRow = bubbleEl.querySelector('.time-row');
    if (timeRow) timeRow.insertBefore(indicator, timeRow.firstChild);
    else         bubbleEl.appendChild(indicator);

    const update = () => {
      const entry = this._activeTimers.get(messageId);
      const left  = entry ? entry.expiresAt - Date.now() : 0;
      if (left <= 0) { label.textContent = ''; return; }
      label.textContent = this._formatRemaining(left);
      if (left < 10000) indicator.classList.add('urgent');
    };

    update();
    const interval = setInterval(() => {
      if (!bubbleEl.isConnected) { clearInterval(interval); return; }
      update();
    }, 1000);

    // Stash interval id so _cancelTimer can clear it
    const entry = this._activeTimers.get(messageId);
    if (entry) entry._countdownInterval = interval;
  }

  _formatRemaining(ms) {
    if (ms < 60000)    return Math.ceil(ms / 1000)     + 's';
    if (ms < 3600000)  return Math.ceil(ms / 60000)    + 'm';
    if (ms < 86400000) return Math.ceil(ms / 3600000)  + 'h';
    return                    Math.ceil(ms / 86400000) + 'd';
  }

  // ── Injected styles ───────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('xame-disappearing-style')) return;
    const style = document.createElement('style');
    style.id    = 'xame-disappearing-style';
    style.textContent = `
      /* ── Timer dialog ── */
      .disappear-options { display: flex; flex-direction: column; gap: 6px; }
      .disappear-option-btn {
        padding: 10px 14px; border-radius: 8px;
        border: 1px solid var(--color-border, #38444d);
        background: var(--color-surface-variant, #263340);
        color: var(--color-text, #fff);
        text-align: left; cursor: pointer; font-size: 14px;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .disappear-option-btn:hover { background: var(--color-surface, #1e2732); }
      .disappear-option-btn.active {
        border-color: var(--color-primary, #0084ff);
        background: rgba(0,132,255,0.12);
        color: var(--color-primary, #0084ff); font-weight: 600;
      }

      /* ── In-bubble indicator ── */
      .disappear-indicator {
        display: inline-flex; align-items: center; gap: 3px;
        margin-right: 6px; font-size: 11px;
        color: var(--color-text-tertiary, #536471); vertical-align: middle;
      }
      .disappear-icon  { font-size: 11px; line-height: 1; }
      .disappear-label { font-variant-numeric: tabular-nums; min-width: 22px; }
      .disappear-indicator.urgent .disappear-icon {
        animation: disappearPulse 0.5s ease infinite alternate;
      }
      @keyframes disappearPulse {
        from { opacity: 1; }
        to   { opacity: 0.3; }
      }

      /* ── Bubble exit animation ── */
      @keyframes disappearOut {
        0%   { opacity: 1; transform: scale(1);   max-height: 200px; }
        60%  { opacity: 0; transform: scale(0.9); }
        100% { opacity: 0; max-height: 0; margin: 0; padding: 0; }
      }
      .disappearing-out {
        animation: disappearOut 0.4s ease forwards;
        overflow: hidden; pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────
const disappearingModule = new _DisappearingModule();

// Re-bind socket handlers whenever the socket (re)connects
document.addEventListener('xame:socket-ready', () => disappearingModule.connectSocket());
