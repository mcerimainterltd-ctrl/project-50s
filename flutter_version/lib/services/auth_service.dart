import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String serverUrl;
  final _storage = const FlutterSecureStorage();
  Map<String, dynamic>? _currentUser;

  AuthService({required this.serverUrl});

  Map<String, dynamic>? get currentUser => _currentUser;

  // Password must match the requirements in your auth.js
  bool validatePassword(String p) {
    bool hasUppercase = p.contains(RegExp(r'[A-Z]'));
    bool hasDigits = p.contains(RegExp(r'[0-9]'));
    bool hasSpecialCharacters = p.contains(RegExp(r'[!@#$%^&*(),.?":{}|<>]'));
    bool hasLowercase = p.contains(RegExp(r'[a-z]'));
    return p.length >= 8 && hasUppercase && hasDigits && hasSpecialCharacters && hasLowercase;
  }

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
        await _storage.write(key: 'token', value: data['token'] ?? '');
        return true;
      }
    } catch (e) { print('Login Exception: $e'); }
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
    // Format to YYYY-MM-DD as required by updateHiddenDOB in auth.js
    final formattedDob = "$year-${month.padLeft(2, '0')}-${day.padLeft(2, '0')}";
    
    try {
      final response = await http.post(
        Uri.parse('$serverUrl/api/auth/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'firstName': firstName,
          'lastName': lastName,
          'dob': formattedDob,
          'password': password,
        }),
      );
      print('Register Status: ${response.statusCode}');
      return response.statusCode == 201 || response.statusCode == 200;
    } catch (e) { return false; }
  }
}
