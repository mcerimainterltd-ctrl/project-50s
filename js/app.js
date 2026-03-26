/*
 * app.js
 * Application bootstrap: setupEventListeners, bootstrapApp.
 * XamePage v2.1
 *
 * Depends on: ALL other modules. Load this last (or after main.js).
 */

//  Global error reporters (early) 
console.log(' XamePage script START');
window.addEventListener('error', (e) => {
  console.error(' CRITICAL ERROR:', e.message, e.filename, e.lineno);
});

//  Environment info 
console.log('Protocol:', window.location.protocol);
console.log('Capacitor available:', !!window.Capacitor);
console.log('Is native:', window.Capacitor?.isNativePlatform?.());
console.log(' Server URL:', serverURL);
console.log(' Platform:', isPackagedApp ? 'Capacitor Native App' : 'Web/PWA');

//  setupEventListeners 
function setupEventListeners() {
  console.log(' Setting up event listeners...');

  // Navigation
  signUpBtn?.addEventListener('click',        () => { console.log('Sign up button clicked');            show(elRegister); });
  signInBtn?.addEventListener('click',        () => { console.log('Sign in button clicked');            show(elLogin);    });
  backToLandingBtn?.addEventListener('click', () => { console.log('Back to landing (from register)'); show(elLanding);  });
  backToLandingBtn2?.addEventListener('click',() => { console.log('Back to landing (from login)');    show(elLanding);  });

  //  Registration form 
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const firstName = firstNameInput?.value.trim();
    const lastName  = lastNameInput?.value.trim();
    const dobValue  = dobHiddenDateInput?.value.trim();

    const passwordField  = document.getElementById('registerPasswordInput');
    const password       = passwordField?.value;

    if (!firstName || firstName.length < 2) { showNotification('First name must be at least 2 characters.'); return; }
    if (!lastName  || lastName.length  < 2) { showNotification('Last name must be at least 2 characters.');  return; }

    if (!dobValue || !isValidISO(dobValue)) {
      if (dobErrorElement) { dobErrorElement.textContent = 'Please enter a valid date of birth.'; dobErrorElement.style.display = 'block'; }
      showNotification('Please enter a valid date of birth.');
      return;
    }

    if (password) {
      const validation = validatePassword(password);
      if (!validation.valid) { showNotification(validation.errors[0]); return; }
    }

    const submitBtn = registerForm.querySelector('[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating account...'; }

    try {
      const body = { firstName, lastName, dob: dobValue };
      if (password) body.password = password;

      const response = await fetch(serverURL+'/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const ct = response.headers.get('content-type') || '';
      if (!ct.includes('application/json')) throw new Error('No internet connection');
      const result = await response.json();

      if (result.success) {
        showNotification(`Account created! Your Xame-ID: ${result.user.xameId}`);
        handleLoginSuccess(result.user);
      } else {
        showNotification(result.message || 'Registration failed. Please try again.');
      }
    } catch (err) {
      console.error('Registration error:', err);
      showNotification('Registration failed: ' + err.message);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Account'; }
    }
  });

  //  Login form 
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    console.log(' Login form submitted');

    if (!loginXameIdInput) { console.error('Login input not found'); return; }

    const loginPasswordInput = document.getElementById('loginPasswordInput');
    if (!loginPasswordInput) { console.error('Password input not found'); return; }

    const xameId   = loginXameIdInput.value.trim();
    const password = loginPasswordInput.value;

    if (!xameId)    { showNotification('Please enter your Xame-ID.'); return; }
    if (!password)  { showNotification('Please enter your password.'); return; }

    console.log(' Attempting login for:', xameId);

    try {
      // Step 1: Check if user exists
      const checkResponse = await fetch(serverURL+'/api/get-user-name', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xameId }),
      });
      if (!checkResponse.ok) throw new Error(`Server error: ${checkResponse.status}`);
      const ct1 = checkResponse.headers.get('content-type') || '';
      if (!ct1.includes('application/json')) throw new Error('No internet connection');
      const checkResult = await checkResponse.json();

      if (!checkResult.success) { showNotification(checkResult.message || 'Login failed. Please check your Xame-ID.'); return; }

      const userName    = checkResult.user.firstName + ' ' + checkResult.user.lastName;
      const isConfirmed = confirm(`Login as ${userName}?`);
      if (!isConfirmed) return;

      // Step 2: Check if switching users
      if (USER && USER.xameId !== xameId) {
        if (!confirm('Logging in as a different user will sign you out. Do you want to continue?')) return;
      }

      // Step 3: Login with password
      const loginResponse = await fetch(serverURL+'/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xameId, password }),
      });
      if (!loginResponse.ok) throw new Error(`Server error: ${loginResponse.status}`);
      const ct2 = loginResponse.headers.get('content-type') || '';
      if (!ct2.includes('application/json')) throw new Error('No internet connection');
      const loginResult = await loginResponse.json();

      if (loginResult.success) {
        console.log(' Login successful for:', xameId);
        showNotification(`Welcome back, ${loginResult.user.firstName}!`);
        loginPasswordInput.value = '';
        handleLoginSuccess(loginResult.user);

      } else if (loginResult.requiresPasswordSetup) {
        // Legacy user: no password set yet
        openDialog(renderPasswordSetupDialog(checkResult.user));

      } else {
        showNotification(loginResult.message || 'Login failed. Please check your credentials.');
      }
    } catch (err) {
      console.error('Login error:', err);
      showNotification('Login failed: ' + err.message);
    }
  });
}

//  bootstrapApp 
function bootstrapApp() {
  console.log(' Bootstrapping XamePage v' + APP_VERSION);

  // 1) Warm memory cache from localStorage
  initializeMemoryFromPersistent();
  // Update unread badge immediately after storage is loaded
  if (typeof updateTotalUnreadBadge === 'function') updateTotalUnreadBadge();

  // 2) Ensure global state is initialised
  window.CONTACTS    = storage.get(KEYS.contacts, []);
  window.DRAFTS      = storage.get(KEYS.drafts, {});
  window.CHAT_HISTORY = window.CHAT_HISTORY || {};
  window.RESOURCES   = window.RESOURCES    || { wavesurfers: new Map() };

  // 3) Initialise audio elements
  initializeAudioElements();

  // 4) Attach all event listeners
  setupEventListeners();
  ensurePlaceholderStyles();

  // 5) Initialise new modules
  if (typeof settingsModule    !== 'undefined') settingsModule.init();
  if (typeof themeModule       !== 'undefined') themeModule.init();
  if (typeof callHistoryModule !== 'undefined') callHistoryModule.initTabs();

  // 6) Restore previous session or show landing
  const savedUser = storage.get(KEYS.user);
  if (savedUser?.xameId) {
    console.log(' Restoring session for:', savedUser.xameId);
    handleLoginSuccess(savedUser);
  } else {
    console.log(' No saved session - showing landing page');
    show(elLanding);
  }
}

//  DOMContentLoaded / Cordova device ready 
document.addEventListener('DOMContentLoaded', bootstrapApp);
document.addEventListener('deviceready', () => {
  console.log(' Cordova device ready');
  bootstrapApp();
});
