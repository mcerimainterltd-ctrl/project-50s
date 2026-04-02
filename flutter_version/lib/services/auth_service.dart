import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String serverUrl;
  final _storage = const FlutterSecureStorage();
  Map<String, dynamic>? _currentUser;

  AuthService({required this.serverUrl});

  Map<String, dynamic>? get currentUser => _currentUser;

  // FIXED: Restored 'validatePassword' for the Signup Screen
  bool validatePassword(String p) {
    // Server requires min 8 characters
    // We also check for Uppercase and special chars to match auth.js
    return p.length >= 8 && 
           p.contains(RegExp(r'[A-Z]')) && 
           p.contains(RegExp(r'[0-9]')) && 
           p.contains(RegExp(r'[!@#$%^&*(),.?":{}|<>]'));
  }

  // FIXED: Restored 'login' for the Login Screen
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

  // FIXED: Corrected path and DOB padding for Registration
  Future<bool> register({
    required String firstName, 
    required String lastName, 
    required String day, 
    required String month, 
    required String year, 
    required String password
  }) async {
    // Padding ensures '05' instead of '5' to pass server validation
    final formattedDay = day.padLeft(2, '0');
    final formattedMonth = month.padLeft(2, '0');
    final formattedDob = "$year-$formattedMonth-$formattedDay";
    
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
      return (response.statusCode == 200 || response.statusCode == 201) && data['success'] == true;
    } catch (e) { return false; }
  }
}
