/*
 * sms-templates.js — Quick Reply Templates for incoming calls
 * XamePage v2.1
 */

const smsTemplates = (() => {
  const STORAGE_KEY = 'xamepage_sms_templates';

  const DEFAULT_TEMPLATES = [
    "Can't talk right now, I'll call you back.",
    "I'm in a meeting. I'll call you soon.",
    "On my way, will call when free.",
    "Please send me a message instead.",
    "I'm driving. I'll call you later.",
  ];

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [...DEFAULT_TEMPLATES];
    } catch (e) { return [...DEFAULT_TEMPLATES]; }
  }

  function _save(templates) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(templates)); } catch (e) {}
  }

  function getTemplates() { return _load(); }

  function addTemplate(text) {
    const t = _load();
    if (!text?.trim() || t.includes(text.trim())) return false;
    t.push(text.trim());
    _save(t);
    return true;
  }

  function deleteTemplate(index) {
    const t = _load();
    if (index < 0 || index >= t.length) return;
    t.splice(index, 1);
    _save(t);
  }

  function editTemplate(index, newText) {
    const t = _load();
    if (index < 0 || index >= t.length || !newText?.trim()) return;
    t[index] = newText.trim();
    _save(t);
  }

  function resetToDefaults() {
    _save([...DEFAULT_TEMPLATES]);
  }

  // ── Render quick reply panel on incoming call ───────────────────────────
  function renderQuickReplyPanel() {
    const panel = document.getElementById('quickReplyPanel');
    const list  = document.getElementById('quickReplyList');
    if (!panel || !list) return;
    list.innerHTML = '';
    const templates = _load();
    templates.forEach((t) => {
      const btn = document.createElement('button');
      btn.textContent = t;
      btn.style.cssText = 'padding:8px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.12);color:white;font-size:12px;cursor:pointer;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%';
      btn.addEventListener('click', () => sendQuickReply(t));
      list.appendChild(btn);
    });
  }

  // ── Send the quick reply and decline the call ───────────────────────────
  function sendQuickReply(text) {
    const callerId = document.getElementById('callerId')?.textContent?.trim();
    if (!callerId || !text?.trim()) return;
    // Send message via socket
    const msgId = typeof uid === 'function' ? uid() : Date.now().toString(36);
    const ts = Date.now();
    socket?.emit('send-message', {
      recipientId: callerId,
      message: { id: msgId, text: text.trim(), ts }
    });
    // Save to local chat
    const chat = getChat(callerId);
    chat.push({ id: msgId, text: text.trim(), type: 'sent', ts, status: 'sending' });
    setChat(callerId, chat);
    // Decline the call
    document.getElementById('declineCallBtn')?.click();
    showNotification('Message sent to ' + callerId);
  }

  // ── Toggle quick reply panel ────────────────────────────────────────────
  function togglePanel() {
    const panel = document.getElementById('quickReplyPanel');
    if (!panel) return;
    if (panel.classList.contains('hidden')) {
      renderQuickReplyPanel();
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  }

  // ── Manage templates dialog ─────────────────────────────────────────────
  function showManageDialog() {
    document.getElementById('manageTemplatesDlg')?.remove();
    const templates = _load();
    const dlg = document.createElement('div');
    dlg.id = 'manageTemplatesDlg';
    dlg.className = 'dialog-backdrop';
    dlg.innerHTML =
      '<div class="dialog" style="width:360px;max-height:85vh;display:flex;flex-direction:column">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">' +
          '<h3>💬 SMS Templates</h3>' +
          '<button class="icon-btn" id="closeManageTemplatesDlg">✕</button>' +
        '</div>' +
        '<div style="flex:1;overflow-y:auto;margin-bottom:12px" id="templatesList">' +
          _renderTemplatesList(templates) +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:8px">' +
          '<input type="text" id="newTemplateInput" placeholder="Add new template..." style="flex:1;padding:8px;background:var(--color-input-bg,var(--dark-card));color:var(--text-primary);border:1px solid var(--divider-color);border-radius:8px;font-size:13px">' +
          '<button class="btn primary" id="addTemplateBtn" style="padding:8px 14px">Add</button>' +
        '</div>' +
        '<button class="btn secondary" id="resetTemplatesBtn" style="font-size:12px">↺ Reset to defaults</button>' +
      '</div>';
    document.body.appendChild(dlg);

    dlg.querySelector('#closeManageTemplatesDlg').addEventListener('click', () => dlg.remove());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

    dlg.querySelector('#addTemplateBtn').addEventListener('click', () => {
      const input = dlg.querySelector('#newTemplateInput');
      if (addTemplate(input.value)) {
        input.value = '';
        dlg.querySelector('#templatesList').innerHTML = _renderTemplatesList(_load());
        _bindTemplateActions(dlg);
      } else { showNotification('Template already exists or is empty'); }
    });

    dlg.querySelector('#newTemplateInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') dlg.querySelector('#addTemplateBtn').click();
    });

    dlg.querySelector('#resetTemplatesBtn').addEventListener('click', () => {
      if (confirm('Reset all templates to defaults?')) {
        resetToDefaults();
        dlg.querySelector('#templatesList').innerHTML = _renderTemplatesList(_load());
        _bindTemplateActions(dlg);
      }
    });

    _bindTemplateActions(dlg);
  }

  function _renderTemplatesList(templates) {
    if (!templates.length) return '<div style="color:var(--text-secondary);text-align:center;padding:20px">No templates</div>';
    return templates.map((t, i) =>
      '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--divider-color)">' +
        '<div style="flex:1;font-size:13px">' + escapeHtml(t) + '</div>' +
        '<button class="icon-btn" style="font-size:13px" data-edit="' + i + '">✏️</button>' +
        '<button class="icon-btn" style="font-size:13px;color:var(--danger,#e53935)" data-del="' + i + '">🗑️</button>' +
      '</div>'
    ).join('');
  }

  function _bindTemplateActions(dlg) {
    dlg.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        deleteTemplate(parseInt(btn.dataset.del));
        dlg.querySelector('#templatesList').innerHTML = _renderTemplatesList(_load());
        _bindTemplateActions(dlg);
      });
    });
    dlg.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.edit);
        const current = _load()[idx];
        const newText = prompt('Edit template:', current);
        if (newText?.trim()) {
          editTemplate(idx, newText);
          dlg.querySelector('#templatesList').innerHTML = _renderTemplatesList(_load());
          _bindTemplateActions(dlg);
        }
      });
    });
  }

  // ── Wire up buttons on DOM ready ────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('replyWithMsgBtn')?.addEventListener('click', togglePanel);
    document.getElementById('sendCustomReplyBtn')?.addEventListener('click', () => {
      const input = document.getElementById('customReplyInput');
      if (input?.value.trim()) { sendQuickReply(input.value.trim()); input.value = ''; }
    });
    document.getElementById('customReplyInput')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('sendCustomReplyBtn')?.click();
    });
  });

  return { showManageDialog, getTemplates, addTemplate, deleteTemplate, editTemplate, resetToDefaults };
})();
