import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String serverUrl;
  final _storage = const FlutterSecureStorage();
  Map<String, dynamic>? _currentUser;

  AuthService({required this.serverUrl});

  // Getter required by wallet_service and socket_service
  Map<String, dynamic>? get currentUser => _currentUser;

  bool validatePassword(String p) {
    // Server requires at least 8 characters
    return p.length >= 8;
  }

  // Restoring the missing login method
  Future<bool> login(String xameId, String password) async {
    try {
      final response = await http.post(
        Uri.parse('$serverUrl/api/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'xameId': xameId, 'password': password}),
      );

      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        _currentUser = data['user'];
        await _storage.write(key: 'token', value: data['token'] ?? '');
        return true;
      }
    } catch (e) {
      print('Login Exception: $e');
    }
    return false;
  }

  Future<bool> register({
    required String firstName, 
    required String lastName, 
    required String day, 
    required String month, 
    required String year, 
    required String password
  }) async {
    // Server expects YYYY-MM-DD
    final formattedDob = "$year-${month.padLeft(2, '0')}-${day.padLeft(2, '0')}";
    
    try {
      final response = await http.post(
        Uri.parse('$serverUrl/api/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'firstName': firstName,
          'lastName': lastName,
          'dob': formattedDob,
          'password': password,
        }),
      );

      final data = jsonDecode(response.body);
      if (response.statusCode == 200 && data['success'] == true) {
        print("Registration Successful! User ID: ${data['user']['xameId']}");
        return true;
      }
      print("Server rejected registration: ${response.body}");
      return false;
    } catch (e) {
      print("Network error during registration: $e");
      return false;
    }
  }

  Future<void> logout() async {
    _currentUser = null;
    await _storage.delete(key: 'token');
  }
}
