// ── XamePage App Lock ─────────────────────────────────────────────────────
const appLock = (() => {
  const LOCK_KEY     = 'xame:applock:pin';
  const ENABLED_KEY  = 'xame:applock:enabled';
  const ATTEMPTS_KEY = 'xame:applock:attempts';
  const LOCKOUT_KEY  = 'xame:applock:lockout';
  const DELAY_KEY    = 'xame:applock:delay'; // ms before locking
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS   = 30000; // 30 seconds

  let _locked = false;
  let _biometricAvailable = false;
  let _overlay = null;

  // Check biometric availability
  function checkBiometric() {
    if (window.AndroidBridge?.checkBiometricAvailable) {
      window.onBiometricAvailable = (available) => { _biometricAvailable = available; };
      window.AndroidBridge.checkBiometricAvailable();
    }
  }

  function isEnabled() { return persistentStorage.get(ENABLED_KEY) === true; }
  function getPin()    { return persistentStorage.get(LOCK_KEY); }

  function lock() {
    if (!isEnabled() || !getPin()) return;
    _locked = true;
    showLockScreen();
  }

  function unlock(onSuccess) {
    _locked = false;
    persistentStorage.set(ATTEMPTS_KEY, 0);
    if (_overlay) { _overlay.remove(); _overlay = null; }
    if (typeof onSuccess === 'function') onSuccess();
  }

  function showLockScreen(onSuccess) {
    if (_overlay) return;
    // Always recheck biometric then render
    if (window.AndroidBridge?.checkBiometricAvailable) {
      window.onBiometricAvailable = (available) => {
        _biometricAvailable = available;
        _renderLockScreen(onSuccess);
      };
      window.AndroidBridge.checkBiometricAvailable();
      return; // wait for callback
    }
    _renderLockScreen(onSuccess);
  }

  function _renderLockScreen(onSuccess) {
    if (_overlay) return;
    const lockout = persistentStorage.get(LOCKOUT_KEY);
    const isLockedOut = lockout && Date.now() < lockout;

    _overlay = document.createElement('div');
    _overlay.id = 'appLockOverlay';
    _overlay.style.cssText = 'position:fixed;inset:0;background:#0D1520;z-index:99998;display:flex;flex-direction:column;align-items:center;justify-content:center;';
    _overlay.innerHTML = `
      <div style="text-align:center;max-width:320px;width:90%;padding:32px;">
        <div style="font-size:48px;margin-bottom:16px;">🔐</div>
        <h2 style="color:#fff;font-size:22px;font-weight:700;margin-bottom:8px;">XamePage Locked</h2>
        <p style="color:#7A9BB5;font-size:14px;margin-bottom:32px;">Enter your PIN to continue</p>
        <div id="pinDots" style="display:flex;justify-content:center;gap:12px;margin-bottom:24px;">
          ${[0,1,2,3,4,5].map(i => `<div class="pin-dot" style="width:14px;height:14px;border-radius:50%;background:rgba(255,255,255,0.2);transition:background 0.2s;"></div>`).join('')}
        </div>
        <div id="lockError" style="color:#e53935;font-size:13px;margin-bottom:16px;min-height:18px;"></div>
        ${isLockedOut ? `<p style="color:#e53935;font-size:13px;">Too many attempts. Try again in <span id="lockoutTimer">30</span>s</p>` : ''}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:240px;margin:0 auto 24px;">
          ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(n => `
            <button class="pin-key" data-val="${n}" style="background:rgba(255,255,255,0.08);border:none;color:#fff;font-size:22px;font-weight:600;padding:18px;border-radius:12px;cursor:pointer;${n===''?'visibility:hidden;':''}transition:background 0.15s;">
              ${n}
            </button>`).join('')}
        </div>
        ${_biometricAvailable ? `<button id="biometricBtn" style="background:none;border:1px solid rgba(0,176,160,0.4);color:#00B0A0;padding:10px 24px;border-radius:100px;font-size:14px;cursor:pointer;margin-bottom:16px;">👆 Use Fingerprint</button><br>` : ''}
        <button id="forgotPinBtn" style="background:none;border:none;color:#7A9BB5;font-size:13px;cursor:pointer;text-decoration:underline;margin-top:8px;">Forgot PIN?</button>
      </div>
    `;
    document.body.appendChild(_overlay);

    let enteredPin = '';
    const dots = _overlay.querySelectorAll('.pin-dot');
    const errorEl = _overlay.querySelector('#lockError');

    function updateDots() {
      dots.forEach((d, i) => {
        d.style.background = i < enteredPin.length ? '#00B0A0' : 'rgba(255,255,255,0.2)';
      });
    }

    function checkPin() {
      const stored = getPin();
      const attempts = (persistentStorage.get(ATTEMPTS_KEY) || 0) + 1;
      if (enteredPin === stored) {
        unlock(onSuccess);
      } else {
        persistentStorage.set(ATTEMPTS_KEY, attempts);
        enteredPin = '';
        updateDots();
        if (attempts >= MAX_ATTEMPTS) {
          persistentStorage.set(LOCKOUT_KEY, Date.now() + LOCKOUT_MS);
          persistentStorage.set(ATTEMPTS_KEY, 0);
          errorEl.textContent = 'Too many attempts. Locked for 30 seconds.';
          _overlay.querySelectorAll('.pin-key').forEach(k => k.disabled = true);
          let remaining = 30;
          const timer = setInterval(() => {
            remaining--;
            const el = _overlay.querySelector('#lockoutTimer');
            if (el) el.textContent = remaining;
            if (remaining <= 0) {
              clearInterval(timer);
              errorEl.textContent = '';
              _overlay.querySelectorAll('.pin-key').forEach(k => k.disabled = false);
            }
          }, 1000);
        } else {
          errorEl.textContent = `Incorrect PIN. ${MAX_ATTEMPTS - attempts} attempts remaining.`;
        }
      }
    }

    _overlay.querySelectorAll('.pin-key').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.val;
        if (val === '⌫') {
          enteredPin = enteredPin.slice(0, -1);
        } else if (val !== '' && enteredPin.length < 6) {
          enteredPin += val;
          if (enteredPin.length === getPin()?.length) {
            setTimeout(checkPin, 100);
          }
        }
        updateDots();
      });
      btn.addEventListener('mousedown', () => btn.style.background = 'rgba(0,176,160,0.3)');
      btn.addEventListener('mouseup', () => btn.style.background = 'rgba(255,255,255,0.08)');
    });

    // Biometric
    _overlay.querySelector('#biometricBtn')?.addEventListener('click', () => {
      window.onBiometricSuccess = () => unlock(onSuccess);
      window.onBiometricFailed = () => { errorEl.textContent = 'Biometric failed. Use PIN.'; };
      window.onBiometricError = (msg) => { if (!msg.includes('cancel')) errorEl.textContent = 'Biometric error. Use PIN.'; };
      window.AndroidBridge?.authenticateBiometric('Unlock XamePage');
    });

    // Auto-trigger biometric on lock screen open
    if (_biometricAvailable) {
      setTimeout(() => {
        window.onBiometricSuccess = () => unlock(onSuccess);
        window.onBiometricFailed = () => {};
        window.onBiometricError = () => {};
        window.AndroidBridge?.authenticateBiometric('Unlock XamePage');
      }, 500);
    }

    // Forgot PIN
    _overlay.querySelector('#forgotPinBtn')?.addEventListener('click', () => {
      if (confirm('Reset PIN using your XamePage password?')) {
        unlock();
        persistentStorage.set(LOCK_KEY, null);
        persistentStorage.set(ENABLED_KEY, false);
        showNotification('PIN removed. Set a new PIN in Settings.');
      }
    });
  }

  } // end _renderLockScreen

  function showSetupDialog() {
    const existing = document.getElementById('pinSetupDialog');
    if (existing) existing.remove();
    const enabled = isEnabled();
    const dlg = document.createElement('div');
    dlg.id = 'pinSetupDialog';
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
    dlg.innerHTML = `
      <div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h3 style="font-size:17px;font-weight:700;color:#fff;">🔐 App Lock PIN</h3>
          <button id="closePinDlg" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">✕</button>
        </div>
        <p style="font-size:13px;color:#aaa;margin-bottom:20px;line-height:1.6;">Set a PIN to lock the app when it goes to background. Supports fingerprint/biometric unlock.</p>
        ${enabled ? `
          <div style="margin-bottom:20px;">
            <label style="font-size:12px;color:#aaa;display:block;margin-bottom:8px;">Lock after</label>
            <select id="lockDelaySelect" style="width:100%;padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:14px;outline:none;">
              <option value="0">Immediately</option>
              <option value="30000">30 seconds</option>
              <option value="60000">1 minute</option>
              <option value="300000">5 minutes</option>
              <option value="1800000">30 minutes</option>
              <option value="-1">Never (manual only)</option>
            </select>
          </div>
          <button id="disablePin" style="width:100%;padding:14px;background:#e53935;border:none;border-radius:12px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;margin-bottom:12px;">
            Disable App Lock
          </button>
          <button id="changePin" style="width:100%;padding:14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:#fff;font-size:15px;cursor:pointer;">
            Change PIN
          </button>
        ` : `
          <div style="margin-bottom:16px;">
            <label style="font-size:12px;color:#aaa;display:block;margin-bottom:6px;">Enter PIN (4-6 digits)</label>
            <input id="newPinInput" type="password" inputmode="numeric" maxlength="6" placeholder="Enter PIN"
              style="width:100%;padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:18px;text-align:center;letter-spacing:8px;outline:none;"/>
          </div>
          <div style="margin-bottom:20px;">
            <label style="font-size:12px;color:#aaa;display:block;margin-bottom:6px;">Confirm PIN</label>
            <input id="confirmPinInput" type="password" inputmode="numeric" maxlength="6" placeholder="Confirm PIN"
              style="width:100%;padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:18px;text-align:center;letter-spacing:8px;outline:none;"/>
          </div>
          <button id="enablePin" style="width:100%;padding:14px;background:#00B0A0;border:none;border-radius:12px;color:#000;font-size:15px;font-weight:700;cursor:pointer;">
            Enable App Lock
          </button>
        `}
      </div>
    `;
    document.body.appendChild(dlg);
    dlg.querySelector('#closePinDlg').onclick = () => dlg.remove();
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

    const delaySelect = dlg.querySelector('#lockDelaySelect');
    if (delaySelect) {
      delaySelect.value = String(getLockDelay());
      if (!delaySelect.value) delaySelect.value = '60000';
      delaySelect.addEventListener('change', () => {
        persistentStorage.set(DELAY_KEY, parseInt(delaySelect.value));
        showNotification('Lock delay updated.');
      });
    }

    dlg.querySelector('#enablePin')?.addEventListener('click', () => {
      const pin = dlg.querySelector('#newPinInput').value.trim();
      const confirm = dlg.querySelector('#confirmPinInput').value.trim();
      if (pin.length < 4) { showNotification('PIN must be at least 4 digits.'); return; }
      if (pin !== confirm) { showNotification('PINs do not match.'); return; }
      persistentStorage.set(LOCK_KEY, pin);
      persistentStorage.set(ENABLED_KEY, true);
      persistentStorage.set(ATTEMPTS_KEY, 0);
      showNotification('App Lock enabled successfully.');
      dlg.remove();
    });

    dlg.querySelector('#disablePin')?.addEventListener('click', () => {
      dlg.remove();
      // Require current PIN before disabling
      showLockScreen(() => {
        persistentStorage.set(ENABLED_KEY, false);
        persistentStorage.set(LOCK_KEY, null);
        showNotification('App Lock disabled.');
      });
    });

    dlg.querySelector('#changePin')?.addEventListener('click', () => {
      dlg.remove();
      // Require current PIN before changing
      showLockScreen(() => {
        persistentStorage.set(ENABLED_KEY, false);
        showSetupDialog();
      });
    });
  }

  let _lockTimer = null;
  let _hiddenAt  = null;

  function getLockDelay() { return persistentStorage.get(DELAY_KEY) ?? 60000; } // default 1 min

  function _hasActiveCall() {
    const incomingOverlay  = document.getElementById('incomingCallOverlay');
    const videoCallOverlay = document.getElementById('videoCallOverlay');
    const incomingVisible  = incomingOverlay && !incomingOverlay.classList.contains('hidden');
    const callOngoing      = videoCallOverlay && !videoCallOverlay.classList.contains('hidden');
    return incomingVisible || callOngoing || (typeof window.callActive !== 'undefined' && window.callActive);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (!isEnabled()) return;
      _hiddenAt = Date.now();
    } else if (document.visibilityState === 'visible') {
      if (_hasActiveCall()) { _hiddenAt = null; return; }
      if (!isEnabled() || !getPin()) return;
      const delay = getLockDelay();
      const elapsed = _hiddenAt ? Date.now() - _hiddenAt : 0;
      if (delay === -1) return;
      if (elapsed >= delay) { _locked = true; showLockScreen(); }
      _hiddenAt = null;
    }
  });

  // Also handle Capacitor app state
  document.addEventListener('resume', () => {
    if (_hasActiveCall()) { clearTimeout(_lockTimer); _locked = false; return; }
    if (_locked && isEnabled()) setTimeout(() => { if (_locked) showLockScreen(); }, 300);
  });

  // Initialize — wait for biometric check before showing lock screen
  if (isEnabled() && getPin()) {
    _locked = true;
    if (window.AndroidBridge?.checkBiometricAvailable) {
      window.onBiometricAvailable = (available) => {
        _biometricAvailable = available;
        if (_locked) showLockScreen();
      };
      window.AndroidBridge.checkBiometricAvailable();
    } else {
      setTimeout(() => { if (_locked) showLockScreen(); }, 1000);
    }
  } else {
    checkBiometric();
  }

  return { lock, unlock, showSetupDialog, isEnabled };
})();
