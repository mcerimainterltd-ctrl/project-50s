/*
 * audio.js
 * App sound system – HTML <audio> element wrappers.
 * XamePage v2.1
 *
 * Depends on: state.js (APP_SOUNDS, FEEDBACK), utils.js (showNotification)
 */

// ── Initialise audio element references after DOM ready ───────────────────
function initializeAudioElements() {
  APP_SOUNDS = {
    incomingCall: document.getElementById('incomingCallSound'),
    outgoingCall: document.getElementById('outgoingCallSound'),
    message:      document.getElementById('messageSound'),
  };

  const missingAudio = [];
  Object.entries(APP_SOUNDS).forEach(([key, audio]) => {
    if (!audio) {
      missingAudio.push(key);
      console.error(`❌ Missing audio element: ${key}`);
    } else {
      console.log(`✅ Audio element loaded: ${key}`);
    }
  });

  if (missingAudio.length > 0) {
    console.error('⚠️ Missing audio elements:', missingAudio.join(', '));
    console.error('Make sure your HTML includes all three audio elements!');
  }
}

// ── Safe play (Android-friendly) ──────────────────────────────────────────
function playSound(type, loop = false) {
  try {
    const audio = APP_SOUNDS[type];
    if (!audio) { console.warn(`Audio element not found: ${type}`); return; }
    audio.currentTime = 0;
    audio.loop        = loop;
    // Set reasonable volume for ringtones
    const savedVol = persistentStorage.get('xame:tone:' + type + ':volume');
    audio.volume = (savedVol !== null && savedVol !== undefined) ? Number(savedVol) : (type === 'incomingCall' || type === 'outgoingCall') ? 0.5 : 0.7;
    const p = audio.play();
    if (p !== undefined) p.catch(err => console.warn('Audio blocked (user interaction required):', err));
  } catch (e) {
    console.error('Sound error:', e);
  }
}

function stopSound(type) {
  const audio = APP_SOUNDS[type];
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  audio.loop        = false;
}

// ── App-specific sound hooks ──────────────────────────────────────────────
function playMessageTone() {
  if (!FEEDBACK.soundEnabled) return;
  const toneId = getActiveTone('incoming');
  const customUrl = persistentStorage.get('xame:tone:incoming:custom');
  playToneTemplate(toneId, customUrl);
}
function playOutgoingMessageTone() {
  if (!FEEDBACK.soundEnabled) return;
  const toneId = getActiveTone('outgoing');
  const customUrl = persistentStorage.get('xame:tone:outgoing:custom');
  playToneTemplate(toneId, customUrl);
  return;
  // original code below (unreachable, kept as fallback reference)
  if (!FEEDBACK.soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.06);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.12);
  } catch(e) {}
}
function playCallRing() {
  if (!FEEDBACK.soundEnabled) return;
  const toneId = getActiveTone('incomingCall');
  const customUrl = persistentStorage.get('xame:tone:incomingCall:custom');
  if (toneId === 'default') { playSound('incomingCall', true); return; }
  if (toneId === 'custom' && customUrl) { const a = APP_SOUNDS.incomingCall; if (a) { a.src = customUrl; a.loop = true; a.play().catch(()=>{}); } return; }
  window._callRingInterval = setInterval(() => playRingtoneTemplate(toneId), 2000);
  playRingtoneTemplate(toneId);
}
function playOutgoingRing() {
  if (!FEEDBACK.soundEnabled) return;
  // Route outgoing ring through earpiece
  if (window.AndroidBridge?.setCallAudioMode) window.AndroidBridge.setCallAudioMode(true);
  const toneId = getActiveTone('outgoingCall');
  const customUrl = persistentStorage.get('xame:tone:outgoingCall:custom');
  if (toneId === 'default') { playSound('outgoingCall', true); return; }
  if (toneId === 'custom' && customUrl) { const a = APP_SOUNDS.outgoingCall; if (a) { a.src = customUrl; a.loop = true; a.play().catch(()=>{}); } return; }
  window._outgoingRingInterval = setInterval(() => playRingtoneTemplate(toneId, 'outgoing'), 2000);
  playRingtoneTemplate(toneId, 'outgoing');
}

function stopCallRing() {
  stopSound('incomingCall');
  if (window._callRingInterval) { clearInterval(window._callRingInterval); window._callRingInterval = null; }
}
function stopOutgoingRing() {
  stopSound('outgoingCall');
  if (window._outgoingRingInterval) { clearInterval(window._outgoingRingInterval); window._outgoingRingInterval = null; }
  if (!window.callActive && window.AndroidBridge?.setCallAudioMode) window.AndroidBridge.setCallAudioMode(false);
}

// ── Unified notification with sound + vibration ───────────────────────────
function notifyWithFeedback(message, { sound = 'message', vibrate = true } = {}) {
  showNotification(message);

  if (FEEDBACK.soundEnabled && sound) {
    sound === 'message' ? playMessageTone() : playSound(sound);
  }

  if (FEEDBACK.vibrationEnabled && vibrate && 'vibrate' in navigator) {
    try { navigator.vibrate(FEEDBACK.vibrationPattern); }
    catch (e) { console.warn('Vibration failed:', e); }
  }
}

// ── User toggles ──────────────────────────────────────────────────────────
function toggleSound(on) {
  FEEDBACK.soundEnabled = !!on;
  persistentStorage.set('xame:sound', FEEDBACK.soundEnabled);
}

function toggleVibration(on) {
  FEEDBACK.vibrationEnabled = !!on;
  persistentStorage.set('xame:vibration', FEEDBACK.vibrationEnabled);
}

// ── Cordova device-ready: ensure audio preload ────────────────────────────
document.addEventListener('deviceready', () => {
  console.log('Cordova ready — ensuring audio preload');
  Object.values(APP_SOUNDS).forEach(audio => {
    if (!audio) return;
    try { audio.preload = 'auto'; audio.load(); }
    catch (e) { console.warn('Audio preload failed:', e); }
  });
});

// ── Debug helper ──────────────────────────────────────────────────────────
function debugPlayAllSounds() {
  console.log('Testing all app sounds...');
  playMessageTone();
  setTimeout(playCallRing,     800);
  setTimeout(playOutgoingRing, 1600);
  setTimeout(() => { stopCallRing(); stopOutgoingRing(); }, 4000);
}

const TONE_TEMPLATES = [
  { id: 'default', label: 'Default', file: 'media/audio/xamepage_message.mp3' },
  { id: 'soft',    label: 'Soft',    gen: (ctx) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type='sine'; o.frequency.setValueAtTime(520,ctx.currentTime); o.frequency.exponentialRampToValueAtTime(720,ctx.currentTime+0.1); g.gain.setValueAtTime(0.2,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.3); o.start(); o.stop(ctx.currentTime+0.3); } },
  { id: 'chime',   label: 'Chime',   gen: (ctx) => { [880,1100,1320].forEach((f,i) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type='sine'; o.frequency.value=f; g.gain.setValueAtTime(0,ctx.currentTime+i*0.1); g.gain.linearRampToValueAtTime(0.15,ctx.currentTime+i*0.1+0.02); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.1+0.25); o.start(ctx.currentTime+i*0.1); o.stop(ctx.currentTime+i*0.1+0.25); }); } },
  { id: 'pop',     label: 'Pop',     gen: (ctx) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type='sine'; o.frequency.setValueAtTime(1200,ctx.currentTime); o.frequency.exponentialRampToValueAtTime(400,ctx.currentTime+0.08); g.gain.setValueAtTime(0.25,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.1); o.start(); o.stop(ctx.currentTime+0.1); } },
  { id: 'bubble',  label: 'Bubble',  gen: (ctx) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type='sine'; o.frequency.setValueAtTime(300,ctx.currentTime); o.frequency.exponentialRampToValueAtTime(900,ctx.currentTime+0.15); g.gain.setValueAtTime(0.18,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.2); o.start(); o.stop(ctx.currentTime+0.2); } },
  { id: 'ding',    label: 'Ding',    gen: (ctx) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type='triangle'; o.frequency.value=1047; g.gain.setValueAtTime(0.3,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.5); o.start(); o.stop(ctx.currentTime+0.5); } },
  { id: 'custom',  label: '+ Upload', custom: true },
];

function playToneTemplate(toneId, customDataUrl) {
  try {
    if (toneId === 'default') { new Audio('media/audio/xamepage_message.mp3').play().catch(()=>{}); return; }
    if (toneId === 'custom' && customDataUrl) { new Audio(customDataUrl).play().catch(()=>{}); return; }
    const tmpl = TONE_TEMPLATES.find(t => t.id === toneId);
    if (tmpl && tmpl.gen) { const ctx = new (window.AudioContext || window.webkitAudioContext)(); tmpl.gen(ctx); }
  } catch(e) { console.warn('Tone play error:', e); }
}

function getActiveTone(type) {
  return persistentStorage.get('xame:tone:' + type) || 'default';
}

function setActiveTone(type, toneId, customDataUrl) {
  persistentStorage.set('xame:tone:' + type, toneId);
  if (toneId === 'custom' && customDataUrl) persistentStorage.set('xame:tone:' + type + ':custom', customDataUrl);
}

function showTonePicker(type) {
  document.getElementById('tonePicker')?.remove();
  const activeTone = getActiveTone(type);
  const customUrl  = persistentStorage.get('xame:tone:' + type + ':custom');
  const label      = type === 'incoming' ? 'Incoming Message Tone' : 'Outgoing Message Tone';
  const icons      = { default:'bell', soft:'musical_note', chime:'notes', pop:'speech_balloon', bubble:'bubble', ding:'bell', custom:'open_file_folder' };

  const dlg = document.createElement('div');
  dlg.id = 'tonePicker';
  dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
  dlg.innerHTML = '<div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;max-height:80vh;overflow-y:auto;">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">'
    + '<h3 style="font-size:17px;font-weight:700;color:var(--text-primary,#fff)">' + label + '</h3>'
    + '<button id="closeTonePicker" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">&#10005;</button>'
    + '</div>'
    + '<div id="toneList" style="display:flex;flex-direction:column;gap:8px;">'
    + TONE_TEMPLATES.map(t => {
        const active = activeTone === t.id;
        const icon = t.custom ? '&#128193;' : t.id === 'chime' ? '&#127925;' : t.id === 'pop' ? '&#128172;' : t.id === 'bubble' ? '&#129706;' : t.id === 'soft' ? '&#127926;' : '&#128276;';
        return '<div class="tone-item" data-id="' + t.id + '" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-radius:12px;background:' + (active?'rgba(0,176,160,0.15)':'rgba(255,255,255,0.05)') + ';border:1px solid ' + (active?'rgba(0,176,160,0.4)':'rgba(255,255,255,0.08)') + ';cursor:pointer;">'
          + '<div style="display:flex;align-items:center;gap:12px;">'
          + '<span style="font-size:20px">' + icon + '</span>'
          + '<span style="font-size:15px;color:#fff;font-weight:' + (active?'700':'400') + '">' + t.label + (t.id==='custom' && customUrl?' (saved)':'') + '</span>'
          + '</div>'
          + '<div style="display:flex;align-items:center;gap:10px;">'
          + (!t.custom ? '<button class="preview-tone-btn" data-id="' + t.id + '" style="background:rgba(0,176,160,0.2);border:none;color:#00B0A0;padding:5px 12px;border-radius:20px;font-size:12px;cursor:pointer;">&#9654; Preview</button>' : '')
          + (active ? '<span style="color:#00B0A0;font-size:18px;">&#10003;</span>' : '')
          + '</div></div>';
      }).join('')
    + '</div>'
    + '<input type="file" id="toneUploadInput" accept="audio/*" style="display:none;">'
    + '<p style="font-size:12px;color:#aaa;margin-top:16px;text-align:center;">Tap a tone to select. Tap &#9654; to preview.</p>'
    + '</div>';

  document.body.appendChild(dlg);
  dlg.querySelector('#closeTonePicker').addEventListener('click', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });

  dlg.querySelectorAll('.preview-tone-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); playToneTemplate(btn.dataset.id, customUrl); });
  });

  dlg.querySelectorAll('.tone-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.classList.contains('preview-tone-btn')) return;
      const id = item.dataset.id;
      if (id === 'custom') { dlg.querySelector('#toneUploadInput').click(); return; }
      setActiveTone(type, id);
      showNotification((type==='incoming'?'Incoming':'Outgoing') + ' tone set to ' + TONE_TEMPLATES.find(t=>t.id===id).label);
      dlg.remove();
    });
  });

  dlg.querySelector('#toneUploadInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500000) { showNotification('File too large. Max 500KB.'); return; }
    const reader = new FileReader();
    reader.onload = ev => { setActiveTone(type, 'custom', ev.target.result); showNotification('Custom tone saved!'); dlg.remove(); };
    reader.readAsDataURL(file);
  });
}

const RINGTONE_TEMPLATES = [
  { id: 'default', label: 'Default', file: true },
  { id: 'classic', label: 'Classic', gen: (ctx, out) => { const freqs = out ? [480,480,0,480,480] : [440,490,440,490,440]; freqs.forEach((f,i) => { if (!f) return; const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type='square'; o.frequency.value=f; g.gain.setValueAtTime(0.1,ctx.currentTime+i*0.18); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.18+0.15); o.start(ctx.currentTime+i*0.18); o.stop(ctx.currentTime+i*0.18+0.15); }); } },
  { id: 'marimba', label: 'Marimba', gen: (ctx) => { [1047,1319,1568,1319,1047].forEach((f,i) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type='triangle'; o.frequency.value=f; g.gain.setValueAtTime(0.2,ctx.currentTime+i*0.12); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.12+0.2); o.start(ctx.currentTime+i*0.12); o.stop(ctx.currentTime+i*0.12+0.2); }); } },
  { id: 'digital', label: 'Digital', gen: (ctx) => { [880,0,880,0,880,0,1320].forEach((f,i) => { if (!f) return; const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type='sawtooth'; o.frequency.value=f; g.gain.setValueAtTime(0.08,ctx.currentTime+i*0.12); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.12+0.1); o.start(ctx.currentTime+i*0.12); o.stop(ctx.currentTime+i*0.12+0.1); }); } },
  { id: 'gentle',  label: 'Gentle',  gen: (ctx) => { [523,659,784,659,523].forEach((f,i) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type='sine'; o.frequency.value=f; g.gain.setValueAtTime(0.15,ctx.currentTime+i*0.2); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.2+0.3); o.start(ctx.currentTime+i*0.2); o.stop(ctx.currentTime+i*0.2+0.3); }); } },
  { id: 'urgent',  label: 'Urgent',  gen: (ctx) => { [1200,800,1200,800,1200,800].forEach((f,i) => { const o=ctx.createOscillator(),g=ctx.createGain(); o.connect(g);g.connect(ctx.destination); o.type='square'; o.frequency.value=f; g.gain.setValueAtTime(0.1,ctx.currentTime+i*0.1); g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+i*0.1+0.08); o.start(ctx.currentTime+i*0.1); o.stop(ctx.currentTime+i*0.1+0.08); }); } },
  { id: 'custom',  label: '+ Upload', custom: true },
];

function playRingtoneTemplate(toneId, direction, type) {
  try {
    const tmpl = RINGTONE_TEMPLATES.find(t => t.id === toneId);
    if (tmpl && tmpl.gen) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const masterGain = ctx.createGain();
      const savedVol = persistentStorage.get('xame:tone:' + (type || (direction === 'outgoing' ? 'outgoingCall' : 'incomingCall')) + ':volume');
      masterGain.gain.value = (savedVol !== null && savedVol !== undefined) ? Number(savedVol) * 2 : 1.0;
      masterGain.connect(ctx.destination);
      // Temporarily override destination so all template nodes connect through master gain
      const origDest = ctx.destination;
      Object.defineProperty(ctx, 'destination', { get: () => masterGain, configurable: true });
      tmpl.gen(ctx, direction === 'outgoing');
      Object.defineProperty(ctx, 'destination', { get: () => origDest, configurable: true });
    }
  } catch(e) { console.warn('Ringtone play error:', e); }
}

function showRingtonePicker(type) {
  document.getElementById('ringtonePicker')?.remove();
  const activeTone = getActiveTone(type);
  const customUrl  = persistentStorage.get('xame:tone:' + type + ':custom');
  const label      = type === 'incomingCall' ? 'Incoming Call Ringtone' : 'Outgoing Call Ringtone';
  const dlg = document.createElement('div');
  dlg.id = 'ringtonePicker';
  dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:99999;display:flex;align-items:flex-end;justify-content:center;';
  dlg.innerHTML = '<div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:24px;max-height:80vh;overflow-y:auto;">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">'
    + '<h3 style="font-size:17px;font-weight:700;color:var(--text-primary,#fff)">' + label + '</h3>'
    + '<button id="closeRingtonePicker" style="background:none;border:none;color:#aaa;font-size:22px;cursor:pointer;">&#10005;</button>'
    + '</div><div style="display:flex;flex-direction:column;gap:8px;">'
    + RINGTONE_TEMPLATES.map(t => {
        const active = activeTone === t.id;
        const icon = t.custom ? '&#128193;' : t.id==='marimba' ? '&#127925;' : t.id==='digital' ? '&#128187;' : t.id==='gentle' ? '&#127926;' : t.id==='urgent' ? '&#128680;' : '&#128222;';
        return '<div class="ringtone-item" data-id="' + t.id + '" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-radius:12px;background:' + (active?'rgba(0,176,160,0.15)':'rgba(255,255,255,0.05)') + ';border:1px solid ' + (active?'rgba(0,176,160,0.4)':'rgba(255,255,255,0.08)') + ';cursor:pointer;">'
          + '<div style="display:flex;align-items:center;gap:12px;"><span style="font-size:20px">' + icon + '</span>'
          + '<span style="font-size:15px;color:#fff;font-weight:' + (active?'700':'400') + '">' + t.label + (t.id==='custom'&&customUrl?' (saved)':'') + '</span></div>'
          + '<div style="display:flex;align-items:center;gap:10px;">'
          + (!t.custom ? '<button class="preview-ring-btn" data-id="' + t.id + '" style="background:rgba(0,176,160,0.2);border:none;color:#00B0A0;padding:5px 12px;border-radius:20px;font-size:12px;cursor:pointer;">&#9654; Preview</button>' : '')
          + (active ? '<span style="color:#00B0A0;font-size:18px;">&#10003;</span>' : '') + '</div></div>';
      }).join('')
    + '</div><input type="file" id="ringtoneUploadInput" accept="audio/*" style="display:none;">'
    + '<div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.1);">'
  + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">'
  + '<span style="font-size:14px;color:#fff;font-weight:600;">🔊 Volume</span>'
  + '<span id="volumeLabel" style="font-size:13px;color:#00B0A0;">' + Math.round((persistentStorage.get('xame:tone:' + type + ':volume') || 0.5) * 100) + '%</span>'
  + '</div>'
  + '<input type="range" id="ringtoneVolume" min="0" max="100" value="' + Math.round((persistentStorage.get('xame:tone:' + type + ':volume') || 0.5) * 100) + '" style="width:100%;accent-color:#00B0A0;cursor:pointer;">'
  + '</div>'
  + '<p style="font-size:12px;color:#aaa;margin-top:16px;text-align:center;">Tap to select. Tap &#9654; to preview.</p></div>';

  document.body.appendChild(dlg);
  dlg.querySelector('#closeRingtonePicker').addEventListener('click', () => dlg.remove());
  dlg.querySelector('#ringtoneVolume')?.addEventListener('input', e => {
    const vol = e.target.value / 100;
    persistentStorage.set('xame:tone:' + type + ':volume', vol);
    dlg.querySelector('#volumeLabel').textContent = e.target.value + '%';
  });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
  dlg.querySelectorAll('.preview-ring-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.dataset.id === 'default') { new Audio(type==='incomingCall'?'media/audio/xamepage_call.mp3':'media/audio/xamepage_outgoing.mp3').play().catch(()=>{}); }
      else { playRingtoneTemplate(btn.dataset.id, type==='outgoingCall'?'outgoing':''); }
    });
  });
  dlg.querySelectorAll('.ringtone-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.classList.contains('preview-ring-btn')) return;
      const id = item.dataset.id;
      if (id === 'custom') { dlg.querySelector('#ringtoneUploadInput').click(); return; }
      setActiveTone(type, id);
      showNotification((type==='incomingCall'?'Incoming call':'Outgoing call') + ' ringtone set to ' + RINGTONE_TEMPLATES.find(t=>t.id===id).label);
      dlg.remove();
    });
  });
  dlg.querySelector('#ringtoneUploadInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1000000) { showNotification('File too large. Max 1MB.'); return; }
    const reader = new FileReader();
    reader.onload = ev => { setActiveTone(type, 'custom', ev.target.result); showNotification('Custom ringtone saved!'); dlg.remove(); };
    reader.readAsDataURL(file);
  });
}

// ── Unlock audio on first user interaction ────────────────────────────────
(function unlockAudioOnInteraction() {
  const unlock = () => {
    // Resume any suspended AudioContext
    if (window.AudioContext || window.webkitAudioContext) {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume().then(() => ctx.close());
    }
    // Pre-play all sounds silently to unlock
    Object.values(APP_SOUNDS || {}).forEach(audio => {
      if (!audio) return;
      audio.volume = 0;
      audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
      }).catch(() => {});
    });
    document.removeEventListener('touchstart', unlock);
    document.removeEventListener('click', unlock);
  };
  document.addEventListener('touchstart', unlock, { once: true });
  document.addEventListener('click', unlock, { once: true });
})();
