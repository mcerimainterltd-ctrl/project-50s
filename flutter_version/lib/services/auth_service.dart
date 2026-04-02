import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class AuthService {
  final String serverUrl;
  final _storage = const FlutterSecureStorage();

  AuthService({required this.serverUrl});

  bool validatePassword(String p) {
    // Matching server requirement: min 8 chars
    return p.length >= 8;
  }

  Future<bool> register({
    required String firstName, 
    required String lastName, 
    required String day, 
    required String month, 
    required String year, 
    required String password
  }) async {
    // Server expects YYYY-MM-DD
    final formattedDob = "$year-${month.padLeft(2, '0')}-${day.padLeft(2, '0')}";
    
    try {
      final response = await http.post(
        Uri.parse('$serverUrl/api/register'), // Removed /auth/
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
        // The server generates a '058...' ID for you. 
        // We must show this to the user so they can log in!
        final String newId = data['user']['xameId'];
        print("REGISTRATION SUCCESS! Your ID is: $newId");
        return true;
      } else {
        print("SERVER REJECTED: ${response.body}");
        return false;
      }
    } catch (e) {
      print("CONNECTION ERROR: $e");
      return false;
    }
  }
}
