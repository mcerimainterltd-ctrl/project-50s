/*
 * broadcast.js — Mass Messaging / Broadcast Lists
 * XamePage v2.1
 */

const broadcastModule = (() => {
  let _lists = [];

  // ── Init ────────────────────────────────────────────────────────────────
  async function init() {
    await _loadLists();
  }

  async function _loadLists() {
    try {
      const r = await fetch('/api/broadcast/' + USER.xameId);
      const d = await r.json();
      if (d.success) _lists = d.lists;
    } catch (e) { console.error('Broadcast load error:', e); }
  }

  // ── Show main broadcast screen ──────────────────────────────────────────
  function showBroadcastScreen() {
    document.getElementById('broadcastDlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'broadcastDlg';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:340px;max-height:85vh;display:flex;flex-direction:column">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
          '<h3>📢 Mass Messaging</h3>' +
          '<button class="icon-btn" id="closeBroadcastDlg">✕</button>' +
        '</div>' +
        '<button class="btn primary" id="newBroadcastBtn" style="margin-bottom:12px">📨 New Broadcast</button>' +
        '<button class="btn secondary" id="manageBroadcastListsBtn" style="margin-bottom:16px">📋 Manage Broadcast Lists</button>' +
        '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">Saved Lists</div>' +
        '<div id="broadcastListsContainer" style="flex:1;overflow-y:auto">' +
          _renderLists() +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#closeBroadcastDlg').addEventListener('click', () => dlg.remove());
    dlg.querySelector('#newBroadcastBtn').addEventListener('click', () => { dlg.remove(); showNewBroadcastDialog(); });
    dlg.querySelector('#manageBroadcastListsBtn').addEventListener('click', () => { dlg.remove(); showManageListsDialog(); });
    dlg.querySelectorAll('[data-list-id]').forEach(btn => {
      btn.addEventListener('click', () => { dlg.remove(); showSendToListDialog(btn.dataset.listId); });
    });
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
  }

  function _renderLists() {
    if (!_lists.length) return '<div style="color:var(--text-secondary);text-align:center;padding:20px">No saved lists yet</div>';
    return _lists.map(l =>
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--divider-color)">' +
        '<div>' +
          '<div style="font-weight:600">' + escapeHtml(l.name) + '</div>' +
          '<div style="font-size:12px;color:var(--text-secondary)">' + l.members.length + ' recipients</div>' +
        '</div>' +
        '<button class="btn primary" style="padding:4px 12px;font-size:12px" data-list-id="' + l.listId + '">Send</button>' +
      '</div>'
    ).join('');
  }

  // ── New broadcast (select contacts + compose) ───────────────────────────
  function showNewBroadcastDialog(preselectedMembers) {
    document.getElementById('newBroadcastDlg')?.remove();
    const contacts = CONTACTS.filter(c => c.id !== USER.xameId);
    const dlg = document.createElement('div');
    dlg.id = 'newBroadcastDlg';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:340px;max-height:85vh;display:flex;flex-direction:column">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
          '<h3>📨 New Broadcast</h3>' +
          '<button class="icon-btn" id="closeNewBroadcastDlg">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">Select Recipients</div>' +
        '<div style="flex:1;overflow-y:auto;max-height:200px;margin-bottom:12px">' +
          contacts.map(c =>
            '<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--divider-color);cursor:pointer">' +
              '<input type="checkbox" data-id="' + c.id + '" ' + (preselectedMembers?.includes(c.id) ? 'checked' : '') + '>' +
              '<span>' + escapeHtml(c.name || c.id) + '</span>' +
            '</label>'
          ).join('') +
        '</div>' +
        '<div style="margin-bottom:8px">' +
          '<textarea id="broadcastText" placeholder="Type your message..." style="width:100%;min-height:80px;background:var(--color-input-bg,var(--dark-card));color:var(--text-primary);border:1px solid var(--divider-color);border-radius:8px;padding:8px;resize:vertical;box-sizing:border-box"></textarea>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:8px">' +
          '<button class="btn secondary" id="broadcastAttachBtn" style="flex:1">📎 Attach File</button>' +
          '<input type="file" id="broadcastFileInput" style="display:none">' +
        '</div>' +
        '<div id="broadcastFilePreview" style="margin-bottom:8px;font-size:12px;color:var(--text-secondary)"></div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn secondary" id="saveListBtn" style="flex:1">💾 Save List</button>' +
          '<button class="btn primary" id="sendBroadcastBtn" style="flex:1">📤 Send</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);

    let attachedFile = null;
    dlg.querySelector('#closeNewBroadcastDlg').addEventListener('click', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

    dlg.querySelector('#broadcastAttachBtn').addEventListener('click', () => dlg.querySelector('#broadcastFileInput').click());
    dlg.querySelector('#broadcastFileInput').addEventListener('change', e => {
      attachedFile = e.target.files[0];
      dlg.querySelector('#broadcastFilePreview').textContent = attachedFile ? '📎 ' + attachedFile.name : '';
    });

    dlg.querySelector('#saveListBtn').addEventListener('click', () => {
      const selected = [...dlg.querySelectorAll('input[type=checkbox]:checked')].map(c => c.dataset.id);
      if (!selected.length) { showNotification('Select at least one contact'); return; }
      const name = prompt('Enter list name:');
      if (!name?.trim()) return;
      _createList(name.trim(), selected).then(() => showNotification('List saved!'));
    });

    dlg.querySelector('#sendBroadcastBtn').addEventListener('click', async () => {
      const selected = [...dlg.querySelectorAll('input[type=checkbox]:checked')].map(c => c.dataset.id);
      const text = dlg.querySelector('#broadcastText').value.trim();
      if (!selected.length) { showNotification('Select at least one recipient'); return; }
      if (!text && !attachedFile) { showNotification('Type a message or attach a file'); return; }
      dlg.remove();
      await _sendBroadcast(selected, text, attachedFile);
    });
  }

  // ── Send to saved list ──────────────────────────────────────────────────
  function showSendToListDialog(listId) {
    const list = _lists.find(l => l.listId === listId);
    if (!list) return;
    showNewBroadcastDialog(list.members);
  }

  // ── Manage lists ────────────────────────────────────────────────────────
  function showManageListsDialog() {
    document.getElementById('manageListsDlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'manageListsDlg';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:340px;max-height:85vh;display:flex;flex-direction:column">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
          '<h3>📋 Broadcast Lists</h3>' +
          '<button class="icon-btn" id="closeManageListsDlg">✕</button>' +
        '</div>' +
        '<button class="btn primary" id="createNewListBtn" style="margin-bottom:12px">+ New List</button>' +
        '<div style="flex:1;overflow-y:auto">' +
          (_lists.length ? _lists.map(l =>
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--divider-color)">' +
              '<div>' +
                '<div style="font-weight:600">' + escapeHtml(l.name) + '</div>' +
                '<div style="font-size:12px;color:var(--text-secondary)">' + l.members.length + ' members</div>' +
              '</div>' +
              '<div style="display:flex;gap:6px">' +
                '<button class="btn secondary" style="padding:4px 8px;font-size:11px" data-edit="' + l.listId + '">✏️</button>' +
                '<button class="btn" style="padding:4px 8px;font-size:11px;background:var(--danger);color:white" data-delete="' + l.listId + '">🗑️</button>' +
              '</div>' +
            '</div>'
          ).join('') : '<div style="color:var(--text-secondary);text-align:center;padding:20px">No lists yet</div>') +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#closeManageListsDlg').addEventListener('click', () => dlg.remove());
    dlg.querySelector('#createNewListBtn').addEventListener('click', () => { dlg.remove(); _showCreateListDialog(); });
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
    dlg.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => { dlg.remove(); _showEditListDialog(btn.dataset.edit); });
    });
    dlg.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this list?')) return;
        await _deleteList(btn.dataset.delete);
        dlg.remove(); showManageListsDialog();
      });
    });
  }

  function _showCreateListDialog() {
    const contacts = CONTACTS.filter(c => c.id !== USER.xameId);
    const dlg = document.createElement('div');
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:320px">' +
        '<h3 style="margin-bottom:12px">New Broadcast List</h3>' +
        '<input id="newListName" type="text" placeholder="List name..." style="width:100%;padding:8px;background:var(--color-input-bg,var(--dark-card));color:var(--text-primary);border:1px solid var(--divider-color);border-radius:8px;margin-bottom:12px;box-sizing:border-box">' +
        '<div style="max-height:200px;overflow-y:auto;margin-bottom:12px">' +
          contacts.map(c =>
            '<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--divider-color);cursor:pointer">' +
              '<input type="checkbox" data-id="' + c.id + '">' +
              '<span>' + escapeHtml(c.name || c.id) + '</span>' +
            '</label>'
          ).join('') +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn secondary" id="cancelCreateList" style="flex:1">Cancel</button>' +
          '<button class="btn primary" id="confirmCreateList" style="flex:1">Create</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#cancelCreateList').addEventListener('click', () => dlg.remove());
    dlg.querySelector('#confirmCreateList').addEventListener('click', async () => {
      const name = dlg.querySelector('#newListName').value.trim();
      const members = [...dlg.querySelectorAll('input[type=checkbox]:checked')].map(c => c.dataset.id);
      if (!name) { showNotification('Enter a list name'); return; }
      if (!members.length) { showNotification('Select at least one member'); return; }
      await _createList(name, members);
      dlg.remove(); showManageListsDialog();
    });
  }

  function _showEditListDialog(listId) {
    const list = _lists.find(l => l.listId === listId);
    if (!list) return;
    const contacts = CONTACTS.filter(c => c.id !== USER.xameId);
    const dlg = document.createElement('div');
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:320px">' +
        '<h3 style="margin-bottom:12px">Edit List</h3>' +
        '<input id="editListName" type="text" value="' + escapeHtml(list.name) + '" style="width:100%;padding:8px;background:var(--color-input-bg,var(--dark-card));color:var(--text-primary);border:1px solid var(--divider-color);border-radius:8px;margin-bottom:12px;box-sizing:border-box">' +
        '<div style="max-height:200px;overflow-y:auto;margin-bottom:12px">' +
          contacts.map(c =>
            '<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--divider-color);cursor:pointer">' +
              '<input type="checkbox" data-id="' + c.id + '" ' + (list.members.includes(c.id) ? 'checked' : '') + '>' +
              '<span>' + escapeHtml(c.name || c.id) + '</span>' +
            '</label>'
          ).join('') +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn secondary" id="cancelEditList" style="flex:1">Cancel</button>' +
          '<button class="btn primary" id="confirmEditList" style="flex:1">Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#cancelEditList').addEventListener('click', () => dlg.remove());
    dlg.querySelector('#confirmEditList').addEventListener('click', async () => {
      const name = dlg.querySelector('#editListName').value.trim();
      const members = [...dlg.querySelectorAll('input[type=checkbox]:checked')].map(c => c.dataset.id);
      if (!name) { showNotification('Enter a list name'); return; }
      await _updateList(listId, name, members);
      dlg.remove(); showManageListsDialog();
    });
  }

  // ── Core send logic ─────────────────────────────────────────────────────
  async function _sendBroadcast(recipients, text, file) {
    showNotification('Sending to ' + recipients.length + ' recipients...');
    let fileData = null;
    if (file) {
      fileData = await _uploadFile(file);
      if (!fileData) { showNotification('File upload failed'); return; }
    }
    let sent = 0;
    for (const recipientId of recipients) {
      const msgId = typeof uid === 'function' ? uid() : Date.now() + Math.random().toString(36).slice(2);
      const ts = Date.now();
      const msg = fileData
        ? { id: msgId, file: fileData, type: 'sent', ts, status: 'sending' }
        : { id: msgId, text, type: 'sent', ts, status: 'sending' };
      // Add to local chat
      const chat = getChat(recipientId);
      chat.push(msg); setChat(recipientId, chat);
      // Send via socket
      if (fileData) {
        socket?.emit('send-message', { recipientId, message: msg });
      } else {
        socket?.emit('send-message', { recipientId, message: { id: msgId, text, ts } });
      }
      sent++;
      await new Promise(r => setTimeout(r, 100)); // small delay between sends
    }
    showNotification('✅ Sent to ' + sent + ' contacts!');
    if (typeof renderContacts === 'function') renderContacts();
  }

  async function _uploadFile(file) {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('senderId', USER.xameId);
      formData.append('recipientId', 'broadcast');
      formData.append('messageId', Date.now().toString());
      const r = await fetch('/api/upload-file', { method: 'POST', body: formData });
      const d = await r.json();
      if (d.success && d.url) return { name: file.name, type: file.type, url: d.url };
      return null;
    } catch (e) { console.error('Upload error:', e); return null; }
  }

  // ── API helpers ─────────────────────────────────────────────────────────
  async function _createList(name, members) {
    try {
      const r = await fetch('/api/broadcast/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: USER.xameId, name, members })
      });
      const d = await r.json();
      if (d.success) { _lists.unshift(d.list); return d.list; }
    } catch (e) { console.error('Create list error:', e); }
  }

  async function _updateList(listId, name, members) {
    try {
      const r = await fetch('/api/broadcast/' + listId, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: USER.xameId, name, members })
      });
      const d = await r.json();
      if (d.success) { const i = _lists.findIndex(l => l.listId === listId); if (i !== -1) _lists[i] = d.list; }
    } catch (e) { console.error('Update list error:', e); }
  }

  async function _deleteList(listId) {
    try {
      await fetch('/api/broadcast/' + listId, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: USER.xameId })
      });
      _lists = _lists.filter(l => l.listId !== listId);
    } catch (e) { console.error('Delete list error:', e); }
  }

  return { init, showBroadcastScreen };
})();
