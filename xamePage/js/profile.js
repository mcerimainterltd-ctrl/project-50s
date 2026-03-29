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
    const response = await fetch('/api/update-profile', { method: 'POST', body: formData });

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
