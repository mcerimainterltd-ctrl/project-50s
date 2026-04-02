import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String serverUrl;
  final _storage = const FlutterSecureStorage();
  Map<String, dynamic>? _currentUser;

  AuthService({required this.serverUrl});

  Map<String, dynamic>? get currentUser => _currentUser;

  bool validatePassword(String password) {
    return password.length >= 8;
  }

  Future<bool> login(String xameId, String password) async {
    try { print("DEBUG: Attempting connection to $url"); print("DEBUG: Attempting connection to $url"); print("DEBUG: Attempting connection to $url");
      final response = await http.post(
        Uri.parse('$serverUrl/api/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'xameId': xameId, 'password': password}),
      );
      final data = jsonDecode(response.body); print("DEBUG: Server response: $data"); print("SERVER RESPONSE: $data");
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
    try { print("DEBUG: Attempting connection to $url"); print("DEBUG: Attempting connection to $url"); print("DEBUG: Attempting connection to $url");
      // Exact padding and format from Capacitor JS
      final d = day.padLeft(2, '0');
      final m = month.padLeft(2, '0');
      final formattedDob = "$year-$m-$d";

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
      final data = jsonDecode(response.body); print("DEBUG: Server response: $data"); print("SERVER RESPONSE: $data");
      return data['success'] == true;
    } catch (e) { 
      print('Register error: $e');
      return false; 
    }
  }
}
