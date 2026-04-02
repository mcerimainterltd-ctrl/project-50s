import 'package:flutter/material.dart';
import '../core/services/auth_service.dart';

// This matches your new AuthService requirements
void handleSignup(BuildContext context, AuthService auth) async {
  try {
    await auth.register(
      firstName: _firstNameController.text,
      lastName: _lastNameController.text,
      xameId: _xameIdController.text, // Added requirement
      email: _emailController.text,   // Added requirement
      password: _passwordController.text,
      dob: "${_yearController.text}-${_monthController.text.padLeft(2,'0')}-${_dayController.text.padLeft(2,'0')}",
    );
    // Success logic here
  } catch (e) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red));
  }
}
