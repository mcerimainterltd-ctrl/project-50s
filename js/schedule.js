/*
 * schedule.js — Message Scheduling
 * XamePage v2.1
 */

const scheduleModule = (() => {
  let _scheduled = [];

  async function init() {
    await _load();
    _listenSocket();
  }

  async function _load() {
    try {
      const r = await fetch(serverURL+'/api/schedule/' + USER.xameId);
      const d = await r.json();
      if (d.success) _scheduled = d.messages;
    } catch (e) { console.error('Schedule load error:', e); }
  }

  function _listenSocket() {
    if (typeof socket === 'undefined' || !socket) return;
    socket.on('scheduled-message-sent', ({ scheduleId, message, recipientId }) => {
      _scheduled = _scheduled.filter(m => m.scheduleId !== scheduleId);
      const chat = getChat(recipientId);
      chat.push({ id: message.id, text: message.text, file: message.file, type: 'sent', ts: message.ts, status: 'delivered' });
      setChat(recipientId, chat);
      if (ACTIVE_ID === recipientId) renderMessages();
      showNotification('Scheduled message sent!');
    });
  }

  // ── Show schedule composer ──────────────────────────────────────────────
  function showScheduleDialog(recipientId, recipientName) {
    document.getElementById('scheduleDlg')?.remove();
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const defaultDate = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate());
    const defaultTime = pad(now.getHours()) + ':' + pad(now.getMinutes());

    const dlg = document.createElement('div');
    dlg.id = 'scheduleDlg';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:340px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
          '<h3>🕐 Schedule Message</h3>' +
          '<button class="icon-btn" id="closeScheduleDlg">✕</button>' +
        '</div>' +
        '<div style="color:var(--text-secondary);font-size:13px;margin-bottom:12px">To: ' + escapeHtml(recipientName || recipientId) + '</div>' +
        '<textarea id="scheduleText" placeholder="Type your message..." style="width:100%;min-height:80px;background:var(--color-input-bg,var(--dark-card));color:var(--text-primary);border:1px solid var(--divider-color);border-radius:8px;padding:8px;resize:vertical;box-sizing:border-box;margin-bottom:12px"></textarea>' +
        '<div style="margin-bottom:12px">' +
          '<button class="btn secondary" id="scheduleAttachBtn" style="width:100%">📎 Attach File (optional)</button>' +
          '<input type="file" id="scheduleFileInput" style="display:none">' +
          '<div id="scheduleFilePreview" style="font-size:12px;color:var(--text-secondary);margin-top:4px"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">' +
          '<div>' +
            '<label style="font-size:12px;color:var(--text-secondary)">Date</label>' +
            '<input type="date" id="scheduleDate" value="' + defaultDate + '" style="width:100%;padding:8px;background:var(--color-input-bg,var(--dark-card));color:var(--text-primary);border:1px solid var(--divider-color);border-radius:8px;box-sizing:border-box">' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;color:var(--text-secondary)">Time</label>' +
            '<input type="time" id="scheduleTime" value="' + defaultTime + '" style="width:100%;padding:8px;background:var(--color-input-bg,var(--dark-card));color:var(--text-primary);border:1px solid var(--divider-color);border-radius:8px;box-sizing:border-box">' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn secondary" id="viewScheduledBtn" style="flex:1">📋 View Scheduled</button>' +
          '<button class="btn primary" id="confirmScheduleBtn" style="flex:1">✅ Schedule</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);

    let attachedFile = null;
    dlg.querySelector('#closeScheduleDlg').addEventListener('click', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

    dlg.querySelector('#scheduleAttachBtn').addEventListener('click', () => dlg.querySelector('#scheduleFileInput').click());
    dlg.querySelector('#scheduleFileInput').addEventListener('change', e => {
      attachedFile = e.target.files[0];
      dlg.querySelector('#scheduleFilePreview').textContent = attachedFile ? '📎 ' + attachedFile.name : '';
    });

    dlg.querySelector('#viewScheduledBtn').addEventListener('click', () => { dlg.remove(); showScheduledList(); });

    dlg.querySelector('#confirmScheduleBtn').addEventListener('click', async () => {
      const text = dlg.querySelector('#scheduleText').value.trim();
      const date = dlg.querySelector('#scheduleDate').value;
      const time = dlg.querySelector('#scheduleTime').value;
      if (!text && !attachedFile) { showNotification('Type a message or attach a file'); return; }
      if (!date || !time) { showNotification('Select date and time'); return; }
      const sendAt = new Date(date + 'T' + time).getTime();
      if (sendAt <= Date.now()) { showNotification('Please select a future time'); return; }

      let fileData = null;
      if (attachedFile) {
        showNotification('Uploading file...');
        fileData = await _uploadFile(attachedFile);
        if (!fileData) { showNotification('File upload failed'); return; }
      }

      const r = await fetch(serverURL+'/api/schedule/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId: USER.xameId, recipientId, text, file: fileData, sendAt })
      });
      const d = await r.json();
      if (d.success) {
        _scheduled.push(d.message);
        dlg.remove();
        const sendDate = new Date(sendAt).toLocaleString();
        showNotification('Message scheduled for ' + sendDate);
      } else { showNotification('Failed to schedule message'); }
    });
  }

  // ── View all scheduled messages ─────────────────────────────────────────
  function showScheduledList() {
    document.getElementById('scheduledListDlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'scheduledListDlg';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:340px;max-height:85vh;display:flex;flex-direction:column">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
          '<h3>📋 Scheduled Messages</h3>' +
          '<button class="icon-btn" id="closeScheduledListDlg">✕</button>' +
        '</div>' +
        '<div style="flex:1;overflow-y:auto">' +
          (_scheduled.length ? _scheduled.map(m => {
            const contact = CONTACTS.find(c => c.id === m.recipientId);
            const name = contact?.name || m.recipientId;
            const sendDate = new Date(m.sendAt).toLocaleString();
            return '<div style="padding:10px 0;border-bottom:1px solid var(--divider-color)">' +
              '<div style="display:flex;justify-content:space-between;align-items:center">' +
                '<div>' +
                  '<div style="font-weight:600;font-size:13px">To: ' + escapeHtml(name) + '</div>' +
                  '<div style="font-size:12px;color:var(--text-secondary)">📅 ' + sendDate + '</div>' +
                  '<div style="font-size:13px;margin-top:4px">' + escapeHtml(m.text || (m.file ? '📎 ' + m.file.name : '')) + '</div>' +
                '</div>' +
                '<button class="btn" style="padding:4px 8px;font-size:11px;background:var(--danger);color:white;flex-shrink:0" data-cancel="' + m.scheduleId + '">🗑️</button>' +
              '</div>' +
            '</div>';
          }).join('') : '<div style="color:var(--text-secondary);text-align:center;padding:20px">No scheduled messages</div>') +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#closeScheduledListDlg').addEventListener('click', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
    dlg.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await _cancel(btn.dataset.cancel);
        dlg.remove(); showScheduledList();
      });
    });
  }

  async function _cancel(scheduleId) {
    try {
      await fetch(serverURL+'/api/schedule/' + scheduleId, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER.xameId })
      });
      _scheduled = _scheduled.filter(m => m.scheduleId !== scheduleId);
      showNotification('Scheduled message cancelled');
    } catch (e) { console.error('Cancel error:', e); }
  }

  async function _uploadFile(file) {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('senderId', USER.xameId);
      formData.append('recipientId', 'scheduled');
      formData.append('messageId', Date.now().toString());
      const r = await fetch(serverURL+'/api/upload-file', { method: 'POST', body: formData });
      const d = await r.json();
      if (d.success && d.url) return { name: file.name, type: file.type, url: d.url };
      return null;
    } catch (e) { return null; }
  }

  return { init, showScheduleDialog, showScheduledList };
})();

document.addEventListener('xame:socket-ready', () => {
  if (typeof scheduleModule !== 'undefined') scheduleModule.init();
});
