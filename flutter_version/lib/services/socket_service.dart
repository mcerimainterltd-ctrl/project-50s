import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'auth_service.dart';

class SocketService {
  final String serverUrl;
  final AuthService auth;
  IO.Socket? socket;

  SocketService({required this.serverUrl, required this.auth});

  void connect() {
    final xameId = auth.currentUser?['xameId'];
    if (xameId == null) return;

    socket = IO.io(serverUrl, <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
      'query': {'userId': xameId},
    });

    socket!.connect();

    socket!.onConnect((_) {
      print('Connected to Socket Server');
      socket!.emit('user-online', {'userId': xameId});
      socket!.emit('get_contacts', xameId);
      socket!.emit('get_chat_history', {'userId': xameId});
    });

    socket!.onDisconnect((_) => print('Disconnected from Socket'));
  }

  void sendMessage(String toId, String message) {
    final fromId = auth.currentUser?['xameId'];
    if (socket != null && fromId != null) {
      socket!.emit('private_message', {
        'toId': toId,
        'fromId': fromId,
        'message': message,
        'timestamp': DateTime.now().toIso8601String(),
      });
    }
  }
}
