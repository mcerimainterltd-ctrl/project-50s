import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../shared/models/user_model.dart';

class AuthService {
  final String baseUrl = 'https://project-50s.onrender.com';

  Future<XameUser?> register({
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
          'firstName': firstName,
          'lastName': lastName,
          'dob': dob,
          'password': password,
        }),
      );
      final data = jsonDecode(response.body);
      if (response.statusCode == 201 || data['success'] == true) {
        return XameUser.fromJson(data['user'] ?? data);
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
        body: jsonEncode({'xameId': xameId, 'password': password}),
      );
      return response.statusCode == 200;
    } catch (e) {
      return false;
    }
  }
}
