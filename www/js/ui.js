/*
 * ui.js
 * DOM element references, navigation helpers, dialog helpers,
 * composer helpers, upload-progress UI, image previews,
 * profile-placeholder styles.
 * XamePage v2.1
 *
 * Depends on: utils.js, state.js, config.js
 */

// ── Core screens ──────────────────────────────────────────────────────────
const elLanding  = $('#landing');
const elRegister = $('#register');
const elLogin    = $('#login');
const elContacts = $('#contacts');
const elChat     = $('#chat');
const elProfile  = $('#profileSection');
const elStatus   = $('#statusSection');

// Ensure profile section is active on load
document.getElementById('profileSection')?.classList.add('active');

// ── Landing / Auth buttons ────────────────────────────────────────────────
const signUpBtn         = $('#signUpBtn');
const signInBtn         = $('#signInBtn');
const backToLandingBtn  = $('#backToLandingBtn');
const backToLandingBtn2 = $('#backToLandingBtn2');

// ── Registration inputs ───────────────────────────────────────────────────
const firstNameInput     = $('#firstNameInput');
const lastNameInput      = $('#lastNameInput');
const dobDayInput        = $('#dobDay');
const dobMonthInput      = $('#dobMonth');
const dobYearInput       = $('#dobYear');
const dobHiddenDateInput = $('#dobHiddenDateInput');
const dobErrorElement    = $('#dobError');

if (dobHiddenDateInput) {
  try {
    dobHiddenDateInput.max = new Date().toISOString().slice(0, 10);
    dobHiddenDateInput.min = '1900-01-01';
  } catch (_) {}
}

// ── Auth forms ────────────────────────────────────────────────────────────
const registerForm    = $('#registerForm');
const loginForm       = $('#loginForm');
const loginXameIdInput = $('#loginXameIdInput');

// ── Contacts UI ───────────────────────────────────────────────────────────
const contactList    = $('#contactList');
const contactsCount  = $('#contactsCount');
const searchInput    = $('#searchInput');
const logoutBtn      = $('#logoutBtn');
const addContactBtn  = $('#addContactBtn');
const moreBtn        = $('#moreBtn');
const moreMenu       = $('#moreMenu');
const clearAllChatsBtn = $('#clearAllChatsBtn');

// ── Profile & header ──────────────────────────────────────────────────────
const avatarInitialsEl    = document.getElementById('avatarInitials');
const avatarBtn           = document.getElementById('avatarBtn');
const accountMenu         = document.getElementById('accountMenu');
const myStatusAvatarInitials = $('#myStatusAvatarInitials');

// ── Chat header ───────────────────────────────────────────────────────────
const elChatHeader        = $('#chat .header');
const elChatToolbar       = $('#chat .header .toolbar');
const elChatHeaderDetails = $('#chat .header .header-details');
const elChatHeaderButtonGroup = $('#chat .header .icon-btn-group');

// ── Chat area ─────────────────────────────────────────────────────────────
const backBtn      = $('#backBtn');
const chatName     = $('#chatName');
const chatSub      = $('#chatSub');
const messagesEl   = $('#messages');
const typingEl     = $('#typing');
const composer     = $('#composer');
const messageInput = $('#messageInput');
const sendBtn      = $('#sendBtn');
const layer        = $('#layer');

// ── Profile section ───────────────────────────────────────────────────────
const profileBackBtn       = $('#profileBackBtn');
const preferredNameInput   = $('#preferredName');
const profilePicInput      = $('#profilePic');
const profilePicPreview    = $('#profilePicPreview');
const saveProfileBtn       = $('#saveProfileBtn');
const removeProfilePicBtn  = $('#removeProfilePicBtn');
const hideNameCheckbox     = $('#hidePreferredNameSwitch');
const hidePicCheckbox      = $('#hideProfilePictureSwitch');
const xameIdDisplay        = $('#xameIdDisplay');

// ── Image crop modal ──────────────────────────────────────────────────────
const cropModal    = $('#cropModal');
const cropImage    = $('#cropImage');
const cropCancelBtn = $('#cropCancelBtn');
const cropSaveBtn  = $('#cropSaveBtn');

// ── Status section ────────────────────────────────────────────────────────
const statusItem    = $('.status-item');
const statusBackBtn = $('#statusBackBtn');
const myStatusTime  = $('#myStatusTime');

// ── File / voice inputs ───────────────────────────────────────────────────
const fileInput        = $('#fileInput');
const attachBtn        = $('#attachBtn');
const micBtn           = $('#micBtn');
const voiceNoteControl = $('#voiceNoteControl');
const recordBtn        = $('#recordBtn');
const playBtn          = $('#playBtn');
const sendVoiceBtn     = $('#sendVoiceBtn');
const stopRecordBtn    = $('#stopRecordBtn');

// ── WebRTC overlays ───────────────────────────────────────────────────────
const videoCallOverlay  = $('#videoCallOverlay');
const remoteVideo       = $('#remoteVideo');
const localVideo        = $('#localVideo');
const cameraToggleBtn   = $('#cameraToggleBtn');
const micMuteBtn        = $('#micMuteBtn');
const cameraMuteBtn     = $('#cameraMuteBtn');
const loudSpeakerBtn    = $('#loudSpeakerBtn');
const exitCallBtn       = $('#exitCallBtn');
const incomingCallOverlay = $('#incomingCallOverlay');
const acceptCallBtn     = $('#acceptCallBtn');
const declineCallBtn    = $('#declineCallBtn');

// ─────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────
function show(section) {
  console.log('[show] called with:', section?.id, new Error().stack.split('\n')[2]);
  [elLanding, elRegister, elLogin, elContacts, elChat, elProfile, elStatus]
    .forEach(s => { if (s && s !== section) s.classList.add('hidden'); });
  if (section) {
    section.classList.remove('hidden');
    section.style.display = '';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Dialog helpers
// ─────────────────────────────────────────────────────────────────────────
function closeDialog() {
  if (layer) layer.innerHTML = '';
}

function openDialog(node) {
  if (!layer) return;
  layer.innerHTML = '';
  layer.appendChild(node);
  setTimeout(() => {
    const closeHandler = (e) => {
      if (!node.contains(e.target)) {
        closeDialog();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 0);
}

function openMenuDialog(node) {
  if (!layer) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  backdrop.appendChild(node);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeDialog(); });
  layer.innerHTML = '';
  layer.appendChild(backdrop);
}

// ─────────────────────────────────────────────────────────────────────────
// Composer helpers
// ─────────────────────────────────────────────────────────────────────────
function isOnlyEmojis(str) {
  const trimmed = str.trim();
  if (!trimmed) return false;
  const emojiRegex = /^[\p{Emoji}\s]+$/u;
  return emojiRegex.test(trimmed);
}

function updateComposerButtons() {
  if (!messageInput || !micBtn || !sendBtn) return;
  const val = messageInput.value;
  if (val.trim().length > 0) {
    micBtn.classList.add('hidden');
    sendBtn.classList.remove('hidden');
    // Show emoji quick-send hint if only emojis
    let emojiHint = document.getElementById('emojiQuickSend');
    if (isOnlyEmojis(val)) {
      if (!emojiHint) {
        emojiHint = document.createElement('div');
        emojiHint.id = 'emojiQuickSend';
        emojiHint.style.cssText = 'position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;font-size:11px;padding:4px 10px;border-radius:20px;white-space:nowrap;pointer-events:none;margin-bottom:4px;';
        emojiHint.textContent = '2x tap to send instantly';
        sendBtn.style.position = 'relative';
        sendBtn.parentElement.style.position = 'relative';
        sendBtn.parentElement.appendChild(emojiHint);
      }
    } else {
      emojiHint?.remove();
    }
  } else {
    micBtn.classList.remove('hidden');
    sendBtn.classList.add('hidden');
    document.getElementById('emojiQuickSend')?.remove();
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Upload-progress UI
// ─────────────────────────────────────────────────────────────────────────
function createUploadProgress(msgId, fileName) {
  const existing = document.getElementById(`upload-progress-${msgId}`);
  if (existing) existing.remove();

  const div = document.createElement('div');
  div.id        = `upload-progress-${msgId}`;
  div.className = 'upload-progress-indicator';
  div.innerHTML = `
    <div class="upload-info">
      <span class="upload-filename">${escapeHtml(fileName)}</span>
      <span class="upload-percentage">0%</span>
    </div>
    <div class="upload-progress-bar">
      <div class="upload-progress-fill" style="width:0%"></div>
    </div>
    <button class="cancel-upload-btn" data-msg-id="${escapeHtml(msgId)}">Cancel</button>
  `;

  if (composer) composer.insertAdjacentElement('beforebegin', div);

  div.querySelector('.cancel-upload-btn')?.addEventListener('click', () => {
    if (window.currentUpload) window.currentUpload.abort();
  });

  return div;
}

function updateUploadProgress(msgId, percentage) {
  const div = document.getElementById(`upload-progress-${msgId}`);
  if (!div) return;
  const fill = div.querySelector('.upload-progress-fill');
  const pct  = div.querySelector('.upload-percentage');
  if (fill) fill.style.width = `${percentage}%`;
  if (pct)  pct.textContent  = `${Math.round(percentage)}%`;
}

function removeUploadProgress(msgId) {
  document.getElementById(`upload-progress-${msgId}`)?.remove();
}

// ─────────────────────────────────────────────────────────────────────────
// Image preview before send
// ─────────────────────────────────────────────────────────────────────────
function showImagePreview(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const overlay = document.createElement('div');
      overlay.className = 'image-preview-overlay';
      overlay.innerHTML = `
        <div class="image-preview-dialog">
          <h3>Send Image?</h3>
          <img src="${e.target.result}" alt="Preview" style="max-height:45vh;object-fit:contain;">
          <div style="margin:10px 0;">
            <input type="text" id="imageCaptionInput" placeholder="Add a caption..." 
              style="width:100%;padding:10px;background:var(--color-input-bg,var(--dark-card));color:var(--text-primary);border:1px solid var(--divider-color);border-radius:20px;box-sizing:border-box;font-size:14px;">
          </div>
          <div style="margin:8px 0;">
            <button id="viewOnceToggle" data-on="false" style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:8px 14px;color:#fff;font-size:13px;cursor:pointer;">
              &#128065;&#65039; View Once: <span id="voStatus" style="color:#7a9bb5;font-weight:600;">OFF</span>
            </button>
          </div>
          <div class="preview-actions">
            <button class="btn secondary" id="cancelImageSend">Cancel</button>
            <button class="btn primary"   id="confirmImageSend">Send</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      // Focus caption input
      setTimeout(() => overlay.querySelector('#imageCaptionInput')?.focus(), 100);
      overlay.querySelector('#cancelImageSend').addEventListener('click', () => { overlay.remove(); resolve(false); });
      overlay.querySelector('#viewOnceToggle')?.addEventListener('click', () => {
        const btn = overlay.querySelector('#viewOnceToggle');
        const on = btn.dataset.on === 'true';
        btn.dataset.on = !on;
        const st = overlay.querySelector('#voStatus');
        st.textContent = !on ? 'ON' : 'OFF';
        st.style.color = !on ? '#00B0A0' : '#7a9bb5';
        btn.style.borderColor = !on ? 'rgba(0,176,160,0.5)' : 'rgba(255,255,255,0.1)';
      });
      overlay.querySelector('#confirmImageSend').addEventListener('click', () => {
        const caption = overlay.querySelector('#imageCaptionInput')?.value.trim() || '';
        const viewOnce = overlay.querySelector('#viewOnceToggle')?.dataset.on === 'true';
        overlay.remove();
        resolve({ send: true, caption, viewOnce });
      });
      // Allow Enter key to send
      overlay.querySelector('#imageCaptionInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const caption = e.target.value.trim() || '';
          const viewOnce = overlay.querySelector('#viewOnceToggle')?.dataset.on === 'true';
          overlay.remove();
          resolve({ send: true, caption, viewOnce });
        }
      });
    };
    reader.onerror = () => { console.error('Failed to read image file'); resolve(false); };
    reader.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Fullscreen image viewer
// ─────────────────────────────────────────────────────────────────────────
function openImageFullscreen(imageUrl, imageName) {
  const overlay = document.createElement('div');
  overlay.className = 'fullscreen-image-overlay';
  overlay.innerHTML = `
    <div class="fullscreen-image-container">
      <button class="close-fullscreen-btn">✕</button>
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(imageName)}">
      <div class="image-actions">
        <a href="${escapeHtml(imageUrl)}" download="${escapeHtml(imageName)}" class="btn secondary">Download</a>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('.close-fullscreen-btn')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ─────────────────────────────────────────────────────────────────────────
// Profile placeholder styles (injected once)
// ─────────────────────────────────────────────────────────────────────────
function ensurePlaceholderStyles() {
  if ($('#profile-placeholder-style')) return;
  const style = document.createElement('style');
  style.id = 'profile-placeholder-style';
  style.textContent = `
    .profile-placeholder {
      width:46px; height:46px; border-radius:50%; overflow:hidden; flex-shrink:0;
      display:flex; align-items:center; justify-content:center;
      background-color:#3e5163; color:white; font-size:20px;
      font-weight:bold; text-transform:uppercase;
    }
    .avatar-container .unread-count {
      position:absolute; bottom:-2px; right:-2px;
      background-color:#007bff; color:white; font-size:10px;
      font-weight:bold; border-radius:50%; width:20px; height:20px;
      display:flex; align-items:center; justify-content:center;
      border:2px solid white;
    }
    .avatar-container .unread-count.hidden { display:none; }
  `;
  document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────
// Avatar initials
// ─────────────────────────────────────────────────────────────────────────
function setAvatarInitials() {
  if (myStatusAvatarInitials) myStatusAvatarInitials.textContent = initialsOf(window.USER);
  if (xameIdDisplay) xameIdDisplay.textContent = window.USER?.xameId || '';

  if (avatarInitialsEl) {
    const u = (typeof USER !== 'undefined' ? USER : null) || {};
    let initials = '';
    if (u.firstName) initials += u.firstName[0];
    if (u.lastName)  initials += u.lastName[0];
    if (!initials && u.preferredName) initials = u.preferredName[0];
    if (!initials && u.xameId) initials = u.xameId[0];
    avatarInitialsEl.textContent = initials.toUpperCase() || '?';
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Sound / Vibration toggle buttons in chat header
// ─────────────────────────────────────────────────────────────────────────
function renderNotificationToggles() {
  if (!elChatHeader) return;
  elChatHeader.querySelector('.notif-toggles')?.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'notif-toggles';
  wrapper.style.cssText = 'display:flex;gap:8px;align-items:center;margin-left:8px;';

  const soundBtn = document.createElement('button');
  soundBtn.id        = 'toggleSoundBtn';
  soundBtn.className = 'icon-btn';
  soundBtn.title     = 'Toggle sound';
  soundBtn.innerHTML = soundOn ? '🔊' : '🔈';
  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    toggleSound(soundOn);
    soundBtn.innerHTML = soundOn ? '🔊' : '🔈';
    notifyWithFeedback(soundOn ? 'Sound enabled' : 'Sound muted', { sound: null, vibrate: false });
  });

  const vibeBtn = document.createElement('button');
  vibeBtn.id        = 'toggleVibrationBtn';
  vibeBtn.className = 'icon-btn';
  vibeBtn.title     = 'Toggle vibration';
  vibeBtn.innerHTML = vibrationOn ? '📳' : '🔕';
  vibeBtn.addEventListener('click', () => {
    vibrationOn = !vibrationOn;
    toggleVibration(vibrationOn);
    vibeBtn.innerHTML = vibrationOn ? '📳' : '🔕';
    notifyWithFeedback(vibrationOn ? 'Vibration enabled' : 'Vibration muted', { sound: null, vibrate: false });
    if (vibrationOn && 'vibrate' in navigator) {
      try { navigator.vibrate([0, 120]); } catch (e) { console.warn('Test vibration failed:', e); }
    }
  });

  wrapper.appendChild(soundBtn);
  wrapper.appendChild(vibeBtn);

  const btnGroup = elChatHeader.querySelector('.icon-btn-group');
  btnGroup ? btnGroup.insertAdjacentElement('afterend', wrapper) : elChatHeader.appendChild(wrapper);
}

function syncToggleUIWithStorage() {
  soundOn     = FEEDBACK.soundEnabled;
  vibrationOn = FEEDBACK.vibrationEnabled;
  const sb = document.getElementById('toggleSoundBtn');
  const vb = document.getElementById('toggleVibrationBtn');
  if (sb) sb.innerHTML = soundOn     ? '🔊' : '🔈';
  if (vb) vb.innerHTML = vibrationOn ? '📳' : '🔕';
}

document.addEventListener('DOMContentLoaded', () => { renderNotificationToggles(); syncToggleUIWithStorage(); });
document.addEventListener('deviceready',    () => { renderNotificationToggles(); syncToggleUIWithStorage(); });

// ─────────────────────────────────────────────────────────────────────────
// Status section
// ─────────────────────────────────────────────────────────────────────────
function showStatus() {
  show(elStatus);
  if (myStatusTime) myStatusTime.textContent = 'Last update: ' + fmtTime(now());
}

statusBackBtn?.addEventListener('click', () => show(elContacts));

// ─────────────────────────────────────────────────────────────────────────
// Account / More menus
// ─────────────────────────────────────────────────────────────────────────
moreBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  moreBtn.getAttribute('aria-expanded') === 'true' ? closeMenu() : openMenu();
});

function openMenu() {
  moreBtn.setAttribute('aria-expanded', 'true');
  const panel = document.createElement('div');
  panel.className = 'menu-panel fade-in';
  panel.innerHTML = `
    <div class="menu-item" id="exportData">Export chats (JSON)</div>
    <div class="menu-item" id="importData">Import chats (JSON)</div>
    <div class="menu-item" id="resetAll">Reset app</div>
  `;
  moreMenu?.appendChild(panel);
  panel.querySelector('#exportData')?.addEventListener('click', exportData);
  panel.querySelector('#importData')?.addEventListener('click', importDataDialog);
  panel.querySelector('#resetAll')?.addEventListener('click', () => {
    if (confirm('This will erase all contacts and chats. Proceed?')) resetAll();
  });
  document.addEventListener('click', function onAway(ev) {
    if (!moreMenu.contains(ev.target)) { closeMenu(); document.removeEventListener('click', onAway); }
  });
}

function closeMenu() {
  moreBtn.setAttribute('aria-expanded', 'false');
  moreMenu?.querySelector('.menu-panel')?.remove();
}

avatarBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  avatarBtn.getAttribute('aria-expanded') === 'true' ? closeAccountMenu() : openAccountMenu();
});

function openAccountMenu() {
  avatarBtn.setAttribute('aria-expanded', 'true');
  const panel = document.createElement('div');
  panel.className = 'menu-panel fade-in';
  panel.innerHTML = `
    <div class="menu-item" id="accountProfile">Profile</div>
    <div class="menu-item" id="accountSettings">Settings</div>
    <div class="menu-item" id="accountThemes">Themes</div>
    <div class="menu-item" id="accountGallery">🖼 My Gallery</div>
    <div class="menu-item" id="accountGroups">👥 Xame Groups</div>
    <div class="menu-item" id="accountBroadcast">📢 Mass Messaging</div>
    <div class="menu-item" id="accountSmsTemplates">💬 SMS Templates</div>
    <div class="menu-item" id="accountSessions">🔐 Active Sessions</div>
    <div class="menu-item" id="accountExtraSecurity">🛡️ Extra Security</div>
    <div class="menu-item" id="accountAppLock">🔐 App Lock PIN</div>
    <div class="menu-item" id="accountCallSchedule">📅 Call Schedule</div>
    <div class="menu-item" id="accountStealth" style="display:flex;align-items:center;justify-content:space-between">🕵️ Stealth Mode <span id="stealthBadge" style="font-size:11px;padding:2px 8px;border-radius:10px;background:rgba(255,255,255,0.1);color:#aaa">OFF</span></div>
  `;
  accountMenu?.appendChild(panel);
  panel.querySelector('#accountProfile')?.addEventListener('click', () => {
    closeAccountMenu();
    try { show(elProfile); loadProfileData(); initPersonalStatus(); console.log('✅ Profile page opened'); }
    catch (err) { console.error('❌ Failed to open profile:', err); showNotification('Failed to open profile. Please try again.'); }
  });
  panel.querySelector('#accountSettings')?.addEventListener('click', () => { closeAccountMenu(); if (typeof settingsModule !== 'undefined') settingsModule.showSettings(); });
  panel.querySelector('#accountThemes')?.addEventListener('click', () => { closeAccountMenu(); if (typeof themeModule !== 'undefined') themeModule.showThemePicker(); });
  panel.querySelector('#accountGallery')?.addEventListener('click', () => { closeAccountMenu(); if (typeof galleryModule !== 'undefined') galleryModule.open(); });
  panel.querySelector('#accountGroups')?.addEventListener('click', () => { closeAccountMenu(); if (typeof groupsModule !== 'undefined') { groupsModule.init().then(() => groupsModule.showGroupsList()); } });
  panel.querySelector('#accountBroadcast')?.addEventListener('click', () => { closeAccountMenu(); if (typeof broadcastModule !== 'undefined') { broadcastModule.init().then(() => broadcastModule.showBroadcastScreen()); } });
  panel.querySelector('#accountSmsTemplates')?.addEventListener('click', () => { closeAccountMenu(); if (typeof smsTemplates !== 'undefined') smsTemplates.showManageDialog(); });
  panel.querySelector('#accountSessions')?.addEventListener('click', () => { closeAccountMenu(); showActiveSessions(); });
  panel.querySelector('#accountExtraSecurity')?.addEventListener('click', () => { closeAccountMenu(); showExtraSecurityDialog(); });
  panel.querySelector('#accountAppLock')?.addEventListener('click', () => { closeAccountMenu(); appLock.showSetupDialog(); });
  // Stealth mode init
  const stealthBadge = panel.querySelector('#stealthBadge');
  const stealthOn = localStorage.getItem('xame:stealth') === 'true';
  if (stealthBadge) {
    stealthBadge.textContent = stealthOn ? 'ON' : 'OFF';
    stealthBadge.style.background = stealthOn ? 'rgba(0,200,150,0.3)' : 'rgba(255,255,255,0.1)';
    stealthBadge.style.color = stealthOn ? '#00c896' : '#aaa';
  }
  panel.querySelector('#accountStealth')?.addEventListener('click', () => {
    const isOn = localStorage.getItem('xame:stealth') === 'true';
    const next = !isOn;
    localStorage.setItem('xame:stealth', next);
    if (stealthBadge) {
      stealthBadge.textContent = next ? 'ON' : 'OFF';
      stealthBadge.style.background = next ? 'rgba(0,200,150,0.3)' : 'rgba(255,255,255,0.1)';
      stealthBadge.style.color = next ? '#00c896' : '#aaa';
    }
    if (next) {
      if (typeof stopHeartbeat === 'function') stopHeartbeat();
      if (typeof startStealthMode === 'function') startStealthMode();
      showNotification('🕵️ Stealth Mode ON — you appear offline');
    } else {
      if (typeof stopStealthMode === 'function') stopStealthMode();
      if (typeof startHeartbeat === 'function') startHeartbeat();
      if (socket?.connected && USER?.xameId) {
        socket.emit('user-online', { userId: USER.xameId, timestamp: Date.now() });
        socket.emit('request_online_users');
      }
      showNotification('Stealth Mode OFF — you appear online');
    }
  });

  panel.querySelector('#accountCallSchedule')?.addEventListener('click', () => {
    closeAccountMenu();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
    const sheet = document.createElement('div');
    sheet.style.cssText = 'background:var(--color-surface,#1e2733);border-radius:16px 16px 0 0;width:100%;max-height:60vh;display:flex;flex-direction:column;padding:16px';
    const title = document.createElement('h3');
    title.textContent = '📅 Schedule a Call';
    title.style.cssText = 'margin:0 0 12px;color:var(--text-primary,#fff);font-size:16px';
    const list = document.createElement('div');
    list.style.cssText = 'overflow-y:auto;flex:1';
    const contacts = CONTACTS.filter(c => c.id !== USER.xameId);
    contacts.forEach(contact => {
      const item = document.createElement('div');
      item.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 8px;border-radius:8px;cursor:pointer';
      item.innerHTML = `<div style="width:40px;height:40px;border-radius:50%;background:var(--color-primary,#00b0a0);display:flex;align-items:center;justify-content:center;font-weight:bold;color:#fff;flex-shrink:0;overflow:hidden">${contact.profilePic ? `<img src="${contact.profilePic}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : (contact.name||'?')[0].toUpperCase()}</div><span style="color:var(--text-primary,#fff);font-size:15px">${contact.name || contact.id}</span>`;
      item.addEventListener('mouseenter', () => item.style.background = 'rgba(255,255,255,0.08)');
      item.addEventListener('mouseleave', () => item.style.background = 'transparent');
      item.addEventListener('click', () => {
        document.body.removeChild(overlay);
        if (typeof callScheduleModule !== 'undefined') callScheduleModule.showScheduleCallDialog(contact.id, contact.name || contact.id);
      });
      list.appendChild(item);
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'margin-top:12px;padding:10px;border:none;border-radius:8px;background:rgba(255,255,255,0.1);color:var(--text-primary,#fff);font-size:15px;cursor:pointer;width:100%';
    cancelBtn.addEventListener('click', () => document.body.removeChild(overlay));
    sheet.appendChild(title);
    sheet.appendChild(list);
    sheet.appendChild(cancelBtn);
    overlay.appendChild(sheet);
    overlay.addEventListener('click', e => { if (e.target === overlay) document.body.removeChild(overlay); });
    document.body.appendChild(overlay);
  });
  const onAway = (ev) => { if (!accountMenu.contains(ev.target)) closeAccountMenu(); };
  setTimeout(() => document.addEventListener('click', onAway, { once: true }));
}

function closeAccountMenu() {
  avatarBtn.setAttribute('aria-expanded', 'false');
  accountMenu?.querySelector('.menu-panel')?.remove();
}

// ─────────────────────────────────────────────────────────────────────────
// Export / Import / Reset
// ─────────────────────────────────────────────────────────────────────────
function exportData() {
  const data = {
    user:     storage.get(KEYS.user),
    contacts: storage.get(KEYS.contacts, []),
    drafts:   storage.get(KEYS.drafts, {}),
    chats:    Object.fromEntries(
      storage.get(KEYS.contacts, []).map(c => [c.id, storage.get(KEYS.chat(c.id), [])])
    ),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url; a.download = 'xamepage-export.json'; a.click();
  URL.revokeObjectURL(url);
  closeMenu();
}

function importDataDialog() {
  const input  = document.createElement('input');
  input.type   = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== 'object') throw new Error('Invalid file');
        if (Array.isArray(data.contacts)) storage.set(KEYS.contacts, data.contacts);
        if (data.user)   storage.set(KEYS.user,   data.user);
        if (data.drafts) storage.set(KEYS.drafts, data.drafts);
        if (data.chats && typeof data.chats === 'object') {
          Object.entries(data.chats).forEach(([id, arr]) => storage.set(KEYS.chat(id), arr || []));
        }
        USER     = storage.get(KEYS.user);
        CONTACTS = storage.get(KEYS.contacts, []);
        DRAFTS   = storage.get(KEYS.drafts, {});
        renderContacts();
        alert('Import complete.');
      } catch (err) { alert('Import failed: ' + err.message); }
    };
    reader.readAsText(file);
  });
  input.click();
  closeMenu();
}

function resetAll() {
  Object.keys(localStorage).filter(k => k.startsWith('xame:')).forEach(k => localStorage.removeItem(k));
  USER      = null;
  CONTACTS  = ensureSeedContacts();
  DRAFTS    = {};
  ACTIVE_ID = null;
  show(elLanding);
  firstNameInput?.focus();
  closeMenu();
}

// ── Composer more-options dropdown ────────────────────────────────────────
const moreOptionsBtn      = document.getElementById('more-options-btn');
const moreOptionsDropdown = document.getElementById('more-options-dropdown');

if (moreOptionsBtn && moreOptionsDropdown) {
  moreOptionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    moreOptionsDropdown.classList.toggle('hidden');
    moreOptionsBtn.setAttribute('aria-expanded',
      moreOptionsDropdown.classList.contains('hidden') ? 'false' : 'true');

    // Dynamically position above the button
    if (!moreOptionsDropdown.classList.contains('hidden')) {
      const btnRect = moreOptionsBtn.getBoundingClientRect();
      moreOptionsDropdown.style.left = btnRect.left + 'px';
      moreOptionsDropdown.style.bottom = (window.innerHeight - btnRect.top + 8) + 'px';
      moreOptionsDropdown.style.top = 'auto';
    }
  });
  document.addEventListener('click', (e) => {
    if (!moreOptionsBtn.contains(e.target) && !moreOptionsDropdown.contains(e.target)) {
      moreOptionsDropdown.classList.add('hidden');
      moreOptionsBtn.setAttribute('aria-expanded', 'false');
    }
  });
}
