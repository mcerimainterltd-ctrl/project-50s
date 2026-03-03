/*
 * chat.js
 * File attach / send from composer, typing indicator,
 * add-contact search dialog, logout.
 * XamePage v2.1
 *
 * Depends on: config.js, state.js, storage.js, utils.js, ui.js,
 *             messaging.js (sendMessage, sendFile),
 *             contacts.js (debouncedRenderContacts, renderContacts),
 *             auth.js (handleLoginSuccess)
 */

//  Attach button / file input 
attachBtn?.addEventListener('click', () => { fileInput?.click(); });

fileInput?.addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;

  console.log(' File selected:', { name: file.name, type: file.type, size: file.size });

  const validation = validateFile(file);
  if (!validation.valid) { showNotification(validation.error); fileInput.value = ''; return; }

  if (file.type.startsWith('image/')) {
    const result = await showImagePreview(file);
    if (result && result.send) sendFile(file, result.caption);
    else fileInput.value = '';
  } else {
    sendFile(file);
  }

  fileInput.value = '';
});

//  Composer submit (text message) 
composer?.addEventListener('submit', (e) => {
  e.preventDefault(); if (!messageInput) return;
  const text = messageInput.value.trim();
  if (text) {
    sendMessage(text);
    messageInput.value = '';
    updateComposerButtons();
    if (ACTIVE_ID) { delete DRAFTS[ACTIVE_ID]; storage.set(KEYS.drafts, DRAFTS); }
  }
});

//  Typing indicator 
let typingTimer;
messageInput?.addEventListener('input', () => {
  clearTimeout(typingTimer);
  const typingEnabled = typeof getSetting === 'function' ? getSetting('account.privacy.typingIndicators') !== false : true;
  if (typeof ACTIVE_GROUP !== 'undefined' && ACTIVE_GROUP) {
    if (typingEnabled) socket?.emit('group:typing', { groupId: ACTIVE_GROUP.groupId, userId: USER.xameId, name: USER.preferredName || USER.firstName });
  } else if (socket && ACTIVE_ID && typingEnabled) socket.emit('typing', { recipientId: ACTIVE_ID });

  typingTimer = setTimeout(() => {
    if (!(typeof ACTIVE_GROUP !== 'undefined' && ACTIVE_GROUP) && socket && ACTIVE_ID) socket.emit('stop-typing', { recipientId: ACTIVE_ID });
  }, 3000);

  updateComposerButtons();

  if (ACTIVE_ID) { DRAFTS[ACTIVE_ID] = messageInput.value; storage.set(KEYS.drafts, DRAFTS); }
});

//  Add contact button 
addContactBtn?.addEventListener('click', () => {
  const searchDialog  = $('#searchDialog');
  const searchIdInput = $('#searchIdInput');
  const searchResults = $('#searchResults');
  const searchUserBtn = $('#searchUserBtn');

  if (!searchDialog) return;

  if (searchIdInput) searchIdInput.value = '';
  if (searchResults) { searchResults.innerHTML = ''; searchResults.classList.add('hidden'); }

  searchDialog.classList.remove('hidden');

  // Close button
  const closeBtn = document.getElementById('closeSearchDialog');
  if (closeBtn) closeBtn.onclick = () => searchDialog.classList.add('hidden');
  // Close on backdrop click
  searchDialog.onclick = (e) => { if (e.target === searchDialog) searchDialog.classList.add('hidden'); };

  if (searchUserBtn) {
    searchUserBtn.onclick = async () => {
      const xameId = searchIdInput?.value.trim();
      if (!xameId) return showNotification('Please enter a Xame-ID.');

      try {
        const res  = await fetch('/api/search-user', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ xameId }),
        });
        const data = await res.json();

        if (!data.success) { showNotification(data.message || 'User not found.'); return; }

        const u = data.user;
        searchResults.innerHTML = ''; searchResults.classList.remove('hidden');

        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML = `
          <div class="meta">
            <div class="name">${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}</div>
            <div class="status">${escapeHtml(u.xameId)}</div>
          </div>
          <button class="btn primary" id="confirmAddContactBtn">Add</button>
        `;

        item.querySelector('#confirmAddContactBtn').addEventListener('click', async () => {
          const res2  = await fetch('/api/add-contact', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: USER.xameId, contactId: u.xameId }),
          });
          const data2 = await res2.json();
          if (data2.success) {
            searchDialog.classList.add('hidden');
            if (socket) socket.emit('get_contacts', USER.xameId);
            showNotification('Contact added!');
          } else {
            showNotification(data2.message || 'Failed to add contact.');
          }
        });

        searchResults.appendChild(item);

      } catch (err) {
        console.error('Search error:', err); showNotification('Network error during search.');
      }
    };
  }

  searchDialog.addEventListener('click', (e) => {
    if (e.target === searchDialog) searchDialog.classList.add('hidden');
  }, { once: true });
});

//  Logout button 
logoutBtn?.addEventListener('click', () => {
  if (!confirm('Are you sure you want to log out?')) return;

  // Disconnect socket and stop heartbeat
  if (socket) { socket.removeAllListeners(); socket.disconnect(); socket = null; }
  stopHeartbeat();

  // Clear user session only (keep contacts/chat data)
  storage.del(KEYS.user);
  USER      = null;
  ACTIVE_ID = null;

  show(elLanding);
  console.log(' Logged out');
});

//  Clear all chats button (in contacts header) 
clearAllChatsBtn?.addEventListener('click', clearAllChats);

//  Search input (live contact filter) 
searchInput?.addEventListener('input', (e) => {
  debouncedRenderContacts(e.target.value);
});

document.getElementById('scheduleMessageBtn')?.addEventListener('click', () => {
  if (!ACTIVE_ID) return;
  const contact = CONTACTS?.find(c => c.id === ACTIVE_ID);
  if (typeof scheduleModule !== 'undefined') scheduleModule.showScheduleDialog(ACTIVE_ID, contact?.name || ACTIVE_ID);
});

// ── Dropdown menu: Voice Note ─────────────────────────────────────────────
document.getElementById('menu-voice-note-btn')?.addEventListener('click', () => {
  document.getElementById('moreDropdown')?.classList.add('hidden');
  document.getElementById('micBtn')?.click();
});

// ── Dropdown menu: Voice-to-Text ─────────────────────────────────────────
document.getElementById('menu-voice-to-text-btn')?.addEventListener('click', () => {
  document.getElementById('moreDropdown')?.classList.add('hidden');
  const btn = document.querySelector('.voice-text-btn');
  if (btn) {
    btn.click();
  } else {
    showNotification('Voice-to-Text not available on this device');
  }
});

// ── Dropdown menu: Disappearing ───────────────────────────────────────────
document.getElementById('disappearTimerBtn')?.addEventListener('click', () => {
  document.getElementById('moreDropdown')?.classList.add('hidden');
  if (!ACTIVE_ID) return;
  if (typeof disappearingModule !== 'undefined') {
    disappearingModule.showTimerDialog(ACTIVE_ID);
  }
});
