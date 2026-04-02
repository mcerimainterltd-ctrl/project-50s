// lib/core/services/auth_service.dart
// Exact mirror of auth.js — XamePage v2.1
//
// JS counterparts:
//   handleLoginSuccess()   → AuthService.handleLoginSuccess()
//   init()                 → AuthService.init()
//   renderPasswordSetupDialog() → AuthService.setPassword()
//   validatePassword()     → AuthService.validatePassword()

import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../config/constants.dart';
import '../../shared/models/xame_user.dart';

// ── Providers ─────────────────────────────────────────────────────────────
final authServiceProvider = Provider<AuthService>((ref) => AuthService());

// Mirrors: USER global — null when not logged in
final currentUserProvider = StateProvider<XameUser?>((ref) => null);

// ── AuthService ────────────────────────────────────────────────────────────
class AuthService {
  final _storage = const FlutterSecureStorage();
  final _dio     = Dio(BaseOptions(baseUrl: AppConstants.serverUrl));

  // ── init() — mirrors auth.js init() ──────────────────────────────────────
  // Called on app start. Restores session from secure storage.
  // JS: const user = storage.get(KEYS.user); if (user && user.xameId) handleLoginSuccess(user)
  Future<XameUser?> init() async {
    try {
      final raw = await _storage.read(key: AppConstants.keyUser);
      if (raw == null) return null;
      final map = jsonDecode(raw) as Map<String, dynamic>;
      if (map['xameId'] == null) return null;
      return XameUser.fromMap(map);
    } catch (_) {
      return null;
    }
  }

  // ── login() — mirrors the fetch inside setupEventListeners() (app.js) ────
  // Server uses xameId + password (NOT Firebase Auth — custom server auth)
  // Returns the user object on success; throws on failure.
  Future<XameUser> login(String xameId, String password) async {
    final res = await _dio.post('/api/login', data: {
      'xameId':   xameId.trim(),
      'password': password,
    });
    final data = res.data as Map<String, dynamic>;
    if (data['success'] != true) {
      throw Exception(data['message'] ?? 'Login failed');
    }
    final user = XameUser.fromMap(data['user'] as Map<String, dynamic>);

    // Mirrors: storage.set(KEYS.user, USER)
    await _storage.write(key: AppConstants.keyUser,         value: jsonEncode(data['user']));
    await _storage.write(key: AppConstants.keySessionToken, value: data['sessionToken']?.toString());

    return user;
  }

  // ── register() — mirrors registration fetch in setupEventListeners() ─────
  Future<XameUser> register({
    required String firstName,
    required String lastName,
    required String xameId,
    required String email,
    required String password,
    required String dob,       // format: YYYY-MM-DD (mirrors dobHiddenDateInput)
    String? phone,
  }) async {
    // DOB validation mirrors updateHiddenDOB() — must be YYYY-MM-DD
    if (!RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(dob)) {
      throw Exception('Invalid date of birth format');
    }
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
    if (data['success'] != true) {
      throw Exception(data['message'] ?? 'Registration failed');
    }
    return XameUser.fromMap(data['user'] as Map<String, dynamic>);
  }

  // ── setPassword() — mirrors renderPasswordSetupDialog() save handler ─────
  // Used for legacy users who have no password yet.
  // POST /api/set-password { xameId, newPassword }
  Future<void> setPassword(String xameId, String newPassword) async {
    final validation = validatePassword(newPassword);
    if (!validation.isValid) {
      throw Exception(validation.errors.join('\n'));
    }
    final res = await _dio.post('/api/set-password', data: {
      'xameId':      xameId,
      'newPassword': newPassword,
    });
    final data = res.data as Map<String, dynamic>;
    if (data['success'] != true) {
      throw Exception(data['message'] ?? 'Failed to set password');
    }
  }

  // ── logout() — mirrors logoutBtn handler in chat.js ──────────────────────
  // POST /api/sessions/kill { userId, sessionId }
  // Then clears local session (but keeps contacts/chat — mirrors JS behavior)
  Future<void> logout(String xameId) async {
    try {
      final token = await _storage.read(key: AppConstants.keySessionToken);
      if (token != null) {
        await _dio.post('/api/sessions/kill', data: {
          'userId':    xameId,
          'sessionId': token,
        });
      }
    } catch (_) {
      // Fire and forget — mirrors .catch(() => {}) in chat.js
    }
    // Mirrors: persistentStorage.set('xame:sessionToken', null); storage.del(KEYS.user)
    // Keep contacts/chat data — only clear session
    await _storage.delete(key: AppConstants.keySessionToken);
    await _storage.delete(key: AppConstants.keyUser);
  }

  // ── forceLogout() — mirrors socket 'force-logout' handler ────────────────
  // Clears everything including contacts
  Future<void> forceLogout() async {
    await _storage.deleteAll();
  }

  // ── getSavedUser() helper ─────────────────────────────────────────────────
  Future<XameUser?> getSavedUser() async {
    final raw = await _storage.read(key: AppConstants.keyUser);
    if (raw == null) return null;
    try {
      return XameUser.fromMap(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      return null;
    }
  }

  Future<String?> getSessionToken() =>
      _storage.read(key: AppConstants.keySessionToken);

  // ── isStealthMode() — mirrors localStorage.getItem('xame:stealth') ────────
  Future<bool> isStealthMode() async {
    final v = await _storage.read(key: AppConstants.keyStealth);
    return v == 'true';
  }

  Future<void> setStealthMode(bool enabled) =>
      _storage.write(key: AppConstants.keyStealth, value: enabled.toString());

  // ── validatePassword() — mirrors validatePassword() in auth.js ────────────
  // Rules: ≥8 chars, uppercase, lowercase, number, special char
  PasswordValidation validatePassword(String password) {
    final errors = <String>[];
    if (password.length < 8)
      errors.add('At least 8 characters');
    if (!RegExp(r'[A-Z]').hasMatch(password))
      errors.add('One uppercase letter');
    if (!RegExp(r'[a-z]').hasMatch(password))
      errors.add('One lowercase letter');
    if (!RegExp(r'[0-9]').hasMatch(password))
      errors.add('One number');
    if (!RegExp(r'[!@#\$%^&*(),.?":{}|<>]').hasMatch(password))
      errors.add('One special character');
    return PasswordValidation(isValid: errors.isEmpty, errors: errors);
  }

  // ── validateDob() — mirrors DOB blur validators in auth.js ───────────────
  // Returns null if valid, error string if not
  String? validateDob(int day, int month, int year) {
    final now = DateTime.now().year;
    if (day   < 1 || day   > 31) return 'Invalid day';
    if (month < 1 || month > 12) return 'Invalid month';
    if (year  < 1900 || year > now) return 'Invalid year';
    return null;
  }
}

// ── PasswordValidation ─────────────────────────────────────────────────────
class PasswordValidation {
  final bool isValid;
  final List<String> errors;
  const PasswordValidation({required this.isValid, required this.errors});
}
