import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String serverUrl;
  final _storage = const FlutterSecureStorage();
  Map<String, dynamic>? _currentUser;

  AuthService({required this.serverUrl});

  Map<String, dynamic>? get currentUser => _currentUser;

  Future<bool> login(String xameId, String password) async {
    try {
      final response = await http.post(
        Uri.parse('$serverUrl/api/auth/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'xameId': xameId, 'password': password}),
      );

      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        _currentUser = data['user'];
        await _storage.write(key: 'token', value: data['token']);
        return true;
      }
    } catch (e) {
      print('Login error: $e');
    }
    return false;
  }
}
