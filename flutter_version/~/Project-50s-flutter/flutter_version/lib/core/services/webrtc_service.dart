// lib/core/services/webrtc_service.dart
// Exact mirror of webrtc.js — XamePage v2.1
//
// Mirrors:
//   peers Map       → _peers Map<String, PeerEntry>
//   startCall()     → startCall()
//   handleIncomingCall() → handleIncomingCall()
//   handleAnswer()  → handleAnswer()
//   handleNewIceCandidate() → handleNewIceCandidate()
//   addCall()       → addCall()
//   mergeCalls()    → mergeCalls()
//   endCall()       → endCall()
//   exitVideoCall() → exitVideoCall()
//   toggleFrontBackCamera() → toggleCamera()
//   Audio mixer (initAudioMixer, addStreamToMixer) → handled via flutter_webrtc

import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import '../config/constants.dart';
import 'socket_service.dart';

// ── Provider ──────────────────────────────────────────────────────────────
final webRTCServiceProvider = Provider<WebRTCService>((ref) {
  final socket = ref.read(socketServiceProvider);
  return WebRTCService(socket);
});

// ── Call state machine ────────────────────────────────────────────────────
// Mirrors: callActive bool + peers.size state
enum CallState { idle, outgoing, incoming, active, ended }

// ── PeerEntry — mirrors: peers Map entry { pc, stream, onHold } ──────────
class PeerEntry {
  RTCPeerConnection pc;
  MediaStream?      stream;
  bool              onHold;
  PeerEntry({required this.pc, this.stream, this.onHold = false});
}

// ── WebRTCService ─────────────────────────────────────────────────────────
class WebRTCService {
  final SocketService _socket;

  // Mirrors: const peers = new Map()
  final Map<String, PeerEntry> _peers = {};

  // Mirrors: localStream, remoteStream globals
  MediaStream? localStream;
  MediaStream? remoteStream;

  // Mirrors: pendingIceCandidates = []
  final List<RTCIceCandidate> _pendingIceCandidates = [];

  // Mirrors: callActive, isAudioMuted, isVideoMuted, isLoudspeakerOn
  bool callActive      = false;
  bool isAudioMuted    = false;
  bool isVideoMuted    = false;
  bool isLoudspeakerOn = false;

  // Mirrors: _callTimerSeconds / _callTimerInterval
  int    _callTimerSeconds = 0;
  Timer? _callTimerTimer;
  Timer? _callTimeoutTimer;

  // Stream controllers for UI
  final _callStateCtrl     = StreamController<CallState>.broadcast();
  final _callTimerCtrl     = StreamController<String>.broadcast();       // "MM:SS"
  final _peersChangedCtrl  = StreamController<Map<String, PeerEntry>>.broadcast();
  final _remoteStreamCtrl  = StreamController<MediaStream>.broadcast();

  Stream<CallState>              get callState     => _callStateCtrl.stream;
  Stream<String>                 get callTimer     => _callTimerCtrl.stream;
  Stream<Map<String, PeerEntry>> get peersChanged  => _peersChangedCtrl.stream;
  Stream<MediaStream>            get remoteStream$ => _remoteStreamCtrl.stream;

  // Public read-only peers access
  Map<String, PeerEntry> get peers => Map.unmodifiable(_peers);
  int get peerCount => _peers.length;

  // MethodChannel for AndroidBridge (setCallAudioMode, setSpeaker)
  // Mirrors: window.AndroidBridge.setCallAudioMode(true/false)
  //          window.AndroidBridge.setSpeaker(bool)
  static const _androidBridge = MethodChannel(AppConstants.channelAndroidBridge);

  WebRTCService(this._socket) {
    _listenToSocketEvents();
  }

  // ── _listenToSocketEvents() ───────────────────────────────────────────────
  // Mirrors the socket.on('make-answer'), socket.on('ice-candidate') handlers
  // that were wired inside connectSocket() in socket.js
  void _listenToSocketEvents() {
    _socket.callAnswer.listen((data) async {
      await handleAnswer(data.answer, data.senderId);
    });
    _socket.iceCandidate.listen((data) {
      handleNewIceCandidate(data.candidate, data.senderId);
    });
    _socket.callEnded.listen((senderId) {
      exitVideoCall();
    });
    _socket.callRejected.listen((data) {
      if (data.reason == 'ended') { exitVideoCall(); return; }
      if (data.senderId != null && _peers.containsKey(data.senderId)) {
        removePeer(data.senderId!);
      }
      if (_peers.isEmpty) exitVideoCall();
    });
  }

  // ── createPeerConnection() — mirrors createPeerConnection(userId) ─────────
  Future<RTCPeerConnection> _createPeerConnection(String userId) async {
    // Mirrors: const pc = new RTCPeerConnection(rtcConfig)
    // rtcConfig has STUN + TURN from config.js
    final pc = await createPeerConnection({
      'iceServers': AppConstants.iceServers,
      'sdpSemantics': 'unified-plan',
    });

    // Mirrors: pc.ontrack = (event) => { ... }
    pc.onTrack = (RTCTrackEvent event) {
      if (event.streams.isEmpty) return;
      final stream = event.streams[0];
      final peer   = _peers[userId];
      if (peer != null) peer.stream = stream;

      // Mirrors: if (peers.size === 1) remoteVideo.srcObject = stream
      remoteStream = stream;
      _remoteStreamCtrl.add(stream);

      // Start call timer when first remote track arrives
      if (_callTimerTimer == null) _startCallTimer();
      _peersChangedCtrl.add(Map.from(_peers));
    };

    // Mirrors: pc.oniceconnectionstatechange
    pc.onIceConnectionState = (RTCIceConnectionState state) {
      debugPrint('ICE [$userId]: $state');
      if (state == RTCIceConnectionState.RTCIceConnectionStateConnected &&
          _callTimerTimer == null) {
        _startCallTimer();
      }
      if (state == RTCIceConnectionState.RTCIceConnectionStateFailed ||
          state == RTCIceConnectionState.RTCIceConnectionStateDisconnected) {
        removePeer(userId);
      }
    };

    // Mirrors: pc.onicecandidate = (event) => socket.emit('ice-candidate', {...})
    pc.onIceCandidate = (RTCIceCandidate? candidate) {
      if (candidate != null) {
        _socket.emitIceCandidate(userId, candidate.toMap());
      }
    };

    return pc;
  }

  // ── startCall() — mirrors startCall(recipientId, callType) ───────────────
  Future<void> startCall(String recipientId, String callType) async {
    try {
      final hasVideo = callType == 'video';

      // Mirrors: localStream = await navigator.mediaDevices.getUserMedia(...)
      localStream ??= await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': hasVideo,
      });

      // Set earpiece BEFORE audio plays — mirrors: AndroidBridge.setCallAudioMode(true)
      isLoudspeakerOn = false;
      await _setCallAudioMode(true);

      final pc = await _createPeerConnection(recipientId);
      _peers[recipientId] = PeerEntry(pc: pc);

      // Add local tracks — mirrors: localStream.getTracks().forEach(track => pc.addTrack(...))
      localStream!.getTracks().forEach((track) {
        pc.addTrack(track, localStream!);
      });

      // Create offer — mirrors: const offer = await pc.createOffer()
      final offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Mirrors: socket.emit('call-user', { recipientId, offer, callType })
      _socket.emitCallUser(recipientId, offer.toMap(), callType);

      callActive = true;
      _callStateCtrl.add(CallState.outgoing);
      _peersChangedCtrl.add(Map.from(_peers));

      // 60-second auto-timeout — mirrors window._callTimeouts
      _callTimeoutTimer?.cancel();
      _callTimeoutTimer = Timer(
        Duration(seconds: AppConstants.callTimeoutSeconds),
        () {
          if (!callActive || _peers.isEmpty ||
              (_peers.length == 1 && _peers.values.first.stream == null)) {
            exitVideoCall();
          }
        },
      );

    } catch (e) {
      debugPrint('Call error: $e');
      await exitVideoCall();
      rethrow;
    }
  }

  // ── handleIncomingCall() — mirrors handleIncomingCall(offer, callerId) ────
  Future<void> handleIncomingCall(dynamic offer, String callerId, {bool isVideo = false}) async {
    try {
      localStream ??= await navigator.mediaDevices.getUserMedia({
        'audio': true,
        'video': isVideo,
      });

      // Set earpiece — mirrors: AndroidBridge.setCallAudioMode(true)
      isLoudspeakerOn = false;
      await _setCallAudioMode(true);

      final pc = await _createPeerConnection(callerId);
      _peers[callerId] = PeerEntry(pc: pc);

      localStream!.getTracks().forEach((track) => pc.addTrack(track, localStream!));

      // Mirrors: await pc.setRemoteDescription(new RTCSessionDescription(offer))
      await pc.setRemoteDescription(RTCSessionDescription(offer['sdp'], offer['type']));

      // Mirrors: const answer = await pc.createAnswer()
      final answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Mirrors: socket.emit('make-answer', { recipientId: callerId, answer })
      _socket.emitMakeAnswer(callerId, answer.toMap());

      // Flush pending ICE candidates
      for (final candidate in _pendingIceCandidates) {
        try { await pc.addCandidate(candidate); } catch (_) {}
      }
      _pendingIceCandidates.clear();

      callActive = true;
      _callStateCtrl.add(CallState.active);
      _peersChangedCtrl.add(Map.from(_peers));

      // 60-second timeout
      _callTimeoutTimer?.cancel();
      _callTimeoutTimer = Timer(
        Duration(seconds: AppConstants.callTimeoutSeconds),
        () {
          if (!callActive || _peers.isEmpty) exitVideoCall();
        },
      );

    } catch (e) {
      debugPrint('Failed to handle incoming call: $e');
      await exitVideoCall();
      rethrow;
    }
  }

  // ── handleAnswer() — mirrors handleAnswer(answer, fromUserId) ─────────────
  Future<void> handleAnswer(dynamic answer, String fromUserId) async {
    final peer = _peers[fromUserId] ?? (_peers.isNotEmpty ? _peers.values.first : null);
    if (peer == null) return;
    try {
      await peer.pc.setRemoteDescription(RTCSessionDescription(answer['sdp'], answer['type']));

      // Flush pending ICE candidates
      for (final candidate in _pendingIceCandidates) {
        try { await peer.pc.addCandidate(candidate); } catch (_) {}
      }
      _pendingIceCandidates.clear();
      _callStateCtrl.add(CallState.active);
    } catch (e) {
      debugPrint('Failed to handle answer: $e');
      await exitVideoCall();
    }
  }

  // ── handleNewIceCandidate() — mirrors handleNewIceCandidate(candidate, fromUserId) ──
  void handleNewIceCandidate(dynamic candidate, String fromUserId) {
    final peer = _peers[fromUserId] ?? (_peers.isNotEmpty ? _peers.values.first : null);
    final pc   = peer?.pc;

    final iceCandidate = RTCIceCandidate(
      candidate['candidate'],
      candidate['sdpMid'],
      candidate['sdpMLineIndex'],
    );

    if (pc == null) {
      // Mirrors: pendingIceCandidates.push(candidate)
      _pendingIceCandidates.add(iceCandidate);
      return;
    }
    // Mirrors: if (pc.remoteDescription) pc.addIceCandidate(...)
    pc.addCandidate(iceCandidate).catchError((e) => debugPrint('ICE error: $e'));
  }

  // ── addCall() — mirrors addCall(recipientId) ──────────────────────────────
  // Adds a new participant to an active call (hold existing, call new)
  Future<void> addCall(String recipientId) async {
    if (!callActive || localStream == null) return;

    // Put existing peers on hold — mirrors: peers.forEach(peer => peer.onHold=true; ...)
    _peers.forEach((_, peer) {
      peer.onHold = true;
      peer.stream?.getAudioTracks().forEach((t) => t.enabled = false);
    });

    try {
      final pc = await _createPeerConnection(recipientId);
      _peers[recipientId] = PeerEntry(pc: pc);

      localStream!.getTracks().forEach((track) => pc.addTrack(track, localStream!));

      final offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      _socket.emitCallUser(recipientId, offer.toMap(), 'voice');
      _peersChangedCtrl.add(Map.from(_peers));

    } catch (e) {
      debugPrint('Add call failed: $e');
      // Restore hold state on failure — mirrors: peers.forEach(peer => peer.onHold=false...)
      _peers.forEach((_, peer) {
        peer.onHold = false;
        peer.stream?.getAudioTracks().forEach((t) => t.enabled = true);
      });
    }
  }

  // ── mergeCalls() — mirrors mergeCalls() ──────────────────────────────────
  // Unmutes all peers on hold, merged audio handled by flutter_webrtc natively
  void mergeCalls() {
    if (_peers.length < 2) return;
    _peers.forEach((_, peer) {
      peer.onHold = false;
      peer.stream?.getAudioTracks().forEach((t) => t.enabled = true);
    });
    _peersChangedCtrl.add(Map.from(_peers));
  }

  // ── removePeer() — mirrors removePeer(userId) ────────────────────────────
  void removePeer(String userId) {
    final peer = _peers[userId];
    if (peer == null) return;

    peer.pc.onTrack              = null;
    peer.pc.onIceConnectionState = null;
    peer.pc.onIceCandidate       = null;
    peer.pc.close();
    peer.stream?.getTracks().forEach((t) => t.stop());

    _peers.remove(userId);
    _peersChangedCtrl.add(Map.from(_peers));

    // Mirrors: if (peers.size === 0) exitVideoCall()
    if (_peers.isEmpty) exitVideoCall();
  }

  // ── exitVideoCall() — mirrors exitVideoCall() ─────────────────────────────
  Future<void> exitVideoCall() async {
    _callTimeoutTimer?.cancel();

    // Notify all peers — mirrors: _notifyIds.forEach(uid => socket.emit('call-ended', ...))
    _peers.keys.toList().forEach((uid) {
      _socket.emitCallEnded(uid);
    });

    await endCall();
    _callStateCtrl.add(CallState.ended);
  }

  // ── endCall() — mirrors endCall() ────────────────────────────────────────
  Future<void> endCall() async {
    // Close all peer connections — mirrors: peers.forEach(peer => { pc.close(); })
    for (final peer in _peers.values) {
      try {
        peer.pc.onTrack              = null;
        peer.pc.onIceConnectionState = null;
        peer.pc.onIceCandidate       = null;
        await peer.pc.close();
      } catch (_) {}
    }
    _peers.clear();

    // Stop all streams
    localStream?.getTracks().forEach((t) => t.stop());
    await localStream?.dispose();
    localStream = null;

    remoteStream?.getTracks().forEach((t) => t.stop());
    await remoteStream?.dispose();
    remoteStream = null;

    _pendingIceCandidates.clear();
    _stopCallTimer();

    isAudioMuted    = false;
    isVideoMuted    = false;
    isLoudspeakerOn = false;
    callActive      = false;

    // Reset to normal audio mode — mirrors: AndroidBridge.setCallAudioMode(false)
    await _setCallAudioMode(false);

    _peersChangedCtrl.add({});
  }

  // ── toggleAudio() — mirrors micMuteBtn click handler ─────────────────────
  void toggleAudio() {
    isAudioMuted = !isAudioMuted;
    localStream?.getAudioTracks().forEach((t) => t.enabled = !isAudioMuted);
  }

  // ── toggleVideo() — mirrors cameraMuteBtn click handler ──────────────────
  void toggleVideo() {
    isVideoMuted = !isVideoMuted;
    localStream?.getVideoTracks().forEach((t) => t.enabled = !isVideoMuted);
  }

  // ── toggleCamera() — mirrors toggleFrontBackCamera() ─────────────────────
  Future<void> toggleCamera() async {
    final tracks = localStream?.getVideoTracks();
    if (tracks == null || tracks.isEmpty) return;
    await Helper.switchCamera(tracks[0]);
  }

  // ── toggleSpeaker() — mirrors loudSpeakerBtn click handler ───────────────
  // Mirrors: AndroidBridge.setSpeaker(isLoudspeakerOn)
  Future<void> toggleSpeaker() async {
    isLoudspeakerOn = !isLoudspeakerOn;
    try {
      await _androidBridge.invokeMethod('setSpeaker', isLoudspeakerOn);
    } catch (_) {
      // Fall back to flutter_webrtc helper
      await Helper.setSpeakerphoneOn(isLoudspeakerOn);
    }
  }

  // ── _startCallTimer() — mirrors _startCallTimer() ────────────────────────
  void _startCallTimer() {
    _callTimerSeconds = 0;
    _callTimerTimer?.cancel();
    _callTimerCtrl.add('00:00');
    _callTimerTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      _callTimerSeconds++;
      final m = (_callTimerSeconds ~/ 60).toString().padLeft(2, '0');
      final s = (_callTimerSeconds  % 60).toString().padLeft(2, '0');
      _callTimerCtrl.add('$m:$s');
    });
  }

  void _stopCallTimer() {
    _callTimerTimer?.cancel();
    _callTimerTimer    = null;
    _callTimerSeconds  = 0;
  }

  // ── AndroidBridge helpers ─────────────────────────────────────────────────
  // Mirrors: window.AndroidBridge.setCallAudioMode(true/false)
  Future<void> _setCallAudioMode(bool callMode) async {
    try {
      await _androidBridge.invokeMethod('setCallAudioMode', callMode);
    } catch (_) {}
  }

  void dispose() {
    endCall();
    _callStateCtrl.close();
    _callTimerCtrl.close();
    _peersChangedCtrl.close();
    _remoteStreamCtrl.close();
  }
}
