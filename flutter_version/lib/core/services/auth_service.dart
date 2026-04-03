import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../shared/models/user_model.dart';

class AuthService {
  // Using the exact URL from your config.js
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
      
      // Based on your auth.js logic, check for success or specific user data
      if (response.statusCode == 201 || data['success'] == true) {
        // Return user with the generated xameId from the server
        return XameUser.fromJson(data['user'] ?? data);
      } else {
        print("Server returned error: ${data['message']}");
        return null;
      }
    } catch (e) {
      print("Network/Parsing Error: $e");
      return null;
    }
  }
}
