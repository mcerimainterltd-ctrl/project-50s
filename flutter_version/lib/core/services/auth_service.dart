import 'dart:convert';
import 'package:http/http.dart' as http;

class AuthService {
  final String baseUrl = 'https://project-50s.onrender.com';

  // Changed return type to Map to avoid missing 'XameUser' error
  Future<Map<String, dynamic>?> register({
    required String firstName,
    required String lastName,
    required String dob,
    required String password,
  }) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/auth/register'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'firstName': firstName.trim(),
          'lastName': lastName.trim(),
          'dob': dob.trim(),
          'password': password,
        }),
      );

      if (response.statusCode == 201 || response.statusCode == 200) {
        return jsonDecode(response.body);
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  Future<bool> login(String xameId, String password) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/api/auth/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'xameId': xameId.trim(),
          'password': password,
        }),
      );
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }
}
