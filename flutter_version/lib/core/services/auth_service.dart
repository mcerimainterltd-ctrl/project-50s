import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'config/constants.dart';

class AuthService {
  final String baseUrl = AppConstants.serverUrl;
  final _storage = const FlutterSecureStorage();

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
        Uri.parse('$baseUrl/api/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'xameId': xameId.trim(),
          'password': password,
        }),
      );

      if (response.statusCode != 200) return false;

      final data = jsonDecode(response.body) as Map<String, dynamic>;

      if (data['success'] != true) return false;

      final sessionToken = data['sessionToken'] as String?;
      final user = data['user'];

      if (sessionToken == null ||
          sessionToken.isEmpty ||
          user is! Map<String, dynamic>) {
        return false;
      }

      await _storage.write(
        key: AppConstants.keySessionToken,
        value: sessionToken,
      );

      await _storage.write(
        key: AppConstants.keyUser,
        value: jsonEncode(user),
      );

      return true;
    } catch (e) {
      return false;
    }
  }
}
