/*
 * contacts.js
 * Contact list rendering, openChat, edit/delete contact,
 * clearAllChats, ensureSeedContacts.
 * XamePage v2.1
 *
 * Depends on: config.js, state.js, storage.js, utils.js, ui.js,
 *             messaging.js (renderMessages, markAllSeen),
 *             chat.js (renderChatMoreMenu)
 */

// ── Seed contacts (ensure self-chat always exists) ────────────────────────
function ensureSeedContacts() {
  let list = storage.get(KEYS.contacts);

  if (Array.isArray(list) && list.length > 0) {
    list = list.filter(c => c && c.id && c.id !== 'self');

    if (USER?.xameId) {
      let selfContact = list.find(c => c.id === USER.xameId);
      if (!selfContact) {
        selfContact = {
          id: USER.xameId,
          name: `${USER.firstName} ${USER.lastName} (You)`,
          status: 'Message yourself',
          createdAt: now(), lastAt: now(), lastInteractionTs: now(),
          lastInteractionPreview: 'Message yourself',
          online: false, profilePic: USER.profilePic, unreadCount: 0, isProfilePicHidden: false,
        };
        list.unshift(selfContact);
      }
    }

    list = list.map(c => ({
      ...c,
      unreadCount:          c.unreadCount          || 0,
      lastInteractionTs:    c.lastInteractionTs    || c.lastAt || c.createdAt || now(),
      lastInteractionPreview: c.lastInteractionPreview || c.status || '',
      isProfilePicHidden:   c.isProfilePicHidden   || false,
    }));

    storage.set(KEYS.contacts, list);
    return list;
  }

  list = [];
  if (USER?.xameId) {
    list.push({
      id: USER.xameId,
      name: `${USER.firstName} ${USER.lastName} (You)`,
      status: 'Message yourself',
      createdAt: now(), lastAt: now(), lastInteractionTs: now(),
      lastInteractionPreview: 'Message yourself',
      online: false, profilePic: USER.profilePic, unreadCount: 0, isProfilePicHidden: false,
    });
  }
  storage.set(KEYS.contacts, list);
  return list;
}

// ── Build a single contact row ─────────────────────────────────────────────
function contactRow(c) {
  const profilePicUrl = (c.isProfilePicHidden || !c.profilePic)
    ? '/media/profile_pics/default.png'
    : addCacheBuster(c.profilePic);

  const lastText = c.lastInteractionPreview || "Hey there I'm on XamePage";
  const lastTime = c.lastInteractionTs
    ? dayLabel(c.lastInteractionTs) + ' · ' + fmtTime(c.lastInteractionTs)
    : '';

  const div = document.createElement('div');
  div.className     = 'item fade-in';
  div.dataset.userId = c.id;

  const onlineClass = c.online ? '' : 'hidden';
  const unreadCount = c.unreadCount || 0;
  const unreadClass = unreadCount > 0 ? '' : 'hidden';

  let avatarContent = c.profilePic && !c.isProfilePicHidden
? `<img class="profile-pic" src="${escapeHtml(profilePicUrl)}" alt="${escapeHtml(c.name || 'User')} profile picture" loading="lazy" onclick="openImageFullscreen('${escapeHtml(profilePicUrl)}', '${escapeHtml(c.name || 'User')}')" style="cursor:pointer"/>`
    : `<div class="profile-placeholder"><span>${escapeHtml(initialsOf(c))}</span></div>`;

  div.innerHTML = `
    <div class="avatar-container">
      ${avatarContent}
      <span class="online-dot ${onlineClass}"></span>
      <span class="unread-count ${unreadClass}">
        <span class="unread-count-text">${unreadCount}</span>
      </span>
    </div>
    <div class="meta">
      <div class="name-row">
        <div class="name">${escapeHtml(c.name)}</div>
        <div class="time">${escapeHtml(lastTime)}</div>
      </div>
      <div class="status">${escapeHtml(lastText)}</div>
    </div>
  `;

  div.addEventListener('click', () => openChat(c.id));
  return div;
}

// ── Render contacts list ───────────────────────────────────────────────────
function renderContacts(filter = '') {
  if (elContacts) elContacts.classList.remove('hidden');
  if (elChat)     elChat.classList.add('hidden');
  if (contactList) contactList.style.display = 'block';

  let list = CONTACTS;
  if (filter) {
    const q = filter.trim().toLowerCase();
    list = list.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.id   || '').toLowerCase().includes(q)
    );
  }

  const sorted = [...list].sort((a, b) => {
    const tsA = b.lastInteractionTs || b.createdAt || 0;
    const tsB = a.lastInteractionTs || a.createdAt || 0;
    return tsA - tsB;
  });

  contactList.innerHTML = '';

  const selfContact   = USER ? sorted.find(c => c.id === USER.xameId)  : null;
  const otherContacts = sorted.filter(c => c.id !== (USER ? USER.xameId : null));

  const selfContactRow = document.getElementById('selfContactRow');
  if (selfContactRow) selfContactRow.innerHTML = '';
  if (!filter && selfContact) {
    const selfRow = document.createElement('div');
    selfRow.className      = 'item fade-in';
    selfRow.dataset.userId = selfContact.id;
    const isSelfOnline     = selfContact.online || false;

    let selfAvatarContent = selfContact.profilePic
      ? `<img class="profile-pic" src="${escapeHtml(addCacheBuster(selfContact.profilePic))}" alt="Your profile picture" loading="lazy" onclick="openImageFullscreen('${escapeHtml(addCacheBuster(selfContact.profilePic))}', '${escapeHtml(selfContact.name)}')" style="cursor:pointer"/>`
      : `<div class="profile-placeholder"><span>${escapeHtml(initialsOf(selfContact))}</span></div>`;

    selfRow.innerHTML = `
      <div class="avatar-container">
        ${selfAvatarContent}
        <span class="online-dot ${isSelfOnline ? '' : 'hidden'}"></span>
      </div>
      <div class="meta">
        <div class="name-row"><div class="name">${escapeHtml(selfContact.name)}</div></div>
        <div class="status">${escapeHtml(selfContact.status || 'Message yourself')}</div>
      </div>
    `;
    selfRow.addEventListener('click', () => openChat(selfContact.id));
    if (selfContactRow) selfContactRow.appendChild(selfRow);
    else contactList.appendChild(selfRow);
  }

  if (otherContacts.length === 0 && !filter) {
    const welcome = document.createElement('div');
    welcome.className = 'empty-contact-list-message';
    welcome.style.cssText = 'text-align:center;padding:50px 20px;color:#777;font-size:16px;';
    welcome.innerHTML = `
      <h3 style="margin:0 0 5px 0;font-weight:900;color:#007bff;display:inline-block;font-size:3em;">XamePage</h3>
      <span style="font-size:0.8em;color:#999;margin-left:5px;font-weight:500;">2.1</span>
      <p style="font-size:0.8em;color:#bbb;margin:5px 0 0 0;">created by <strong style="font-weight:700;color:#aaa;">Gibson Agbor</strong></p>
      <p style="font-size:12px;margin-top:20px;color:#aaa;">Click on the "+" above to add a new contact, and call or start a conversation to see it appear here.</p>
    `;
    contactList.appendChild(welcome);
    contactsCount.textContent = '0 contacts';
  } else if (otherContacts.length > 0) {
    const allHeader = document.createElement('div');
    allHeader.className   = 'contact-group-header';
    allHeader.textContent = 'All Contacts';
    contactList.appendChild(allHeader);
    otherContacts.forEach(c => contactList.appendChild(contactRow(c)));
    contactsCount.textContent = `${otherContacts.length} contact${otherContacts.length !== 1 ? 's' : ''}`;
  } else {
    contactsCount.textContent = '0 contacts';
  }
  if (typeof updateTotalUnreadBadge === 'function') updateTotalUnreadBadge();
}
const debouncedRenderContacts = debounce(renderContacts, 150);

// ── Open a chat ───────────────────────────────────────────────────────────
function closeChat() {
  if (ACTIVE_ID && typeof chatLockModule !== "undefined" && chatLockModule.isLocked(ACTIVE_ID)) {
    chatLockModule.lockChat(ACTIVE_ID);
  }
}

function openChat(id) {
  if (typeof chatLockModule !== "undefined" && chatLockModule.isLocked(id) && !chatLockModule.isUnlocked(id)) {
    chatLockModule.checkLock(id, () => openChat(id));
    return;
  }
  ACTIVE_ID = id;

  if (elContacts) elContacts.classList.add('hidden');
  if (elChat)     elChat.classList.remove('hidden');

  let c = CONTACTS.find(x => x.id === id);
  let isNewThread = false;

  if (!c) {
    c = {
      id, name: id, status: 'New message thread.',
      lastInteractionTs: now(), lastInteractionPreview: 'New message thread.',
      online: false, profilePic: null, unreadCount: 0, isProfilePicHidden: false,
    };
    CONTACTS.push(c);
    isNewThread = true;
  }

  c.unreadCount = 0;
  updateTotalUnreadBadge();
  storage.set(KEYS.contacts, CONTACTS);
  if (isNewThread) setChat(id, []);
  if (selectedMessages.length > 0) exitSelectMode();

  const profilePicUrl = (c.isProfilePicHidden || !c.profilePic)
    ? '/media/profile_pics/default.png'
    : addCacheBuster(c.profilePic);

  const chatAvatarContent = (c.profilePic && !c.isProfilePicHidden)
    ? `<img class="profile-pic" src="${escapeHtml(profilePicUrl)}" alt="${escapeHtml(c.name)} profile picture" loading="lazy" onclick="openImageFullscreen('${escapeHtml(profilePicUrl)}', '${escapeHtml(c.name)}')" style="cursor:pointer"/>`
    : `<div class="profile-placeholder"><span>${escapeHtml(initialsOf(c))}</span></div>`;

  elChatHeader.innerHTML = `
    <div class="icon-btn-group">
      <button class="icon-btn" id="backBtn">←</button>
    </div>
    <div class="header-details">
      <div class="avatar-container chat-header">
        ${chatAvatarContent}
        <span class="online-dot ${c.online ? '' : 'hidden'}"></span>
      </div>
      <div class="header-text">
        <div class="name-row"><h2 id="chatName"></h2></div>
        <p class="xame-id" id="contactIdDisplay"></p>
        <span id="chatSub"></span>
        <span id="typing" class="typing hidden">typing…</span>
      </div>
    </div>
    <div class="toolbar">
      <div class="menu" id="chatMoreMenu">
        <button class="icon-btn" id="chatMoreBtn" aria-haspopup="menu" aria-expanded="false" title="More options">⋮</button>
      </div>
    </div>
  `;

  $('#chatName').textContent        = c.name;
  const statusText = c.status && c.status !== 'Message a friend' ? ' · ' + c.status : '';
  $('#chatSub').textContent = (c.online ? 'Online' : 'Offline') + statusText;
  $('#contactIdDisplay').textContent = c.id;

  $('#backBtn')?.addEventListener('click', () => {
    closeChat();
    elChat?.classList.add('hidden');
    elContacts?.classList.remove('hidden');
    debouncedRenderContacts();
  });
  $('#chatMoreBtn')?.addEventListener('click', renderChatMoreMenu);

  renderMessages();
  setTimeout(() => scrollToBottom(), 200);

  if (composer) {
    composer.classList.remove('hidden');
    composer.style.display    = 'flex';
    composer.style.visibility = 'visible';
    composer.style.opacity    = '1';
    composer.style.position   = 'relative';
    composer.style.bottom     = '0';
  }

  if (voiceNoteControl) voiceNoteControl.classList.add('hidden');
  if (messageInput)     messageInput.classList.remove('hidden');
  if (attachBtn)        attachBtn.classList.remove('hidden');
  if (micBtn)           micBtn.classList.remove('hidden');

  const draft = DRAFTS[id] || '';
  if (messageInput) { messageInput.value = draft; messageInput.focus(); }
  updateComposerButtons();

  if (socket) {
    const unseenIds = getChat(id)
      .filter(m => m.type === 'received' && m.status !== 'seen')
      .map(m => m.id);
    if (unseenIds.length > 0) socket.emit('message-seen', { recipientId: ACTIVE_ID, messageIds: unseenIds });
  }
  markAllSeen(id);
}

// ── Chat more menu ─────────────────────────────────────────────────────────
function renderChatMoreMenu() {
  const wrap = document.createElement('div');
  wrap.className = 'menu-panel dialog-like';
  wrap.innerHTML = `
    <div class="menu-item" id="voiceCallBtn">📞 Voice Call</div>
    <div class="menu-item" id="videoCallBtn">📹 Video Call</div>
    <div class="menu-item" id="scheduleCallBtn">🕐 Schedule Call</div>
    <div class="menu-item" id="conferenceCallBtn">👥 Conference Call</div>
    <div class="menu-item" id="viewGalleryBtn">🖼 View Gallery</div>
    <div class="menu-item" id="editContactBtn">✍️ Edit Contact Name</div>
    <div class="menu-item" id="clearChatBtn">🗑 Clear Chat</div>
    <div class="menu-item" id="lockChatBtn">🔒 Lock Chat</div>
    <div class="menu-item" id="blockContactBtn">🚫 Block Contact</div>
    <div class="menu-item" id="deleteContactBtn">❌ Delete Contact</div>
  `;

  const chatMoreBtn = $('#chatMoreBtn');
  if (!chatMoreBtn || !layer) return;

  layer.querySelector('.menu-panel')?.remove();

  const rect         = chatMoreBtn.getBoundingClientRect();
  const vw           = window.innerWidth;
  const vh           = window.innerHeight;
  let top   = rect.bottom + 5;
  let right = vw - rect.right;

  layer.appendChild(wrap);
  const menuRect = wrap.getBoundingClientRect();
  if (top   + menuRect.height > vh) top   = rect.top - menuRect.height - 5;
  if (right + menuRect.width  > vw) right = 5;
  wrap.style.top   = `${top}px`;
  wrap.style.right = `${right}px`;

  wrap.querySelector('#voiceCallBtn')?.addEventListener('click', () => {
    if (!ACTIVE_ID) { notifyWithFeedback('No active contact selected.'); return; }
    startCall(ACTIVE_ID, 'voice'); closeDialog();
  });
  wrap.querySelector('#conferenceCallBtn')?.addEventListener('click', () => {
    closeDialog();
    if (typeof conferenceModule === 'undefined') { notifyWithFeedback('Conference module not loaded.'); return; }
    const existing = document.querySelector('.conf-join-dialog');
    if (existing) { existing.remove(); return; }
    const dlg = document.createElement('div');
    dlg.className = 'dialog-backdrop conf-join-dialog';
    dlg.innerHTML = `
      <div class="dialog">
        <h3>Conference Call</h3>
        <div class="row" style="gap:10px;margin-bottom:12px">
          <button class="btn primary" id="confCreateBtn">➕ Create New</button>
          <button class="btn secondary" id="confJoinBtn">🔗 Join Existing</button>
        </div>
        <div id="confJoinInputArea" style="display:none">
          <input id="confRoomIdInput" class="input" placeholder="Enter Room ID" style="width:100%;margin-bottom:8px"/>
          <button class="btn primary" id="confJoinConfirmBtn" style="width:100%">Join</button>
        </div>
        <button class="btn secondary" id="confCancelBtn" style="width:100%;margin-top:8px">Cancel</button>
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.querySelector('#confCreateBtn').addEventListener('click', () => { dlg.remove(); conferenceModule.create(); });
    dlg.querySelector('#confJoinBtn').addEventListener('click', () => { dlg.querySelector('#confJoinInputArea').style.display = 'block'; });
    dlg.querySelector('#confJoinConfirmBtn').addEventListener('click', () => {
      let roomId = dlg.querySelector('#confRoomIdInput').value.trim();
      if (!roomId) { showNotification('Please enter a Room ID'); return; }
      // Extract room ID from URL if pasted as full URL
      const urlMatch = roomId.match(/[?&]room=([^&]+)/);
      if (urlMatch) roomId = urlMatch[1];
      // Ensure room- prefix
      if (!roomId.startsWith('room-')) roomId = 'room-' + roomId;
      dlg.remove(); conferenceModule.join(roomId);
    });
    dlg.querySelector('#confCancelBtn').addEventListener('click', () => dlg.remove());
  });
  wrap.querySelector('#videoCallBtn')?.addEventListener('click', () => {
    if (!ACTIVE_ID) { notifyWithFeedback('No active contact selected.'); return; }
    startCall(ACTIVE_ID, 'video'); closeDialog();
  });
  wrap.querySelector('#scheduleCallBtn')?.addEventListener('click', () => {
    closeDialog();
    if (!ACTIVE_ID) { notifyWithFeedback('No active contact selected.'); return; }
    const contact = CONTACTS?.find(c => c.id === ACTIVE_ID);
    if (typeof callScheduleModule !== 'undefined') callScheduleModule.showScheduleCallDialog(ACTIVE_ID, contact?.name || ACTIVE_ID);
    else notifyWithFeedback('Call schedule not available.');
  });
  wrap.querySelector('#viewGalleryBtn')?.addEventListener('click', () => {
    closeDialog();
    if (typeof galleryModule !== 'undefined') galleryModule.open(ACTIVE_ID);
    else notifyWithFeedback('Gallery not available.');
  });

  wrap.querySelector('#editContactBtn')?.addEventListener('click', () => {
    if (!ACTIVE_ID) return;
    const c = CONTACTS.find(x => x.id === ACTIVE_ID);
    if (c && ACTIVE_ID !== USER.xameId) { closeDialog(); openDialog(renderEditContactDialog(c)); }
    else notifyWithFeedback('Cannot edit this contact.');
  });
  wrap.querySelector('#lockChatBtn')?.addEventListener('click', () => {
    closeDialog();
    if (!ACTIVE_ID) return;
    const c = CONTACTS.find(x => x.id === ACTIVE_ID);
    if (typeof chatLockModule !== 'undefined') chatLockModule.showSetPinDialog(ACTIVE_ID, c?.name || ACTIVE_ID);
    else notifyWithFeedback('Chat lock not available.');
  });
  wrap.querySelector('#clearChatBtn')?.addEventListener('click', () => {
    if (!ACTIVE_ID) return;
    if (confirm('Are you sure you want to clear messages in this chat?')) {
      setChat(ACTIVE_ID, []);
      const c = CONTACTS.find(x => x.id === ACTIVE_ID);
      if (c) { c.lastInteractionTs = now(); c.lastInteractionPreview = 'Chat cleared.'; storage.set(KEYS.contacts, CONTACTS); }
      renderMessages(); closeDialog(); notifyWithFeedback('Chat cleared successfully.');
    }
  });
  wrap.querySelector('#blockContactBtn')?.addEventListener('click', () => {
    const id = ACTIVE_ID; if (!id) return;
    const c  = CONTACTS.find(x => x.id === id);
    if (id === USER.xameId) { notifyWithFeedback('Cannot block yourself.'); return; }
    if (typeof callBlockingModule === 'undefined') { notifyWithFeedback('Call blocking not available.'); return; }
    const isBlocked = callBlockingModule.isBlocked(id);
    if (isBlocked) {
      callBlockingModule.unblock(id);
    } else {
      callBlockingModule.block(id, c?.name || '');
    }
    closeDialog();
  });

  wrap.querySelector('#deleteContactBtn')?.addEventListener('click', () => {
    const id = ACTIVE_ID; if (!id) return;
    const c  = CONTACTS.find(x => x.id === id); if (!c) return;
    if (id === USER.xameId) { notifyWithFeedback('Cannot delete the self chat.'); return; }
    if (confirm(`Permanently delete contact "${c.name || id}" and ALL chat/call history? This cannot be undone.`)) {
      deleteContact(id); closeDialog();
    }
  });

  openMenuDialog(wrap);
}

// ── Edit contact name dialog ──────────────────────────────────────────────
function renderEditContactDialog(contact) {
  const wrap = document.createElement('div');
  wrap.className = 'dialog-backdrop';
  wrap.innerHTML = `
    <div class="dialog fade-in">
      <h3>Edit Contact Name</h3>
      <div class="row" style="margin:8px 0 16px;">
        <input id="editContactNameInput" class="input" placeholder="Enter a new name"
               value="${escapeHtml(contact.name)}" maxlength="60"/>
      </div>
      <div class="row">
        <button class="btn" id="saveEditBtn">Save</button>
        <button class="btn secondary" id="cancelEditBtn">Cancel</button>
      </div>
      <div id="editContactFeedback" class="feedback-message"></div>
    </div>
  `;

  const nameInput  = wrap.querySelector('#editContactNameInput');
  const saveBtn    = wrap.querySelector('#saveEditBtn');
  const cancelBtn  = wrap.querySelector('#cancelEditBtn');
  const feedbackEl = wrap.querySelector('#editContactFeedback');

  cancelBtn?.addEventListener('click', () => closeDialog());

  saveBtn?.addEventListener('click', async () => {
    const newName = nameInput.value.trim();
    if (!newName) { notifyWithFeedback('Please enter a name.'); return; }
    saveBtn.disabled = true; feedbackEl.textContent = 'Saving...';

    try {
      const response = await fetch(`${serverURL}/api/update-contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER.xameId, contactId: contact.id, newName }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        const contactToUpdate = CONTACTS.find(c => c.id === contact.id);
        if (contactToUpdate) {
          contactToUpdate.name = data.updatedName;
          storage.set(KEYS.contacts, CONTACTS);
          debouncedRenderContacts(searchInput.value);
          openChat(contactToUpdate.id);
          closeDialog(); notifyWithFeedback('Contact name updated successfully!');
        }
      } else {
        feedbackEl.textContent = data.message || `Save failed: ${response.statusText}.`;
      }
    } catch (err) {
      console.error('Update contact name fetch error:', err);
      feedbackEl.textContent = 'Network error. Please try again.';
    } finally { saveBtn.disabled = false; }
  });

  return wrap;
}

// ── Delete contact ─────────────────────────────────────────────────────────
async function deleteContact(contactId) {
  if (!contactId || contactId === USER.xameId)
    return notifyWithFeedback('Invalid contact ID or cannot delete self chat.');

  notifyWithFeedback(`Permanently deleting contact ${contactId} and all chat history...`);
  const deleteBtn = document.querySelector('#deleteContactBtn');
  if (deleteBtn) deleteBtn.disabled = true;

  try {
    const response = await fetch(`${serverURL}/api/delete-chat-and-contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER.xameId, contactId }),
    });
    const data = await response.json();
    if (response.ok && data.success) {
      CONTACTS = CONTACTS.filter(c => c.id !== contactId);
      storage.set(KEYS.contacts, CONTACTS);
      delete CHAT_HISTORY[contactId];
      storage.set(KEYS.chat(contactId), []);
      openChat(USER.xameId);
      debouncedRenderContacts(searchInput.value);
      notifyWithFeedback('Contact and chat history permanently deleted.');
    } else {
      notifyWithFeedback(data.message || 'Failed to delete contact and chat history.');
    }
  } catch (err) {
    console.error('Permanent deletion fetch error:', err);
    notifyWithFeedback('Network error during permanent deletion. Please check your connection.');
  } finally {
    if (deleteBtn) deleteBtn.disabled = false;
  }
}

// ── Clear ALL chats ────────────────────────────────────────────────────────
function clearAllChats() {
  if (!confirm('Are you sure you want to clear ALL messages from ALL chats? This action cannot be undone.')) return;

  const contacts = storage.get(KEYS.contacts, []);
  contacts.forEach(c => {
    storage.set(KEYS.chat(c.id), []);
    if (c.id !== USER.xameId) { c.lastInteractionTs = now(); c.lastInteractionPreview = 'All messages cleared.'; }
    c.unreadCount = 0;
  updateTotalUnreadBadge();
    if (DRAFTS[c.id]) delete DRAFTS[c.id];
  });
  storage.set(KEYS.contacts, contacts);
  storage.set(KEYS.drafts, DRAFTS);

  if (ACTIVE_ID) {
    renderMessages();
    if (messageInput) messageInput.value = DRAFTS[ACTIVE_ID] || '';
    updateComposerButtons();
  }
  debouncedRenderContacts(searchInput.value);
  notifyWithFeedback('All chats have been cleared!');
}

function updateTotalUnreadBadge() {
  const total = CONTACTS.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
  const badge = document.getElementById('totalUnreadBadge');
  if (!badge) return;
  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : total;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}
