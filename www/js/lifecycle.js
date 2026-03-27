/*
 * lifecycle.js
 * Visibility change, beforeunload, online/offline handlers.
 * XamePage v2.1
 *
 * Depends on: state.js, utils.js, messaging.js (renderMessages, cleanupWaveSurfers),
 *             socket.js (connectSocket, startHeartbeat, stopHeartbeat),
 *             webrtc.js (endCall), audio.js (stopCallRing, stopOutgoingRing)
 */

// ── Visibility change ─────────────────────────────────────────────────────
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('📴 Tab hidden - maintaining background presence');
    // Do NOT stop heartbeat — keep user online in background

    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (window.AndroidBridge?.stopSpeaking) window.AndroidBridge.stopSpeaking();

    if (speechRecognizer?.running) speechRecognizer.stop();

    RESOURCES.wavesurfers.forEach((ws) => {
      if (ws?.isPlaying?.()) ws.pause();
    });
  } else {
    console.log('📱 Tab visible - refreshing presence');

    if (socket?.connected && USER?.xameId) {
      socket.emit('user-online',         { userId: USER.xameId });
      socket.emit('request_online_users');
    }

    if (ACTIVE_ID) scheduleRender(renderMessages, 'messages');
  }
});

// ── Page unload ────────────────────────────────────────────────────────────
window.addEventListener('beforeunload', () => {
  console.log('🔄 Page unloading...');
  try {
    cleanupWaveSurfers();

    if (cropper) cropper.destroy();

    endCall();

    RESOURCES.mediaRecorders.forEach(recorder => {
      if (recorder.state === 'recording') recorder.stop();
    });

    if (socket) { socket.removeAllListeners(); socket.disconnect(); }

    renderScheduled = false;

    console.log('✅ Cleanup complete');
  } catch (error) {
    console.error('❌ Cleanup error:', error);
  }
});

// ── Online / Offline ──────────────────────────────────────────────────────
window.addEventListener('online', () => {
  console.log('🌐 Network restored');
  showNotification('Connection restored');
  if (USER) { connectSocket(); if (localStorage.getItem('xame:stealth') === 'true') { setTimeout(startStealthMode, 1000); } else { startHeartbeat(); } }
});

window.addEventListener('offline', () => {
  console.log('📡 Network lost');
  showNotification('Connection lost. You are offline.');
  stopHeartbeat();
});

// ── Global error handlers ─────────────────────────────────────────────────
window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  event.preventDefault();
});
