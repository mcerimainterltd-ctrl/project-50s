import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../core/services/auth_service.dart';

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});
  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final firstNameController = TextEditingController();
  final lastNameController = TextEditingController();
  final dController = TextEditingController();
  final mController = TextEditingController();
  final yController = TextEditingController();
  final passwordController = TextEditingController();
  final confirmController = TextEditingController();
  final authService = AuthService();

  Widget _dobField(TextEditingController controller, String hint, int limit, bool next) {
    return Expanded(
      child: TextField(
        controller: controller,
        keyboardType: TextInputType.number,
        textAlign: TextAlign.center,
        style: const TextStyle(color: Colors.white),
        inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(limit)],
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: const TextStyle(color: Colors.grey),
          enabledBorder: const UnderlineInputBorder(borderSide: BorderSide(color: Colors.grey)),
        ),
        onChanged: (value) {
          if (value.length == limit && next) FocusScope.of(context).nextFocus();
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1117), // Dark professional background
      appBar: AppBar(backgroundColor: Colors.transparent, elevation: 0),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 30),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text("Sign Up", style: TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold)),
            const SizedBox(height: 40),
            TextField(controller: firstNameController, style: const TextStyle(color: Colors.white), decoration: const InputDecoration(labelText: 'First Name', labelStyle: TextStyle(color: Colors.grey))),
            const SizedBox(height: 20),
            TextField(controller: lastNameController, style: const TextStyle(color: Colors.white), decoration: const InputDecoration(labelText: 'Last Name', labelStyle: TextStyle(color: Colors.grey))),
            const SizedBox(height: 20),
            const Text("DOB", style: TextStyle(color: Colors.grey, fontSize: 16)),
            Row(
              children: [
                _dobField(dController, 'DD', 2, true),
                const SizedBox(width: 20),
                _dobField(mController, 'MM', 2, true),
                const SizedBox(width: 20),
                _dobField(yController, 'YYYY', 4, false),
              ],
            ),
            const SizedBox(height: 20),
            TextField(controller: passwordController, obscureText: true, style: const TextStyle(color: Colors.white), decoration: const InputDecoration(labelText: 'Password', labelStyle: TextStyle(color: Colors.grey))),
            const SizedBox(height: 20),
            TextField(controller: confirmController, obscureText: true, style: const TextStyle(color: Colors.white), decoration: const InputDecoration(labelText: 'Confirm Password', labelStyle: TextStyle(color: Colors.grey))),
            const SizedBox(height: 40),
            Center(
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: Colors.purple, padding: const EdgeInsets.symmetric(horizontal: 50, vertical: 15)),
                onPressed: () {
                  // Registration logic will go here to hit your Render server
                },
                child: const Text("Register", style: TextStyle(color: Colors.white)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
