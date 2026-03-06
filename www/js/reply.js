/*
 * reply.js — XamePage v2.1.1
 *
 * Provides (plain globals, no import/export):
 * replyModule  — singleton ReplyModule instance
 *
 * Usage from messaging.js:
 * // When building a message bubble that has msg.replyTo:
 * replyModule.renderQuote(msg.replyTo, bubbleEl);
 *
 * // When building an outgoing message object before sending:
 * const outgoing = replyModule.decorateOutgoing({ id, text, ts, type:'sent' });
 * // After successful send:
 * replyModule.confirmSent();
 *
 * Usage from chat.js / contacts.js (wired to long-press or swipe on bubble):
 * replyModule.startReply(messageId, bubbleEl);
 *
 * Depends on globals (must load after):
 * ACTIVE_ID     state.js
 * CONTACTS      state.js
 * getChat       storage.js
 * escapeHtml    utils.js
 *
 * Load order: after state.js, storage.js, utils.js — before messaging.js, app.js
 */

class _ReplyModule {
  constructor() {
    this._replyTarget = null; // { id, text, file, type, senderName, ts }
    this._bannerEl    = null;
    this._injectStyles();
  }

  //    Public API                                                                 

  /**
   * Begin a reply to a message.
   * Shows the reply banner above the composer and stores the target.
   *
   * @param {string}      messageId
   * @param {HTMLElement} bubbleEl   the .bubble element (for highlight animation)
   */
  startReply(messageId, bubbleEl) {
    const msg = this._findMessage(messageId);
    if (!msg) return;

    // CONTACTS and ACTIVE_ID are bare globals from state.js
    const contact    = CONTACTS?.find(c => c.id === ACTIVE_ID);
    const senderName = msg.type === 'sent'
      ? 'You'
      : (contact?.name || ACTIVE_ID || 'Them');

    this._replyTarget = {
      id:         msg.id,
      text:       msg.text || null,
      file:       msg.file || null,
      type:       msg.type,
      senderName,
      ts:         msg.ts,
    };

    this._showBanner();
    this._highlightBubble(bubbleEl);
    document.getElementById('messageInput')?.focus();
  }

  /** Cancel the active reply (called by banner × button or on navigation away) */
  cancelReply() {
    this._replyTarget = null;
    this._hideBanner();
  }

  /**
   * Decorate an outgoing message with replyTo metadata if a reply is active.
   * Call this in buildOutgoingMessage() before sending.
   *
   * @param {object} msg  outgoing message object
   * @returns {object}    msg, possibly with .replyTo added
   */
  decorateOutgoing(msg) {
    if (!this._replyTarget) return msg;
    return { ...msg, replyTo: { ...this._replyTarget } };
  }

  /**
   * Render a reply quote block inside a message bubble.
   * Called from messaging.js renderMessage() when msg.replyTo is present.
   *
   * @param {object}      replyTo   the replyTo metadata object
   * @param {HTMLElement} bubbleEl  the parent .bubble element
   */
  renderQuote(replyTo, bubbleEl) {
    if (!replyTo || !bubbleEl) return;
    bubbleEl.querySelector('.reply-quote')?.remove();

    const previewText = replyTo.text
      ? escapeHtml(replyTo.text).slice(0, 100) + (replyTo.text.length > 100 ? '…' : '')
      : replyTo.file
        ? '  ' + escapeHtml(replyTo.file.name || 'Attachment')
        : 'Message';

    const quote = document.createElement('div');
    quote.className = 'reply-quote';
    quote.innerHTML = `
      <div class="reply-quote-bar"></div>
      <div class="reply-quote-body">
        <span class="reply-quote-sender">${escapeHtml(replyTo.senderName || '')}</span>
        <span class="reply-quote-text">${previewText}</span>
      </div>
    `;

    // Click on quote scrolls to the original message
    quote.addEventListener('click', e => {
      e.stopPropagation();
      this._scrollToOriginal(replyTo.id);
    });

    // Insert at the very top of the bubble (before message text/media)
    bubbleEl.insertBefore(quote, bubbleEl.firstChild);
  }

  /**
   * Call after successfully sending a reply — clears the active target.
   */
  confirmSent() {
    this.cancelReply();
  }

  //    Banner                                                                    

  _showBanner() {
    this._hideBanner();

    const composer = document.getElementById('composer');
    if (!composer) return;

    const target  = this._replyTarget;
    const preview = target.text
      ? escapeHtml(target.text).slice(0, 80) + (target.text.length > 80 ? '…' : '')
      : target.file
        ? '  ' + escapeHtml(target.file.name || 'Attachment')
        : 'Message';

    const banner     = document.createElement('div');
    banner.id        = 'replyBanner';
    banner.className = 'reply-banner';
    banner.innerHTML = `
      <div class="reply-banner-bar"></div>
      <div class="reply-banner-body">
        <span class="reply-banner-label">Replying to <strong>${escapeHtml(target.senderName)}</strong></span>
        <span class="reply-banner-preview">${preview}</span>
      </div>
      <button class="reply-banner-cancel icon-btn" id="replyBannerCancel" aria-label="Cancel reply">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    `;

    composer.parentNode.insertBefore(banner, composer);
    this._bannerEl = banner;

    banner.querySelector('#replyBannerCancel')
      ?.addEventListener('click', () => this.cancelReply());

    // Animate in
    requestAnimationFrame(() => banner.classList.add('visible'));
  }

  _hideBanner() {
    if (!this._bannerEl) return;
    this._bannerEl.remove();
    this._bannerEl = null;
  }

  //    Highlight                                                                 

  _highlightBubble(bubbleEl) {
    if (!bubbleEl) return;
    bubbleEl.classList.add('reply-highlight');
    setTimeout(() => bubbleEl.classList.remove('reply-highlight'), 800);
  }

  //    Scroll to original                                                        

  _scrollToOriginal(messageId) {
    const target = document.querySelector(`.bubble[data-id="${messageId}"]`);
    if (!target) {
      this._flashNotFound();
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('reply-highlight');
    setTimeout(() => target.classList.remove('reply-highlight'), 1000);
  }

  _flashNotFound() {
    const messagesEl = document.getElementById('messages');
    if (!messagesEl) return;
    const notice = document.createElement('div');
    notice.className   = 'reply-not-found-notice';
    notice.textContent = 'Original message not in view';
    messagesEl.appendChild(notice);
    setTimeout(() => notice.remove(), 2000);
  }

  //    Storage helper                                                             

  _findMessage(messageId) {
    // ACTIVE_ID and getChat are bare globals from state.js / storage.js
    if (!ACTIVE_ID) return null;
    const chat = getChat(ACTIVE_ID);
    return chat.find(m => m.id === messageId) || null;
  }

  //    Styles                                                                    

  _injectStyles() {
    if (document.getElementById('xame-reply-style')) return;
    const style = document.createElement('style');
    style.id    = 'xame-reply-style';
    style.textContent = `
      /* Reply banner above composer    */
      .reply-banner {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 12px;
        background: var(--color-surface, #1e2732);
        border-top: 1px solid var(--color-border, #38444d);
        opacity: 0; transform: translateY(4px);
        transition: opacity 0.15s ease, transform 0.15s ease;
      }
      .reply-banner.visible { opacity: 1; transform: translateY(0); }
      .reply-banner-bar {
        width: 3px; min-height: 32px; flex-shrink: 0;
        background: var(--color-primary, #0084ff); border-radius: 2px;
      }
      .reply-banner-body {
        flex: 1; display: flex; flex-direction: column; gap: 2px; overflow: hidden;
      }
      .reply-banner-label {
        font-size: 12px; color: var(--color-primary, #0084ff); font-weight: 500;
      }
      .reply-banner-preview {
        font-size: 13px; color: var(--color-text-secondary, #8899a6);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .reply-banner-cancel { 
        flex-shrink: 0; 
        color: var(--color-text-secondary, #8899a6);
        background: transparent;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
      }

      /* Quote block inside bubbles    */
      .reply-quote {
        display: flex; gap: 8px; padding: 6px 8px; margin-bottom: 6px;
        background: rgba(0,0,0,0.15); border-radius: 6px; cursor: pointer;
        transition: background 0.15s ease;
      }
      .reply-quote:hover { background: rgba(0,0,0,0.25); }
      .reply-quote-bar {
        width: 3px; border-radius: 2px; flex-shrink: 0;
        background: var(--color-primary, #0084ff);
      }
      .reply-quote-body {
        display: flex; flex-direction: column; gap: 2px; overflow: hidden;
      }
      .reply-quote-sender {
        font-size: 11px; font-weight: 600; color: var(--color-primary, #0084ff);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .reply-quote-text {
        font-size: 12px; color: var(--color-text-secondary, #8899a6);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }

      /* Highlight animation    */
      @keyframes replyHighlight {
        0%   { box-shadow: 0 0 0 3px var(--color-primary, #0084ff); }
        100% { box-shadow: 0 0 0 0 transparent; }
      }
      .reply-highlight { animation: replyHighlight 0.8s ease forwards; border-radius: 8px; }

      /* "Not in view" notice    */
      .reply-not-found-notice {
        text-align: center; padding: 8px; font-size: 12px;
        color: var(--color-text-secondary, #8899a6);
        background: var(--color-surface, #1e2732);
        border-radius: 8px; margin: 4px auto; width: fit-content;
      }
    `;
    document.head.appendChild(style);
  }
}

//                                                                              
// Singleton
//                                                                              
const replyModule = new _ReplyModule();
