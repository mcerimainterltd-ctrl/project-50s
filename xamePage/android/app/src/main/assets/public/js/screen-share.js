/*
 * screen-share.js — XamePage v2.1.1
 *
 * Provides (plain globals, no import/export):
 *   screenShareModule  — singleton ScreenShareModule instance
 *
 * Usage from webrtc.js (1-to-1 screen share):
 *   // On "Share screen" button click:
 *   screenShareModule.setCameraTrack(localStream.getVideoTracks()[0]);
 *   screenShareModule.addPeerConnection('remote', peerConnection);
 *   await screenShareModule.start();
 *   // To stop:
 *   await screenShareModule.stop();
 *
 * Usage from conference.js (injected via this._screenShare):
 *   conferenceModule is constructed with screenShareModule already wired.
 *
 * Depends on globals (must load after):
 *   socket  ← state.js  (bare global; may be null)
 *
 * Load order: after state.js — before webrtc.js, conference.js, app.js
 */

// ─────────────────────────────────────────────────────────────────────────────
// Browser support detection (IIFE so it runs once at parse time)
// ─────────────────────────────────────────────────────────────────────────────
const _SS_SUPPORT = (() => {
  const ua        = navigator.userAgent;
  const supported = !!(navigator.mediaDevices?.getDisplayMedia);
  const isIOS     = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isAndroid = /Android/.test(ua);
  return {
    supported:   supported && !isIOS && !isAndroid,
    audioShare:  /Chrome|Edge/.test(ua) && !/Firefox/.test(ua) && !isIOS && !isAndroid,
    isIOS,
    isAndroid,
    reason: (isIOS || isAndroid)
      ? 'Screen sharing is not supported on mobile devices.'
      : !supported
        ? 'Your browser does not support screen sharing.'
        : null,
  };
})();

// ─────────────────────────────────────────────────────────────────────────────
// ScreenShareModule
// ─────────────────────────────────────────────────────────────────────────────
class _ScreenShareModule {
  constructor() {
    // Map of peerId → RTCPeerConnection
    // webrtc.js adds its single connection; conference.js adds all mesh peers.
    this.peerConnections  = new Map();

    this._stream          = null;
    this._originalTrack   = null; // camera track to restore after stop
    this._isSharing       = false;
    this._isPaused        = false;
    this._onStopCallbacks = [];

    this._injectHTML();
    this._bindEvents();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  get isSharing()   { return this._isSharing; }
  get isSupported() { return _SS_SUPPORT.supported; }

  /** Static compatibility check — call before showing the "Share" button */
  static checkSupport() { return { ..._SS_SUPPORT }; }

  /**
   * Start screen sharing.
   * @param {object} opts
   * @param {boolean} opts.preferAudio  request tab audio if Chrome/Edge (default true)
   * @param {string}  opts.surface      'monitor'|'window'|'browser'|null
   * @returns {MediaStream}
   */
  async start({ preferAudio = true, surface = null } = {}) {
    if (!_SS_SUPPORT.supported) throw new Error(_SS_SUPPORT.reason || 'Screen sharing not supported.');
    if (this._isSharing) await this.stop();

    const videoConstraints = {
      cursor:    'always',
      width:     { max: 1920 },
      height:    { max: 1080 },
      frameRate: { max: 30 },
      ...(surface ? { displaySurface: surface } : {}),
    };

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraints,
        audio: preferAudio && _SS_SUPPORT.audioShare
          ? { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 }
          : false,
      });
    } catch (err) {
      if (err.name === 'NotAllowedError')   throw new Error('Permission denied. Please allow screen sharing in your browser.');
      if (err.name === 'NotFoundError')     throw new Error('No screen or window was selected.');
      if (err.name === 'NotSupportedError') throw new Error(_SS_SUPPORT.reason || 'Screen sharing is not supported.');
      throw err;
    }

    this._stream    = stream;
    this._isSharing = true;
    this._isPaused  = false;

    const screenVideoTrack = stream.getVideoTracks()[0];
    await this._replaceVideoTrack(screenVideoTrack);

    // Hook browser's native "Stop sharing" button
    screenVideoTrack.onended = () => this.stop();

    this._enterPresentationMode();
    // socket is the bare global from state.js
    socket?.emit('screen-share:started');

    return stream;
  }

  /** Stop screen sharing and revert to camera */
  async stop() {
    if (!this._isSharing) return;

    this._stream?.getTracks().forEach(t => t.stop());
    this._stream    = null;
    this._isSharing = false;
    this._isPaused  = false;

    if (this._originalTrack) {
      await this._replaceVideoTrack(this._originalTrack);
      this._originalTrack = null;
    }

    this._exitPresentationMode();
    socket?.emit('screen-share:stopped');
    this._onStopCallbacks.forEach(fn => fn());
  }

  /** Pause: mute the video track without dropping the connection */
  pause() {
    if (!this._isSharing || this._isPaused) return;
    this._isPaused = true;
    const videoTrack = this._stream?.getVideoTracks()[0];
    if (videoTrack) videoTrack.enabled = false;
    this._updateBannerText('Paused – Screen Share');
    socket?.emit('screen-share:paused');
  }

  /** Resume after pause */
  resume() {
    if (!this._isSharing || !this._isPaused) return;
    this._isPaused = false;
    const videoTrack = this._stream?.getVideoTracks()[0];
    if (videoTrack) videoTrack.enabled = true;
    this._updateBannerText('You are presenting');
    socket?.emit('screen-share:resumed');
  }

  /**
   * Register the current camera video track so it can be restored on stop.
   * Call this before start().
   */
  setCameraTrack(track) {
    if (track) this._originalTrack = track;
  }

  /**
   * Add a peer connection that should receive the screen video track.
   * webrtc.js calls this with 'remote' + peerConnection.
   * conference.js calls this for each mesh peer.
   */
  addPeerConnection(peerId, pc) {
    this.peerConnections.set(peerId, pc);
    // If already sharing, push the screen track to this new connection immediately
    if (this._isSharing) {
      const screenTrack = this._stream?.getVideoTracks()[0];
      if (screenTrack) {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
        sender?.replaceTrack(screenTrack);
      }
    }
  }

  removePeerConnection(peerId) {
    this.peerConnections.delete(peerId);
  }

  /** Register a callback to run when sharing stops */
  onStop(fn) { this._onStopCallbacks.push(fn); }

  // ── Private: replace video track in all peer connections ─────────────────────

  async _replaceVideoTrack(newTrack) {
    const promises = [];
    for (const [, pc] of this.peerConnections) {
      const sender = pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender && newTrack) promises.push(sender.replaceTrack(newTrack));
    }
    await Promise.allSettled(promises);
  }

  // ── Presentation mode UI ─────────────────────────────────────────────────────

  _injectHTML() {
    if (document.getElementById('screenShareBanner')) return;

    const banner = document.createElement('div');
    banner.id        = 'screenShareBanner';
    banner.className = 'screen-share-banner hidden';
    banner.innerHTML = `
      <div class="ssb-inner">
        <span class="ssb-dot"></span>
        <span class="ssb-text">You are presenting</span>
        <div class="ssb-actions">
          <button class="ssb-btn" id="ssbPauseBtn" data-action="ss-pause">Pause</button>
          <button class="ssb-btn ssb-stop" id="ssbStopBtn" data-action="ss-stop">Stop Sharing</button>
        </div>
      </div>
    `;
    document.body.appendChild(banner);

    // Unsupported-browser toast (hidden by default; shown on start() error if needed)
    if (!document.getElementById('screenShareUnsupported')) {
      const hint = document.createElement('div');
      hint.id        = 'screenShareUnsupported';
      hint.className = 'xp-toast xp-toast-error hidden';
      hint.textContent = _SS_SUPPORT.reason || '';
      document.body.appendChild(hint);
    }
  }

  _bindEvents() {
    document.addEventListener('click', async e => {
      const btn = e.target.closest('[data-action^="ss-"]');
      if (!btn) return;
      if (btn.dataset.action === 'ss-stop') {
        await this.stop();
      } else if (btn.dataset.action === 'ss-pause') {
        if (this._isPaused) { this.resume(); btn.textContent = 'Pause'; }
        else                { this.pause();  btn.textContent = 'Resume'; }
      }
    });
  }

  _enterPresentationMode() {
    document.getElementById('screenShareBanner')?.classList.remove('hidden');
    document.getElementById('localVideo')?.classList.add('presenting');
    document.getElementById('remoteVideo')?.classList.add('presenting');
  }

  _exitPresentationMode() {
    document.getElementById('screenShareBanner')?.classList.add('hidden');
    document.getElementById('localVideo')?.classList.remove('presenting');
    document.getElementById('remoteVideo')?.classList.remove('presenting');
  }

  _updateBannerText(text) {
    const el = document.querySelector('#screenShareBanner .ssb-text');
    if (el) el.textContent = text;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────
const screenShareModule = new _ScreenShareModule();
