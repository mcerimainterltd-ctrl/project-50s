/*
 * call-history.js — Call History Tab & Missed Call Badges
 * XamePage v2.1
 */

const callHistoryModule = (() => {
  let _history = [];
  let _missedCount = 0;

  async function load() {
    try {
      const r = await fetch(serverURL+'/api/call-history/' + USER.xameId);
      const d = await r.json();
      if (d.success) {
        _history = d.calls;
        _missedCount = _history.filter(c => c.status === 'missed' && c.recipientId === USER.xameId && !c.seen).length;
        _updateBadge();
      }
    } catch (e) { console.error('Call history load error:', e); }
  }

  function _updateBadge() {
    const badge = document.getElementById('missedCallsBadge');
    if (!badge) return;
    if (_missedCount > 0) {
      badge.textContent = _missedCount;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  function addMissedCall(callerId) {
    const contact = CONTACTS?.find(c => c.id === callerId);
    const name = contact?.name || callerId;
    _history.unshift({ callerId, recipientId: USER.xameId, status: 'missed', callType: 'voice', startTime: new Date().toISOString(), seen: false, callerName: name });
    _missedCount++;
    _updateBadge();
    // Update contact badge in chats list
    _updateContactMissedBadge(callerId);
  }

  function _updateContactMissedBadge(callerId) {
    const contact = CONTACTS?.find(c => c.id === callerId);
    if (!contact) return;
    if (!contact.missedCalls) contact.missedCalls = 0;
    contact.missedCalls++;
    if (typeof renderContacts === 'function') renderContacts();
  }

  function render() {
    const container = document.getElementById('callHistoryList');
    if (!container) return;
    // Mark missed calls as seen
    _missedCount = 0;
    _updateBadge();

    if (!_history.length) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-secondary)">No call history</div>';
      return;
    }

    container.innerHTML = _history.map((call, i) => {
      const isIncoming = call.recipientId === USER.xameId;
      const contactId  = isIncoming ? call.callerId : call.recipientId;
      const contact    = CONTACTS?.find(c => c.id === contactId);
      const name       = call.callerName || contact?.name || contactId;
      const initials   = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
      const icon       = call.status === 'missed' ? '📵' : isIncoming ? '📲' : '📤';
      const callIcon   = call.callType === 'video' ? '📹' : '🎙️';
      const timeStr    = _formatCallTime(call.startTime);
      const isMissed   = call.status === 'missed';
      return `
        <div class="call-history-item ${isMissed ? 'call-missed' : ''}" data-contact="${contactId}">
          <div class="call-history-avatar">${initials}</div>
          <div class="call-history-info">
            <div class="call-history-name">${escapeHtml(name)}</div>
            <div class="call-history-meta">${icon} ${isMissed ? 'Missed' : isIncoming ? 'Incoming' : 'Outgoing'} ${callIcon} · ${timeStr}</div>
          </div>
          <div class="call-history-action" data-call-contact="${contactId}" data-call-type="${call.callType || 'voice'}" title="Call back">📞</div>
        </div>`;
    }).join('');

    // Tap item → open chat
    container.querySelectorAll('.call-history-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.dataset.callContact) return;
        const cid = item.dataset.contact;
        if (typeof openChat === 'function') openChat(cid);
      });
    });

    // Tap call icon → call back
    container.querySelectorAll('[data-call-contact]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cid  = btn.dataset.callContact;
        const type = btn.dataset.callType || 'voice';
        if (typeof openChat === 'function') openChat(cid);
        setTimeout(() => { if (typeof startCall === 'function') startCall(cid, type); }, 500);
      });
    });
  }

  function _formatCallTime(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff/86400000) + 'd ago';
    return d.toLocaleDateString();
  }

  async function clearHistory() {
    try {
      await fetch(serverURL+'/api/call-history/' + USER.xameId, { method: 'DELETE' });
      _history = []; _missedCount = 0; _updateBadge(); render();
    } catch (e) { console.error('Clear history error:', e); }
  }

  // ── Tab switching ───────────────────────────────────────────────────────
  function initTabs() {
    document.getElementById('tabWallet')?.addEventListener('click', () => {
      document.querySelectorAll('.contacts-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tabWallet')?.classList.add('active');
      if (typeof walletModule !== 'undefined') walletModule.show();
    });

    document.getElementById('tabChats')?.addEventListener('click', () => {
      document.getElementById('chatsPanel')?.classList.remove('hidden');
      document.getElementById('callsPanel')?.classList.add('hidden');
      document.querySelectorAll('.contacts-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tabChats')?.classList.add('active');
    });
    document.getElementById('tabCalls')?.addEventListener('click', () => {
      document.getElementById('callsPanel')?.classList.remove('hidden');
      document.getElementById('chatsPanel')?.classList.add('hidden');
      document.querySelectorAll('.contacts-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tabCalls')?.classList.add('active');
      load().then(() => {
        // Mark all missed calls as seen in memory
        _history.forEach(c => { c.seen = true; });
        _missedCount = 0;
        // Clear the badge
        const badge = document.getElementById('missedCallsBadge');
        if (badge) { badge.textContent = '0'; badge.classList.add('hidden'); }
        render();
        // Persist seen status to server
        fetch(serverURL+'/api/call-history/' + USER.xameId + '/seen', { method: 'PATCH' })
          .catch(e => console.warn('Failed to mark calls seen:', e));
      });
    });
    document.getElementById('clearCallHistoryBtn')?.addEventListener('click', () => {
      if (confirm('Clear all call history?')) clearHistory();
    });
  }

  return { load, render, addMissedCall, initTabs };
})();
