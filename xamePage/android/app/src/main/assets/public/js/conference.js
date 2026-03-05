/*
 * conference.js — XamePage v2.1.1
 *
 * Provides (plain globals, no import/export):
 *   conferenceModule  — singleton ConferenceModule instance
 *
 * Usage:
 *   conferenceModule.create()         // become host, start room
 *   conferenceModule.join(roomId)     // join existing room
 *   conferenceModule.leave()          // leave current room
 *   conferenceModule.setLayout('grid'|'spotlight'|'sidebar')
 *
 * Wiring in app.js / contacts.js:
 *   // #conferenceBtn in chat header:
 *   document.getElementById('conferenceBtn')?.addEventListener('click', () => conferenceModule.create());
 *
 * Depends on globals (must load after):
 *   socket             ← state.js   (bare global; may be null; re-bound on xame:socket-ready)
 *   USER               ← state.js   (bare global; read lazily at call time — NOT at construction)
 *   rtcConfig          ← config.js
 *   uid                ← utils.js
 *   escapeHtml         ← utils.js
 *   showNotification   ← utils.js
 *   screenShareModule  ← screen-share.js
 *
 * Load order: after config.js, state.js, utils.js, screen-share.js — before app.js
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const _CONF_MAX_PARTICIPANTS    = 6;
const _CONF_VAD_INTERVAL_MS     = 150;   // voice activity detection poll interval
const _CONF_VAD_THRESHOLD       = 0.015; // RMS threshold for "speaking"
const _CONF_SPEAKER_DEBOUNCE_MS = 800;   // ms before switching active speaker
const _CONF_LAYOUTS             = ['grid', 'spotlight', 'sidebar'];

// ─────────────────────────────────────────────────────────────────────────────
// ConferenceModule
// ─────────────────────────────────────────────────────────────────────────────
class _ConferenceModule {
  constructor() {
    // Room state
    this._roomId          = null;
    this._isHost          = false;
    this._layout          = 'grid';
    this._activeSpeakerId = null;
    this._screenSharerId  = null;

    // Media
    this._localStream     = null;
    this._audioCtx        = null;
    this._vadInterval     = null;
    this._speakerDebounce = null;

    // peerId → { peerId, displayName, stream, pc, audioAnalyser, muted, videoMuted, handRaised }
    this._participants    = new Map();

    // DOM
    this._overlayEl       = null;
  }

  // ── Lazy current-user accessor ────────────────────────────────────────────────
  // USER is a bare global that is null before login; we read it on demand.
  get _me() {
    return {
      xameId:      USER?.xameId      || '',
      displayName: USER?.preferredName || USER?.firstName || USER?.xameId || 'Me',
    };
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  init() {
    this._injectHTML();
    this._registerSocketHandlers();
    console.log('[ConferenceModule] Initialized');
  }

  /** Create a new conference room (become host) */
  async create() {
    if (!this._me.xameId) { showNotification('Please log in before starting a conference.'); return; }
    if (this._roomId)     { showNotification('You are already in a conference.'); return; }
    await this._joinRoom('room-' + uid(), true);
  }

  /** Join an existing conference room */
  async join(roomId) {
    if (!roomId) return;
    if (this._roomId) { showNotification('You are already in a conference.'); return; }
    await this._joinRoom(roomId, false);
  }

  /** Leave the current conference */
  async leave() {
    if (!this._roomId) return;
    await this._teardown(true);
  }

  // ── Room join / leave ─────────────────────────────────────────────────────────

  async _joinRoom(roomId, isHost) {
    try {
      this._roomId = roomId;
      this._isHost = isHost;

      this._localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this._showOverlay();
      this._addLocalTile();

      if (!socket) throw new Error('Socket not connected');
      socket.emit('conference:join', {
        roomId,
        userId:      this._me.xameId,
        displayName: this._me.displayName,
        isHost,
      });

      this._startVAD();
      showNotification(isHost ? 'Conference created' : 'Joined conference');
    } catch (err) {
      console.error('[ConferenceModule] Failed to join room:', err);
      showNotification('Failed to start conference: ' + err.message);
      await this._teardown(false);
    }
  }

  async _teardown(notify = true) {
    this._stopVAD();
    this._participants.forEach(p => this._closePeer(p.peerId));
    this._participants.clear();

    if (this._localStream) {
      this._localStream.getTracks().forEach(t => t.stop());
      this._localStream = null;
    }
    if (this._audioCtx) {
      try { await this._audioCtx.close(); } catch (_) {}
      this._audioCtx = null;
    }
    if (notify && this._roomId) {
      socket?.emit('conference:leave', { roomId: this._roomId, userId: this._me.xameId });
    }

    this._roomId          = null;
    this._isHost          = false;
    this._activeSpeakerId = null;
    this._screenSharerId  = null;
    this._hideOverlay();
    showNotification('Left conference');
  }

  // ── Peer connection management ────────────────────────────────────────────────

  async _createPeer(peerId, displayName, isInitiator) {
    if (this._participants.has(peerId)) return;

    const pc = new RTCPeerConnection(rtcConfig); // rtcConfig is global from config.js

    const participant = {
      peerId, displayName,
      stream:        new MediaStream(),
      pc,
      audioAnalyser: null,
      muted:         false,
      videoMuted:    false,
      handRaised:    false,
    };

    this._participants.set(peerId, participant);
    this._localStream?.getTracks().forEach(track => pc.addTrack(track, this._localStream));

    pc.ontrack = event => {
      event.streams[0]?.getTracks().forEach(track => participant.stream.addTrack(track));
      this._updateTile(peerId);
      this._setupAudioAnalyser(participant);
    };

    pc.onicecandidate = event => {
      if (event.candidate) {
        socket?.emit('conference:ice', {
          roomId: this._roomId, to: peerId, from: this._me.xameId, candidate: event.candidate,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.iceConnectionState)) {
        console.warn('[ConferenceModule] ICE failed for peer:', peerId);
        this._removeParticipant(peerId);
      }
    };

    // Register with screenShareModule singleton so it can push the screen track
    screenShareModule?.addPeerConnection(peerId, pc);

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket?.emit('conference:offer', {
        roomId: this._roomId, to: peerId, from: this._me.xameId,
        offer, displayName: this._me.displayName,
      });
    }

    this._addRemoteTile(participant);
    this._recalculateLayout();
  }

  async _handleOffer(from, displayName, offer) {
    await this._createPeer(from, displayName, false);
    const participant = this._participants.get(from);
    if (!participant) return;
    const { pc } = participant;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket?.emit('conference:answer', {
      roomId: this._roomId, to: from, from: this._me.xameId, answer,
    });
  }

  async _handleAnswer(from, answer) {
    const p = this._participants.get(from);
    if (p) await p.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  async _handleIce(from, candidate) {
    const p = this._participants.get(from);
    if (!p) return;
    try { await p.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
    catch (err) { console.warn('[ConferenceModule] ICE candidate error:', err); }
  }

  _closePeer(peerId) {
    const p = this._participants.get(peerId);
    if (!p) return;
    try { p.pc.close(); } catch (_) {}
    p.stream.getTracks().forEach(t => t.stop());
    this._participants.delete(peerId);
    screenShareModule?.removePeerConnection(peerId);
  }

  _removeParticipant(peerId) {
    this._closePeer(peerId);
    this._removeTile(peerId);
    this._recalculateLayout();
    showNotification('A participant left the conference');
  }

  // ── Layout management ─────────────────────────────────────────────────────────

  setLayout(layoutType) {
    if (!_CONF_LAYOUTS.includes(layoutType)) return;
    this._layout = layoutType;
    this._applyLayout();
  }

  _recalculateLayout() { this._applyLayout(); }

  _applyLayout() {
    const grid = this._overlayEl?.querySelector('#confGrid');
    if (!grid) return;

    const count = this._participants.size + 1; // +1 for local
    grid.dataset.layout = this._layout;
    grid.dataset.count  = String(count);

    if (this._layout === 'grid') {
      const cols = count <= 1 ? 1 : count <= 4 ? 2 : 3;
      grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    }

    if (this._layout === 'spotlight') {
      const spotlightId = this._screenSharerId || this._activeSpeakerId;
      grid.querySelectorAll('.conf-tile').forEach(tile => {
        tile.classList.toggle('spotlight-main',  tile.dataset.peerId === spotlightId);
        tile.classList.toggle('spotlight-thumb', tile.dataset.peerId !== spotlightId);
      });
    }

    if (this._layout === 'sidebar') {
      grid.querySelectorAll('.conf-tile').forEach((tile, i) => {
        tile.classList.toggle('sidebar-main',  i === 0);
        tile.classList.toggle('sidebar-thumb', i !== 0);
      });
    }
  }

  // ── Tiles ─────────────────────────────────────────────────────────────────────

  _addLocalTile() {
    const grid = this._overlayEl?.querySelector('#confGrid');
    if (!grid) return;
    const tile = this._createTileEl({
      peerId: this._me.xameId, displayName: this._me.displayName + ' (You)',
      stream: this._localStream, isLocal: true,
    });
    grid.appendChild(tile);
    const video = tile.querySelector('video');
    if (video) { video.srcObject = this._localStream; video.muted = true; }
  }

  _addRemoteTile(participant) {
    const grid = this._overlayEl?.querySelector('#confGrid');
    if (!grid) return;
    const tile = this._createTileEl({
      peerId: participant.peerId, displayName: participant.displayName,
      stream: participant.stream, isLocal: false,
    });
    grid.appendChild(tile);
    const video = tile.querySelector('video');
    if (video && participant.stream) video.srcObject = participant.stream;
  }

  _updateTile(peerId) {
    const tile = this._overlayEl?.querySelector(`[data-peer-id="${peerId}"]`);
    const p    = this._participants.get(peerId);
    if (!tile || !p) return;
    const video = tile.querySelector('video');
    if (video && p.stream) video.srcObject = p.stream;
  }

  _removeTile(peerId) {
    this._overlayEl?.querySelector(`[data-peer-id="${peerId}"]`)?.remove();
  }

  _createTileEl({ peerId, displayName, stream, isLocal }) {
    const tile = document.createElement('div');
    tile.className      = 'conf-tile';
    tile.dataset.peerId = peerId;

    tile.innerHTML = `
      <video autoplay playsinline${isLocal ? ' muted' : ''}></video>
      <div class="conf-tile-overlay">
        <span class="conf-tile-name">${escapeHtml(displayName)}</span>
        <div class="conf-tile-indicators">
          <span class="conf-mic-icon">🎙️</span>
          <span class="conf-cam-icon">📹</span>
          <span class="conf-hand-icon hidden">✋</span>
          <span class="conf-speaking-ring hidden"></span>
        </div>
      </div>
      ${this._isHost && !isLocal ? `
        <div class="conf-host-controls">
          <button class="conf-tile-btn" data-action="mute-peer"   data-peer="${escapeHtml(peerId)}" title="Mute">🔇</button>
          <button class="conf-tile-btn" data-action="remove-peer" data-peer="${escapeHtml(peerId)}" title="Remove">✕</button>
        </div>
      ` : ''}
    `;

    const video = tile.querySelector('video');
    if (video && stream) video.srcObject = stream;

    tile.querySelectorAll('.conf-tile-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this._handleTileAction(btn.dataset.action, btn.dataset.peer);
      });
    });

    return tile;
  }

  _handleTileAction(action, peerId) {
    if (!this._isHost) return;
    if (action === 'mute-peer') {
      socket?.emit('conference:mute-peer', { roomId: this._roomId, targetId: peerId });
    } else if (action === 'remove-peer') {
      if (confirm('Remove this participant?')) {
        socket?.emit('conference:remove-peer', { roomId: this._roomId, targetId: peerId });
      }
    }
  }

  // ── Voice activity detection ──────────────────────────────────────────────────

  _startVAD() {
    if (!this._localStream) return;
    try {
      this._audioCtx    = new (window.AudioContext || window.webkitAudioContext)();
      this._vadInterval = setInterval(() => this._pollVAD(), _CONF_VAD_INTERVAL_MS);
    } catch (err) {
      console.warn('[ConferenceModule] VAD setup failed:', err);
    }
  }

  _stopVAD() {
    clearInterval(this._vadInterval); this._vadInterval = null;
    clearTimeout(this._speakerDebounce);
  }

  _setupAudioAnalyser(participant) {
    if (!this._audioCtx || !participant.stream) return;
    try {
      const source   = this._audioCtx.createMediaStreamSource(participant.stream);
      const analyser = this._audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      participant.audioAnalyser = analyser;
    } catch (err) {
      console.warn('[ConferenceModule] Analyser setup failed for peer:', participant.peerId, err);
    }
  }

  _pollVAD() {
    let loudestId = null, loudestRms = 0;
    this._participants.forEach(p => {
      if (!p.audioAnalyser || p.muted) return;
      const data = new Uint8Array(p.audioAnalyser.frequencyBinCount);
      p.audioAnalyser.getByteTimeDomainData(data);
      let sum = 0;
      data.forEach(v => { const n = v / 128 - 1; sum += n * n; });
      const rms = Math.sqrt(sum / data.length);
      if (rms > loudestRms) { loudestRms = rms; loudestId = p.peerId; }
    });
    if (loudestRms < _CONF_VAD_THRESHOLD || !loudestId) return;
    if (loudestId !== this._activeSpeakerId) {
      clearTimeout(this._speakerDebounce);
      this._speakerDebounce = setTimeout(() => this._setActiveSpeaker(loudestId), _CONF_SPEAKER_DEBOUNCE_MS);
    }
  }

  _setActiveSpeaker(peerId) {
    this._activeSpeakerId = peerId;
    this._overlayEl?.querySelectorAll('.conf-tile').forEach(tile => {
      const ring = tile.querySelector('.conf-speaking-ring');
      const isSpeaking = tile.dataset.peerId === peerId;
      ring?.classList.toggle('hidden', !isSpeaking);
      tile.classList.toggle('speaking', isSpeaking);
    });
    if (this._layout === 'spotlight') this._applyLayout();
  }

  // ── Controls ──────────────────────────────────────────────────────────────────

  _toggleMic() {
    const track = this._localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const muted   = !track.enabled;
    const btn     = this._overlayEl?.querySelector('#confMicBtn');
    if (btn) btn.textContent = muted ? '🔇' : '🎙️';
    const localMicIcon = this._overlayEl?.querySelector(`[data-peer-id="${this._me.xameId}"] .conf-mic-icon`);
    if (localMicIcon) localMicIcon.textContent = muted ? '🔇' : '🎙️';
    socket?.emit('conference:mic-toggle', { roomId: this._roomId, userId: this._me.xameId, muted });
  }

  _toggleCamera() {
    const track = this._localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    const hidden  = !track.enabled;
    const btn     = this._overlayEl?.querySelector('#confCamBtn');
    if (btn) btn.textContent = hidden ? '📷' : '📹';
  }

  _toggleHand() {
    const localTile = this._overlayEl?.querySelector(`[data-peer-id="${this._me.xameId}"]`);
    const handIcon  = localTile?.querySelector('.conf-hand-icon');
    const raised    = handIcon?.classList.contains('hidden'); // hidden = not raised → will raise
    handIcon?.classList.toggle('hidden', !raised);
    const btn = this._overlayEl?.querySelector('#confHandBtn');
    btn?.classList.toggle('active', !!raised);
    socket?.emit('conference:raise-hand', { roomId: this._roomId, userId: this._me.xameId, raised: !!raised });
  }

  async _toggleScreenShare() {
    if (!screenShareModule) { showNotification('Screen sharing is not available'); return; }
    if (screenShareModule.isSharing) {
      await screenShareModule.stop();
      this._screenSharerId = null;
    } else {
      try {
        screenShareModule.setCameraTrack(this._localStream?.getVideoTracks()[0] || null);
        this._participants.forEach((p, id) => screenShareModule.addPeerConnection(id, p.pc));
        await screenShareModule.start();
        this._screenSharerId = this._me.xameId;
        this.setLayout('spotlight');
      } catch (err) {
        console.error('[ConferenceModule] Screen share failed:', err);
        showNotification('Screen share failed: ' + err.message);
      }
    }
    this._overlayEl?.querySelector('#confShareBtn')?.classList.toggle('active', !!this._screenSharerId);
  }

  _updateHostControls() {
    const myId = this._me.xameId;
    this._overlayEl?.querySelectorAll(`.conf-tile:not([data-peer-id="${myId}"])`).forEach(tile => {
      if (tile.querySelector('.conf-host-controls')) return;
      const controls = document.createElement('div');
      controls.className = 'conf-host-controls';
      controls.innerHTML = `
        <button class="conf-tile-btn" data-action="mute-peer"   data-peer="${escapeHtml(tile.dataset.peerId)}" title="Mute">🔇</button>
        <button class="conf-tile-btn" data-action="remove-peer" data-peer="${escapeHtml(tile.dataset.peerId)}" title="Remove">✕</button>
      `;
      controls.querySelectorAll('.conf-tile-btn').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          this._handleTileAction(btn.dataset.action, btn.dataset.peer);
        });
      });
      tile.appendChild(controls);
    });
  }

  // ── Invite ────────────────────────────────────────────────────────────────────

  _copyInviteLink() {
    const roomId = this._roomId;
    navigator.clipboard.writeText(roomId)
      .then(()  => showNotification('Room ID copied: ' + roomId))
      .catch(()  => showNotification('Room ID: ' + roomId));
  }

  // ── Socket handlers ───────────────────────────────────────────────────────────

  _registerSocketHandlers() {
    document.addEventListener('xame:socket-ready', () => this._bindSocket());
    if (socket) this._bindSocket();
  }

  _bindSocket() {
    if (!socket) return;
    const on = (event, handler) => { socket.off(event); socket.on(event, handler); };

    on('conference:peer-joined', ({ peerId, displayName }) => {
      if (peerId === this._me.xameId) return;
      if (this._participants.size >= _CONF_MAX_PARTICIPANTS - 1) {
        showNotification(`Conference is full (max ${_CONF_MAX_PARTICIPANTS} participants)`); return;
      }
      showNotification(displayName + ' joined the conference');
      this._createPeer(peerId, displayName, true);
    });

    on('conference:offer',  async ({ from, displayName, offer })  => { if (this._roomId) await this._handleOffer(from, displayName, offer); });
    on('conference:answer', async ({ from, answer })               => { await this._handleAnswer(from, answer); });
    on('conference:ice',    async ({ from, candidate })            => { await this._handleIce(from, candidate); });

    on('conference:peer-left', ({ peerId, displayName }) => {
      showNotification(displayName + ' left the conference');
      this._removeParticipant(peerId);
    });

    on('conference:mic-toggle', ({ userId, muted }) => {
      const p = this._participants.get(userId);
      if (!p) return;
      p.muted = muted;
      const icon = this._overlayEl?.querySelector(`[data-peer-id="${userId}"] .conf-mic-icon`);
      if (icon) icon.textContent = muted ? '🔇' : '🎙️';
    });

    on('conference:raise-hand', ({ userId, raised }) => {
      const p = this._participants.get(userId);
      if (!p) return;
      p.handRaised = raised;
      const handIcon = this._overlayEl?.querySelector(`[data-peer-id="${userId}"] .conf-hand-icon`);
      handIcon?.classList.toggle('hidden', !raised);
      if (raised) showNotification(p.displayName + ' raised their hand ✋');
    });

    on('conference:muted-by-host', () => {
      const track = this._localStream?.getAudioTracks()[0];
      if (track) track.enabled = false;
      const btn = this._overlayEl?.querySelector('#confMicBtn');
      if (btn) btn.textContent = '🔇';
      showNotification('You were muted by the host');
    });

    on('conference:removed-by-host', () => {
      showNotification('You were removed from the conference');
      this._teardown(false);
    });

    on('conference:screen-share-started', ({ userId }) => {
      this._screenSharerId = userId; this.setLayout('spotlight');
    });

    on('conference:screen-share-stopped', () => {
      this._screenSharerId = null; this.setLayout('grid');
    });

    on('conference:room-closed', () => {
      showNotification('Conference ended by host'); this._teardown(false);
    });
  }

  // ── UI ────────────────────────────────────────────────────────────────────────

  _injectHTML() {
    if (document.getElementById('conferenceOverlay')) return;

    const overlay = document.createElement('div');
    overlay.id        = 'conferenceOverlay';
    overlay.className = 'conf-overlay hidden';
    overlay.innerHTML = `
      <div class="conf-header">
        <div class="conf-header-left">
          <button class="icon-btn" id="confCloseBtn" title="Close">←</button>
          <span class="conf-room-id"           id="confRoomId"></span>
          <span class="conf-participant-count"  id="confParticipantCount">1 participant</span>
        </div>
        <div class="conf-header-right">
          <button class="icon-btn" id="confLayoutBtn" title="Change layout">⊞</button>
          <button class="icon-btn" id="confInviteBtn" title="Copy invite link">🔗</button>
        </div>
      </div>
      <div class="conf-grid" id="confGrid" data-layout="grid" data-count="1"></div>
      <div class="conf-controls">
        <button class="conf-ctrl-btn"        id="confMicBtn"   title="Toggle mic">🎙️</button>
        <button class="conf-ctrl-btn"        id="confCamBtn"   title="Toggle camera">📹</button>
        <button class="conf-ctrl-btn"        id="confHandBtn"  title="Raise hand">✋</button>
        <button class="conf-ctrl-btn"        id="confShareBtn" title="Share screen">🖥️</button>
        <button class="conf-ctrl-btn danger" id="confLeaveBtn" title="Leave conference">📞</button>
      </div>
    `;

    document.body.appendChild(overlay);
    this._overlayEl = overlay;
    this._bindOverlayControls();
  }

  _bindOverlayControls() {
    const g = id => this._overlayEl?.querySelector('#' + id);
    g('confMicBtn')  ?.addEventListener('click', () => this._toggleMic());
    g('confCamBtn')  ?.addEventListener('click', () => this._toggleCamera());
    g('confHandBtn') ?.addEventListener('click', () => this._toggleHand());
    g('confShareBtn')?.addEventListener('click', () => this._toggleScreenShare());
    g('confCloseBtn')?.addEventListener('click', () => this.leave());
    g('confLeaveBtn')?.addEventListener('click', () => this.leave());
    g('confInviteBtn')?.addEventListener('click',() => this._copyInviteLink());
    g('confLayoutBtn')?.addEventListener('click', () => {
      const idx  = _CONF_LAYOUTS.indexOf(this._layout);
      const next = _CONF_LAYOUTS[(idx + 1) % _CONF_LAYOUTS.length];
      this.setLayout(next);
      showNotification('Layout: ' + next.charAt(0).toUpperCase() + next.slice(1));
    });
  }

  _showOverlay() {
    if (!this._overlayEl) this._injectHTML();
    this._overlayEl.classList.remove('hidden');
    const roomIdEl = this._overlayEl.querySelector('#confRoomId');
    if (roomIdEl) roomIdEl.textContent = 'Room: ' + this._roomId;
    this._updateParticipantCount();
  }

  _hideOverlay() {
    this._overlayEl?.classList.add('hidden');
    const grid = this._overlayEl?.querySelector('#confGrid');
    if (grid) grid.innerHTML = '';
  }

  _updateParticipantCount() {
    const el    = this._overlayEl?.querySelector('#confParticipantCount');
    if (!el) return;
    const total = this._participants.size + 1;
    el.textContent = `${total} participant${total !== 1 ? 's' : ''}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────
const conferenceModule = new _ConferenceModule();

// Re-bind socket handlers whenever the socket (re)connects
document.addEventListener('xame:socket-ready', () => conferenceModule._bindSocket());
