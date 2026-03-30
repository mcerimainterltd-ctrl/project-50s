/*
 * phone.js - XamePage Phone Tab
 * Full telecom interface: Recents, Contacts, Keypad, Credits
 */

const phoneModule = (() => {
  let _activeSubTab = 'recents';
  let _deviceContacts = [];
  let _xamePageUsers = {};
  let _credits = { balance: 0, currency: 'NGN' };
  let _rates = {};
  let _dialInput = '';
  let _selectedCountry = { code: 'NG', dialCode: '+234', flag: '🇳🇬' };

  const COUNTRIES = [
    { code: 'NG', dialCode: '+234', flag: '🇳🇬', name: 'Nigeria' },
    { code: 'US', dialCode: '+1',   flag: '🇺🇸', name: 'United States' },
    { code: 'GB', dialCode: '+44',  flag: '🇬🇧', name: 'United Kingdom' },
    { code: 'GH', dialCode: '+233', flag: '🇬🇭', name: 'Ghana' },
    { code: 'KE', dialCode: '+254', flag: '🇰🇪', name: 'Kenya' },
    { code: 'ZA', dialCode: '+27',  flag: '🇿🇦', name: 'South Africa' },
    { code: 'CM', dialCode: '+237', flag: '🇨🇲', name: 'Cameroon' },
    { code: 'SN', dialCode: '+221', flag: '🇸🇳', name: 'Senegal' },
    { code: 'CI', dialCode: '+225', flag: '🇨🇮', name: 'Côte d\'Ivoire' },
    { code: 'FR', dialCode: '+33',  flag: '🇫🇷', name: 'France' },
    { code: 'DE', dialCode: '+49',  flag: '🇩🇪', name: 'Germany' },
    { code: 'CA', dialCode: '+1',   flag: '🇨🇦', name: 'Canada' },
  ];

  // ── Init ─────────────────────────────────────────────────────────────────
  let _initialized = false;
  let _keypadContainer = null;
  async function init() {
    if (_initialized) { render(); return; }
    _initialized = true;
    render();
    _loadCredits().then(() => {
      const bal = document.getElementById('creditsBalance');
      if (bal) bal.textContent = `${_credits.currency} ${(_credits.balance||0).toFixed(2)}`;
    });
    _loadRates().then(() => render()); // re-render once rates are loaded
  }

  async function _loadCredits() {
    try {
      const r = await fetch(`${serverURL}/api/call-credits/${USER.xameId}`);
      const d = await r.json();
      if (d.success) _credits = d;
    } catch(e) {}
  }

  async function _loadRates() {
    try {
      const r = await fetch(`${serverURL}/api/call-credits/rates`);
      const d = await r.json();
      if (d.success) _rates = d.rates;
    } catch(e) {}
  }

  // ── Main Render ───────────────────────────────────────────────────────────
  function render() {
    const container = document.getElementById('phonePanelContent');
    if (!container) return;

    const rate = (_rates && _rates[_selectedCountry.code]) || (_rates && _rates['default']) || { rate: 20 };

    container.innerHTML = `
      <!-- Credits bar -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:var(--bg-secondary,#1a2332);border-bottom:1px solid rgba(255,255,255,0.06);">
        <div>
          <span style="font-size:11px;color:#aaa;">Call Credits</span><br>
          <span style="font-size:18px;font-weight:700;color:#00B0A0;" id="creditsBalance">${_credits.currency} ${(_credits.balance||0).toFixed(2)}</span>
        </div>
        <div style="display:flex;gap:8px;">
          <button id="topupCreditsBtn" style="padding:6px 14px;background:rgba(0,176,160,0.15);border:1px solid rgba(0,176,160,0.3);border-radius:20px;color:#00B0A0;font-size:12px;cursor:pointer;">Top Up</button>
          <button id="rechargeCreditsBtn" style="padding:6px 14px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:20px;color:#fff;font-size:12px;cursor:pointer;">Recharge</button>
        </div>
      </div>

      <!-- Sub-tabs -->
      <div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.06);">
        ${['recents','contacts','keypad'].map(t => `
          <button class="phone-subtab ${_activeSubTab===t?'active':''}" data-subtab="${t}"
            style="flex:1;padding:10px;background:none;border:none;color:${_activeSubTab===t?'#00B0A0':'#aaa'};font-size:13px;font-weight:600;cursor:pointer;border-bottom:${_activeSubTab===t?'2px solid #00B0A0':'2px solid transparent'};">
            ${t === 'recents' ? '🕐 Recents' : t === 'contacts' ? '👥 Contacts' : '⌨️ Keypad'}
          </button>`).join('')}
      </div>

      <!-- Sub-tab content -->
      <div id="phoneSubContent" style="overflow-y:auto;flex:1;min-height:0;"></div>
    `;

    // Sub-tab switching — use delegation (set once)
    if (!container._delegationSet) {
      container._delegationSet = true;
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.phone-subtab');
        if (btn && btn.dataset.subtab) {
          _activeSubTab = btn.dataset.subtab;
          render();
        }
      });
    }

    document.getElementById('topupCreditsBtn')?.addEventListener('click', _showTopupDialog);
    document.getElementById('rechargeCreditsBtn')?.addEventListener('click', _showRechargeDialog);

    _renderSubTab();
  }

  function _renderSubTab() {
    const sub = document.getElementById('phoneSubContent');
    if (!sub) return;
    if (_activeSubTab === 'recents') _renderRecents(sub);
    else if (_activeSubTab === 'contacts') _renderContacts(sub);
    else if (_activeSubTab === 'keypad') _renderKeypad(sub);
  }

  // ── Recents ───────────────────────────────────────────────────────────────
  async function _renderRecents(container) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:#aaa;">Loading...</div>';
    try {
      const r = await fetch(`${serverURL}/api/call-history/${USER.xameId}`);
      const d = await r.json();
      if (!d.success || !d.calls.length) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;">No recent calls</div>';
        return;
      }
      container.innerHTML = d.calls.map(call => {
        const isIncoming = call.recipientId === USER.xameId;
        const contactId = isIncoming ? call.callerId : call.recipientId;
        const isPSTN = call.type === 'pstn';
        const isMissed = call.status === 'missed' || (isIncoming && !call.duration && ['rejected','ended'].includes(call.status));
        const icon = isPSTN ? '📞' : '💬';
        const dirIcon = isMissed ? '📵' : isIncoming ? '📲' : '📤';
        const timeStr = _formatTime(call.startTime);
        const dur = call.duration ? ` · ${Math.floor(call.duration/60)}m ${call.duration%60}s` : '';
        const initials = contactId.slice(0,2).toUpperCase();
        return `
          <div class="phone-recent-item" data-contact="${contactId}" data-type="${isPSTN?'pstn':'xame'}" data-calltype="${call.callType||'voice'}"
            style="display:flex;align-items:center;padding:12px 16px;gap:12px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;">
            <div style="width:42px;height:42px;border-radius:50%;background:#3e5163;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0;">${initials}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:600;color:${isMissed?'#ff6464':'#fff'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(contactId)}</div>
              <div style="font-size:12px;color:#aaa;">${dirIcon} ${isMissed?'Missed':isIncoming?'Incoming':'Outgoing'} ${icon}${dur} · ${timeStr}</div>
            </div>
            <button class="phone-callback-btn" data-contact="${contactId}" data-type="${isPSTN?'pstn':'xame'}" data-calltype="${call.callType||'voice'}"
              style="padding:6px 12px;background:rgba(0,176,160,0.15);border:1px solid rgba(0,176,160,0.3);border-radius:20px;color:#00B0A0;font-size:12px;cursor:pointer;">Call</button>
          </div>`;
      }).join('');

      container.querySelectorAll('.phone-callback-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          _initiateCall(btn.dataset.contact, btn.dataset.type, btn.dataset.calltype);
        });
      });
    } catch(e) {
      container.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;">Failed to load recents</div>';
    }
  }

  // ── Contacts ──────────────────────────────────────────────────────────────
  async function _renderContacts(container) {
    container.innerHTML = `
      <div style="padding:12px 16px;">
        <input id="phoneContactSearch" placeholder="🔍 Search contacts..." style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:20px;color:#fff;font-size:14px;outline:none;"/>
      </div>
      <div id="phoneContactList" style="padding:0 0 20px;"></div>
    `;

    document.getElementById('phoneContactSearch')?.addEventListener('input', e => {
      _renderContactList(e.target.value.trim());
    });

    await _loadDeviceContacts();
    _renderContactList('');
  }

  async function _loadDeviceContacts() {
    if (_deviceContacts.length) return;
    try {
      if (window.Capacitor?.Plugins?.Contacts) {
        const Contacts = window.Capacitor.Plugins.Contacts;
        // Request permission first
        const perm = await Contacts.requestPermissions().catch(() => ({ contacts: 'denied' }));
        if (perm.contacts !== 'granted') {
          showNotification('Contacts permission denied');
          return;
        }
        const result = await Contacts.getContacts({
          projection: { name: true, phones: true, image: true }
        });
        _deviceContacts = (result.contacts || [])
          .filter(c => c.phones?.length)
          .map(c => ({
            name: c.name?.display || c.name?.given || 'Unknown',
            phones: c.phones.map(p => p.number.replace(/\s/g,'')),
            photo: c.photos?.[0]?.base64String || null
          }))
          .sort((a,b) => a.name.localeCompare(b.name));

        // Check which are on XamePage
        const allPhones = _deviceContacts.flatMap(c => c.phones);
        const r = await fetch(`${serverURL}/api/phone/check-xamepage`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ phones: allPhones })
        });
        const d = await r.json();
        if (d.success) _xamePageUsers = d.registered;
      } else {
        // Fallback: use XamePage contacts with names
        _deviceContacts = (CONTACTS || []).filter(c => c.id !== USER.xameId).map(c => ({
          name: c.name && c.name !== c.id ? c.name : c.id,
          phones: [c.id],
          photo: c.profilePic || null,
          isXame: true
        }));
      }
    } catch(e) {
      _deviceContacts = (CONTACTS || []).map(c => ({
        name: c.name || c.id, phones: [c.id], photo: c.profilePic || null
      }));
    }
  }

  function _renderContactList(query) {
    const list = document.getElementById('phoneContactList');
    if (!list) return;
    const filtered = query
      ? _deviceContacts.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || c.phones.some(p => p.includes(query)))
      : _deviceContacts;

    if (!filtered.length) {
      list.innerHTML = '<div style="text-align:center;padding:40px;color:#aaa;">No contacts found</div>';
      return;
    }

    // Group by first letter
    const grouped = {};
    filtered.forEach(c => {
      const letter = c.name[0].toUpperCase();
      if (!grouped[letter]) grouped[letter] = [];
      grouped[letter].push(c);
    });

    list.innerHTML = Object.keys(grouped).sort().map(letter => `
      <div style="padding:6px 16px;font-size:11px;font-weight:700;color:#00B0A0;background:rgba(0,176,160,0.05);">${letter}</div>
      ${grouped[letter].map(c => {
        const primaryPhone = c.phones[0];
        const isOnXame = !!_xamePageUsers[primaryPhone];
        const initials = c.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
        return `
          <div class="phone-contact-item" data-phone="${primaryPhone}" data-name="${escapeHtml(c.name)}" data-xame="${isOnXame}"
            style="display:flex;align-items:center;padding:10px 16px;gap:12px;border-bottom:1px solid rgba(255,255,255,0.04);cursor:pointer;">
            <div style="position:relative;width:42px;height:42px;flex-shrink:0;">
              ${c.photo ? `<img src="data:image/jpeg;base64,${c.photo}" style="width:42px;height:42px;border-radius:50%;object-fit:cover;"/>` :
                `<div style="width:42px;height:42px;border-radius:50%;background:#3e5163;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;">${initials}</div>`}
              ${isOnXame ? `<div style="position:absolute;bottom:-2px;right:-2px;width:16px;height:16px;border-radius:50%;background:#00B0A0;border:2px solid var(--dark-bg,#0f1419);display:flex;align-items:center;justify-content:center;font-size:8px;">✓</div>` : ''}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:14px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.name)}</div>
              <div style="font-size:12px;color:#aaa;">${primaryPhone}${isOnXame?' · <span style="color:#00B0A0">On XamePage</span>':''}</div>
            </div>
          </div>`;
      }).join('')}
    `).join('');

    list.querySelectorAll('.phone-contact-item').forEach(item => {
      item.addEventListener('click', () => {
        _showContactCallOptions(item.dataset.name, item.dataset.phone, item.dataset.xame === 'true');
      });
    });
  }

  // ── Keypad ────────────────────────────────────────────────────────────────
  function _renderKeypad(container) {
    const rate = (_rates && _rates[_selectedCountry.code]) || (_rates && _rates['default']) || { rate: 20 };
    container.innerHTML = `
      <div style="padding:12px 16px;display:flex;flex-direction:column;align-items:center;gap:8px;height:100%;box-sizing:border-box;">
        <!-- Country selector -->
        <button id="countrySelectBtn" style="display:flex;align-items:center;gap:8px;padding:8px 16px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:20px;color:#fff;font-size:14px;cursor:pointer;width:100%;justify-content:center;">
          <span>${_selectedCountry.flag}</span>
          <span>${_selectedCountry.name}</span>
          <span style="color:#aaa;">${_selectedCountry.dialCode}</span>
          <span style="color:#aaa;font-size:10px;">▼</span>
        </button>

        <!-- Rate indicator -->
        <div style="font-size:12px;color:#aaa;">Rate: <span style="color:#00B0A0;">${_credits.currency} ${rate.rate}/min</span></div>

        <!-- Display -->
        <div id="dialDisplay" style="font-size:28px;font-weight:300;color:#fff;letter-spacing:4px;min-height:44px;text-align:center;width:100%;padding:8px;">
          ${_dialInput || '<span style="color:#444;">Enter number</span>'}
        </div>

        <!-- Keypad grid -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:100%;max-width:260px;">
          ${['1','2','3','4','5','6','7','8','9','*','0','#'].map(k => `
            <button class="dial-key" data-key="${k}"
              style="padding:12px;background:rgba(255,255,255,0.07);border:none;border-radius:50%;color:#fff;font-size:20px;font-weight:500;cursor:pointer;aspect-ratio:1;transition:background 0.15s;display:flex;align-items:center;justify-content:center;">
              ${k}
            </button>`).join('')}
        </div>

        <!-- Backspace -->
        <button id="dialBackspace" style="padding:8px 20px;background:rgba(255,100,100,0.1);border:1px solid rgba(255,100,100,0.2);border-radius:20px;color:#ff6464;font-size:16px;cursor:pointer;">⌫</button>

        <!-- Action buttons -->
        <div style="display:flex;gap:12px;width:100%;max-width:260px;">
          <button id="dialSmsBtn" style="flex:1;padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:13px;cursor:pointer;">💬 SMS</button>
          <button id="dialCallBtn" style="flex:2;padding:12px;background:#00B0A0;border:none;border-radius:12px;color:#000;font-size:15px;font-weight:700;cursor:pointer;">📞 Call</button>
        </div>
      </div>
    `;

    // Store container reference and set listener once
    _keypadContainer = container;
    container.addEventListener('click', function _kh(e) {
      if (container !== _keypadContainer) { container.removeEventListener('click', _kh); return; }
      const dialKey = e.target.closest('.dial-key');
      if (dialKey) { _dialInput += dialKey.dataset.key; _renderKeypad(container); return; }
      const target = e.target.closest('button');
      if (!target) return;
      const t = target.id;
      if (t === 'dialBackspace') { _dialInput = _dialInput.slice(0,-1); _renderKeypad(container); }
      else if (t === 'countrySelectBtn') { _showCountryPicker(); }
      else if (t === 'dialCallBtn') {
        if (!_dialInput) return showNotification('Enter a number first');
        _initiateCall(_selectedCountry.dialCode + _dialInput, 'pstn', 'voice');
      } else if (t === 'dialSmsBtn') {
        if (!_dialInput) return showNotification('Enter a number first');
        _showSmsComposer(_selectedCountry.dialCode + _dialInput);
      }
    };
    });
  }

  // ── Call Initiation ───────────────────────────────────────────────────────
  function _initiateCall(number, type, callType) {
    if (type === 'xame') {
      if (typeof openChat === 'function') openChat(number);
      setTimeout(() => { if (typeof startCall === 'function') startCall(number, callType || 'voice'); }, 500);
    } else {
      _showPSTNCallConfirm(number, callType);
    }
  }

  function _showPSTNCallConfirm(number, callType) {
    const rate = _rates[_selectedCountry.code] || _rates['default'] || { rate: 20 };
    const dlg = document.createElement('div');
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    dlg.innerHTML = `
      <div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;">
        <h3 style="color:#fff;font-size:17px;margin:0 0 8px;">📞 PSTN Call</h3>
        <p style="color:#aaa;font-size:14px;margin:0 0 16px;">Calling <strong style="color:#fff;">${escapeHtml(number)}</strong></p>
        <p style="color:#aaa;font-size:13px;margin:0 0 20px;">Rate: <span style="color:#00B0A0;">${_credits.currency} ${rate.rate}/min</span> · Balance: <span style="color:#fff;">${_credits.currency} ${(_credits.balance||0).toFixed(2)}</span></p>
        <div style="display:flex;gap:12px;">
          <button id="cancelPSTN" style="flex:1;padding:14px;background:rgba(255,255,255,0.07);border:none;border-radius:12px;color:#fff;cursor:pointer;">Cancel</button>
          <button id="confirmPSTN" style="flex:2;padding:14px;background:#00B0A0;border:none;border-radius:12px;color:#000;font-weight:700;cursor:pointer;">Call Now</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#cancelPSTN').onclick = () => dlg.remove();
    dlg.querySelector('#confirmPSTN').onclick = async () => {
      dlg.remove();
      try {
        // Get Twilio Voice SDK token
        const tokenRes = await fetch(`${serverURL}/api/pstn/token/${USER.xameId}`);
        const tokenData = await tokenRes.json();
        if (!tokenData.success) {
          // Fallback to server-side call
          const r = await fetch(`${serverURL}/api/pstn/call`, {
            method: 'POST', headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ userId: USER.xameId, to: number, countryCode: _selectedCountry.code })
          });
          const d = await r.json();
          if (d.success) {
            showNotification('📞 Connecting call...');
            _credits.balance = (_credits.balance || 0) - d.deducted;
            const bal = document.getElementById('creditsBalance');
            if (bal) bal.textContent = `${_credits.currency} ${_credits.balance.toFixed(2)}`;
          } else {
            showNotification(d.message || 'Call failed');
          }
          return;
        }
        // Use Twilio Voice SDK
        if (typeof Twilio !== 'undefined' && Twilio.Device) {
          const device = new Twilio.Device(tokenData.token, { codecPreferences: ['opus', 'pcmu'] });
          device.on('ready', () => {
            const conn = device.connect({ To: number, CallerId: process.env.TWILIO_PHONE_NUMBER });
            showNotification('📞 Connecting call...');
            conn.on('disconnect', () => { device.destroy(); showNotification('📵 Call ended'); });
            conn.on('error', (e) => { device.destroy(); showNotification('Call error: ' + e.message); });
          });
          device.on('error', (e) => showNotification('Call setup error: ' + e.message));
        } else {
          // Fallback: load SDK then retry
          const script = document.createElement('script');
          script.src = 'https://sdk.twilio.com/js/client/v1.14/twilio.min.js';
          script.onload = () => {
            const device = new Twilio.Device(tokenData.token);
            device.on('ready', () => {
              device.connect({ To: number });
              showNotification('📞 Connecting call...');
            });
          };
          document.head.appendChild(script);
        }
        // Deduct credits
        const r = await fetch(`${serverURL}/api/pstn/call`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ userId: USER.xameId, to: number, countryCode: _selectedCountry.code })
        });
        const d = await r.json();
        if (d.success) {
          _credits.balance = (_credits.balance || 0) - d.deducted;
          const bal = document.getElementById('creditsBalance');
          if (bal) bal.textContent = `${_credits.currency} ${_credits.balance.toFixed(2)}`;
        }
      } catch(e) { showNotification('Call failed. Check connection.'); }
    };
  }

  // ── Contact Options ───────────────────────────────────────────────────────
  function _showContactCallOptions(name, phone, isOnXame) {
    const dlg = document.createElement('div');
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    dlg.innerHTML = `
      <div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;">
        <h3 style="color:#fff;font-size:17px;margin:0 0 4px;">${escapeHtml(name)}</h3>
        <p style="color:#aaa;font-size:13px;margin:0 0 20px;">${escapeHtml(phone)}</p>
        ${isOnXame ? `
          <button class="call-opt-btn" data-type="xame-voice" style="width:100%;padding:14px;background:rgba(0,176,160,0.15);border:1px solid rgba(0,176,160,0.3);border-radius:12px;color:#00B0A0;font-size:14px;cursor:pointer;margin-bottom:10px;">
            💬 Voice Call via XamePage (Free)
          </button>
          <button class="call-opt-btn" data-type="xame-video" style="width:100%;padding:14px;background:rgba(0,176,160,0.1);border:1px solid rgba(0,176,160,0.2);border-radius:12px;color:#00B0A0;font-size:14px;cursor:pointer;margin-bottom:10px;">
            📹 Video Call via XamePage (Free)
          </button>` : ''}
        <button class="call-opt-btn" data-type="pstn" style="width:100%;padding:14px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:14px;cursor:pointer;margin-bottom:10px;">
          📞 Call via Phone (Credits)
        </button>
        <button class="call-opt-btn" data-type="sms" style="width:100%;padding:14px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:14px;cursor:pointer;margin-bottom:16px;">
          ✉️ Send SMS (Credits)
        </button>
        <button id="closeCallOpts" style="width:100%;padding:12px;background:none;border:none;color:#aaa;font-size:14px;cursor:pointer;">Cancel</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#closeCallOpts').onclick = () => dlg.remove();
    dlg.querySelectorAll('.call-opt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        dlg.remove();
        const t = btn.dataset.type;
        if (t === 'xame-voice') _initiateCall(phone, 'xame', 'voice');
        else if (t === 'xame-video') _initiateCall(phone, 'xame', 'video');
        else if (t === 'pstn') _showPSTNCallConfirm(phone, 'voice');
        else if (t === 'sms') _showSmsComposer(phone);
      });
    });
  }

  // ── SMS Composer ──────────────────────────────────────────────────────────
  function _showSmsComposer(to) {
    const dlg = document.createElement('div');
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    dlg.innerHTML = `
      <div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;">
        <h3 style="color:#fff;font-size:17px;margin:0 0 16px;">✉️ Send SMS</h3>
        <p style="color:#aaa;font-size:13px;margin:0 0 12px;">To: <strong style="color:#fff;">${escapeHtml(to)}</strong> · Cost: <span style="color:#00B0A0;">5 credits</span></p>
        <textarea id="smsBody" placeholder="Type your message..." style="width:100%;padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:14px;min-height:100px;resize:none;outline:none;margin-bottom:16px;"></textarea>
        <div style="display:flex;gap:12px;">
          <button id="cancelSMS" style="flex:1;padding:14px;background:rgba(255,255,255,0.07);border:none;border-radius:12px;color:#fff;cursor:pointer;">Cancel</button>
          <button id="sendSMS" style="flex:2;padding:14px;background:#00B0A0;border:none;border-radius:12px;color:#000;font-weight:700;cursor:pointer;">Send SMS</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#cancelSMS').onclick = () => dlg.remove();
    dlg.querySelector('#sendSMS').onclick = async () => {
      const msg = dlg.querySelector('#smsBody').value.trim();
      if (!msg) return showNotification('Enter a message');
      try {
        const r = await fetch(`${serverURL}/api/pstn/sms`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ userId: USER.xameId, to, message: msg })
        });
        const d = await r.json();
        dlg.remove();
        if (d.success) showNotification('✅ SMS sent!');
        else showNotification(d.message || 'SMS failed');
      } catch(e) { showNotification('SMS failed'); }
    };
  }

  // ── Top Up Dialog ─────────────────────────────────────────────────────────
  function _showTopupDialog() {
    const dlg = document.createElement('div');
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    dlg.innerHTML = `
      <div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;">
        <h3 style="color:#fff;font-size:17px;margin:0 0 8px;">💰 Top Up Call Credits</h3>
        <p style="color:#aaa;font-size:13px;margin:0 0 16px;">Wallet Balance: <span style="color:#fff;" id="walletBalanceDisplay">Loading...</span></p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
          ${[100,200,500,1000,2000,5000].map(a => `
            <button class="topup-amount" data-amount="${a}" style="padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:14px;cursor:pointer;">
              ${_credits.currency} ${a}
            </button>`).join('')}
        </div>
        <input id="customTopup" type="number" placeholder="Custom amount..." style="width:100%;padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:14px;outline:none;margin-bottom:16px;"/>
        <div style="display:flex;gap:12px;">
          <button id="cancelTopup" style="flex:1;padding:14px;background:rgba(255,255,255,0.07);border:none;border-radius:12px;color:#fff;cursor:pointer;">Cancel</button>
          <button id="confirmTopup" style="flex:2;padding:14px;background:#00B0A0;border:none;border-radius:12px;color:#000;font-weight:700;cursor:pointer;">Top Up</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);

    // Load wallet balance
    fetch(`${serverURL}/api/wallet/me`, { headers: { 'x-xame-id': USER.xameId } })
      .then(r => r.json()).then(d => {
        if (d.wallet) document.getElementById('walletBalanceDisplay').textContent = `${d.wallet.currency} ${d.wallet.balance?.toFixed(2)}`;
      }).catch(() => {});

    let selectedAmount = 0;
    dlg.querySelectorAll('.topup-amount').forEach(btn => {
      btn.addEventListener('click', () => {
        dlg.querySelectorAll('.topup-amount').forEach(b => b.style.borderColor = 'rgba(255,255,255,0.1)');
        btn.style.borderColor = '#00B0A0';
        selectedAmount = parseInt(btn.dataset.amount);
        document.getElementById('customTopup').value = '';
      });
    });

    dlg.querySelector('#cancelTopup').onclick = () => dlg.remove();
    dlg.querySelector('#confirmTopup').onclick = async () => {
      const custom = parseInt(document.getElementById('customTopup').value);
      const amount = custom || selectedAmount;
      if (!amount || amount <= 0) return showNotification('Select or enter an amount');
      try {
        const r = await fetch(`${serverURL}/api/call-credits/topup`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ userId: USER.xameId, amount })
        });
        const d = await r.json();
        dlg.remove();
        if (d.success) {
          _credits.balance = d.balance;
          showNotification(`✅ ${_credits.currency} ${amount} added to call credits`);
          render();
        } else showNotification(d.message || 'Top up failed');
      } catch(e) { showNotification('Top up failed'); }
    };
  }

  // ── Recharge Dialog ───────────────────────────────────────────────────────
  function _showRechargeDialog() {
    const dlg = document.createElement('div');
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    dlg.innerHTML = `
      <div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;">
        <h3 style="color:#fff;font-size:17px;margin:0 0 8px;">🎟️ Recharge Token</h3>
        <p style="color:#aaa;font-size:13px;margin:0 0 16px;">Enter your recharge token in format: XAME-XXXX-XXXX-XXXX</p>
        <input id="rechargeToken" placeholder="XAME-XXXX-XXXX-XXXX" style="width:100%;padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:16px;text-align:center;letter-spacing:2px;outline:none;margin-bottom:16px;text-transform:uppercase;"/>
        <div style="display:flex;gap:12px;">
          <button id="cancelRecharge" style="flex:1;padding:14px;background:rgba(255,255,255,0.07);border:none;border-radius:12px;color:#fff;cursor:pointer;">Cancel</button>
          <button id="confirmRecharge" style="flex:2;padding:14px;background:#00B0A0;border:none;border-radius:12px;color:#000;font-weight:700;cursor:pointer;">Redeem</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelector('#cancelRecharge').onclick = () => dlg.remove();
    dlg.querySelector('#confirmRecharge').onclick = async () => {
      const token = document.getElementById('rechargeToken').value.trim().toUpperCase();
      if (!token) return showNotification('Enter a token');
      try {
        const r = await fetch(`${serverURL}/api/call-credits/recharge`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ userId: USER.xameId, token })
        });
        const d = await r.json();
        dlg.remove();
        if (d.success) {
          _credits.balance = d.balance;
          showNotification(`✅ Credits added! Balance: ${_credits.currency} ${d.balance.toFixed(2)}`);
          render();
        } else showNotification(d.message || 'Invalid token');
      } catch(e) { showNotification('Recharge failed'); }
    };
  }

  // ── Country Picker ────────────────────────────────────────────────────────
  function _showCountryPicker() {
    const dlg = document.createElement('div');
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    dlg.innerHTML = `
      <div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;max-height:60vh;overflow-y:auto;">
        <h3 style="color:#fff;font-size:17px;margin:0 0 16px;">🌍 Select Country</h3>
        ${COUNTRIES.map(c => `
          <button class="country-opt" data-code="${c.code}" style="width:100%;display:flex;align-items:center;gap:12px;padding:12px;background:${_selectedCountry.code===c.code?'rgba(0,176,160,0.15)':'none'};border:none;border-radius:10px;color:#fff;font-size:14px;cursor:pointer;margin-bottom:4px;">
            <span style="font-size:20px;">${c.flag}</span>
            <span style="flex:1;text-align:left;">${c.name}</span>
            <span style="color:#aaa;">${c.dialCode}</span>
          </button>`).join('')}
      </div>`;
    document.body.appendChild(dlg);
    dlg.querySelectorAll('.country-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        _selectedCountry = COUNTRIES.find(c => c.code === btn.dataset.code);
        dlg.remove();
        render();
      });
    });
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _formatTime(isoStr) {
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

  // ── Tab switching (called from call-history.js initTabs) ──────────────────
  function initTab() {
    document.getElementById('tabPhone')?.addEventListener('click', () => {
      document.getElementById('chatsPanel')?.classList.add('hidden');
      document.getElementById('callsPanel')?.classList.add('hidden');
      const pp = document.getElementById('phonePanel');
      if (pp) { pp.classList.remove('hidden'); pp.style.display = 'block'; }
      document.querySelectorAll('.contacts-tab').forEach(t => t.classList.remove('active'));
      document.getElementById('tabPhone')?.classList.add('active');
      // ensure contacts screen is visible
      const cs = document.getElementById('contacts');
      if (cs) { cs.classList.remove('hidden'); cs.style.display = ''; }
      requestAnimationFrame(() => init());
    });
  }

  return { initTab, init };
})();
