import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'socket_service.dart';

class WebRTCService {
  final SocketService _socket;
  MediaStream? localStream;
  Map<String, RTCPeerConnection> peers = {};
  
  WebRTCService(this._socket);

  // Replaces the rtcConfig in your JS
  Map<String, dynamic> configuration = {
    'iceServers': [
      {'urls': 'stun:stun.l.google.com:19302'},
    ]
  };

  Future<void> startCall(String remoteUserId, bool isVideo) async {
    // 1. Get Local Media
    final Map<String, dynamic> constraints = {
      'audio': true,
      'video': isVideo ? {'facingMode': 'user'} : false,
    };
    
    localStream = await navigator.mediaDevices.getUserMedia(constraints);

    // 2. Create Peer Connection
    RTCPeerConnection pc = await createPeerConnection(configuration);
    peers[remoteUserId] = pc;

    // 3. Add tracks to Peer
    localStream!.getTracks().forEach((track) {
      pc.addTrack(track, localStream!);
    });

    // 4. Create Offer (Mirroring your startCall JS logic)
    RTCSessionDescription offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    _socket.socket?.emit('call-user', {
      'recipientId': remoteUserId,
      'offer': offer.toMap(),
      'callType': isVideo ? 'video' : 'voice',
    });
  }

  Future<void> handleAnswer(String remoteUserId, dynamic answer) async {
    var pc = peers[remoteUserId];
    if (pc != null) {
      await pc.setRemoteDescription(
        RTCSessionDescription(answer['sdp'], answer['type'])
      );
    }
  }

  void endCall() {
    localStream?.dispose();
    peers.forEach((key, pc) => pc.dispose());
    peers.clear();
  }
}
