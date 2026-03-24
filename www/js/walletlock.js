// ── XamePage Wallet Lock ──────────────────────────────────────────────────
const walletLock = (() => {
  const LOCK_KEY     = 'xame:walletlock:pin';
  const ENABLED_KEY  = 'xame:walletlock:enabled';
  const ATTEMPTS_KEY = 'xame:walletlock:attempts';
  const LOCKOUT_KEY  = 'xame:walletlock:lockout';
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS   = 30000;

  let _biometricAvailable = false;

  window.onBiometricAvailable = (available) => { _biometricAvailable = available; };
  if (window.AndroidBridge?.checkBiometricAvailable) window.AndroidBridge.checkBiometricAvailable();

  function isEnabled() { return persistentStorage.get(ENABLED_KEY) === true; }
  function getPin()    { return persistentStorage.get(LOCK_KEY); }

  function verify(onSuccess) {
    if (!isEnabled() || !getPin()) { onSuccess(); return; }

    // Auto-try biometric first
    if (_biometricAvailable) {
      window.onBiometricSuccess = () => { cleanup(); onSuccess(); };
      window.onBiometricFailed  = () => showPinPrompt(onSuccess);
      window.onBiometricError   = () => showPinPrompt(onSuccess);
      window.AndroidBridge?.authenticateBiometric('Unlock XamePay Wallet');
      return;
    }
    showPinPrompt(onSuccess);
  }

  function cleanup() {
    const overlay = document.getElementById('walletLockOverlay');
    if (overlay) overlay.remove();
  }

  function showPinPrompt(onSuccess) {
    cleanup();
    const lockout = persistentStorage.get(LOCKOUT_KEY);
    const isLockedOut = lockout && Date.now() < lockout;

    const overlay = document.createElement('div');
    overlay.id = 'walletLockOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:99998;display:flex;flex-direction:column;align-items:center;justify-content:center;';
    overlay.innerHTML = `
      <div style="text-align:center;max-width:320px;width:90%;padding:32px;background:#111E2E;border-radius:24px;border:1px solid rgba(0,176,160,0.2);">
        <div style="font-size:48px;margin-bottom:12px;">💰</div>
        <h2 style="color:#fff;font-size:20px;font-weight:700;margin-bottom:6px;">XamePay Wallet</h2>
        <p style="color:#7A9BB5;font-size:13px;margin-bottom:24px;">Enter your wallet PIN to continue</p>
        <div id="wPinDots" style="display:flex;justify-content:center;gap:12px;margin-bottom:16px;">
          ${[0,1,2,3,4,5].map(() => `<div class="wpin-dot" style="width:14px;height:14px;border-radius:50%;background:rgba(255,255,255,0.2);transition:background 0.2s;"></div>`).join('')}
        </div>
        <div id="wLockError" style="color:#e53935;font-size:13px;margin-bottom:12px;min-height:18px;"></div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:240px;margin:0 auto 20px;">
          ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(n => `
            <button class="wpin-key" data-val="${n}" style="background:rgba(255,255,255,0.08);border:none;color:#fff;font-size:20px;font-weight:600;padding:16px;border-radius:12px;cursor:pointer;${n===''?'visibility:hidden;':''}transition:background 0.15s;">
              ${n}
            </button>`).join('')}
        </div>
        ${_biometricAvailable ? `<button id="wBiometricBtn" style="background:none;border:1px solid rgba(0,176,160,0.4);color:#00B0A0;padding:8px 20px;border-radius:100px;font-size:13px;cursor:pointer;margin-bottom:12px;">👆 Use Fingerprint</button><br>` : ''}
        <button id="wCancelBtn" style="background:none;border:none;color:#7A9BB5;font-size:13px;cursor:pointer;margin-top:8px;">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);

    let enteredPin = '';
    const dots = overlay.querySelectorAll('.wpin-dot');
    const errorEl = overlay.querySelector('#wLockError');

    function updateDots() {
      dots.forEach((d, i) => {
        d.style.background = i < enteredPin.length ? '#00B0A0' : 'rgba(255,255,255,0.2)';
      });
    }

    function checkPin() {
      const stored = getPin();
      const attempts = (persistentStorage.get(ATTEMPTS_KEY) || 0) + 1;
      if (enteredPin === stored) {
        persistentStorage.set(ATTEMPTS_KEY, 0);
        cleanup();
        onSuccess();
      } else {
        persistentStorage.set(ATTEMPTS_KEY, attempts);
        enteredPin = '';
        updateDots();
        if (attempts >= MAX_ATTEMPTS) {
          persistentStorage.set(LOCKOUT_KEY, Date.now() + LOCKOUT_MS);
          persistentStorage.set(ATTEMPTS_KEY, 0);
          errorEl.textContent = 'Too many attempts. Locked for 30 seconds.';
          overlay.querySelectorAll('.wpin-key').forEach(k => k.disabled = true);
          setTimeout(() => {
            errorEl.textContent = '';
            overlay.querySelectorAll('.wpin-key').forEach(k => k.disabled = false);
          }, LOCKOUT_MS);
        } else {
          errorEl.textContent = `Incorrect PIN. ${MAX_ATTEMPTS - attempts} attempts remaining.`;
        }
      }
    }

    overlay.querySelectorAll('.wpin-key').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.val;
        if (val === '⌫') {
          enteredPin = enteredPin.slice(0, -1);
        } else if (val !== '' && enteredPin.length < 6) {
          enteredPin += val;
          if (enteredPin.length === getPin()?.length) setTimeout(checkPin, 100);
        }
        updateDots();
      });
      btn.addEventListener('mousedown', () => btn.style.background = 'rgba(0,176,160,0.3)');
      btn.addEventListener('mouseup', () => btn.style.background = 'rgba(255,255,255,0.08)');
    });

    overlay.querySelector('#wBiometricBtn')?.addEventListener('click', () => {
      window.onBiometricSuccess = () => { cleanup(); onSuccess(); };
      window.onBiometricFailed  = () => { errorEl.textContent = 'Biometric failed. Use PIN.'; };
      window.onBiometricError   = () => { errorEl.textContent = 'Biometric error. Use PIN.'; };
      window.AndroidBridge?.authenticateBiometric('Unlock XamePay Wallet');
    });

    overlay.querySelector('#wCancelBtn')?.addEventListener('click', () => {
      cleanup();
      // Switch back to chats tab
      document.getElementById('tabChats')?.click();
    });
  }

  function showSetupDialog() {
    const existing = document.getElementById('walletPinSetupDialog');
    if (existing) existing.remove();
    const enabled = isEnabled();
    const dlg = document.createElement('div');
    dlg.id = 'walletPinSetupDialog';
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    dlg.innerHTML = `
      <div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h3 style="font-size:17px;font-weight:700;color:#fff;">💰 Wallet PIN</h3>
          <button id="closeWalletPinDlg" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">✕</button>
        </div>
        <p style="font-size:13px;color:#aaa;margin-bottom:20px;line-height:1.6;">Protect your XamePay wallet with a separate PIN. Required every time you access the Pay tab.</p>
        ${enabled ? `
          <button id="disableWalletPin" style="width:100%;padding:14px;background:#e53935;border:none;border-radius:12px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:12px;">
            Disable Wallet PIN
          </button>
          <button id="changeWalletPin" style="width:100%;padding:14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:15px;cursor:pointer;">
            Change Wallet PIN
          </button>
        ` : `
          <div style="margin-bottom:16px;">
            <label style="font-size:12px;color:#aaa;display:block;margin-bottom:6px;">Enter Wallet PIN (4-6 digits)</label>
            <input id="newWalletPin" type="password" inputmode="numeric" maxlength="6" placeholder="Enter PIN"
              style="width:100%;padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:18px;text-align:center;letter-spacing:8px;outline:none;"/>
          </div>
          <div style="margin-bottom:20px;">
            <label style="font-size:12px;color:#aaa;display:block;margin-bottom:6px;">Confirm Wallet PIN</label>
            <input id="confirmWalletPin" type="password" inputmode="numeric" maxlength="6" placeholder="Confirm PIN"
              style="width:100%;padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:18px;text-align:center;letter-spacing:8px;outline:none;"/>
          </div>
          <button id="enableWalletPin" style="width:100%;padding:14px;background:#00B0A0;border:none;border-radius:12px;color:#000;font-size:15px;font-weight:700;cursor:pointer;">
            Enable Wallet PIN
          </button>
        `}
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.querySelector('#closeWalletPinDlg').onclick = () => dlg.remove();
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

    dlg.querySelector('#enableWalletPin')?.addEventListener('click', () => {
      const pin = dlg.querySelector('#newWalletPin').value.trim();
      const confirm = dlg.querySelector('#confirmWalletPin').value.trim();
      if (pin.length < 4) { showNotification('PIN must be at least 4 digits.'); return; }
      if (pin !== confirm) { showNotification('PINs do not match.'); return; }
      persistentStorage.set(LOCK_KEY, pin);
      persistentStorage.set(ENABLED_KEY, true);
      persistentStorage.set(ATTEMPTS_KEY, 0);
      showNotification('Wallet PIN enabled successfully.');
      dlg.remove();
    });

    dlg.querySelector('#disableWalletPin')?.addEventListener('click', () => {
      if (!confirm('Disable Wallet PIN?')) return;
      persistentStorage.set(ENABLED_KEY, false);
      persistentStorage.set(LOCK_KEY, null);
      showNotification('Wallet PIN disabled.');
      dlg.remove();
    });

    dlg.querySelector('#changeWalletPin')?.addEventListener('click', () => {
      persistentStorage.set(ENABLED_KEY, false);
      dlg.remove();
      showSetupDialog();
    });
  }

  return { verify, isEnabled, showSetupDialog };
})();
