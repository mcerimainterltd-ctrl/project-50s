import 'package:flutter/material.dart';
import '../core/services/auth_service.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final AuthService _authSvc = AuthService();
  final _idController = TextEditingController();
  final _passController = TextEditingController();
  bool _isLoading = false;

  void _handleLogin() async {
    if (_idController.text.isEmpty || _passController.text.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Please enter ID and Password")));
      return;
    }

    setState(() => _isLoading = true);
    final success = await _authSvc.login(_idController.text, _passController.text);
    
    if (mounted) setState(() => _isLoading = false);

    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Login Successful!")));
    } else {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Invalid ID or Password")));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      body: Padding(
        padding: const EdgeInsets.all(30),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text("Xame Login", style: TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold)),
            const SizedBox(height: 40),
            TextField(
              controller: _idController,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(labelText: "Xame ID (e.g. XP12345)", labelStyle: TextStyle(color: Colors.grey)),
            ),
            TextField(
              controller: _passController,
              obscureText: true,
              style: const TextStyle(color: Colors.white),
              decoration: const InputDecoration(labelText: "Password", labelStyle: TextStyle(color: Colors.grey)),
            ),
            const SizedBox(height: 30),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _handleLogin,
                child: _isLoading ? const CircularProgressIndicator() : const Text("Login"),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
