import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String serverUrl;
  final _storage = const FlutterSecureStorage();
  Map<String, dynamic>? _currentUser;

  AuthService({required this.serverUrl});

  Map<String, dynamic>? get currentUser => _currentUser;

  // Login matched to server.js
  Future<bool> login(String xameId, String password) async {
    try {
      final response = await http.post(
        Uri.parse('$serverUrl/api/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'xameId': xameId, 'password': password}),
      );

      final data = jsonDecode(response.body);
      // Checking the 'success' flag from your server
      if (response.statusCode == 200 && data['success'] == true) {
        _currentUser = data['user'];
        await _storage.write(key: 'token', value: data['token'] ?? '');
        return true;
      }
      print("Login Failed: ${data['message']}");
    } catch (e) {
      print('Login Exception: $e');
    }
    return false;
  }

  // Register matched to server.js
  Future<bool> register({
    required String firstName, 
    required String lastName, 
    required String day, 
    required String month, 
    required String year, 
    required String password
  }) async {
    // CRITICAL: Padding months/days with 0 to pass server-side date validation
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
      if (response.statusCode == 200 && data['success'] == true) {
        print("Success! Assigned XameID: ${data['user']['xameId']}");
        return true;
      }
      print("Server rejected: ${data['message']}");
      return false;
    } catch (e) {
      print("Network error: $e");
      return false;
    }
  }
}
