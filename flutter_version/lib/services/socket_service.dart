import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SocketService {
  IO.Socket? socket;
  Timer? _heartbeatTimer;
  Timer? _stealthTimer;
  final _storage = const FlutterSecureStorage();

  void connect(String userId) {
    if (socket?.connected == true) return;

    socket = IO.io('https://project-50s.onrender.com', 
      IO.OptionBuilder()
        .setTransports(['websocket']) // Force websocket for native performance
        .setQuery({'userId': userId})
        .enableAutoConnect()
        .build()
    );

    _registerHandlers();
    socket!.connect();
  }

  void _registerHandlers() {
    socket!.onConnect((_) async {
      print('✅ Connected to Render');
      
      // Check stealth mode status
      String? isStealth = await _storage.read(key: 'xame:stealth');
      if (isStealth == 'true') {
        startStealthMode(socket!.query['userId']);
      } else {
        socket!.emit('user-online', {'userId': socket!.query['userId']});
        startHeartbeat(socket!.query['userId']);
      }
      
      // Sync data immediately
      socket!.emit('get_contacts', socket!.query['userId']);
      socket!.emit('get_chat_history', {'userId': socket!.query['userId']});
    });

    // Handle incoming messages (Replaces 'receive-message')
    socket!.on('receive-message', (data) {
      print('📩 New Message from ${data['senderId']}');
      // TODO: Trigger Local Notification & Update UI
    });

    // Handle Wallet Transfers
    socket!.on('wallet:receive', (data) {
      print('💸 Wallet Credit: ${data['amount']}');
      // TODO: Update Local Wallet Storage
    });

    // WebRTC Signaling Handlers
    socket!.on('call-user', (data) => _handleIncomingCall(data));
    socket!.on('ice-candidate', (data) => _handleIceCandidate(data));

    socket!.onDisconnect((_) => stopHeartbeat());
  }

  void startHeartbeat(String userId) {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 30), (timer) {
      if (socket?.connected == true) {
        socket!.emit('heartbeat', {'userId': userId, 'timestamp': DateTime.now().millisecondsSinceEpoch});
      }
    });
  }

  void startStealthMode(String userId) {
    _stealthTimer?.cancel();
    _stealthTimer = Timer.periodic(const Duration(seconds: 8), (timer) {
      if (socket?.connected == true) {
        socket!.emit('user-offline', {'userId': userId});
      }
    });
  }

  void stopHeartbeat() => _heartbeatTimer?.cancel();
  
  void _handleIncomingCall(dynamic data) {
    // Logic for WebRTC will go here
    print('📞 Incoming call signaling received');
  }

  void _handleIceCandidate(dynamic data) {
    // ICE candidate logic
  }
}
