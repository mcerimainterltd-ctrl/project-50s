/*
 * call-settings.js
 * Call Blocking, Call Schedule, and other call settings.
 * XamePage v2.1
 *
 * Depends on: config.js, state.js, storage.js, utils.js
 */

// ── Storage key ───────────────────────────────────────────────────────────
const BLOCKED_KEY = 'xame:blockedNumbers';

// ── Call Blocking ─────────────────────────────────────────────────────────
const callBlockingModule = {

  getBlockedList() {
    try { return JSON.parse(localStorage.getItem(BLOCKED_KEY) || '[]'); }
    catch { return []; }
  },

  saveBlockedList(list) {
    localStorage.setItem(BLOCKED_KEY, JSON.stringify(list));
  },

  isBlocked(xameId) {
    return this.getBlockedList().some(b => b.number === xameId);
  },

  block(xameId, name = '', reason = '') {
    const list = this.getBlockedList();
    if (list.some(b => b.number === xameId)) {
      showNotification(`${name || xameId} is already blocked`);
      return false;
    }
    list.push({ number: xameId, name, reason, blockedAt: Date.now() });
    this.saveBlockedList(list);
    showNotification(`${name || xameId} blocked`);
    return true;
  },

  unblock(xameId) {
    const list = this.getBlockedList().filter(b => b.number !== xameId);
    this.saveBlockedList(list);
    showNotification('Number unblocked');
  },

  // ── Blocked Numbers UI ─────────────────────────────────────────────────
  openBlockedNumbersUI() {
    const existing = document.getElementById('blockedNumbersDialog');
    if (existing) { existing.remove(); return; }

    const list = this.getBlockedList();
    const dlg  = document.createElement('div');
    dlg.id        = 'blockedNumbersDialog';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML = `
      <div class="dialog" style="max-height:80vh;overflow-y:auto;min-width:300px">
        <h3 style="margin-bottom:12px">🚫 Blocked Numbers</h3>
        <div id="blockedList" style="margin-bottom:12px">
          ${list.length === 0
            ? '<p style="color:var(--text-secondary);text-align:center">No blocked numbers</p>'
            : list.map(b => `
              <div class="blocked-item" style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--divider-color)">
                <div>
                  <div style="font-weight:600">${escapeHtml(b.name || b.number)}</div>
                  <div style="font-size:12px;color:var(--text-secondary)">${escapeHtml(b.number)}</div>
                </div>
                <button class="btn danger" style="padding:4px 12px;font-size:12px" data-unblock="${escapeHtml(b.number)}">Unblock</button>
              </div>
            `).join('')}
        </div>
        <div style="display:flex;gap:8px">
          <input id="blockNumberInput" class="input" placeholder="Enter Xame-ID to block" style="flex:1"/>
          <button class="btn primary" id="blockNumberBtn">Block</button>
        </div>
        <button class="btn secondary" id="closeBlockedBtn" style="width:100%;margin-top:8px">Close</button>
      </div>
    `;
    document.body.appendChild(dlg);

    // Unblock buttons
    dlg.querySelectorAll('[data-unblock]').forEach(btn => {
      btn.addEventListener('click', () => {
        callBlockingModule.unblock(btn.dataset.unblock);
        dlg.remove();
        callBlockingModule.openBlockedNumbersUI();
      });
    });

    // Block new number
    dlg.querySelector('#blockNumberBtn').addEventListener('click', () => {
      const val = dlg.querySelector('#blockNumberInput').value.trim();
      if (!val) { showNotification('Enter a Xame-ID'); return; }
      const contact = CONTACTS.find(c => c.id === val);
      callBlockingModule.block(val, contact?.name || '');
      dlg.remove();
      callBlockingModule.openBlockedNumbersUI();
    });

    dlg.querySelector('#closeBlockedBtn').addEventListener('click', () => dlg.remove());
  },
};
