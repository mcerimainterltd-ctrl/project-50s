/*
 * webrtc.js
 * WebRTC voice/video calls – 1-to-1 and merged multi-party calls.
 * XamePage v2.1
 */

// ── Multi-peer state ───────────────────────────────────────────────────────
const peers    = new Map();   // userId → { pc, stream, onHold }
let audioCtx   = null;
let mergedDest = null;
let callActive = false;
let holdUserId = null;
let _callTimerInterval = null;
let _callTimerSeconds = 0;

function _startCallTimer() {
  const display = document.getElementById('callTimerDisplay');
  if (!display) return;
  _callTimerSeconds = 0;
  display.textContent = '00:00';
  clearInterval(_callTimerInterval);
  _callTimerInterval = setInterval(() => {
    _callTimerSeconds++;
    const m = String(Math.floor(_callTimerSeconds / 60)).padStart(2, '0');
    const s = String(_callTimerSeconds % 60).padStart(2, '0');
    display.textContent = m + ':' + s;
  }, 1000);
}

function _stopCallTimer() {
  clearInterval(_callTimerInterval);
  _callTimerInterval = null;
  const display = document.getElementById('callTimerDisplay');
  if (display) display.textContent = '';
}

// ── Draggable local video ─────────────────────────────────────────────────
const makeDraggable = (el) => {
  let initialX, initialY;
  let currentX = parseFloat(el.style.left) || 0;
  let currentY = parseFloat(el.style.top)  || 0;
  let lastTap  = 0;
  el.style.position = 'fixed';
  el.style.left = currentX + 'px';
  el.style.top  = currentY + 'px';
  const drag = (e) => {
    e.preventDefault();
    const clientX = e.type === 'touchmove' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
    currentX += clientX - initialX;
    currentY += clientY - initialY;
    initialX = clientX; initialY = clientY;
    el.style.left = currentX + 'px'; el.style.top = currentY + 'px';
  };
  const dragEnd = () => {
    el.classList.remove('dragging');
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('mouseup', dragEnd);
    document.removeEventListener('touchmove', drag);
    document.removeEventListener('touchend', dragEnd);
  };
  const dragStart = (e) => {
    e.preventDefault();
    const n = Date.now(); const isDouble = (n - lastTap) <= 300; lastTap = n;
    if (isDouble) { swapVideos(); return; }
    const clientX = e.type === 'touchstart' ? e.touches[0].clientX : e.clientX;
    const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
    initialX = clientX; initialY = clientY;
    currentX = parseFloat(el.style.left) || 0;
    currentY = parseFloat(el.style.top)  || 0;
    el.classList.add('dragging');
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('touchmove', drag, { passive: false });
    document.addEventListener('touchend', dragEnd);
  };
  el.addEventListener('mousedown', dragStart);
  el.addEventListener('touchstart', dragStart, { passive: false });
};

function swapVideos() {
  if (!localVideo || !remoteVideo) return;
  const tmpSrc = localVideo.srcObject;
  localVideo.srcObject = remoteVideo.srcObject;
  remoteVideo.srcObject = tmpSrc;
}

// ── Audio mixer ───────────────────────────────────────────────────────────
function initAudioMixer() {
  if (audioCtx) return;
  try {
    audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
    mergedDest = audioCtx.createMediaStreamDestination();
  } catch (e) { console.error('AudioContext failed:', e); }
}

function addStreamToMixer(stream) {
  if (!audioCtx || !mergedDest || !stream) return;
  try {
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(mergedDest);
  } catch (e) { console.error('Mixer error:', e); }
}

// ── Create peer connection ─────────────────────────────────────────────────
function createPeerConnection(userId) {
  const pc = new RTCPeerConnection(rtcConfig);
  RESOURCES.peerConnections.push(pc);
  pc.ontrack = (event) => {
    const stream = event.streams[0]; if (!stream) return;
    const peer = peers.get(userId); if (peer) peer.stream = stream;
    if (peers.size === 1) {
      remoteVideo.srcObject = stream; remoteVideo.muted = false;
      remoteVideo.play().catch(e => console.error('Remote play error:', e));
    } else {
      initAudioMixer(); addStreamToMixer(stream);
      if (mergedDest) { remoteVideo.srcObject = mergedDest.stream; remoteVideo.muted = false; remoteVideo.play().catch(() => {}); }
    }
    updateCallParticipantsUI();
    if (!_callTimerInterval) { _startCallTimer(); }
  };
  pc.oniceconnectionstatechange = () => {
    console.log('ICE [' + userId + ']: ' + pc.iceConnectionState);
    if (pc.iceConnectionState === 'connected' && !_callTimerInterval && remoteVideo.srcObject) { _startCallTimer(); }
    if (['failed','disconnected'].includes(pc.iceConnectionState)) {
      showNotification('Connection lost with ' + (CONTACTS.find(c => c.id === userId)?.name || userId));
      removePeer(userId);
    }
  };
  pc.onicecandidate = (event) => {
    if (event.candidate) socket?.emit('ice-candidate', { recipientId: userId, candidate: event.candidate });
  };
  return pc;
}

function removePeer(userId) {
  const peer = peers.get(userId); if (!peer) return;
  const pc = peer.pc;
  pc.oniceconnectionstatechange = null;
  pc.ontrack = null;
  pc.onicecandidate = null;
  pc.close();
  peer.stream?.getTracks().forEach(t => t.stop());
  // Remove from RESOURCES
  const idx = RESOURCES.peerConnections.indexOf(pc);
  if (idx !== -1) RESOURCES.peerConnections.splice(idx, 1);
  peers.delete(userId); updateCallParticipantsUI();
  if (peers.size === 0) exitVideoCall();
}

// ── Start outgoing call ───────────────────────────────────────────────────
async function startCall(recipientId, callType) {
  try {
    const hasVideo = callType === 'video';
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ video: hasVideo, audio: true });
      RESOURCES.localStreams.push(localStream);
    }
    // Set earpiece BEFORE any audio plays
    isLoudspeakerOn = false;
    if (window.AndroidBridge?.setCallAudioMode) window.AndroidBridge.setCallAudioMode(true);
    playOutgoingRing();
    videoCallOverlay.classList.remove('hidden');
    elChatHeader.classList.add('hidden'); composer.classList.add('hidden');
    localVideo.srcObject = localStream; localVideo.muted = true;
    if (!hasVideo) { localVideo.style.display = 'none'; }
    else { localVideo.style.display = 'block'; makeDraggable(localVideo); }
    const pc = createPeerConnection(recipientId);
    peers.set(recipientId, { pc, stream: null, onHold: false });
    peerConnection = pc;
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket?.emit('call-user', { recipientId, offer, callType });
    callActive = true; showCallControls();
    // Update speaker button to show earpiece state
    if (typeof loudSpeakerBtn !== 'undefined' && loudSpeakerBtn) loudSpeakerBtn.textContent = '🔈';
    // Update speaker button to show earpiece state
    if (typeof loudSpeakerBtn !== 'undefined' && loudSpeakerBtn) loudSpeakerBtn.textContent = '🔈';
  // Auto-timeout if unanswered after 60 seconds
  if (window._callTimeouts) window._callTimeouts.forEach(t => clearTimeout(t));
  window._callTimeouts = [];
  window._callTimeouts.push(setTimeout(() => {
    if (!callActive || peers.size === 0 || (peers.size === 1 && [...peers.values()][0].stream === null)) {
      showNotification('No answer'); exitVideoCall();
    }
  }, 60000));
  // Auto-timeout if unanswered after 60 seconds
  } catch (err) {
    console.error('Call error:', err.name, err.message);
    alert('Call error: ' + (err.name || err.message || String(err)));
    exitVideoCall();
  }
}

// ── Add call to ongoing call ──────────────────────────────────────────────
async function addCall(recipientId) {
  if (!callActive || !localStream) { showNotification('No active call'); return; }
  peers.forEach((peer) => {
    peer.onHold = true;
    peer.stream?.getAudioTracks().forEach(t => t.enabled = false);
  });
  showNotification('Calling ' + (CONTACTS.find(c => c.id === recipientId)?.name || recipientId) + '...');
  try {
    const pc = createPeerConnection(recipientId);
    peers.set(recipientId, { pc, stream: null, onHold: false });
    peerConnection = pc;
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket?.emit('call-user', { recipientId, offer, callType: 'voice' });
    updateCallParticipantsUI();
  } catch (err) {
    console.error('Add call failed:', err); showNotification('Failed to add call');
    peers.forEach(peer => { peer.onHold = false; peer.stream?.getAudioTracks().forEach(t => t.enabled = true); });
  }
}

// ── Merge all calls ───────────────────────────────────────────────────────
function mergeCalls() {
  if (peers.size < 2) { showNotification('No calls to merge'); return; }
  initAudioMixer();
  peers.forEach((peer) => {
    peer.onHold = false;
    peer.stream?.getAudioTracks().forEach(t => t.enabled = true);
    if (peer.stream) addStreamToMixer(peer.stream);
  });
  if (mergedDest) { remoteVideo.srcObject = mergedDest.stream; remoteVideo.play().catch(() => {}); }
  holdUserId = null; showNotification('Calls merged!'); updateCallParticipantsUI();
}

// ── Handle incoming call ──────────────────────────────────────────────────
async function handleIncomingCall(offer, callerId) {
  try {
    const hasVideo = window.__pendingCall__?.callType === 'video';
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ video: hasVideo, audio: true });
      RESOURCES.localStreams.push(localStream);
    }
    // Set earpiece BEFORE audio plays on incoming call answer
    isLoudspeakerOn = false;
    if (window.AndroidBridge?.setCallAudioMode) window.AndroidBridge.setCallAudioMode(true);
    videoCallOverlay.classList.remove('hidden');
    elChatHeader.classList.add('hidden'); composer.classList.add('hidden');
    localVideo.srcObject = localStream; localVideo.muted = true;
    if (!hasVideo) { localVideo.style.display = 'none'; }
    else { localVideo.style.display = 'block'; makeDraggable(localVideo); }
    const pc = createPeerConnection(callerId);
    peers.set(callerId, { pc, stream: null, onHold: false });
    peerConnection = pc;
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket?.emit('make-answer', { recipientId: callerId, answer });
    for (const candidate of pendingIceCandidates) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
    }
    pendingIceCandidates = []; delete window.__pendingCall__;
    callActive = true; showCallControls();
  // Auto-timeout if unanswered after 60 seconds
  if (window._callTimeouts) window._callTimeouts.forEach(t => clearTimeout(t));
  window._callTimeouts = [];
  window._callTimeouts.push(setTimeout(() => {
    if (!callActive || peers.size === 0 || (peers.size === 1 && [...peers.values()][0].stream === null)) {
      showNotification('No answer'); exitVideoCall();
    }
  }, 60000));
  } catch (error) {
    console.error('Failed to handle incoming call:', error);
    showNotification('Failed to answer call'); exitVideoCall();
  }
}

// ── Handle answer ─────────────────────────────────────────────────────────
async function handleAnswer(answer, fromUserId) {
  stopOutgoingRing();
  const userId = fromUserId || (peers.size === 1 ? [...peers.keys()][0] : null);
  const peer   = userId ? peers.get(userId) : null;
  const pc     = peer?.pc || peerConnection;
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    for (const candidate of pendingIceCandidates) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch (e) {}
    }
    pendingIceCandidates = [];
  } catch (error) {
    console.error('Failed to handle answer:', error);
    showNotification('Call connection failed'); exitVideoCall();
  }
}

// ── Handle ICE candidate ──────────────────────────────────────────────────
function handleNewIceCandidate(candidate, fromUserId) {
  const userId = fromUserId || (peers.size === 1 ? [...peers.keys()][0] : null);
  const peer   = userId ? peers.get(userId) : null;
  const pc     = peer?.pc || peerConnection;
  if (!pc) { pendingIceCandidates.push(candidate); return; }
  if (pc.remoteDescription) {
    pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => console.error('ICE error:', e));
  } else { pendingIceCandidates.push(candidate); }
}

// ── End call ──────────────────────────────────────────────────────────────
function endCall() {
  peers.forEach((peer) => {
    try {
      peer.pc.oniceconnectionstatechange = null;
      peer.pc.ontrack = null;
      peer.pc.onicecandidate = null;
      peer.pc.close();
    } catch(_) {}
  });
  peers.clear(); peerConnection = null;
  localStream?.getTracks().forEach(t => t.stop()); localStream = null;
  remoteStream?.getTracks().forEach(t => t.stop()); remoteStream = null;
  RESOURCES.localStreams.forEach(s => s.getTracks().forEach(t => t.stop()));
  RESOURCES.localStreams = [];
  RESOURCES.peerConnections.forEach(pc => { if (pc?.connectionState !== 'closed') pc.close(); });
  RESOURCES.peerConnections = [];
  pendingIceCandidates = [];
  if (audioCtx) { try { audioCtx.close(); } catch(_) {} audioCtx = null; mergedDest = null; }
  isAudioMuted = false; isVideoMuted = false; isLoudspeakerOn = false;
  callActive = false; holdUserId = null; _stopCallTimer();
  // Reset to normal audio mode
  if (window.AndroidBridge?.setCallAudioMode) window.AndroidBridge.setCallAudioMode(false);
}

function exitVideoCall() {
  stopOutgoingRing(); stopCallRing();
  if (window._callTimeouts) { window._callTimeouts.forEach(t => clearTimeout(t)); window._callTimeouts = []; }
  window._lastCallEndedAt = Date.now();
  const _notifyIds = peers.size > 0 ? [...peers.keys()] : (ACTIVE_ID ? [ACTIVE_ID] : []);
  _notifyIds.forEach(uid => socket?.emit('call-ended', { recipientId: uid }));
  endCall();
  videoCallOverlay?.classList.add('hidden');
  elChatHeader?.classList.remove('hidden'); composer?.classList.remove('hidden');
  document.getElementById('callParticipantsBar')?.remove();
  document.getElementById('addCallBtn')?.remove();
  document.getElementById('mergeCallBtn')?.remove();
}

// ── Call UI controls ──────────────────────────────────────────────────────
function showCallControls() {
  if (document.getElementById('addCallBtn')) return;
  const addBtn = document.createElement('button');
  addBtn.id = 'addCallBtn';
  addBtn.innerHTML = '➕📞';
  addBtn.title = 'Add Call';
  addBtn.style.cssText = 'position:absolute;bottom:170px;left:50%;transform:translateX(-120px);background:rgba(0,0,0,0.8);padding:8px 14px;border-radius:20px;color:white;font-size:12px;border:1px solid rgba(255,255,255,0.3);cursor:pointer;z-index:100;';
  addBtn.addEventListener('click', showAddCallDialog);
  videoCallOverlay?.appendChild(addBtn);

  const mergeBtn = document.createElement('button');
  mergeBtn.id = 'mergeCallBtn';
  mergeBtn.innerHTML = '🔀 Merge';
  mergeBtn.style.cssText = 'position:absolute;bottom:170px;left:50%;transform:translateX(20px);background:rgba(0,150,0,0.9);padding:8px 14px;border-radius:20px;color:white;font-size:12px;border:none;cursor:pointer;z-index:100;display:none;';
  mergeBtn.addEventListener('click', mergeCalls);
  videoCallOverlay?.appendChild(mergeBtn);
}

function updateCallParticipantsUI() {
  const mergeBtn = document.getElementById('mergeCallBtn');
  if (mergeBtn) mergeBtn.style.display = peers.size >= 2 ? 'block' : 'none';

  let bar = document.getElementById('callParticipantsBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'callParticipantsBar';
    bar.style.cssText = 'position:absolute;top:8px;left:0;right:0;display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:4px 8px;z-index:10;';
    videoCallOverlay?.appendChild(bar);
  }
  bar.innerHTML = '';
  peers.forEach((peer, uid) => {
    const name = CONTACTS.find(c => c.id === uid)?.name || uid;
    const chip = document.createElement('div');
    chip.style.cssText = 'background:rgba(0,0,0,0.75);color:white;border-radius:12px;padding:3px 8px;font-size:11px;display:flex;align-items:center;gap:4px;';
    chip.innerHTML = (peer.onHold ? '⏸ ' : '🟢 ') + name + ' <button style="background:none;border:none;color:#ff4444;cursor:pointer;font-size:14px" data-uid="' + uid + '">✕</button>';
    chip.querySelector('button').addEventListener('click', (e) => {
      const u = e.target.dataset.uid;
      socket?.emit('call-rejected', { recipientId: u, reason: 'ended' });
      removePeer(u);
    });
    bar.appendChild(chip);
  });
}

function showAddCallDialog() {
  document.getElementById('addCallDlg')?.remove();
  const available = CONTACTS.filter(c => c.id !== USER.xameId && c.online && !peers.has(c.id));
  if (available.length === 0) { showNotification('No online contacts to add'); return; }
  const dlg = document.createElement('div');
  dlg.id = 'addCallDlg';
  dlg.className = 'dialog-backdrop';
  dlg.style.cssText = 'z-index:99999;position:fixed;inset:0;';
  dlg.style.cssText = 'z-index:99999;position:fixed;inset:0;';
  dlg.innerHTML =
    '<div class="dialog" style="width:300px">' +
      '<h3 style="margin-bottom:12px">Add to Call</h3>' +
      '<div style="max-height:250px;overflow-y:auto">' +
        available.map(c =>
          '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--divider-color)">' +
            '<span>' + escapeHtml(c.name || c.id) + '</span>' +
            '<button class="btn primary" style="padding:4px 12px;font-size:12px" data-id="' + c.id + '">Call</button>' +
          '</div>'
        ).join('') +
      '</div>' +
      '<button class="btn secondary" id="closeAddCallDlg" style="width:100%;margin-top:12px">Cancel</button>' +
    '</div>';
  document.body.appendChild(dlg);
  dlg.querySelector('#closeAddCallDlg').addEventListener('click', () => dlg.remove());
  dlg.querySelectorAll('[data-id]').forEach(btn => {
    btn.addEventListener('click', () => { dlg.remove(); addCall(btn.dataset.id); });
  });
}

// ── Incoming call notification ────────────────────────────────────────────
function showIncomingCallNotification(caller, callType, offer) {
  if (typeof callBlockingModule !== 'undefined' && callBlockingModule.isBlocked(caller.xameId)) {
    socket?.emit('call-rejected', { recipientId: caller.xameId, reason: 'blocked' }); return;
  }
  playCallRing();
  const localContact = CONTACTS.find(c => c.id === caller.xameId);
  const displayName  = localContact ? localContact.name : (caller.name || 'Unknown Caller');
  $('#callerName').textContent = displayName;
  $('#callerId').textContent   = caller.xameId;
  $('#callStatus').textContent = 'Incoming ' + callType + ' call...';
  const callerPicEl = $('#callerPic'); const callAvatarInitialsEl = $('#callAvatarInitials');
  let callerPicUrl = caller.profilePic; let showPlaceholder = !caller.profilePic;
  if (localContact?.isProfilePicHidden) { showPlaceholder = true; callerPicUrl = null; }
  if (callerPicUrl && !showPlaceholder) {
    callerPicEl.src = addCacheBuster(callerPicUrl);
    callerPicEl.classList.remove('hidden'); callAvatarInitialsEl.classList.add('hidden');
  } else {
    callAvatarInitialsEl.textContent = initialsOf({ name: displayName });
    callAvatarInitialsEl.classList.remove('hidden'); callerPicEl.classList.add('hidden');
  }
  incomingCallOverlay.classList.remove('hidden');
  acceptCallBtn.onclick = async () => {
    stopCallRing(); 
    incomingCallOverlay.classList.add('hidden');
    document.getElementById('quickReplyPanel')?.classList.add('hidden');
    if (callActive && peers.size > 0) {
      peers.forEach(peer => { peer.onHold = true; peer.stream?.getAudioTracks().forEach(t => t.enabled = false); });
    }
    openChat(caller.xameId);
    await handleIncomingCall(offer, caller.xameId);
    socket?.emit('call-accepted', { recipientId: caller.xameId });
  };
  declineCallBtn.onclick = () => {
    stopCallRing(); 
    incomingCallOverlay.classList.add('hidden');
    document.getElementById('quickReplyPanel')?.classList.add('hidden');
    socket?.emit('call-rejected', { recipientId: caller.xameId, reason: 'user-rejected' });
  };
}

// ── In-call controls ──────────────────────────────────────────────────────
function toggleFrontBackCamera() {
  if (!localStream) return;
  const videoTrack = localStream.getVideoTracks()[0]; if (!videoTrack) return;
  const facingMode = videoTrack.getSettings().facingMode;
  const newMode    = facingMode === 'user' ? 'environment' : 'user';
  navigator.mediaDevices.getUserMedia({ video: { facingMode: newMode }, audio: true })
    .then(newStream => {
      const newVideoTrack = newStream.getVideoTracks()[0];
      peers.forEach(peer => { const sender = peer.pc?.getSenders().find(s => s.track?.kind === 'video'); sender?.replaceTrack(newVideoTrack); });
      localStream.getVideoTracks().forEach(t => t.stop());
      localVideo.srcObject = newStream; localStream = newStream;
    })
    .catch(err => { showNotification('Failed to switch camera'); });
}

exitCallBtn?.addEventListener('click', exitVideoCall);
cameraToggleBtn?.addEventListener('click', toggleFrontBackCamera);
micMuteBtn?.addEventListener('click', () => {
  if (!localStream) return;
  isAudioMuted = !isAudioMuted;
  localStream.getAudioTracks().forEach(t => t.enabled = !isAudioMuted);
  micMuteBtn.textContent = isAudioMuted ? '🔇' : '🎙️';
});
cameraMuteBtn?.addEventListener('click', () => {
  if (!localStream) return;
  isVideoMuted = !isVideoMuted;
  localStream.getVideoTracks().forEach(t => t.enabled = !isVideoMuted);
  cameraMuteBtn.textContent = isVideoMuted ? '📵' : '📹';
});
loudSpeakerBtn?.addEventListener('click', () => {
  isLoudspeakerOn = !isLoudspeakerOn;
  // Use native bridge to switch between earpiece and speaker
  if (window.AndroidBridge && window.AndroidBridge.setSpeaker) {
    window.AndroidBridge.setSpeaker(isLoudspeakerOn);
  }
  loudSpeakerBtn.textContent = isLoudspeakerOn ? '🔊' : '🔈';
});

// Handle Android back button to close call/camera overlay
document.addEventListener('backbutton', function(e) {
  const overlay = document.getElementById('videoCallOverlay');
  if (overlay && !overlay.classList.contains('hidden')) {
    e.preventDefault();
    endCall();
  }
}, false);
