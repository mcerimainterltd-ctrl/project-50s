import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String serverUrl;
  final _storage = const FlutterSecureStorage();
  Map<String, dynamic>? _currentUser;

  AuthService({required this.serverUrl});

  Future<bool> register({
    required String firstName,
    required String lastName,
    required String day,
    required String month,
    required String year,
    required String password,
  }) async {
    try {
      final d = day.padLeft(2, '0');
      final m = month.padLeft(2, '0');
      final formattedDob = "$year-$m-$d";
      
      // FIXED URL: Only one /api/
      final uri = Uri.parse('$serverUrl/api/register');
      print("DEBUG: Sending to $uri");

      final response = await http.post(
        uri,
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'firstName': firstName,
          'lastName': lastName,
          'dob': formattedDob,
          'password': password,
        }),
      );

      final data = jsonDecode(response.body);
      if (response.statusCode == 200 || response.statusCode == 201) {
        return data['success'] == true;
      } else {
        // This throws the error message so the Red Band can see it
        throw data['message'] ?? 'Server Error ${response.statusCode}';
      }
    } catch (e) {
      print('Register error: $e');
      rethrow; // This sends the error to the UI Red Band
    }
  }

  // Keeping a simplified login for now to ensure compilation
  Future<bool> login(String xameId, String password) async {
    try {
      final response = await http.post(
        Uri.parse('$serverUrl/api/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'xameId': xameId, 'password': password}),
      );
      return response.statusCode == 200;
    } catch (e) { return false; }
  }
}
