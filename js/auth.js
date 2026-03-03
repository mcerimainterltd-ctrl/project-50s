/*
 * auth.js
 * Registration, login (with password), logout, DOB validation,
 * password-setup dialog for legacy users.
 * XamePage v2.1
 *
 * Depends on: config.js, state.js, storage.js, utils.js, ui.js,
 *             contacts.js (ensureSeedContacts, renderContacts),
 *             socket.js (connectSocket), audio.js (notifyWithFeedback),
 *             push.js (subscribeToPushNotifications),
 *             camera.js (initCameraFunctionality),
 *             webrtc.js (startHeartbeat)
 */

// ── handleLoginSuccess ────────────────────────────────────────────────────
function handleLoginSuccess(user) {
  USER = user;

  if (USER.profilePic) USER.profilePic = addCacheBuster(USER.profilePic);

  storage.set(KEYS.user, USER);
  setAvatarInitials();
  setTimeout(setAvatarInitials, 500);
  CONTACTS = ensureSeedContacts();
  DRAFTS   = storage.get(KEYS.drafts, {});

  [elLanding, elRegister, elLogin, elChat, elProfile, elStatus]
    .forEach(s => s?.classList.add('hidden'));

  show(elContacts);
  initCameraFunctionality();

  try {
    connectSocket();
    startHeartbeat();
    subscribeToPushNotifications();
  } catch (err) {
    console.error('Failed to connect socket:', err);
    showNotification('Connected but real-time features may be limited.');
  }

  renderContacts();
}

// ── init (called by app.js as fallback) ───────────────────────────────────
function init() {
  const user = storage.get(KEYS.user);
  if (user && user.xameId) handleLoginSuccess(user);
  else show(elLanding);
}

// ── DOB helpers ───────────────────────────────────────────────────────────
const updateHiddenDOB = () => {
  if (!dobDayInput || !dobMonthInput || !dobYearInput || !dobHiddenDateInput) return;
  const day   = dobDayInput.value.trim().padStart(2, '0');
  const month = dobMonthInput.value.trim().padStart(2, '0');
  const year  = dobYearInput.value.trim();
  if (year.length === 4 && day.length === 2 && month.length === 2) {
    dobHiddenDateInput.value = `${year}-${month}-${day}`;
  } else {
    dobHiddenDateInput.value = '';
  }
};

const handleDateSegmentInput = (currentInput, maxLength, nextInput) => {
  let value = currentInput.value.replace(/[^0-9]/g, '');
  if (value.length > maxLength) value = value.slice(0, maxLength);
  currentInput.value = value;
  if (value.length === maxLength && nextInput) nextInput.focus();
  updateHiddenDOB();
};

const NUMERIC_KEYS_ALLOWED = ['Backspace','Delete','Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];

if (dobDayInput) {
  dobDayInput.addEventListener('input', () => handleDateSegmentInput(dobDayInput, 2, dobMonthInput));
  dobDayInput.addEventListener('blur', () => {
    const v = parseInt(dobDayInput.value, 10);
    if (dobDayInput.value !== '' && (isNaN(v) || v < 1 || v > 31)) {
      dobDayInput.value = ''; dobDayInput.classList.add('input-error');
      if (dobHiddenDateInput) dobHiddenDateInput.value = '';
    } else { dobDayInput.classList.remove('input-error'); }
    updateHiddenDOB();
  });
  dobDayInput.addEventListener('keydown', (e) => { if (!NUMERIC_KEYS_ALLOWED.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault(); });
}

if (dobMonthInput) {
  dobMonthInput.addEventListener('input', () => handleDateSegmentInput(dobMonthInput, 2, dobYearInput));
  dobMonthInput.addEventListener('blur', () => {
    const v = parseInt(dobMonthInput.value, 10);
    if (dobMonthInput.value !== '' && (isNaN(v) || v < 1 || v > 12)) {
      dobMonthInput.value = ''; dobMonthInput.classList.add('input-error');
      if (dobHiddenDateInput) dobHiddenDateInput.value = '';
    } else { dobMonthInput.classList.remove('input-error'); }
    updateHiddenDOB();
  });
  dobMonthInput.addEventListener('keydown', (e) => { if (!NUMERIC_KEYS_ALLOWED.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault(); });
}

if (dobYearInput) {
  dobYearInput.addEventListener('input', () => handleDateSegmentInput(dobYearInput, 4, null));
  dobYearInput.addEventListener('blur', () => {
    const v = parseInt(dobYearInput.value, 10);
    const currentYear = new Date().getFullYear();
    if (dobYearInput.value !== '' && (isNaN(v) || v < 1900 || v > currentYear)) {
      dobYearInput.value = ''; dobYearInput.classList.add('input-error');
      if (dobHiddenDateInput) dobHiddenDateInput.value = '';
    } else { dobYearInput.classList.remove('input-error'); }
    updateHiddenDOB();
  });
  dobYearInput.addEventListener('keydown', (e) => { if (!NUMERIC_KEYS_ALLOWED.includes(e.key) && !/^\d$/.test(e.key)) e.preventDefault(); });
}

[dobDayInput, dobMonthInput, dobYearInput].forEach(input => {
  input?.addEventListener('input', () => {
    input.classList.remove('input-error');
    if (dobErrorElement) { dobErrorElement.style.display = 'none'; dobErrorElement.textContent = ''; }
  });
});

// ── Password-setup dialog (legacy users without a password) ───────────────
function renderPasswordSetupDialog(userData) {
  const wrap = document.createElement('div');
  wrap.className = 'dialog-backdrop';
  wrap.innerHTML = `
    <div class="dialog fade-in" style="max-width:400px;">
      <h3>🔐 Set Your Password</h3>
      <p class="subtitle" style="margin:10px 0;color:#666;">
        Welcome back, ${escapeHtml(userData.firstName)}!<br>
        Please set a password to secure your account.
      </p>
      <div class="row" style="margin:16px 0;">
        <label for="setupPasswordInput" style="display:block;margin-bottom:5px;font-weight:500;">New Password</label>
        <input id="setupPasswordInput" class="input" type="password" placeholder="Minimum 8 characters" minlength="8" autocomplete="new-password"/>
      </div>
      <div class="row" style="margin-bottom:16px;">
        <label for="setupConfirmPasswordInput" style="display:block;margin-bottom:5px;font-weight:500;">Confirm Password</label>
        <input id="setupConfirmPasswordInput" class="input" type="password" placeholder="Re-enter password" minlength="8" autocomplete="new-password"/>
      </div>
      <div class="password-requirements" style="font-size:12px;color:#666;margin-bottom:16px;">
        <p style="margin:5px 0;">Password must contain:</p>
        <ul style="margin:5px 0;padding-left:20px;">
          <li>At least 8 characters</li>
          <li>One uppercase letter</li>
          <li>One lowercase letter</li>
          <li>One number</li>
          <li>One special character</li>
        </ul>
      </div>
      <div class="row" style="display:flex;gap:10px;">
        <button class="btn secondary" id="cancelPasswordBtn" style="flex:1;">Cancel</button>
        <button class="btn primary"   id="savePasswordBtn"   style="flex:1;">Set Password</button>
      </div>
      <div id="passwordFeedback" class="feedback-message" style="margin-top:10px;color:#dc3545;"></div>
    </div>
  `;

  const saveBtn      = wrap.querySelector('#savePasswordBtn');
  const cancelBtn    = wrap.querySelector('#cancelPasswordBtn');
  const passwordInput = wrap.querySelector('#setupPasswordInput');
  const confirmInput  = wrap.querySelector('#setupConfirmPasswordInput');
  const feedbackEl   = wrap.querySelector('#passwordFeedback');

  cancelBtn.addEventListener('click', () => { closeDialog(); show(elLogin); });

  saveBtn.addEventListener('click', async () => {
    const password = passwordInput.value;
    const confirm  = confirmInput.value;
    feedbackEl.textContent = '';
    feedbackEl.style.color = '#dc3545';

    if (!password || password.length < 8) {
      feedbackEl.textContent = '❌ Password must be at least 8 characters.';
      passwordInput.focus(); return;
    }
    if (password !== confirm) {
      feedbackEl.textContent = '❌ Passwords do not match.';
      confirmInput.value = ''; confirmInput.focus(); return;
    }
    const validation = validatePassword(password);
    if (!validation.valid) { feedbackEl.innerHTML = '❌ ' + validation.errors.join('<br>'); return; }

    saveBtn.disabled = true; saveBtn.textContent = 'Setting password...';
    feedbackEl.textContent = 'Please wait...'; feedbackEl.style.color = '#007bff';

    try {
      const response = await fetch('/api/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xameId: userData.xameId, newPassword: password }),
      });
      const data = await response.json();
      if (data.success) {
        feedbackEl.textContent = '✅ Password set successfully!'; feedbackEl.style.color = '#28a745';
        setTimeout(() => {
          closeDialog(); show(elLogin);
          if (loginXameIdInput) {
            loginXameIdInput.value = userData.xameId;
            document.getElementById('loginPasswordInput')?.focus();
          }
          showNotification('✅ Password set! Please log in with your new password.');
        }, 1500);
      } else {
        feedbackEl.textContent = '❌ ' + (data.message || 'Failed to set password.');
        feedbackEl.style.color = '#dc3545';
        saveBtn.disabled = false; saveBtn.textContent = 'Set Password';
      }
    } catch (err) {
      console.error('Password setup error:', err);
      feedbackEl.textContent = '❌ Network error. Please check your connection.';
      feedbackEl.style.color = '#dc3545';
      saveBtn.disabled = false; saveBtn.textContent = 'Set Password';
    }
  });

  [passwordInput, confirmInput].forEach(input => {
    input.addEventListener('keypress', (e) => { if (e.key === 'Enter') saveBtn.click(); });
  });

  return wrap;
}

// ── Event listeners wired in setupEventListeners() (app.js) ──────────────
// Registration, login, back-to-landing — all attached in app.js/setupEventListeners
// to keep DOM ready guarantees consistent.
