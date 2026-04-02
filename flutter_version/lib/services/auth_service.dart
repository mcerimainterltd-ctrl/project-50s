import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String serverUrl;
  final _storage = const FlutterSecureStorage();
  Map<String, dynamic>? _currentUser;

  AuthService({required this.serverUrl});

  Map<String, dynamic>? get currentUser => _currentUser;

  bool validatePassword(String p) {
    return p.length >= 8;
  }

  Future<bool> login(String xameId, String password) async {
    try {
      final response = await http.post(
        Uri.parse('$serverUrl/api/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          "name": "$firstName $lastName",
          "dob": formattedDob,
          "password": password,
        }),
      );
      final data = jsonDecode(response.body);
      return data['success'] == true;
    } catch (e) { return false; }
  }
}
