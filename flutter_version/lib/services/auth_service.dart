import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String serverUrl;
  final _storage = const FlutterSecureStorage();
  Map<String, dynamic>? _currentUser;

  AuthService({required this.serverUrl});

  // Getter required by Wallet and Socket services
  Map<String, dynamic>? get currentUser => _currentUser;

  // Validation required by Signup screen
  bool validatePassword(String password) {
    return password.length >= 8;
  }

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
    } catch (e) { print('Login error: $e'); }
    return false;
  }

  Future<bool> register({
    required String firstName,
    required String lastName,
    required String day,
    required String month,
    required String year,
    required String password,
  }) async {
    try {
      final formattedDob = "$year-$month-$day";
      final response = await http.post(
        Uri.parse('$serverUrl/api/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          "name": "$firstName $lastName",
          "dob": formattedDob,
          "password": password,
        }),
      );
      final data = jsonDecode(response.body);
      return data['success'] == true;
    } catch (e) { 
      print('Register error: $e');
      return false; 
    }
  }
}
