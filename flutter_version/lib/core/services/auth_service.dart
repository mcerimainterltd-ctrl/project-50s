import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../config/constants.dart';
import '../../shared/models/xame_user.dart';

final authServiceProvider = Provider<AuthService>((ref) => AuthService());
final currentUserProvider = StateProvider<XameUser?>((ref) => null);

class AuthService {
  final _storage = const FlutterSecureStorage();
  final _dio     = Dio(BaseOptions(baseUrl: AppConstants.serverUrl));

  Future<XameUser?> init() async {
    try {
      final raw = await _storage.read(key: AppConstants.keyUser);
      if (raw == null) return null;
      final map = jsonDecode(raw) as Map<String, dynamic>;
      if (map['xameId'] == null) return null;
      return XameUser.fromMap(map);
    } catch (_) { return null; }
  }

  Future<XameUser> login(String xameId, String password) async {
    final res = await _dio.post('/api/login', data: {
      'xameId': xameId.trim(),
      'password': password,
    });
    final data = res.data as Map<String, dynamic>;
    if (data['success'] != true) throw Exception(data['message'] ?? 'Login failed');
    final user = XameUser.fromMap(data['user'] as Map<String, dynamic>);
    await _storage.write(key: AppConstants.keyUser, value: jsonEncode(data['user']));
    await _storage.write(key: AppConstants.keySessionToken, value: data['sessionToken']?.toString());
    return user;
  }

  Future<XameUser> register({
    required String firstName,
    required String lastName,
    required String xameId,
    required String email,
    required String password,
    required String dob,
    String? phone,
  }) async {
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(dob)) throw Exception('Invalid date of birth format');
    final res = await _dio.post('/api/register', data: {
      'firstName': firstName.trim(),
      'lastName':  lastName.trim(),
      'xameId':    xameId.trim(),
      'email':     email.trim(),
      'password':  password,
      'dob':       dob,
      if (phone != null) 'phone': phone.trim(),
    });
    final data = res.data as Map<String, dynamic>;
    if (data['success'] != true) throw Exception(data['message'] ?? 'Registration failed');
    return XameUser.fromMap(data['user'] as Map<String, dynamic>);
  }

  PasswordValidation validatePassword(String password) {
    final errors = <String>[];
    if (password.length < 8) errors.add('At least 8 characters');
    if (!RegExp(r'[A-Z]').hasMatch(password)) errors.add('One uppercase letter');
    if (!RegExp(r'[a-z]').hasMatch(password)) errors.add('One lowercase letter');
    if (!RegExp(r'[0-9]').hasMatch(password)) errors.add('One number');
    if (!RegExp(r'[!@#\$%^&*(),.?":{}|<>]').hasMatch(password)) errors.add('One special character');
    return PasswordValidation(isValid: errors.isEmpty, errors: errors);
  }
}

class PasswordValidation {
  final bool isValid;
  final List<String> errors;
  const PasswordValidation({required this.isValid, required this.errors});
}
