import 'package:flutter/material.dart';
import '../core/services/auth_service.dart';
import 'signup_screen.dart';

class LoginScreen extends StatefulWidget {
  final AuthService authService;
  final VoidCallback onLoginSuccess;

  const LoginScreen({super.key, required this.authService, required this.onLoginSuccess});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _xameIdController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('XAMEPAGE', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold, letterSpacing: 8)),
            const SizedBox(height: 48),
            TextField(controller: _xameIdController, style: const TextStyle(color: Colors.white), decoration: const InputDecoration(hintText: 'XameID', enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)))),
            const SizedBox(height: 16),
            TextField(controller: _passwordController, obscureText: true, style: const TextStyle(color: Colors.white), decoration: const InputDecoration(hintText: 'Password', enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)))),
            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: _isLoading ? null : () async {
                setState(() => _isLoading = true);
                final success = await widget.authService.login(_xameIdController.text, _passwordController.text);
                setState(() => _isLoading = false);
                if (success != null) widget.onLoginSuccess();
                else ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Login Failed.')));
              },
              style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF007AFF), padding: const EdgeInsets.symmetric(vertical: 16)),
              child: _isLoading ? const CircularProgressIndicator(color: Colors.white) : const Text('Login', style: TextStyle(color: Colors.white)),
            ),
            TextButton(
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (context) => SignupScreen())),
              child: const Text('Don\'t have an account? Sign Up', style: TextStyle(color: Colors.white54)),
            ),
          ],
        ),
      ),
    );
  }
}
