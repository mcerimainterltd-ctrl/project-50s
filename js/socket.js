/*
 * socket.js
 * Socket.IO connection, all event handlers, reconnection,
 * heartbeat system.
 * XamePage v2.1
 *
 * Depends on: config.js, state.js, storage.js, utils.js,
 *             audio.js (playSound), messaging.js (renderMessages, intelligentMerge, markAllSeen),
 *             contacts.js (renderContacts), webrtc.js (showIncomingCallNotification, handleAnswer, handleNewIceCandidate, exitVideoCall)
 */

// ── Reconnect scheduler ───────────────────────────────────────────────────
function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    showNotification('Connection failed. Tap to retry.');
    console.error('❌ Max reconnection attempts reached.');
    return;
  }
  const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(1.5, reconnectAttempts), 15000);
  reconnectAttempts++;
  console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
  setTimeout(() => connectSocket(), delay);
}

// ── Connect socket ────────────────────────────────────────────────────────
function connectSocket() {
  if (!USER?.xameId) { console.warn('⚠️ connectSocket() called before USER is set - aborting'); return; }
  if (socket?.connected) { console.log('✅ Socket already connected for:', USER.xameId); return; }

  if (socket) {
    console.log('🔄 Cleaning up stale socket before reconnecting');
    socket.removeAllListeners(); socket.disconnect(); socket = null;
  }

  console.log('🔌 Connecting socket for user:', USER.xameId);

  try {
    socket = io(serverURL, {
      query:                  { userId: USER.xameId },
      transports:             ['polling', 'websocket'],
      path:                   '/socket.io/',
      reconnection:           true,
      reconnectionDelay:      1000,
      reconnectionDelayMax:   5000,
      reconnectionAttempts:   Infinity,
      timeout:                20000,
    });

    registerSocketHandlers(socket);

    // ── Additional lifecycle events ────────────────────────────────────
    socket.on('typing', ({ senderId }) => {
      if (ACTIVE_ID === senderId && typingEl) {
        typingEl.textContent = 'typing...'; typingEl.classList.remove('hidden');
      }
    });

    socket.on('stop-typing', ({ senderId }) => {
      if (ACTIVE_ID === senderId && typingEl) typingEl.classList.add('hidden');
    });

    socket.on('message-status-update', ({ recipientId, messageId, status }) => {
      const chat = getChat(recipientId);
      const msg  = chat.find(m => m.id === messageId);
      if (msg) {
        msg.status = status; setChat(recipientId, chat);
        if (ACTIVE_ID === recipientId) scheduleRender(renderMessages, 'messages');
      }
    });

    socket.on('message-seen-update', ({ recipientId, messageIds }) => {
      const chat    = getChat(recipientId);
      let updated   = false;
      messageIds.forEach(msgId => {
        const msg = chat.find(m => m.id === msgId);
        if (msg && msg.status !== 'seen') { msg.status = 'seen'; updated = true; }
      });
      if (updated) {
        setChat(recipientId, chat);
        if (ACTIVE_ID === recipientId) scheduleRender(renderMessages, 'messages');
      }
    });

    // new_message_count removed — unreadCount is handled in receive-message

    socket.on('new_missed_call_count', ({ senderId }) => {
      const contact = CONTACTS.find(c => c.id === senderId);
      if (contact) {
        contact.missedCallsCount = (contact.missedCallsCount || 0) + 1;
        storage.set(KEYS.contacts, CONTACTS);
        scheduleRender(() => renderContacts(), 'contacts');
      }
    });

    socket.on('messages-deleted', ({ deleterId, contactId, messageIds, permanently }) => {
      const updatedChat = getChat(contactId).filter(m => !messageIds.includes(m.id));
      setChat(contactId, updatedChat);
      if (ACTIVE_ID === contactId) scheduleRender(renderMessages, 'messages');
      showNotification(permanently
        ? `${messageIds.length} message(s) were deleted by sender`
        : `${messageIds.length} message(s) deleted`
      );
    });

    // Wallet P2P receive
    socket.on('wallet:receive', ({ senderId, senderName, amount, currency }) => {
      const sym = {'NGN':'₦','GHS':'GH₵','KES':'KSh','ZAR':'R','USD':'$','EUR':'€','GBP':'£'};
      const s = sym[currency] || currency + ' ';
      // Credit via walletModule if available (keeps module state in sync)
      if (typeof walletModule !== 'undefined' && walletModule._credit) {
        walletModule._credit(amount, senderName || senderId);
      } else {
        // Fallback: write directly to storage
        const bal = persistentStorage.get('wallet:balance') || 0;
        persistentStorage.set('wallet:balance', bal + amount);
        const txs = persistentStorage.get('wallet:transactions') || [];
        txs.unshift({ id: Date.now(), label: 'Received from ' + (senderName || senderId), icon: '💸', amount, type: 'credit', status: 'Completed', ts: new Date().toISOString() });
        persistentStorage.set('wallet:transactions', txs.slice(0, 100));
      }
      showNotification('💸 You received ' + s + Number(amount).toLocaleString() + ' from ' + (senderName || senderId));
    });

    // WebRTC signaling
    socket.on('call-user', async ({ offer, callerId, caller, callType, callId }) => {
      console.log('📞 Incoming call from:', callerId, 'Type:', callType);
      try {
        showIncomingCallNotification(caller, callType, offer);
        window.__pendingCall__ = { offer, callerId, caller, callType, callId };
      } catch (error) { console.error('Error handling incoming call:', error); }
    });

    socket.on('make-answer', async ({ answer, senderId }) => {
      console.log('📞 Received answer from:', senderId);
      await handleAnswer(answer, senderId);
    });

    socket.on('ice-candidate', ({ candidate, senderId }) => {
      console.log('📞 Received ICE candidate from:', senderId);
      handleNewIceCandidate(candidate, senderId);
    });

    socket.on('call-accepted',     ({ recipientId }) => { console.log('📞 Call accepted by:', recipientId); stopOutgoingRing(); });
    socket.on('call-rejected', ({ senderId, reason }) => {
      stopOutgoingRing();
      // 'ended' means the other party ended the call normally — no error notification needed
      if (reason === 'ended') { exitVideoCall(); return; }
      let msg = 'Call declined';
      if (reason === 'offline') msg = 'User is offline';
      else if (reason === 'blocked') msg = 'You are blocked by this user';
      else if (reason === 'user-rejected') msg = 'Call declined';
      showNotification(msg);
      // Only exit if no active peers remain
      if (typeof peers !== 'undefined' && peers.size > 0) {
        // Remove the rejected peer if present
        if (senderId && peers.has(senderId)) removePeer(senderId);
        // Keep call alive if other peers exist
        if (peers.size > 0) return;
      }
      exitVideoCall();
    });
    socket.on('call-acknowledged', ({ senderId }) => { console.log('📞 Call acknowledged by:', senderId); });

    socket.on('call-ended', ({ senderId }) => {
      if (Date.now() - (window._lastCallEndedAt || 0) < 2000) return;
      stopCallRing();
      stopOutgoingRing();
      const incomingOverlay = document.getElementById('incomingCallOverlay');
      if (incomingOverlay && !incomingOverlay.classList.contains('hidden')) {
        // Caller hung up before recipient answered — missed call
        incomingOverlay.classList.add('hidden');
        document.getElementById('quickReplyPanel')?.classList.add('hidden');
        showNotification('📵 Missed call from ' + (senderId || 'unknown'));
        if (senderId) {
          // Only update call history badge, not chat
          if (typeof callHistoryModule !== 'undefined') callHistoryModule.addMissedCall(senderId);
        }
      }
      if (typeof peers !== 'undefined' && peers.size > 0 && typeof exitVideoCall === 'function') {
        exitVideoCall();
      }
    });

    socket.on('profile-updated', ({ userId, profilePic, preferredName, hideProfilePicture, hidePreferredName }) => {
      // Update contact in memory and storage
      const contacts = storage.get(KEYS.contacts) || [];
      const idx = contacts.findIndex(c => c.id === userId);
      if (idx !== -1) {
        if (profilePic !== undefined) contacts[idx].profilePic = profilePic;
        if (preferredName !== undefined && preferredName !== '') contacts[idx].name = preferredName;
        else if (preferredName === '') contacts[idx].name = userId;
        if (hideProfilePicture !== undefined) contacts[idx].isProfilePicHidden = hideProfilePicture;
        if (hidePreferredName !== undefined) contacts[idx].isNameHidden = hidePreferredName;
        storage.set(KEYS.contacts, contacts);
        CONTACTS = contacts;
        scheduleRender(() => renderContacts(), 'contacts');
      }
      // Update USER if it's the current user
      if (userId === USER?.xameId) {
        if (profilePic !== undefined) USER.profilePic = profilePic;
        if (preferredName !== undefined) USER.preferredName = preferredName;
        if (hideProfilePicture !== undefined) USER.hideProfilePicture = hideProfilePicture;
        if (hidePreferredName !== undefined) USER.hidePreferredName = hidePreferredName;
        storage.set(KEYS.user, USER);
      }
    });

    socket.on('force-logout', ({ reason }) => {
      // Clear all local data and force back to login
      persistentStorage.set('xame:sessionToken', null);
      persistentStorage.set(KEYS.user, null);
      persistentStorage.set(KEYS.contacts, null);
      storage.clear();
      alert('Security alert: ' + (reason || 'You have been logged out remotely.'));
      window.location.reload();
    });

    console.log('✅ Socket event handlers registered for:', USER.xameId);
    document.dispatchEvent(new CustomEvent('xame:socket-ready'));

    // Handle answer from notification (Android)
    document.addEventListener('xame:answer-call', () => {
      const pending = window.__pendingCall__;
      if (pending && typeof handleIncomingCall === 'function') {
        handleIncomingCall(pending.offer, pending.callerId);
      }
    }, { once: true });

  } catch (error) {
    console.error('❌ Socket connection error:', error);
    showNotification('Failed to connect to server');
    scheduleReconnect();
  }
}

// ── Core socket event handlers (Part 15 from original) ───────────────────
function registerSocketHandlers(socket) {

  socket.on('connect', () => {
    console.log('✅ Connected to server!');
    showNotification('Connected to server');
    if (USER?.xameId) {
      if (localStorage.getItem('xame:stealth') === 'true') {
        // In stealth mode: briefly connected but immediately go offline
        setTimeout(() => {
          if (socket?.connected) socket.emit('user-offline', { userId: USER.xameId });
        }, 500);
      } else {
        socket.emit('user-online', { userId: USER.xameId, timestamp: Date.now() });
      }
    }
    setTimeout(() => {
      if (socket?.connected && USER?.xameId) {
        socket.emit('request_online_users');
        socket.emit('get_contacts',     USER.xameId);
        socket.emit('get_chat_history', { userId: USER.xameId });
      }
    }, 100);
  });

  socket.on('connect_error',     (err)           => { console.error('Socket connection error:', err.message); showNotification('Connection error. Retrying...'); });
  socket.on('connect_timeout',   ()              => { console.error('Socket connection timeout'); showNotification('Connection is slow. Please check your network.'); });
  socket.on('reconnect_attempt', (attemptNumber) => { console.log(`Reconnection attempt ${attemptNumber}`); showNotification(`Reconnecting... (attempt ${attemptNumber})`); });

  socket.on('reconnect', (attemptNumber) => {
    reconnectAttempts = 0; // Reset counter on successful reconnect
    if (window._offlineTimer) { clearTimeout(window._offlineTimer); window._offlineTimer = null; }
    console.log(`Reconnected after ${attemptNumber} attempts`);
    showNotification('Reconnected successfully!');
    if (USER?.xameId) {
      if (localStorage.getItem('xame:stealth') === 'true') {
        setTimeout(() => { if (socket?.connected) socket.emit('user-offline', { userId: USER.xameId }); }, 500);
      } else {
        socket.emit('user-online', { userId: USER.xameId, timestamp: Date.now() });
      }
      socket.emit('request_online_users');
    }
  });

  socket.on('reconnect_failed', () => { console.error('Failed to reconnect after all attempts'); showNotification('Failed to reconnect. Please refresh the page.'); });

  socket.on('chat_history', async (historyData) => {
    console.log('Received full chat history from server. Performing intelligent merge.');
    await intelligentMerge(historyData);
    if (ACTIVE_ID) scheduleRender(renderMessages, 'messages');
    scheduleRender(() => renderContacts(), 'contacts');
    if (typeof setAvatarInitials === 'function') setAvatarInitials();
    if (typeof callHistoryModule !== 'undefined') { callHistoryModule.initTabs(); callHistoryModule.load(); }
  });

  socket.on('stream-ready', () => {
    if (remoteStream && remoteVideo) { remoteVideo.srcObject = remoteStream; remoteVideo.muted = false; }
  });

  socket.on('contacts_list', (serverContacts) => {
    console.log('Received updated contacts list from server:', serverContacts);
    if (!Array.isArray(serverContacts)) { console.error('Invalid contacts list received'); return; }

    // Load persisted contacts to preserve unread counts before overwriting
    const persistedContacts = storage.get(KEYS.contacts, []);
    const updatedContacts = serverContacts.map(c => {
      // Preserve existing unread counts and missed call counts — never reset on server refresh
      const existing = CONTACTS.find(ec => ec.id === c.xameId) || persistedContacts.find(ec => ec.id === c.xameId);
      return {
        id:                     c.xameId,
        name:                   c.name || c.xameId,
        profilePic:             c.profilePic ? addCacheBuster(c.profilePic) : null,
        online:                 c.isOnline || false,
        status:                 c.personalStatus ? (c.personalStatus.emoji + ' ' + c.personalStatus.message) : (c.status || 'Message a friend'),
        lastInteractionTs:      c.lastInteractionTs || now(),
        lastInteractionPreview: c.lastInteractionPreview || '',
        isProfilePicHidden:     c.isProfilePicHidden || false,
        createdAt:              now(), lastAt: now(),
        unreadCount:            existing ? (existing.unreadCount || 0) : 0,
        missedCallsCount:       existing ? (existing.missedCallsCount || 0) : 0,
      };
    });

    const selfIdx = updatedContacts.findIndex(c => c.id === USER.xameId);
    if (selfIdx !== -1) {
      updatedContacts[selfIdx].online           = true;
      updatedContacts[selfIdx].profilePic       = USER.profilePic;
      updatedContacts[selfIdx].isProfilePicHidden = false;
    } else {
      const existingSelf = CONTACTS.find(c => c.id === USER.xameId);
      updatedContacts.push({
        id: USER.xameId, name: `${USER.firstName} ${USER.lastName} (You)`,
        profilePic: USER.profilePic, online: true, status: 'Message yourself',
        createdAt: now(), lastAt: now(), lastInteractionTs: now(),
        lastInteractionPreview: 'Message yourself', isProfilePicHidden: false,
        unreadCount: existingSelf ? (existingSelf.unreadCount || 0) : 0,
        missedCallsCount: existingSelf ? (existingSelf.missedCallsCount || 0) : 0,
      });
    }

    CONTACTS = updatedContacts;
    storage.set(KEYS.contacts, CONTACTS);
    scheduleRender(() => {
      renderContacts(searchInput?.value);
      if (typeof updateTotalUnreadBadge === 'function') updateTotalUnreadBadge();
    }, 'contacts');
  });

  socket.on('disconnect', () => {
    // Don't immediately mark contacts offline - wait to see if we reconnect quickly
    if (window._offlineTimer) clearTimeout(window._offlineTimer);
    window._offlineTimer = setTimeout(() => {
      if (!socket?.connected) {
        const contacts = storage.get(KEYS.contacts);
        if (contacts) { contacts.forEach(c => c.online = false); storage.set(KEYS.contacts, contacts); scheduleRender(() => renderContacts(), 'contacts'); }
      }
    }, 10000); // Wait 10 seconds before marking offline
  });

  socket.on('online_users', (ids) => {
    const contacts = storage.get(KEYS.contacts);
    if (!contacts) return;
    contacts.forEach(c => c.online = ids.includes(c.id));
    const self = contacts.find(c => c.id === USER?.xameId);
    if (self) self.online = true;
    CONTACTS = contacts;
    storage.set(KEYS.contacts, contacts);
    scheduleRender(() => renderContacts(), 'contacts');
  });

  socket.on('receive-message', (data) => {
    playMessageTone();
    if (!data?.senderId || !data?.message) return;
    const { senderId, message } = data;
    const chat = getChat(senderId);
    const newMsg = {
      id:     message.id || uid(),
      text:   message.text,
      file:   message.file,
      type:   'received',
      ts:     message.ts || now(),
      status: 'delivered',
      expiresAt: message.expiresAt || null,
      replyTo:   message.replyTo  || null,
      forwarded: message.forwarded || false,
      viewOnce:  message.viewOnce  || false,
    };
    chat.push(newMsg); setChat(senderId, chat);

    const contact = CONTACTS.find(c => c.id === senderId);
    if (contact) {
      contact.lastInteractionTs      = newMsg.ts;
      contact.lastInteractionPreview = newMsg.text || 'Attachment';
      if (ACTIVE_ID !== senderId) contact.unreadCount++;
      storage.set(KEYS.contacts, CONTACTS);
    }

    scheduleRender(() => renderContacts(), 'contacts');
    if (ACTIVE_ID === senderId) {
      scheduleRender(renderMessages, 'messages');
      socket.emit('message-seen', { recipientId: senderId, messageIds: [newMsg.id] });
    }
    if (typeof disappearingModule !== 'undefined' && newMsg.expiresAt) {
      setTimeout(() => {
        const el = document.querySelector(`.bubble[data-id="${newMsg.id}"]`);
        disappearingModule.scheduleDelete(newMsg.id, newMsg.expiresAt, el || null);
      }, 800);
    }
  });

  socket.on('contact-status-update', ({ userId, status }) => {
    const contact = CONTACTS.find(c => c.id === userId);
    if (contact) {
      contact.status = `${status.emoji} ${status.message}`;
      storage.set(KEYS.contacts, CONTACTS);
      scheduleRender(() => renderContacts(), 'contacts');
      // Update chat header if this contact is active
      if (ACTIVE_ID === userId) {
        const chatSub = document.getElementById('chatSub');
        if (chatSub) chatSub.textContent = contact.online ? `Online · ${contact.status}` : contact.status;
      }
    }
  });

  socket.on('disappearing:expired', ({ messageId, contactId }) => {
    if (!messageId) return;
    const cid  = contactId || ACTIVE_ID;
    const chat = getChat(cid);
    if (chat) {
      const updated = chat.filter(m => m.id !== messageId);
      setChat(cid, updated);
    }
    const el = document.querySelector(`.bubble[data-id="${messageId}"]`);
    if (el) {
      el.classList.add('disappearing-out');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }
  });

}

// ── Heartbeat ────────────────────────────────────────────────────────────
// ── Stealth enforcer ─────────────────────────────────────────────────────
let stealthInterval = null;

function startStealthMode() {
  stopStealthMode();
  if (socket?.connected && USER?.xameId) socket.emit('user-offline', { userId: USER.xameId });
  stealthInterval = setInterval(() => {
    if (socket?.connected && USER?.xameId) socket.emit('user-offline', { userId: USER.xameId });
  }, 8000);
}

function stopStealthMode() {
  if (stealthInterval) { clearInterval(stealthInterval); stealthInterval = null; }
}

function startHeartbeat() {
  stopHeartbeat();
  if (!USER?.xameId) return;
  console.log('💓 Starting presence heartbeat');
  heartbeatInterval = setInterval(() => {
    if (socket?.connected && USER?.xameId) {
      if (localStorage.getItem('xame:stealth') !== 'true') socket.emit('heartbeat', { userId: USER.xameId, timestamp: Date.now() });
    } else if (!socket?.connected) {
      console.log('💔 Heartbeat: socket disconnected, letting socket.io handle reconnect');
      // Don't manually reconnect - socket.io handles this automatically
    }
  }, HEARTBEAT_INTERVAL);
  if (socket?.connected && localStorage.getItem('xame:stealth') !== 'true') socket.emit('heartbeat', { userId: USER.xameId, timestamp: Date.now() });
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval); heartbeatInterval = null;
    console.log('🛑 Stopped presence heartbeat');
  }
}
