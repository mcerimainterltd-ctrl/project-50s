/*
 * profile.js
 * Profile page: load, save, image crop, remove pic.
 * XamePage v2.1
 *
 * Depends on: config.js, state.js, storage.js, utils.js, ui.js,
 *             contacts.js (debouncedRenderContacts, ensureSeedContacts)
 */

// ── Load profile data into the form ───────────────────────────────────────
function loadProfileData() {
  if (!USER) { console.error('❌ loadProfileData called with no USER'); return; }
  console.log('📋 Loading profile data for:', USER.xameId);

  if (preferredNameInput) preferredNameInput.value = USER.preferredName || '';

  const profilePicUrl = USER.profilePic
    ? addCacheBuster(USER.profilePic)
    : '/media/profile_pics/default.png';

  if (profilePicPreview) {
    profilePicPreview.src    = profilePicUrl;
    profilePicPreview.onerror = function () {
      console.error('Failed to load profile picture');
      this.src = '/media/profile_pics/default.png';
    };
  }

  if (xameIdDisplay)    xameIdDisplay.textContent    = USER.xameId;
  if (hideNameCheckbox) hideNameCheckbox.checked      = USER.privacySettings?.hidePreferredName  || false;
  if (hidePicCheckbox)  hidePicCheckbox.checked       = USER.privacySettings?.hideProfilePicture || false;
}

// ── Back button ───────────────────────────────────────────────────────────
profileBackBtn?.addEventListener('click', () => { show(elContacts); debouncedRenderContacts(); });

// ── Profile picture input ─────────────────────────────────────────────────
profilePicInput?.addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const validation = validateFile(file);
  if (!validation.valid) { showNotification(validation.error); profilePicInput.value = ''; return; }
  const reader = new FileReader();
  reader.onload  = () => { if (cropImage) { cropImage.src = reader.result; openCropModal(); } };
  reader.onerror = () => showNotification('Failed to read image file');
  reader.readAsDataURL(file);
});

// ── Remove profile picture ────────────────────────────────────────────────
let isRemoveProfilePicClicked = false;

removeProfilePicBtn?.addEventListener('click', () => {
  isRemoveProfilePicClicked = true;
  if (profilePicPreview) profilePicPreview.src = '/media/profile_pics/default.png';
  showNotification('Profile picture will be removed when you save.');
});

// ── Save profile ──────────────────────────────────────────────────────────
saveProfileBtn?.addEventListener('click', async () => {
  const preferredName = preferredNameInput?.value.trim();
  const hideName      = hideNameCheckbox?.checked || false;
  const hidePic       = hidePicCheckbox?.checked  || false;

  if (!preferredName || preferredName.length < 2) {
    showNotification('Preferred name must be at least 2 characters.'); return;
  }

  saveProfileBtn.textContent = 'Saving...';
  saveProfileBtn.disabled    = true;

  try {
    const formData = new FormData();
    formData.append('userId',           USER.xameId);
    formData.append('preferredName',    preferredName);
    formData.append('hidePreferredName',  hideName);
    formData.append('hideProfilePicture', hidePic);

    const currentPreviewSrc = profilePicPreview?.src || '';
    const isDefaultPic      = currentPreviewSrc.includes('default.png');

    if (isRemoveProfilePicClicked) {
      console.log('🗑️ Profile removal requested.');
      formData.append('removeProfilePic', 'true');
      isRemoveProfilePicClicked = false;
      closeCropModal();
    } else if (currentPreviewSrc.startsWith('data:image/')) {
      console.log('🖼️ Detecting new image from preview source...');
      try {
        const blob = await fetch(currentPreviewSrc).then(r => r.blob());
        if (blob.size === 0) throw new Error('Processed image blob is empty.');
        formData.append('profilePic', blob, 'profile_pic.jpg');
        console.log('✅ New profile pic blob added to FormData.');
      } catch (blobError) {
        console.error('Failed to process image blob:', blobError);
        throw new Error('Failed to process profile picture');
      }
    } else { console.log('ℹ️ No change to profile picture.'); }

    closeCropModal();

    console.log('📤 Sending to: /api/update-profile');
    const response = await fetch(serverURL+'/api/update-profile', { method: 'POST', body: formData });

    if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);

    const result = await response.json();
    console.log('📥 Server response:', result);

    if (result.success) {
      showNotification('Profile saved successfully!');
      USER.preferredName     = result.preferredName;
      USER.privacySettings   = {
        hidePreferredName:    result.hidePreferredName,
        hideProfilePicture:   result.hideProfilePicture,
      };

      if (result.profilePicUrl) {
        const newUrl                = addCacheBuster(result.profilePicUrl);
        profilePicPreview.src       = newUrl;
        profilePicPreview.onerror   = function () { this.src = '/media/profile_pics/default.png'; USER.profilePic = ''; };
        profilePicPreview.onload    = () => console.log('✅ Profile picture loaded successfully');
        USER.profilePic             = newUrl;
      } else {
        if (profilePicPreview) profilePicPreview.src = '/media/profile_pics/default.png';
        USER.profilePic = '';
      }

      storage.set(KEYS.user, USER);
      if (hideNameCheckbox) hideNameCheckbox.checked = USER.privacySettings.hidePreferredName;
      if (hidePicCheckbox)  hidePicCheckbox.checked  = USER.privacySettings.hideProfilePicture;

      setAvatarInitials();

      const selfContact = CONTACTS.find(c => c.id === USER.xameId);
      if (selfContact) { selfContact.profilePic = USER.profilePic; storage.set(KEYS.contacts, CONTACTS); }

      console.log('💾 Profile save complete');
      setTimeout(() => { show(elContacts); debouncedRenderContacts(); }, 1500);

    } else {
      console.error('❌ Save failed:', result.message);
      showNotification('Failed to save profile: ' + (result.message || 'Unknown error.'));
    }
  } catch (err) {
    console.error('❌ Profile save error:', err);
    showNotification('Error saving profile: ' + err.message);
  } finally {
    saveProfileBtn.textContent = 'Save Changes';
    saveProfileBtn.disabled    = false;
  }
});

// ── Crop modal ─────────────────────────────────────────────────────────────
function openCropModal() {
  if (!cropModal) return;
  cropModal.classList.remove('hidden');
  if (cropper) cropper.destroy();
  try {
    cropper = new Cropper(cropImage, { aspectRatio: 1, viewMode: 1, guides: true, autoCropArea: 0.8 });
  } catch (error) {
    console.error('Failed to initialize cropper:', error);
    showNotification('Failed to initialize image editor'); closeCropModal();
  }
}

function closeCropModal() {
  if (cropper) { cropper.destroy(); cropper = null; }
  if (cropImage) cropImage.src = '';
  cropModal?.classList.add('hidden');
}

cropCancelBtn?.addEventListener('click', closeCropModal);

cropSaveBtn?.addEventListener('click', () => {
  if (!cropper) return;
  try {
    const croppedCanvas  = cropper.getCroppedCanvas({ width: 256, height: 256 });
    const croppedImageURL = croppedCanvas.toDataURL('image/png');
    if (profilePicPreview) profilePicPreview.src = croppedImageURL;
    closeCropModal();
  } catch (error) {
    console.error('Failed to crop image:', error);
    showNotification('Failed to crop image'); closeCropModal();
  }
});

// ── Personal Status ───────────────────────────────────────────────────────
const STATUS_MAP = {
  'Available':  '🟢',
  'Busy':       '🔴',
  'Away':       '🟡',
  'In Meeting': '📅',
  'Custom':     '✏️',
};

function initPersonalStatus() {
  const emojiRow    = document.getElementById('statusEmojiRow');
  const presets     = document.getElementById('statusPresets');
  const customInput = document.getElementById('statusCustomInput');
  const msgInput    = document.getElementById('statusMessageInput');
  const saveBtn     = document.getElementById('saveStatusBtn');
  if (!emojiRow || !presets || !saveBtn) return;

  // Load saved status
  const saved = storage.get('xame:userStatus', { type: 'Available', message: 'Available', emoji: '🟢' });
  _applyStatusUI(saved.type, saved.emoji, saved.message);
  if (msgInput) msgInput.value = saved.message || '';

  // Preset buttons
  presets.querySelectorAll('.status-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.status;
      const emoji = STATUS_MAP[type] || '🟢';
      _applyStatusUI(type, emoji, type === 'Custom' ? (msgInput?.value || '') : type);
      if (type === 'Custom') {
        customInput?.classList.remove('hidden');
        msgInput?.focus();
      } else {
        customInput?.classList.add('hidden');
      }
    });
  });

  // Emoji buttons
  emojiRow.querySelectorAll('.status-emoji-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      emojiRow.querySelectorAll('.status-emoji-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Save button
  saveBtn.addEventListener('click', () => {
    const activePreset = presets.querySelector('.status-preset-btn.active');
    const activeEmoji  = emojiRow.querySelector('.status-emoji-btn.active');
    const type    = activePreset?.dataset.status || 'Available';
    const emoji   = activeEmoji?.dataset.emoji   || '🟢';
    const message = type === 'Custom' ? (msgInput?.value?.trim() || 'Custom') : type;
    const status  = { type, emoji, message, lastUpdated: Date.now() };
    storage.set('xame:userStatus', status);
    // Broadcast via socket
    if (typeof socket !== 'undefined' && socket?.connected) {
      socket.emit('status-update', { userId: USER?.xameId, status });
    }
    // Update USER object
    if (USER) USER.status = `${emoji} ${message}`;
    showNotification(`Status updated: ${emoji} ${message}`);
  });
}

function _applyStatusUI(type, emoji, message) {
  const presets  = document.getElementById('statusPresets');
  const emojiRow = document.getElementById('statusEmojiRow');
  if (!presets || !emojiRow) return;
  presets.querySelectorAll('.status-preset-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.status === type);
  });
  emojiRow.querySelectorAll('.status-emoji-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.emoji === emoji);
  });
}

// Init when profile section is shown
document.addEventListener('xame:profile-opened', initPersonalStatus);


// ── Active Sessions Management ────────────────────────────────────────────
async function showActiveSessions() {
  const existing = document.getElementById('sessionsDialog');
  if (existing) existing.remove();

  const dlg = document.createElement('div');
  dlg.id = 'sessionsDialog';
  dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
  dlg.innerHTML = `
    <div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;max-height:80vh;overflow-y:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 style="font-size:17px;font-weight:700;color:var(--text-primary,#fff)">🔐 Active Sessions</h3>
        <button id="closeSessionsDlg" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">✕</button>
      </div>
      <div id="sessionsList" style="display:flex;flex-direction:column;gap:12px;">
        <p style="color:#aaa;text-align:center;">Loading sessions...</p>
      </div>
      <button id="killAllSessions" style="margin-top:20px;width:100%;padding:14px;background:#e53935;border:none;border-radius:12px;color:#fff;font-size:15px;font-weight:700;cursor:pointer;">
        🚨 Log Out All Other Devices
      </button>
    </div>
  `;
  document.body.appendChild(dlg);

  dlg.querySelector('#closeSessionsDlg').onclick = () => dlg.remove();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

  // Load sessions
  try {
    const res = await fetch(`${serverURL}/api/sessions/${USER.xameId}`);
    const data = await res.json();
    const list = dlg.querySelector('#sessionsList');
    if (!data.success) {
      list.innerHTML = '<p style="color:#e53935;text-align:center;">Failed to load sessions.</p>';
      return;
    }
    if (!data.sessions.length) {
      list.innerHTML = '<p style="color:#aaa;text-align:center;">No active sessions yet.<br><small style="color:#666;margin-top:6px;display:block;">Log out and log back in to register this device.</small></p>';
      return;
    }
    list.innerHTML = data.sessions.map(s => {
      const date = new Date(s.createdAt).toLocaleString();
      // Parse user agent into readable format
      const ua = s.deviceInfo;
      let device = 'Unknown device';
      const androidMatch = ua.match(/Android ([\d.]+)/);
      const iosMatch = ua.match(/iPhone OS ([\d_]+)/);
      const brandMatch = ua.match(/Build\/([A-Z0-9]+)/i);
      const huaweiMatch = ua.match(/HUAWEI([^;)]+)/i);
      const samsungMatch = ua.match(/SM-([^;)\s]+)/i);
      if (androidMatch) {
        let brand = 'Android';
        if (huaweiMatch) brand = 'Huawei';
        else if (samsungMatch) brand = 'Samsung';
        else if (ua.includes('Pixel')) brand = 'Google Pixel';
        else if (ua.includes('Xiaomi')) brand = 'Xiaomi';
        else if (ua.includes('OnePlus')) brand = 'OnePlus';
        device = brand + ' · Android ' + androidMatch[1];
      } else if (iosMatch) {
        device = 'iPhone · iOS ' + iosMatch[1].replace(/_/g, '.');
      } else if (ua.includes('Windows')) {
        device = 'Windows PC';
      } else if (ua.includes('Mac')) {
        device = 'Mac';
      } else if (ua.includes('Linux')) {
        device = 'Linux';
      }
      const currentToken = persistentStorage.get('xame:sessionToken');
      const isCurrent = s.id === currentToken || false;
      return `
        <div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:16px;border:1px solid rgba(255,255,255,0.08);">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
            <div>
              <div style="font-size:13px;color:#fff;font-weight:600;margin-bottom:4px;">📱 ${device} ${isCurrent ? '<span style="background:#00B0A0;color:#000;font-size:9px;padding:2px 7px;border-radius:10px;margin-left:6px;">This device</span>' : ''}</div>
              <div style="font-size:11px;color:#aaa;">Logged in: ${date}</div>
            </div>
            <button class="kill-session-btn" data-id="${s.id}"
              style="background:rgba(229,57,53,0.15);border:1px solid rgba(229,57,53,0.4);color:#e53935;padding:6px 12px;border-radius:8px;font-size:12px;cursor:pointer;white-space:nowrap;">
              Log Out
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Kill individual session
    list.querySelectorAll('.kill-session-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.textContent = '...';
        const r = await fetch(`${serverURL}/api/sessions/kill`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: USER.xameId, sessionId: btn.dataset.id })
        });
        const d = await r.json();
        if (d.success) { showNotification('Device logged out.'); showActiveSessions(); }
        else showNotification('Failed to log out device.');
      });
    });
  } catch(e) {
    dlg.querySelector('#sessionsList').innerHTML = '<p style="color:#e53935;text-align:center;">Failed to load sessions.</p>';
  }

  // Kill all other sessions
  dlg.querySelector('#killAllSessions').addEventListener('click', async () => {
    const token = persistentStorage.get('xame:sessionToken');
    // Check if there are other sessions to kill
    const sessRes = await fetch(`${serverURL}/api/sessions/${USER.xameId}`);
    const sessData = await sessRes.json();
    const otherSessions = (sessData.sessions || []).filter(s => s.id !== token);
    if (otherSessions.length === 0) {
      showNotification('No other devices connected at the moment.');
      return;
    }
    if (!confirm('This will log out ALL other devices immediately. Continue?')) return;
    if (!token) { showNotification('Session not found. Please log out and log back in.'); return; }
    const r = await fetch(`${serverURL}/api/sessions/kill-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER.xameId, keepToken: token })
    });
    const d = await r.json();
    if (d.success) { showNotification('All other devices logged out.'); dlg.remove(); }
    else showNotification('Failed. Please try again.');
  });
}


// ── Extra Security Setup ──────────────────────────────────────────────────
async function showExtraSecurityDialog() {
  const existing = document.getElementById('extraSecurityDialog');
  if (existing) existing.remove();

  // Load current settings
  const res = await fetch(`${serverURL}/api/extra-security/${USER.xameId}`);
  const data = await res.json();
  const es = data.extraSecurity || { enabled: false, email: '', phone: '' };

  const dlg = document.createElement('div');
  dlg.id = 'extraSecurityDialog';
  dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
  dlg.innerHTML = `
    <div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;max-height:80vh;overflow-y:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 style="font-size:17px;font-weight:700;color:var(--text-primary,#fff)">🛡️ Extra Security</h3>
        <button id="closeExtraSecDlg" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">✕</button>
      </div>
      <p style="font-size:13px;color:#aaa;margin-bottom:20px;line-height:1.6;">When enabled, a one-time code will be sent to your email every time you log in from an unrecognised device.</p>
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px;background:rgba(255,255,255,0.05);border-radius:12px;">
          <span style="font-size:14px;color:#fff;font-weight:600;">Enable Extra Security</span>
          <label style="position:relative;display:inline-block;width:48px;height:26px;">
            <input type="checkbox" id="extraSecEnabled" ${es.enabled ? 'checked' : ''} style="opacity:0;width:0;height:0;">
            <span id="extraSecToggle" style="position:absolute;cursor:pointer;inset:0;background:${es.enabled ? '#00B0A0' : '#444'};border-radius:26px;transition:0.3s;"></span>
            <span style="position:absolute;content:'';height:20px;width:20px;left:${es.enabled ? '24px' : '4px'};bottom:3px;background:#fff;border-radius:50%;transition:0.3s;pointer-events:none;"></span>
          </label>
        </div>
        <div>
          <label style="font-size:12px;color:#aaa;display:block;margin-bottom:6px;">Email Address for OTP</label>
          <input id="extraSecEmail" type="email" value="${es.email || ''}" placeholder="your@email.com"
            style="width:100%;padding:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:#fff;font-size:14px;outline:none;"/>
        </div>
        <button id="saveExtraSec" style="width:100%;padding:14px;background:#00B0A0;border:none;border-radius:12px;color:#000;font-size:15px;font-weight:700;cursor:pointer;">
          Save Extra Security Settings
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(dlg);

  dlg.querySelector('#closeExtraSecDlg').onclick = () => dlg.remove();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

  // Toggle switch visual
  const checkbox = dlg.querySelector('#extraSecEnabled');
  const toggle = dlg.querySelector('#extraSecToggle');
  const thumb = dlg.querySelector('span[style*="bottom:3px"]');
  checkbox.addEventListener('change', () => {
    toggle.style.background = checkbox.checked ? '#00B0A0' : '#444';
    thumb.style.left = checkbox.checked ? '24px' : '4px';
  });

  dlg.querySelector('#saveExtraSec').addEventListener('click', async () => {
    const email = dlg.querySelector('#extraSecEmail').value.trim();
    const enabled = dlg.querySelector('#extraSecEnabled').checked;
    if (enabled && !email) { showNotification('Please enter an email address.'); return; }
    const r = await fetch(`${serverURL}/api/extra-security/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER.xameId, email, enabled })
    });
    const d = await r.json();
    if (d.success) { showNotification('Extra security settings saved.'); dlg.remove(); }
    else showNotification('Failed to save. Please try again.');
  });
}
