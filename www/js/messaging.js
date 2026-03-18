/*
 * messaging.js
 * Message rendering (bubbles, waveforms, pagination, select mode),
 * sendMessage, sendFile, markAllSeen, intelligentMerge.
 * XamePage v2.1
 * Depends on: config.js, state.js, storage.js, utils.js, ui.js, audio.js
 */

// WaveSurfer cleanup
function cleanupWaveSurfers() {
  if (!messagesEl) return;
  messagesEl.querySelectorAll('.bubble').forEach(bubble => {
    if (bubble.wavesurfer) {
      try { if (typeof bubble.wavesurfer.destroy === 'function') bubble.wavesurfer.destroy(); }
      catch (e) { console.error('Error destroying bubble wavesurfer:', e); }
      delete bubble.wavesurfer;
    }
  });
  RESOURCES.wavesurfers.forEach((ws) => {
    try { if (ws && typeof ws.destroy === 'function') ws.destroy(); }
    catch (e) { console.error('Error destroying tracked wavesurfer:', e); }
  });
  RESOURCES.wavesurfers.clear();
}

// Tick helper
function renderTicks(status) {
  if (status === 'seen')      return '<span style="color:#4fc3f7">&#10003;&#10003;</span>';
  if (status === 'delivered') return '<span style="color:#aaa">&#10003;&#10003;</span>';
  return '<span style="color:#aaa">&#10003;</span>';
}

// Simple UI sound (direct Audio elements)
function playUiSound(type = 'message') {
  let audio;
  if (type === 'call')
    audio = new Audio('xamepage_call.mp3');
  else if (type === 'outgoing') audio = new Audio('xamepage_outgoing.mp3');
  else                     audio = new Audio('xamepage_message.mp3');
  audio.volume = 0.5;
  audio.play().catch(err => console.warn('Audio play blocked:', err));
}

// Build a single message bubble
function messageBubble(m) {
  const div = document.createElement('div');
  div.className = `bubble ${m.type}`;
  if (m.type === 'sent' && m.status === 'seen') div.classList.add('seen');
  div.dataset.id = m.id;
  if (selectedMessages.includes(m.id)) div.classList.add('selected');

  // Selection on click (when already in select mode)
  div.addEventListener('click', (e) => {
    if (selectedMessages.length > 0) { e.preventDefault(); e.stopPropagation(); toggleMessageSelection(m); }
  });

  // Long-press to enter select mode
  let pressTimer, hasMoved = false;
  const LONG_PRESS_DELAY = 500, MOVE_THRESHOLD = 10;
  let startX = 0, startY = 0;

  const longPressAction = () => {
    if (!hasMoved) {
      window.__xame_longpress_fired = true;
      div.style.transform = 'scale(0.98)';
      setTimeout(() => (div.style.transform = ''), 100);

      if (typeof replyModule !== 'undefined' && selectedMessages.length === 0) {
        // Show action menu with Reply and Select options
        const existing = document.querySelector('.bubble-action-menu');
        if (existing) existing.remove();

        const menu = document.createElement('div');
        menu.className = 'bubble-action-menu menu-panel dialog-like';
        menu.innerHTML = `
          <div class="menu-item" id="bubbleReplyBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;vertical-align:middle;">
              <polyline points="9 17 4 12 9 7"></polyline>
              <path d="M20 18v-2a4 4 0 0 0-4-4H4"></path>
            </svg> Reply
          </div>
          <div class="menu-item" id="bubbleSelectBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;vertical-align:middle;">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg> Select
          </div>
          <div class="menu-item" id="bubbleTranslateBtn">
            <span style="margin-right:8px;font-size:16px;">&#127758;</span> Translate
          </div>
          <div class="menu-item" id="bubbleCopyBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;vertical-align:middle;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> Copy
          </div>
        `;
        
        const rect = div.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = (rect.top - 90) + 'px';
        menu.style.left = rect.left + 'px';
        menu.style.zIndex = '9999';
        document.body.appendChild(menu);

        menu.querySelector('#bubbleReplyBtn').addEventListener('click', () => {
          menu.remove();
          replyModule.startReply(m.id, div);
        });

        menu.querySelector('#bubbleSelectBtn').addEventListener('click', () => {
          menu.remove();
          if (selectedMessages.length === 0) enterSelectMode();
          toggleMessageSelection(m);
        });

        menu.querySelector('#bubbleTranslateBtn').addEventListener('click', () => {
          menu.remove();
          const msgText = m.text || m.content || m.body || '';
          if (typeof translationModule !== 'undefined' && msgText) {
            translationModule.showTranslateDialog(msgText, div);
          } else {
            showNotification('No text to translate');
          }
        });

        menu.querySelector('#bubbleCopyBtn').addEventListener('click', () => {
          menu.remove();
          const msgText = m.text || m.content || m.body || '';
          navigator.clipboard?.writeText(msgText).then(() => showNotification('Copied!'));
        });

        setTimeout(() => {
          document.addEventListener('click', () => menu.remove(), { once: true });
        }, 100);
      } else {
        if (selectedMessages.length === 0) enterSelectMode();
        toggleMessageSelection(m);
      }
    }
  };

  const startTimer = (e) => {
    clearTimeout(pressTimer); hasMoved = false;
    if (e.type === 'mousedown' && e.button !== 0) return;
    startX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    startY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    pressTimer = setTimeout(longPressAction, LONG_PRESS_DELAY);
  };

  const checkMove = (e) => {
    const cx = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const cy = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    if (Math.abs(cx - startX) > MOVE_THRESHOLD || Math.abs(cy - startY) > MOVE_THRESHOLD) {
      hasMoved = true; clearTimeout(pressTimer);
    }
  };

  const clearTimer = () => clearTimeout(pressTimer);

  div.addEventListener('mousedown', startTimer);
  div.addEventListener('mousemove', checkMove);
  div.addEventListener('mouseup', clearTimer);
  div.addEventListener('mouseleave', clearTimer);
  div.addEventListener('touchstart', e => { if (e.touches.length === 1) startTimer(e); }, { passive: true });
  div.addEventListener('touchmove', checkMove, { passive: true });
  div.addEventListener('touchend', clearTimer);
  div.addEventListener('touchcancel', clearTimer);
  div.addEventListener('contextmenu', e => e.preventDefault());

  // Forwarded indicator
  const fwdBanner = m.forwarded ? '<div class="forwarded-label">&#10149; Forwarded</div>' : '';

  // --- Text message ---
  if (m.text && !(m.file && m.file.url)) {
    const _emojiOnly = /^[\p{Emoji}\s]+$/u.test(m.text.trim()) && m.text.trim().length > 0;
    if (_emojiOnly) {
      div.classList.add('emoji-only-msg');
      div.innerHTML = '<div class="emoji-standalone">' + m.text.trim() + '</div>'
        + '<div class="time-row" style="justify-content:center;">'
        + '<span>' + fmtTime(m.ts) + '</span>'
        + (m.type === 'sent' ? '<span class="ticks">' + renderTicks(m.status) + '</span>' : '')
        + '</div>';
    } else {
    div.innerHTML = fwdBanner + '<div>' + escapeHtml(m.text) + '</div>'
      + '<div class="time-row">'
      + '<button class="icon-btn speak-btn">&#128266;</button>'
      + '<span>' + fmtTime(m.ts) + '</span>'
      + (m.type === 'sent' ? '<span class="ticks">' + renderTicks(m.status) + '</span>' : '')
      + '</div>';
    div.querySelector('.speak-btn')?.addEventListener('click', (e) => { e.stopPropagation(); textToVoice(m.text); });
    if (m.replyTo && typeof replyModule !== 'undefined') replyModule.renderQuote(m.replyTo, div);
    }

  // --- File message ---
  } else if (m.file && (m.file.url || m.voOpened)) {
    const fileUrl  = m.file.url ? constructFileUrl(m.file.url) : null;
    const fileType = m.file.type;
    const fileName = m.file.name || 'file';
    let fileContent = '';

    if (fileType.startsWith('image/')) {
      if (m.viewOnce) {
        if (m.type === 'sent') {
          fileContent = '<div class="view-once-sent" style="padding:10px;text-align:center;opacity:0.7;font-size:13px">👁️ View Once sent</div>';
        } else if (m.voOpened) {
          fileContent = '<div class="view-once-opened" style="padding:10px;text-align:center;opacity:0.5;font-size:13px">Opened</div>';
        } else {
          fileContent = `<div class="view-once-tap" data-url="${escapeHtml(fileUrl)}" data-id="${escapeHtml(m.id)}" style="padding:14px 20px;text-align:center;cursor:pointer;background:rgba(255,255,255,0.07);border-radius:12px;font-size:14px">👁️ Tap to view</div>`;
        }
      } else
      fileContent = `
        <div class="image-preview" data-url="${escapeHtml(fileUrl)}">
          <img src="${escapeHtml(fileUrl)}" alt="${escapeHtml(fileName)}" loading="lazy">
          <div class="image-overlay"><button class="view-fullscreen-btn">👁 View</button></div>
        </div>
      `;
      if (m.text) fileContent += '<div style="margin-top:4px;font-size:13px;word-break:break-word">' + escapeHtml(m.text) + '</div>';
    } else if (fileType.startsWith('video/')) {
      fileContent = `
        <div class="video-preview">
          <video src="${escapeHtml(fileUrl)}" controls preload="metadata" playsinline style="max-width:100%;border-radius:8px;display:block"></video>
          <div class="file-info" style="display:flex;align-items:center;justify-content:space-between;margin-top:4px">
            <span class="file-name">${escapeHtml(fileName)}</span>
            <button class="video-fullscreen-btn" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--text-secondary)" title="Fullscreen">⛶</button>
          </div>
        </div>
      `;
    } else if (fileType.startsWith('audio/')) {
      const audioId = `audio-${m.id}`;
      fileContent = `
        <div class="audio-message-container">
          <audio id="${audioId}" src="${escapeHtml(fileUrl)}" preload="metadata"></audio>
          <div class="waveform-container" id="waveform-container-${m.id}">
            <div class="waveform-loading">Loading waveform...</div>
          </div>
          <div class="audio-controls">
            <button class="audio-play-btn" data-audio-id="${audioId}">&#9654;</button>
            <span class="audio-time">0:00</span>
            <a href="${escapeHtml(fileUrl)}" download="${escapeHtml(fileName)}" class="download-btn" title="Download">&#8595;</a>
          </div>
        </div>
      `;
    } else {
      const fileIcon = getFileIcon(fileType, fileName);
      fileContent = `
        <a href="${escapeHtml(fileUrl)}" target="_blank" download="${escapeHtml(fileName)}" class="document-preview">
          <div class="doc-icon">${fileIcon}</div>
          <div class="doc-details">
            <span class="doc-name">${escapeHtml(fileName)}</span>
            <span class="doc-type">${(fileType.split('/')[1] || 'FILE').toUpperCase()}</span>
          </div>
          <button class="doc-download-btn" title="Download">&#8595;</button>
        </a>
      `;
    }

    div.innerHTML = (m.forwarded ? '<div class="forwarded-label">&#10149; Forwarded</div>' : '')
      + '<div class="file-message">' + fileContent + '</div>'
      + '<div class="time-row">'
      + '<span>' + fmtTime(m.ts) + '</span>'
      + (m.type === 'sent' ? '<span class="ticks">' + renderTicks(m.status) + '</span>' : '')
      + '</div>';

    // Image fullscreen
    div.querySelector('.image-preview')?.addEventListener('click', (e) => {
      if (selectedMessages.length > 0) return;
      e.stopPropagation(); openImageFullscreen(fileUrl, fileName);
    });

    // View once tap handler
    div.querySelector('.view-once-tap')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openImageFullscreen(fileUrl, fileName);
      const chat = getChat(ACTIVE_ID);
      const idx = chat.findIndex(msg => msg.id === m.id);
      if (idx !== -1) { chat[idx].voOpened = true; chat[idx].file.url = null; setChat(ACTIVE_ID, chat); renderMessages(); }
    });

    // Video fullscreen
    div.querySelector('.video-fullscreen-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const video = div.querySelector('video');
      if (!video) return;

      // Create fullscreen overlay
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000;display:flex;align-items:center;justify-content:center;';
      
      const fullVideo = document.createElement('video');
      fullVideo.src = video.src;
      fullVideo.controls = true;
      fullVideo.autoplay = true;
      fullVideo.playsInline = false;
      fullVideo.style.cssText = 'width:100%;height:100%;object-fit:contain;';

      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;background:rgba(0,0,0,0.6);color:white;border:none;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:10000;';
      closeBtn.addEventListener('click', () => { fullVideo.pause(); overlay.remove(); });

      overlay.appendChild(fullVideo);
      overlay.appendChild(closeBtn);
      document.body.appendChild(overlay);

      // Try native fullscreen
      if (fullVideo.requestFullscreen) fullVideo.requestFullscreen().catch(() => {});
      else if (fullVideo.webkitRequestFullscreen) fullVideo.webkitRequestFullscreen();
      else if (fullVideo.webkitEnterFullscreen) fullVideo.webkitEnterFullscreen();
    });

    // WaveSurfer for audio
    if (fileType.startsWith('audio/') && typeof WaveSurfer !== 'undefined') {
      const audioEl     = div.querySelector(`#audio-${m.id}`);
      const wfContainer = div.querySelector(`#waveform-container-${m.id}`);
      const playBtn2    = div.querySelector('.audio-play-btn');
      const timeDisplay = div.querySelector('.audio-time');

      if (audioEl && wfContainer) {
        const existingWs = RESOURCES.wavesurfers.get(m.id);
        if (existingWs) { try { existingWs.destroy(); } catch (_) {} RESOURCES.wavesurfers.delete(m.id); }

        wfContainer.innerHTML = '';
        const wfDiv = document.createElement('div');
        wfDiv.className = 'waveform';
        wfContainer.appendChild(wfDiv);

        try {
          const wavesurfer = WaveSurfer.create({
            container:     wfDiv,
            waveColor:     m.type === 'sent' ? 'rgba(255,255,255,0.5)' : '#9aa8b2',
            progressColor: m.type === 'sent' ? '#fff' : '#0084ff',
            cursorColor:   'transparent',
            barWidth: 2, barRadius: 3, height: 50, barGap: 2,
            responsive: true, interact: true,
          });
          wavesurfer.load(fileUrl);
          wavesurfer.on('ready', () => { if (timeDisplay) timeDisplay.textContent = formatDuration(wavesurfer.getDuration()); });
          wavesurfer.on('audioprocess', () => { if (timeDisplay) timeDisplay.textContent = formatDuration(wavesurfer.getCurrentTime()); });
          wavesurfer.on('finish', () => { if (playBtn2) playBtn2.innerHTML = '&#9654;'; });

          playBtn2?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (wavesurfer.isPlaying()) { wavesurfer.pause(); playBtn2.innerHTML = '&#9654;'; }
            else                        { wavesurfer.play();  playBtn2.innerHTML = '&#9646;&#9646;'; }
          });

          div.wavesurfer = wavesurfer;
          RESOURCES.wavesurfers.set(m.id, wavesurfer);
        } catch (error) {
          console.error('Failed to create waveform:', error);
          wfContainer.innerHTML = '<div class="waveform-error">Waveform unavailable</div>';
        }
      }
    }

  // --- Fallback ---
  } else {
    div.innerHTML = `
      <div class="file-message">
        <span class="file-icon">⚠️</span>
        <span class="file-name">File not available.</span>
      </div>
      <div class="time-row">
        <span>${fmtTime(m.ts)}</span>
        ${m.type === 'sent' ? `<span class="ticks">${renderTicks(m.status)}</span>` : ''}
      </div>
    `;
  }

  if (typeof reactionsModule !== 'undefined') reactionsModule.attachToMessage(div, m.id);
  return div;
}

// Render all messages
function renderMessages() {
  if (!messagesEl) return;

  // Destroy existing WaveSurfers before clearing DOM
  messagesEl.querySelectorAll('.bubble').forEach(bubble => {
    if (bubble.wavesurfer && typeof bubble.wavesurfer.destroy === 'function') {
      try { bubble.wavesurfer.destroy(); } catch (_) {}
      delete bubble.wavesurfer;
    }
  });
  RESOURCES.wavesurfers.forEach((ws) => { try { ws?.destroy?.(); } catch (_) {} });
  RESOURCES.wavesurfers.clear();

  messagesEl.innerHTML = '';
  const msgs          = getChat(ACTIVE_ID);
  const totalMessages = msgs.length;
  const messagesToShow = Math.min(MESSAGE_PAGE_SIZE * currentMessagePage, totalMessages);
  const startIndex    = Math.max(0, totalMessages - messagesToShow);
  const visibleMsgs   = msgs.slice(startIndex);

  let lastDay = '';
  const fragment = document.createDocumentFragment();
  visibleMsgs.forEach(m => {
    const label = dayLabel(m.ts);
    if (label !== lastDay) {
      const sep = document.createElement('div');
      sep.className   = 'h-sub';
      sep.style.cssText = 'text-align:center;margin:8px 0;';
      sep.textContent = label;
      fragment.appendChild(sep);
      lastDay = label;
    }
    const bubble = messageBubble(m);
    fragment.appendChild(bubble);

    if (typeof disappearingModule !== 'undefined' && m.expiresAt) {
      disappearingModule.scheduleDelete(m.id, m.expiresAt, bubble);
    }
  });

  messagesEl.appendChild(fragment);

  if (startIndex > 0 && !isLoadingMoreMessages) {
    const loadMoreBtn = document.createElement('button');
    loadMoreBtn.className   = 'load-more-messages-btn';
    loadMoreBtn.textContent = `Load ${Math.min(MESSAGE_PAGE_SIZE, startIndex)} more messages`;
    loadMoreBtn.style.cssText = 'display:block;margin:10px auto;padding:8px 16px;background:#007bff;color:white;border:none;border-radius:8px;cursor:pointer;';
    loadMoreBtn.addEventListener('click', () => {
      currentMessagePage++; isLoadingMoreMessages = true;
      renderMessages(); isLoadingMoreMessages = false;
    });
    messagesEl.insertBefore(loadMoreBtn, messagesEl.firstChild);
  }

  scrollToBottom();
}

// Message selection
function toggleMessageSelection(message) {
  const id      = message.id;
  const index   = selectedMessages.indexOf(id);
  const element = messagesEl.querySelector(`.bubble[data-id="${id}"]`);

  if (index > -1) {
    selectedMessages.splice(index, 1);
    element?.classList.remove('selected');
    if (selectedMessages.length === 0) exitSelectMode();
  } else {
    selectedMessages.push(id);
    element?.classList.add('selected');
    if (selectedMessages.length === 1 && !elChatHeader.querySelector('.selection-toolbar-wrapper'))
      enterSelectMode();
  }
  updateSelectCounter();
}

function enterSelectMode() {
  elChatHeader.insertAdjacentHTML('beforeend', `
    <div class="selection-toolbar-wrapper">
      <button class="icon-btn" id="exitSelectModeBtn" title="Exit selection mode">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <div class="counter">${selectedMessages.length} selected</div>
      <div class="toolbar">
        <button class="icon-btn" id="copySelectedBtn" title="Copy messages">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
        <button class="icon-btn" id="forwardSelectedBtn" title="Forward messages">
           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <polyline points="15 10 20 15 15 20"></polyline>
             <path d="M4 4v7a4 4 0 0 0 4 4h12"></path>
           </svg>
        </button>
        <button class="icon-btn" id="emailSelectedBtn" title="Send via Email">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
            <polyline points="22,6 12,13 2,6"></polyline>
          </svg>
        </button>
        <button class="icon-btn" id="deleteSelectedBtn"  title="Delete messages">
           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
             <polyline points="3 6 5 6 21 6"></polyline>
             <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
             <line x1="10" y1="11" x2="10" y2="17"></line>
             <line x1="14" y1="11" x2="14" y2="17"></line>
           </svg>
        </button>
      </div>
    </div>
  `);

  elChatHeader.querySelector('.header-details')?.classList.add('hidden');
  elChatHeader.querySelector('.toolbar:not(.selection-toolbar-wrapper .toolbar)')?.classList.add('hidden');
  elChatHeader.querySelector('.icon-btn-group')?.classList.add('hidden');

  const wrapper = elChatHeader.querySelector('.selection-toolbar-wrapper');
  wrapper.querySelector('#exitSelectModeBtn')?.addEventListener('click', exitSelectMode);
  wrapper.querySelector('#deleteSelectedBtn')?.addEventListener('click', renderDeleteMenu);
  wrapper.querySelector('#copySelectedBtn')?.addEventListener('click', () => {
    playUiSound('outgoing'); copyMessages(selectedMessages); exitSelectMode();
  });
  wrapper.querySelector('#forwardSelectedBtn')?.addEventListener('click', () => {
    playUiSound('outgoing'); forwardMessages(selectedMessages); exitSelectMode();
  });
  wrapper.querySelector('#emailSelectedBtn')?.addEventListener('click', () => {
    emailMessages(selectedMessages); exitSelectMode();
  });
}

function emailMessages(ids) {
  const chat = getChat(ACTIVE_ID);
  const msgs = ids.map(id => chat.find(m => m.id === id)).filter(Boolean);

  const contactName = CONTACTS.find(c => c.id === ACTIVE_ID)?.name || ACTIVE_ID;
  const subject = encodeURIComponent('XamePage conversation with ' + contactName);

  const body = msgs.map(m => {
    const time = new Date(m.ts).toLocaleString();
    const sender = m.type === 'sent' ? 'Me' : contactName;
    if (m.file) return '[' + time + '] ' + sender + ': [File: ' + m.file.name + '] ' + (m.file.url ? m.file.url : '');
    return '[' + time + '] ' + sender + ': ' + (m.text || '');
  }).join('\n\n');

  window.location.href = 'mailto:?subject=' + subject + '&body=' + encodeURIComponent(body);
}

function exitSelectMode() {
  selectedMessages = [];
  elChatHeader.querySelector('.selection-toolbar-wrapper')?.remove();
  elChatHeader.querySelector('.header-details')?.classList.remove('hidden');
  elChatHeader.querySelector('.toolbar:not(.selection-toolbar-wrapper .toolbar)')?.classList.remove('hidden');
  elChatHeader.querySelector('.icon-btn-group')?.classList.remove('hidden');
  currentMessagePage = 1;
  renderMessages();
}

function updateSelectCounter() {
  const counter = elChatHeader.querySelector('.selection-toolbar-wrapper .counter');
  if (counter) counter.textContent = `${selectedMessages.length} selected`;
}

function renderDeleteMenu() {
  const count = selectedMessages.length;
  if (count === 0) return;

  const snapshot = [...selectedMessages]; // capture before any async/dialog clears it
  const currentChat     = getChat(ACTIVE_ID);
  const hasSentMessages = snapshot.some(id => currentChat.find(m => m.id === id)?.type === 'sent');

  const options = [
    { 
      label: `Copy ${count} message${count === 1 ? '' : 's'}`,    
      icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;">
               <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
               <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
             </svg>`,  
      action: () => { playUiSound('outgoing'); copyMessages(snapshot); exitSelectMode(); closeDialog(); } 
    },
    { label: `Forward ${count} message${count === 1 ? '' : 's'}`, icon: '➡',  action: () => { playUiSound('outgoing'); forwardMessages(snapshot); exitSelectMode(); closeDialog(); } },
    { label: `Email ${count} message${count === 1 ? '' : 's'}`, icon: '📧', action: () => { emailMessages(snapshot); exitSelectMode(); closeDialog(); } },
    { label: `Delete for me (${count})`, icon: '🗑', action: () => {
        if (confirm(`Are you sure you want to delete ${count} message${count === 1 ? '' : 's'} for yourself?`)) {
          deleteMessages(snapshot, false); closeDialog();
        }
      }
    },
  ];

  if (hasSentMessages) {
    options.push({ label: `Delete for everyone (${count})`, icon: '🗑', action: () => {
        if (confirm(`Are you sure you want to delete ${count} message${count === 1 ? '' : 's'} for everyone?`)) {
          deleteMessages(snapshot, true); closeDialog();
        }
      }
    });
  }

  const wrap = document.createElement('div');
  wrap.className = 'menu-panel dialog-like';
  wrap.style.cssText = 'min-width:250px;padding:5px 0;';

  const deleteBtnEl = elChatHeader.querySelector('#deleteSelectedBtn');
  if (!deleteBtnEl) return;

  const rect = deleteBtnEl.getBoundingClientRect();
  const vw   = window.innerWidth, vh = window.innerHeight;
  let top = rect.bottom + 5, right = vw - rect.right;

  layer.appendChild(wrap);
  const menuRect = wrap.getBoundingClientRect();

  if (top   + menuRect.height > vh) top   = rect.top - menuRect.height - 5;
  if (right + menuRect.width  > vw) right = 5;

  wrap.style.top   = `${top}px`;
  wrap.style.right = `${right}px`;

  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'menu-item';
    item.style.fontWeight = 'bold';
    item.innerHTML = `<span style="margin-right:10px;">${opt.icon}</span> ${escapeHtml(opt.label)}`;
    item.addEventListener('click', opt.action);
    wrap.appendChild(item);
  });

  openMenuDialog(wrap);
}

async function deleteMessages(messageIds, deleteForEveryone = false) {

  if (!ACTIVE_ID) return;
  const chat = getChat(ACTIVE_ID);
  const updated = chat.filter(m => !messageIds.includes(m.id));

  // Write synchronously so deletion survives page refresh
  memoryStorage.set(KEYS.chat(ACTIVE_ID), updated);
  persistentStorage.set(KEYS.chat(ACTIVE_ID), updated);

  const deletedIds = new Set(JSON.parse(localStorage.getItem('xame:deleted_msgs') || '[]'));
  messageIds.forEach(id => deletedIds.add(id));
  localStorage.setItem('xame:deleted_msgs', JSON.stringify([...deletedIds]));

  selectedMessages.length = 0;
  renderMessages();
  exitSelectMode();

  if (deleteForEveryone) {
    await syncDeletionsWithServer({ chat: { messageIds, contactId: ACTIVE_ID, deleteForEveryone: true } });
  }
}

function copyMessages(messageIds) {
  const texts = getChat(ACTIVE_ID).filter(m => messageIds.includes(m.id)).map(m => m.text || '[Attachment]');
  if (texts.length > 0) {
    navigator.clipboard.writeText(texts.join('\n\n'))
      .then(() => showNotification('Messages copied!'))
      .catch(() => showNotification('Failed to copy messages.'));
  }
}

function forwardMessages(messageIds) {
  const messages = getChat(ACTIVE_ID).filter(m => messageIds.includes(m.id));
  if (messages.length === 0) return;

  // Build contact picker dialog
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center';

  const sheet = document.createElement('div');
  sheet.style.cssText = 'background:var(--color-surface,#1e2733);border-radius:16px 16px 0 0;width:100%;max-height:70vh;display:flex;flex-direction:column;padding:16px';

  const title = document.createElement('h3');
  title.textContent = `Forward ${messages.length} message${messages.length > 1 ? 's' : ''} to...`;
  title.style.cssText = 'margin:0 0 12px;color:var(--text-primary,#fff);font-size:16px';

  const list = document.createElement('div');
  list.style.cssText = 'overflow-y:auto;flex:1';

  const otherContacts = CONTACTS.filter(c => c.id !== USER.xameId && c.id !== ACTIVE_ID);
  const selected = new Set();

  otherContacts.forEach(contact => {
    const item = document.createElement('div');
    item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 8px;border-radius:8px;cursor:pointer';
    item.dataset.id = contact.id;

    item.innerHTML = `
      <div style="width:40px;height:40px;border-radius:50%;background:var(--color-primary,#00b0a0);display:flex;align-items:center;justify-content:center;font-weight:bold;color:#fff;flex-shrink:0;overflow:hidden">
        ${contact.profilePic ? `<img src="${contact.profilePic}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : (contact.name||'?')[0].toUpperCase()}
      </div>
      <span style="color:var(--text-primary,#fff);font-size:15px;flex:1">${contact.name || contact.id}</span>
      <span class="fwd-check" style="width:22px;height:22px;border-radius:50%;border:2px solid #aaa;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0"></span>
    `;

    item.addEventListener('click', () => {
      const check = item.querySelector('.fwd-check');
      if (selected.has(contact.id)) {
        selected.delete(contact.id);
        check.style.background = 'transparent';
        check.style.borderColor = '#aaa';
        check.textContent = '';
        item.style.background = 'transparent';
      } else {
        selected.add(contact.id);
        check.style.background = 'var(--color-primary,#00b0a0)';
        check.style.borderColor = 'var(--color-primary,#00b0a0)';
        check.textContent = '✓';
        item.style.background = 'rgba(0,176,160,0.12)';
      }
      sendBtn.textContent = selected.size > 0 ? `Forward to ${selected.size} contact${selected.size > 1 ? 's' : ''}` : 'Select contacts';
      sendBtn.disabled = selected.size === 0;
      sendBtn.style.opacity = selected.size === 0 ? '0.5' : '1';
    });

    list.appendChild(item);
  });

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;margin-top:12px';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'flex:1;padding:10px;border:none;border-radius:8px;background:rgba(255,255,255,0.1);color:var(--text-primary,#fff);font-size:15px;cursor:pointer';
  cancelBtn.addEventListener('click', () => document.body.removeChild(overlay));

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'Select contacts';
  sendBtn.disabled = true;
  sendBtn.style.cssText = 'flex:2;padding:10px;border:none;border-radius:8px;background:var(--color-primary,#00b0a0);color:#fff;font-size:15px;cursor:pointer;font-weight:bold;opacity:0.5';
  
  sendBtn.addEventListener('click', () => {
    selected.forEach(contactId => {
      messages.forEach(m => {
        const fwdMsg = { id: uid(), text: m.text, file: m.file, type: 'sent', ts: now(), status: 'sending', forwarded: true };
        const chat = getChat(contactId);
        chat.push(fwdMsg);
        setChat(contactId, chat);
        socket.emit('send-message', { recipientId: contactId, message: fwdMsg });
      });
    });

    const names = [...selected].map(id => CONTACTS.find(c => c.id === id)?.name || id).join(', ');
    showNotification(`Forwarded to ${names}`);
    document.body.removeChild(overlay);
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(sendBtn);

  sheet.appendChild(title);
  sheet.appendChild(list);
  sheet.appendChild(btnRow);
  overlay.appendChild(sheet);

  overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
  document.body.appendChild(overlay);
}

async function syncDeletionsWithServer(deletionData) {
  if (!socket?.connected) { console.error('Cannot sync deletions: Socket not connected'); return false; }
  socket.emit('sync-deletions', deletionData, (response) => {
    if (!response?.success) console.error('sync-deletions failed:', response);
  });
  return true;
}

// Send text message
function sendMessage(text) {
  // Route to group if active group chat
  if (typeof ACTIVE_GROUP !== 'undefined' && ACTIVE_GROUP) {
    if (!text?.trim()) return;
    const msg = { senderId: USER.xameId, senderName: USER.preferredName || USER.firstName, text, ts: Date.now() };
    groupsModule._messages.push({ ...msg, _id: 'local-' + Date.now() });
    groupsModule._renderGroupMessages();
    scrollToBottom();
    socket.emit('group:send-message', { groupId: ACTIVE_GROUP.groupId, message: msg });
    return;
  }

  if (!ACTIVE_ID || !socket) { showNotification('Cannot send message. Check your connection.'); return; }
  if (!text?.trim()) return;

  const msgId  = uid();
  const ts     = now();
  let newMsg = { id: msgId, text, type: 'sent', ts, status: 'sending' };

  if (typeof replyModule !== 'undefined') {
    newMsg = replyModule.decorateOutgoing(newMsg) || newMsg;
  }
  if (typeof disappearingModule !== 'undefined') {
    newMsg = disappearingModule.stampMessage(newMsg, ACTIVE_ID) || newMsg;
  }

  const chat = getChat(ACTIVE_ID);
  chat.push(newMsg); setChat(ACTIVE_ID, chat);
  scheduleRender(renderMessages, 'messages');
  playOutgoingMessageTone();

  const socketMsg = { id: msgId, text, ts };
  if (newMsg.expiresAt) socketMsg.expiresAt = newMsg.expiresAt;
  if (newMsg.replyTo)   socketMsg.replyTo   = newMsg.replyTo;

  if (typeof replyModule !== 'undefined') replyModule.confirmSent();

  socket.emit('send-message', { recipientId: ACTIVE_ID, message: socketMsg }, (response) => {
    if (response?.success && response.messageId) {
      const chatToUpdate = getChat(ACTIVE_ID);
      const idx = chatToUpdate.findIndex(m => m.id === response.messageId);
      if (idx !== -1) { 
        chatToUpdate[idx].status = 'delivered'; 
        setChat(ACTIVE_ID, chatToUpdate); 
        scheduleRender(renderMessages, 'messages'); 
      }
    } else {
      console.error('Server failed to deliver message:', response?.message);
      showNotification('Message may not have been delivered');
    }
  });
}

// Send file
async function uploadLargeFileToCDN(file) {
  const CLOUD_NAME = 'dveoa6j32';
  const UPLOAD_PRESET = 'gx8rteqo';
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);
  formData.append('folder', 'xamepage_chat');
  formData.append('resource_type', 'raw');
  // Try raw first, fall back to auto
  let response = await fetch('https://api.cloudinary.com/v1_1/' + CLOUD_NAME + '/raw/upload', {
    method: 'POST',
    body: formData
  });
  if (!response.ok) {
    formData.delete('resource_type');
    response = await fetch('https://api.cloudinary.com/v1_1/' + CLOUD_NAME + '/auto/upload', {
      method: 'POST',
      body: formData
    });
  }
  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error('Upload failed: ' + (errData.error?.message || response.status));
  }
  const data = await response.json();
  return data.secure_url;
}

async function sendFile(file, caption, viewOnce) {
  const inGroup = typeof ACTIVE_GROUP !== 'undefined' && ACTIVE_GROUP;

  if ((!ACTIVE_ID && !inGroup) || !socket) {
    showNotification('Cannot send file. Please check your connection.'); return;
  }

  console.log('Starting file upload:', file.name);
  const msgId = uid(), ts = now();
  const pendingMsg = { id: msgId, text: 'Uploading ' + file.name + '...', type: 'sent', ts, status: 'sending', isPending: true };

  if (!inGroup) {
    const chat = getChat(ACTIVE_ID);
    chat.push(pendingMsg); setChat(ACTIVE_ID, chat); renderMessages();
  }

  createUploadProgress(msgId, file.name);

  // All files go through server
  if (false) {
    try {
      updateUploadProgress(msgId, 10);
      const cdnUrl = await uploadLargeFileToCDN(file);
      updateUploadProgress(msgId, 100);
      removeUploadProgress(msgId);
      const finalMessage = { id: msgId, file: { name: file.name, type: file.type, url: cdnUrl }, type: 'sent', ts, status: 'sending', text: caption || '', viewOnce: !!viewOnce };
      if (!inGroup) {
        const chatToUpdate = getChat(ACTIVE_ID);
        const idx = chatToUpdate.findIndex(m => m.id === msgId);
        if (idx !== -1) { chatToUpdate[idx] = finalMessage; setChat(ACTIVE_ID, chatToUpdate); renderMessages(); }
        socket.emit('send-message', { recipientId: ACTIVE_ID, message: finalMessage }, () => {});
      }
    } catch(e) {
      removeUploadProgress(msgId);
      console.error('Upload error:', e);
      showNotification('Upload failed: ' + (e.message || JSON.stringify(e)));
    }
    return;
  }

  const formData = new FormData();
  formData.append('file',        file);
  formData.append('senderId',    USER.xameId);
  formData.append('recipientId', inGroup ? 'group' : ACTIVE_ID);
  formData.append('messageId',   msgId);

  const xhr = new XMLHttpRequest();
  currentUpload = xhr;

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) updateUploadProgress(msgId, (e.loaded / e.total) * 100);
  });

  xhr.addEventListener('load', function () {
    removeUploadProgress(msgId);
    if (xhr.status === 200) {
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.success && data.url) {
          const finalMessage = { id: msgId, file: { name: file.name, type: file.type, url: data.url }, type: 'sent', ts, status: 'sending', text: caption || '', viewOnce: !!viewOnce };

          if (inGroup) {
            const msg = { senderId: USER.xameId, senderName: USER.preferredName || USER.firstName, file: finalMessage.file, text: caption || '', ts };
            groupsModule._messages.push({ ...msg, _id: 'local-' + msgId });
            groupsModule._renderGroupMessages();
            scrollToBottom();
            socket?.emit('group:send-message', { groupId: ACTIVE_GROUP.groupId, message: msg });
            showNotification('File sent!');
          } else {
            const chatToUpdate = getChat(ACTIVE_ID);
            const idx = chatToUpdate.findIndex(m => m.id === msgId);
            if (idx !== -1) { chatToUpdate[idx] = finalMessage; setChat(ACTIVE_ID, chatToUpdate); renderMessages(); }

            socket?.emit('send-message', { recipientId: ACTIVE_ID, message: finalMessage }, (response) => {
              if (response?.success) {
                const c = getChat(ACTIVE_ID); const i = c.findIndex(m => m.id === msgId);
                if (i !== -1) { c[i].status = 'delivered'; setChat(ACTIVE_ID, c); renderMessages(); }
                showNotification('File sent successfully!');
              } else { showNotification('File uploaded but delivery failed'); }
            });
          }
        } else { throw new Error(data.message || 'Upload failed - no URL returned'); }
      } catch (error) { handleUploadError(msgId, error.message); }
    } else { handleUploadError(msgId, 'Server error: ' + xhr.status); }
    currentUpload = null;
  });

  xhr.addEventListener('error', () => {
    removeUploadProgress(msgId); handleUploadError(msgId, 'Network error during upload'); currentUpload = null;
  });

  xhr.addEventListener('abort', () => {
    removeUploadProgress(msgId);
    if (!inGroup) {
      const chatToUpdate = getChat(ACTIVE_ID);
      const idx = chatToUpdate.findIndex(m => m.id === msgId);
      if (idx !== -1) { chatToUpdate.splice(idx, 1); setChat(ACTIVE_ID, chatToUpdate); renderMessages(); }
    }
    showNotification('Upload cancelled'); currentUpload = null;
  });

  xhr.open('POST', serverURL+'/api/upload-file');
  xhr.send(formData);
}

// Mark all received messages as seen
function markAllSeen(contactId) {
  const chat    = getChat(contactId);
  const unseen  = chat.filter(m => m.type === 'received' && m.status !== 'seen');
  if (unseen.length > 0) {
    unseen.forEach(m => m.status = 'seen');
    setChat(contactId, chat);
    scheduleRender(renderMessages, 'messages');
  }
}

// Intelligent merge from server chat history
async function intelligentMerge(serverChatHistory) {
  console.log('Starting intelligent merge...');
  try {
    const entries    = Object.entries(serverChatHistory);
    const CHUNK_SIZE = 5;

    for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
      const chunk = entries.slice(i, i + CHUNK_SIZE);
      await new Promise(resolve => {
        requestAnimationFrame(() => {
          chunk.forEach(([contactId, serverMessages]) => {
            if (!Array.isArray(serverMessages)) { console.warn(`Invalid messages for contact ${contactId}`); return; }
            
            const localMessages  = storage.get(KEYS.chat(contactId), []);
            const localIds       = new Set(localMessages.map(m => m.id));
            const now            = Date.now();
            const deletedIds     = new Set(JSON.parse(localStorage.getItem('xame:deleted_msgs') || '[]'));

            const newMessages    = serverMessages.filter(m => {
              if (!m?.id) return false;
              if (localIds.has(m.id)) return false;
              if (deletedIds.has(m.id)) return false;
              if (m.expiresAt && m.expiresAt <= now) return false;
              return true;
            });

            const validLocal = localMessages.filter(m => (!m.expiresAt || m.expiresAt > now) && !deletedIds.has(m.id));
            const merged = [...validLocal, ...newMessages].sort((a, b) => (a.ts || 0) - (b.ts || 0));
            storage.set(KEYS.chat(contactId), merged);
          });
          resolve();
        });
      });
    }
    console.log('Intelligent merge complete.');
  } catch (error) { console.error('Merge error:', error); } 
}


// ── APK file download/open interceptor ──────────────────────────────────
async function openFileNatively(url, fileName) {
  if (url.includes('localhost')) {
    url = url.replace('https://localhost', serverURL).replace('http://localhost', serverURL);
  }
  if (window.AndroidBridge && window.AndroidBridge.openFileBase64) {
    try {
      showNotification('Opening ' + fileName + '...');
      const response = await fetch(url);
      if (!response.ok) throw new Error('Fetch failed: ' + response.status);
      const blob = await response.blob();
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      window.AndroidBridge.openFileBase64(base64, fileName, blob.type);
    } catch(e) {
      console.error('File open error:', e);
      showNotification('Could not open file: ' + (e.message || 'Unknown error') + ' | ' + fileName);
    }
  } else {
    window.open(url, '_blank');
  }
}

document.addEventListener('click', function(e) {
  if (!window.Capacitor?.isNativePlatform?.()) return;
  const btn = e.target.closest('.download-btn, .doc-download-btn, .document-preview');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  let url = btn.href || btn.closest('[data-url]')?.dataset.url || btn.parentElement?.querySelector('a')?.href;
  if (!url) return;
  const fileName = btn.getAttribute('download') || url.split('/').pop().split('?')[0] || 'file';
  openFileNatively(url, fileName);
}, true);
