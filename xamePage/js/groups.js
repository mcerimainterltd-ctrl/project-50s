/*
 * groups.js
 * Xame Group — group creation, chat, member management.
 * XamePage v2.1
 * Uses the existing chat screen/composer for full media support.
 */

let ACTIVE_GROUP = null; // Set when a group chat is open

const groupsModule = {
  _groups: [],
  _messages: [],
  _typingTimer: null,

  // ── Init ──────────────────────────────────────────────────────────────────
  async init() {
    await this.loadGroups();
    this._bindSocketEvents();
  },

  async loadGroups() {
    try {
      const res  = await fetch('/api/groups/' + USER.xameId);
      const data = await res.json();
      this._groups = data.groups || [];
    } catch (e) { this._groups = []; }
  },

  _bindSocketEvents() {
    if (typeof socket === 'undefined' || !socket) return;
    socket.off('group:message');
    socket.on('group:message', ({ groupId, message }) => {
      if (ACTIVE_GROUP && ACTIVE_GROUP.groupId === groupId) {
        this._messages.push(message);
        this._renderGroupMessages();
        scrollToBottom();
      }
      const g = this._groups.find(g => g.groupId === groupId);
      if (g) { g.lastMessagePreview = message.text || 'Attachment'; g.lastMessageTs = message.ts; }
      showNotification((message.senderName || 'Someone') + ': ' + (message.text || 'Attachment'));
    });
    socket.off('group:typing');
    socket.on('group:typing', ({ groupId, name }) => {
      if (ACTIVE_GROUP?.groupId === groupId) {
        const el = document.getElementById('typing');
        if (el) { el.textContent = name + ' is typing…'; el.classList.remove('hidden'); }
        clearTimeout(this._typingTimer);
        this._typingTimer = setTimeout(() => el?.classList.add('hidden'), 2000);
      }
    });
  },

  // ── Groups List UI ────────────────────────────────────────────────────────
  showGroupsList() {
    document.getElementById('groupsOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'groupsOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:800;background:var(--dark-bg);display:flex;flex-direction:column;';
    overlay.innerHTML =
      '<header class="header" style="display:flex;align-items:center;gap:12px;padding:12px 16px;">' +
        '<button class="icon-btn" id="groupsBackBtn">←</button>' +
        '<h3 style="flex:1;margin:0">Xame Groups</h3>' +
        '<button class="btn primary" id="createGroupBtn" style="padding:6px 14px;font-size:13px">+ New</button>' +
      '</header>' +
      '<div id="groupsList" style="flex:1;overflow-y:auto;"></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#groupsBackBtn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#createGroupBtn').addEventListener('click', () => this.showCreateGroupDialog());
    this._renderGroupsList();
  },

  _renderGroupsList() {
    const list = document.getElementById('groupsList');
    if (!list) return;
    if (this._groups.length === 0) {
      list.innerHTML = '<p style="color:var(--text-secondary);text-align:center;padding:40px">No groups yet. Create one!</p>';
      return;
    }
    list.innerHTML = this._groups.map(g => {
      const initials = g.name.slice(0, 2).toUpperCase();
      const preview  = g.lastMessagePreview || 'No messages yet';
      return '<div class="contact-item group-item" data-id="' + g.groupId + '" style="display:flex;align-items:center;padding:12px 16px;gap:12px;cursor:pointer;border-bottom:1px solid var(--divider-color)">' +
        (g.avatar
          ? '<img src="' + g.avatar + '" style="width:48px;height:48px;border-radius:50%;object-fit:cover;flex-shrink:0" alt="">' 
          : '<div style="width:48px;height:48px;border-radius:50%;background:var(--accent-color);display:flex;align-items:center;justify-content:center;font-weight:700;color:white;flex-shrink:0">' + initials + '</div>') +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;margin-bottom:2px">' + escapeHtml(g.name) + '</div>' +
          '<div style="font-size:13px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(preview) + '</div>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-secondary)">' + g.members.length + ' members</div>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.group-item').forEach(el => {
      el.addEventListener('click', () => {
        const g = this._groups.find(g => g.groupId === el.dataset.id);
        if (g) this.openGroupChat(g);
      });
    });
  },

  // ── Create Group ──────────────────────────────────────────────────────────
  showCreateGroupDialog() {
    document.getElementById('createGroupDlg')?.remove();
    const contacts = CONTACTS.filter(c => c.id !== USER.xameId);
    const dlg = document.createElement('div');
    dlg.id = 'createGroupDlg';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:320px;max-height:80vh;overflow-y:auto">' +
        '<h3 style="margin-bottom:12px">Create Group</h3>' +
        '<input type="text" id="groupNameInput" class="input" placeholder="Group name" style="margin-bottom:8px"/>' +
        '<input type="text" id="groupDescInput" class="input" placeholder="Description (optional)" style="margin-bottom:12px"/>' +
        '<p style="font-size:13px;color:var(--text-secondary);margin-bottom:8px">Select members:</p>' +
        '<div id="memberCheckList" style="max-height:200px;overflow-y:auto;margin-bottom:12px">' +
          contacts.map(c => '<label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer">' +
            '<input type="checkbox" value="' + c.id + '" style="width:18px;height:18px"/>' +
            '<span>' + escapeHtml(c.name || c.id) + '</span>' +
          '</label>').join('') +
        '</div>' +
        '<button class="btn primary" id="createGroupConfirmBtn" style="width:100%">Create Group</button>' +
        '<button class="btn secondary" id="createGroupCancelBtn" style="width:100%;margin-top:8px">Cancel</button>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#createGroupCancelBtn').addEventListener('click', () => dlg.remove());
    dlg.querySelector('#createGroupConfirmBtn').addEventListener('click', async () => {
      const name    = dlg.querySelector('#groupNameInput').value.trim();
      const desc    = dlg.querySelector('#groupDescInput').value.trim();
      const checked = [...dlg.querySelectorAll('#memberCheckList input:checked')].map(i => i.value);
      if (!name) { showNotification('Enter a group name'); return; }
      const btn = dlg.querySelector('#createGroupConfirmBtn');
      btn.textContent = 'Creating...'; btn.disabled = true;
      try {
        const res  = await fetch('/api/groups/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: USER.xameId, name, description: desc, memberIds: checked })
        });
        const data = await res.json();
        if (data.success) {
          this._groups.unshift(data.group);
          dlg.remove();
          this._renderGroupsList();
          showNotification('Group created!');
          this.openGroupChat(data.group);
        } else {
          showNotification('Failed: ' + data.message);
          btn.textContent = 'Create Group'; btn.disabled = false;
        }
      } catch (err) {
        showNotification('Error: ' + err.message);
        btn.textContent = 'Create Group'; btn.disabled = false;
      }
    });
  },

  // ── Open Group Chat (reuse existing chat screen) ──────────────────────────
  async openGroupChat(group) {
    ACTIVE_GROUP = group;
    this._messages = [];

    // Hide groups overlay, show chat screen
    document.getElementById('groupsOverlay')?.classList.add('hidden');

    // Build chat header with group info
    const isAdmin = group.members.find(m => m.userId === USER.xameId)?.role === 'admin';
    elChatHeader.innerHTML =
      '<div class="icon-btn-group">' +
        '<button class="icon-btn" id="backBtn">←</button>' +
      '</div>' +
      '<div class="header-details">' +
        '<div class="avatar-container chat-header">' +
          (group.avatar
            ? '<img class="profile-pic" src="' + group.avatar + '" alt="Group avatar"/>' 
            : '<div class="profile-placeholder"><span>' + group.name.slice(0,2).toUpperCase() + '</span></div>') +
        '</div>' +
        '<div class="header-text">' +
          '<div class="name-row"><h2>' + escapeHtml(group.name) + '</h2></div>' +
          '<span style="font-size:12px;color:var(--text-secondary)">' + group.members.length + ' members</span>' +
        '</div>' +
      '</div>' +
      '<div class="toolbar">' +
        '<button class="icon-btn" id="groupInfoBtn" title="Group Info">ℹ️</button>' +
      '</div>';

    // Show chat screen
    if (elContacts) elContacts.classList.add('hidden');
    if (elChat) elChat.classList.remove('hidden');
    if (composer) { composer.classList.remove('hidden'); composer.style.display = 'flex'; }
    if (messagesEl) messagesEl.innerHTML = '';

    // Wire back button
    document.getElementById('backBtn')?.addEventListener('click', () => {
      ACTIVE_GROUP = null;
      elChat?.classList.add('hidden');
      const groupsOverlay = document.getElementById('groupsOverlay');
      if (groupsOverlay) groupsOverlay.classList.remove('hidden');
      else { elContacts?.classList.remove('hidden'); debouncedRenderContacts(); }
    });

    // Wire group info button
    document.getElementById('groupInfoBtn')?.addEventListener('click', () => this.showGroupInfo(group, isAdmin));

    // Setup composer properly
    if (typeof voiceNoteControl !== 'undefined' && voiceNoteControl) voiceNoteControl.classList.add('hidden');
    if (typeof messageInput !== 'undefined' && messageInput) { messageInput.classList.remove('hidden'); messageInput.value = ''; }
    if (typeof attachBtn !== 'undefined' && attachBtn) attachBtn.classList.remove('hidden');
    if (typeof micBtn !== 'undefined' && micBtn) micBtn.classList.remove('hidden');
    if (typeof updateComposerButtons === 'function') updateComposerButtons();

    // Load messages
    try {
      const res  = await fetch('/api/groups/messages/' + group.groupId);
      const data = await res.json();
      this._messages = data.messages || [];
      this._renderGroupMessages();
      setTimeout(() => scrollToBottom(), 200);
    } catch (e) {}
  },

  // ── Render Group Messages (into existing #messages el) ────────────────────
  _renderGroupMessages() {
    if (!messagesEl) return;
    // Clean up wavesurfers
    messagesEl.querySelectorAll('.bubble').forEach(b => {
      if (b.wavesurfer) { try { b.wavesurfer.destroy(); } catch(_) {} delete b.wavesurfer; }
    });
    messagesEl.innerHTML = '';
    const fragment = document.createDocumentFragment();
    this._messages.forEach(m => {
      const isMine = m.senderId === USER.xameId;
      // Convert group message to format messageBubble expects
      const normalized = {
        id:     m._id || m.id || ('g-' + m.ts),
        text:   m.text || '',
        type:   isMine ? 'sent' : 'received',
        ts:     m.ts,
        status: 'delivered',
        file:   m.file || null,
      };
      // Add sender name label for received messages
      const wrapper = document.createElement('div');
      if (!isMine) {
        const nameEl = document.createElement('div');
        nameEl.style.cssText = 'font-size:11px;color:var(--accent-color);font-weight:600;padding:4px 12px 0;';
        nameEl.textContent = m.senderName || m.senderId;
        wrapper.appendChild(nameEl);
      }
      if (typeof messageBubble === 'function') {
        const prevActiveId = typeof ACTIVE_ID !== 'undefined' ? ACTIVE_ID : null;
        if (typeof ACTIVE_ID !== 'undefined') window.ACTIVE_ID = 'group';
        const bubble = messageBubble(normalized);
        if (typeof ACTIVE_ID !== 'undefined') window.ACTIVE_ID = prevActiveId;
        wrapper.appendChild(bubble);
      } else {
        const fallback = document.createElement('div');
        fallback.className = 'bubble-row ' + (isMine ? 'sent' : 'received');
        fallback.style.cssText = 'display:flex;justify-content:' + (isMine ? 'flex-end' : 'flex-start') + ';padding:2px 12px;';
        fallback.innerHTML = '<div class="bubble" style="padding:8px 12px;background:' + (isMine ? 'var(--accent-color)' : 'var(--dark-card)') + ';border-radius:12px;max-width:75%">' + escapeHtml(m.text || '📎 Attachment') + '</div>';
        wrapper.appendChild(fallback);
      }
      fragment.appendChild(wrapper);
    });
    messagesEl.appendChild(fragment);
  },

  // ── Group Info ────────────────────────────────────────────────────────────
  showGroupInfo(group, isAdmin) {
    document.getElementById('groupInfoDlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'groupInfoDlg';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:320px;max-height:80vh;overflow-y:auto">' +
        '<div style="text-align:center;margin-bottom:12px">' +
          (group.avatar
            ? '<img src="' + group.avatar + '" style="width:80px;height:80px;border-radius:50%;object-fit:cover;margin-bottom:8px" alt="">' 
            : '<div style="width:80px;height:80px;border-radius:50%;background:var(--accent-color);display:flex;align-items:center;justify-content:center;font-weight:700;color:white;font-size:28px;margin:0 auto 8px">' + group.name.slice(0,2).toUpperCase() + '</div>') +
          (isAdmin ? '<div><label style="cursor:pointer;color:var(--accent-color);font-size:13px">📷 Change Photo<input type="file" id="groupAvatarInput" accept="image/*" style="display:none"/></label></div>' : '') +
        '</div>' +
        '<h3 style="margin-bottom:4px;text-align:center">' + escapeHtml(group.name) + '</h3>' +
        (group.description ? '<p style="color:var(--text-secondary);font-size:13px;text-align:center;margin-bottom:12px">' + escapeHtml(group.description) + '</p>' : '') +
        '<p style="font-size:13px;font-weight:700;margin-bottom:8px">Members (' + group.members.length + ')</p>' +
        '<div style="margin-bottom:12px">' +
          group.members.map(m =>
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--divider-color)">' +
              '<div>' +
                '<div style="font-weight:600">' + escapeHtml(m.name || m.userId) + '</div>' +
                '<div style="font-size:11px;color:var(--text-secondary)">' + m.role + '</div>' +
              '</div>' +
              (isAdmin && m.userId !== USER.xameId
                ? '<button class="btn danger" style="padding:3px 10px;font-size:12px" data-remove="' + m.userId + '">Remove</button>'
                : '') +
            '</div>'
          ).join('') +
        '</div>' +
        (isAdmin ? '<button class="btn primary" id="addMemberBtn" style="width:100%;margin-bottom:8px">+ Add Member</button>' : '') +
        '<button class="btn secondary" id="leaveGroupBtn" style="width:100%;margin-bottom:8px">Leave Group</button>' +
        '<button class="btn secondary" id="closeGroupInfoBtn" style="width:100%">Close</button>' +
      '</div>';
    document.body.appendChild(dlg);

    dlg.querySelector('#closeGroupInfoBtn').addEventListener('click', () => dlg.remove());

    dlg.querySelector('#groupAvatarInput')?.addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      showNotification('Uploading...');
      const formData = new FormData();
      formData.append('avatar', file);
      formData.append('groupId', group.groupId);
      formData.append('userId', USER.xameId);
      try {
        const res  = await fetch('/api/groups/upload-avatar', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
          group.avatar = data.avatarUrl;
          const g = this._groups.find(g => g.groupId === group.groupId);
          if (g) g.avatar = data.avatarUrl;
          dlg.remove(); this.showGroupInfo(group, isAdmin);
          showNotification('Group photo updated!');
        } else showNotification('Upload failed: ' + data.message);
      } catch (err) { showNotification('Upload error: ' + err.message); }
    });

    dlg.querySelector('#leaveGroupBtn').addEventListener('click', async () => {
      if (!confirm('Leave this group?')) return;
      await fetch('/api/groups/remove-member', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: group.groupId, requesterId: group.createdBy, userId: USER.xameId })
      });
      dlg.remove();
      ACTIVE_GROUP = null;
      elChat?.classList.add('hidden');
      elContacts?.classList.remove('hidden');
      this._groups = this._groups.filter(g => g.groupId !== group.groupId);
      debouncedRenderContacts();
      showNotification('Left group');
    });

    dlg.querySelector('#addMemberBtn')?.addEventListener('click', () => { dlg.remove(); this._showAddMemberDialog(group, isAdmin); });

    dlg.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Remove this member?')) return;
        await fetch('/api/groups/remove-member', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: group.groupId, requesterId: USER.xameId, userId: btn.dataset.remove })
        });
        group.members = group.members.filter(m => m.userId !== btn.dataset.remove);
        dlg.remove(); this.showGroupInfo(group, isAdmin);
      });
    });
  },

  _showAddMemberDialog(group, isAdmin) {
    const existing  = new Set(group.members.map(m => m.userId));
    const available = CONTACTS.filter(c => c.id !== USER.xameId && !existing.has(c.id));
    if (available.length === 0) { showNotification('All contacts are already members'); return; }
    const dlg = document.createElement('div');
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:300px">' +
        '<h3 style="margin-bottom:12px">Add Member</h3>' +
        '<div style="max-height:250px;overflow-y:auto;margin-bottom:12px">' +
          available.map(c => '<label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer">' +
            '<input type="checkbox" value="' + c.id + '" style="width:18px;height:18px"/>' +
            '<span>' + escapeHtml(c.name || c.id) + '</span>' +
          '</label>').join('') +
        '</div>' +
        '<button class="btn primary" id="addMemberConfirmBtn" style="width:100%">Add</button>' +
        '<button class="btn secondary" id="addMemberCancelBtn" style="width:100%;margin-top:8px">Cancel</button>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#addMemberCancelBtn').addEventListener('click', () => dlg.remove());
    dlg.querySelector('#addMemberConfirmBtn').addEventListener('click', async () => {
      const selected = [...dlg.querySelectorAll('input:checked')].map(i => i.value);
      if (selected.length === 0) { showNotification('Select at least one member'); return; }
      for (const userId of selected) {
        const res = await fetch('/api/groups/add-member', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: group.groupId, requesterId: USER.xameId, userId })
        });
        const data = await res.json();
        if (data.success) group.members = data.group.members;
      }
      dlg.remove();
      showNotification('Member(s) added');
      this._renderGroupsList();
    });
  },
};

document.addEventListener('xame:socket-ready', () => groupsModule._bindSocketEvents());
