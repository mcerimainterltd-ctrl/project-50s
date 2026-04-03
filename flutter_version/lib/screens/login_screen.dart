import 'package:flutter/material.dart';
import '../core/services/auth_service.dart';
import 'signup_screen.dart';

class LoginScreen extends StatefulWidget {
  final AuthService authService = AuthService();
  LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _xameIdController = TextEditingController();
  final _passwordController = TextEditingController();

  void _handleLogin() async {
    final success = await widget.authService.login(
      _xameIdController.text, 
      _passwordController.text
    );
    if (success) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Login Successful!")));
      // Navigate to Home/Chat here
    } else {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Login Failed. Check ID/Password.")));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      body: Padding(
        padding: const EdgeInsets.all(30.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text("XamePage", style: TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold)),
            const SizedBox(height: 40),
            TextField(controller: _xameIdController, style: const TextStyle(color: Colors.white), decoration: const InputDecoration(labelText: 'Xame ID', labelStyle: TextStyle(color: Colors.grey))),
            TextField(controller: _passwordController, obscureText: true, style: const TextStyle(color: Colors.white), decoration: const InputDecoration(labelText: 'Password', labelStyle: TextStyle(color: Colors.grey))),
            const SizedBox(height: 30),
            ElevatedButton(
              onPressed: _handleLogin,
              child: const Text("Login"),
            ),
            TextButton(
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (context) => const SignupScreen())),
              child: const Text("Don't have an account? Sign Up"),
            ),
          ],
        ),
      ),
    );
  }
}
