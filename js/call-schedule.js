/*
 * call-schedule.js — Call Scheduling
 * XamePage v2.1
 */

const callScheduleModule = (() => {
  let _calls = [];

  async function init() {
    await _load();
    _listenSocket();
  }

  async function _load() {
    try {
      const r = await fetch(serverURL+'/api/schedule-call/' + USER.xameId);
      const d = await r.json();
      if (d.success) _calls = d.calls;
    } catch (e) { console.error('Call schedule load error:', e); }
  }

  function _listenSocket() {
    if (typeof socket === 'undefined' || !socket) return;
    socket.on('scheduled-call-due', ({ scheduleId, recipientId, callType }) => {
      console.log('📞 Scheduled call due:', scheduleId, recipientId, callType);
      _calls = _calls.filter(c => c.scheduleId !== scheduleId);
      const contact = CONTACTS?.find(c => c.id === recipientId);
      const name = contact?.name || recipientId;
      // Set ACTIVE_ID so startCall has the right context
      ACTIVE_ID = recipientId;
      showNotification('📞 Calling ' + name + ' (scheduled)...');
      setTimeout(() => {
        if (typeof startCall === 'function') startCall(recipientId, callType);
        else console.error('startCall not found');
      }, 500);
    });
  }

  // ── Show schedule dialog ────────────────────────────────────────────────
  function showScheduleCallDialog(recipientId, recipientName) {
    document.getElementById('scheduleCallDlg')?.remove();
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const defaultDate = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate());
    const defaultTime = pad(now.getHours()) + ':' + pad(now.getMinutes());

    const dlg = document.createElement('div');
    dlg.id = 'scheduleCallDlg';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:320px">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
          '<h3>📞 Schedule Call</h3>' +
          '<button class="icon-btn" id="closeScheduleCallDlg">✕</button>' +
        '</div>' +
        '<div style="color:var(--text-secondary);font-size:13px;margin-bottom:16px">To: ' + escapeHtml(recipientName || recipientId) + '</div>' +
        '<div style="margin-bottom:12px">' +
          '<label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">Call Type</label>' +
          '<div style="display:flex;gap:8px">' +
            '<button class="btn primary" id="callTypeVoice" data-type="voice" style="flex:1">🎙️ Voice</button>' +
            '<button class="btn secondary" id="callTypeVideo" data-type="video" style="flex:1">📹 Video</button>' +
          '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">' +
          '<div>' +
            '<label style="font-size:12px;color:var(--text-secondary)">Date</label>' +
            '<input type="date" id="callScheduleDate" value="' + defaultDate + '" style="width:100%;padding:8px;background:var(--color-input-bg,var(--dark-card));color:var(--text-primary);border:1px solid var(--divider-color);border-radius:8px;box-sizing:border-box">' +
          '</div>' +
          '<div>' +
            '<label style="font-size:12px;color:var(--text-secondary)">Time</label>' +
            '<input type="time" id="callScheduleTime" value="' + defaultTime + '" style="width:100%;padding:8px;background:var(--color-input-bg,var(--dark-card));color:var(--text-primary);border:1px solid var(--divider-color);border-radius:8px;box-sizing:border-box">' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button class="btn secondary" id="viewScheduledCallsBtn" style="flex:1">📋 View</button>' +
          '<button class="btn primary" id="confirmScheduleCallBtn" style="flex:1">✅ Schedule</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);

    let selectedType = 'voice';
    dlg.querySelector('#closeScheduleCallDlg').addEventListener('click', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

    // Call type toggle
    dlg.querySelectorAll('[data-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedType = btn.dataset.type;
        dlg.querySelectorAll('[data-type]').forEach(b => {
          b.className = b.dataset.type === selectedType ? 'btn primary' : 'btn secondary';
          b.style.flex = '1';
        });
      });
    });

    dlg.querySelector('#viewScheduledCallsBtn').addEventListener('click', () => { dlg.remove(); showScheduledCallsList(); });

    dlg.querySelector('#confirmScheduleCallBtn').addEventListener('click', async () => {
      const date = dlg.querySelector('#callScheduleDate').value;
      const time = dlg.querySelector('#callScheduleTime').value;
      if (!date || !time) { showNotification('Select date and time'); return; }
      const callAt = new Date(date + 'T' + time).getTime();
      if (callAt <= Date.now()) { showNotification('Please select a future time'); return; }

      const r = await fetch(serverURL+'/api/schedule-call/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerId: USER.xameId, recipientId, callType: selectedType, callAt })
      });
      const d = await r.json();
      if (d.success) {
        _calls.push(d.call);
        dlg.remove();
        showNotification('Call scheduled for ' + new Date(callAt).toLocaleString());
      } else { showNotification('Failed to schedule call'); }
    });
  }

  // ── View scheduled calls ────────────────────────────────────────────────
  function showScheduledCallsList() {
    document.getElementById('scheduledCallsListDlg')?.remove();
    const dlg = document.createElement('div');
    dlg.id = 'scheduledCallsListDlg';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:340px;max-height:85vh;display:flex;flex-direction:column">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
          '<h3>📋 Scheduled Calls</h3>' +
          '<button class="icon-btn" id="closeScheduledCallsListDlg">✕</button>' +
        '</div>' +
        '<div style="flex:1;overflow-y:auto">' +
          (_calls.length ? _calls.map(c => {
            const contact = CONTACTS?.find(ct => ct.id === c.recipientId);
            const name = contact?.name || c.recipientId;
            const callDate = new Date(c.callAt).toLocaleString();
            const icon = c.callType === 'video' ? '📹' : '🎙️';
            return '<div style="padding:10px 0;border-bottom:1px solid var(--divider-color)">' +
              '<div style="display:flex;justify-content:space-between;align-items:center">' +
                '<div>' +
                  '<div style="font-weight:600;font-size:13px">' + icon + ' To: ' + escapeHtml(name) + '</div>' +
                  '<div style="font-size:12px;color:var(--text-secondary)">📅 ' + callDate + '</div>' +
                '</div>' +
                '<button class="btn" style="padding:4px 8px;font-size:11px;background:var(--danger);color:white;flex-shrink:0" data-cancel="' + c.scheduleId + '">🗑️</button>' +
              '</div>' +
            '</div>';
          }).join('') : '<div style="color:var(--text-secondary);text-align:center;padding:20px">No scheduled calls</div>') +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#closeScheduledCallsListDlg').addEventListener('click', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
    dlg.querySelectorAll('[data-cancel]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await _cancel(btn.dataset.cancel);
        dlg.remove(); showScheduledCallsList();
      });
    });
  }

  async function _cancel(scheduleId) {
    try {
      await fetch(serverURL+'/api/schedule-call/' + scheduleId, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER.xameId })
      });
      _calls = _calls.filter(c => c.scheduleId !== scheduleId);
      showNotification('Scheduled call cancelled');
    } catch (e) { console.error('Cancel call error:', e); }
  }

  return { init, showScheduleCallDialog, showScheduledCallsList };
})();

document.addEventListener('xame:socket-ready', () => {
  if (typeof callScheduleModule !== 'undefined') callScheduleModule.init();
});
