import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String baseUrl = 'https://project-50s.onrender.com';
  final _storage = const FlutterSecureStorage();
  
  // This mirrors your 'USER' global variable
  Map<String, dynamic>? currentUser;

  // Replaces storage.get(KEYS.user)
  Future<void> init() async {
    String? userJson = await _storage.read(key: 'user');
    if (userJson != null) {
      currentUser = jsonDecode(userJson);
      // Here we would trigger socket connection later
    }
  }

  // Replaces the legacy password setup fetch
  Future<Map<String, dynamic>> setPassword(String xameId, String password) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/set-password'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'xameId': xameId,
          'newPassword': password,
        }),
      );

      return jsonDecode(response.body);
    } catch (e) {
      return {'success': false, 'message': 'Network error'};
    }
  }

  // Replaces handleLoginSuccess
  Future<void> saveUserSession(Map<String, dynamic> user) async {
    currentUser = user;
    await _storage.write(key: 'user', value: jsonEncode(user));
    // TODO: Trigger SocketService.connect()
    // TODO: Trigger PushNotificationService.register()
  }

  Future<void> logout() async {
    currentUser = null;
    await _storage.delete(key: 'user');
  }
}
