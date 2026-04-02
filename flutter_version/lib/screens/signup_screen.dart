import 'package:flutter/material.dart';
import '../services/auth_service.dart';

class SignupScreen extends StatefulWidget {
  final AuthService authService;
  const SignupScreen({super.key, required this.authService});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _fNameController = TextEditingController();
  final _lNameController = TextEditingController();
  final _dController = TextEditingController();
  final _mController = TextEditingController();
  final _yController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isLoading = false;

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: Colors.red));
  }

  Future<void> _handleSignup() async {
    final p = _passwordController.text;
    if (!widget.authService.isPasswordValid(p)) {
      _showError('Password must have: 8+ chars, Uppercase, Lowercase, Number, and Special Char');
      return;
    }

    setState(() => _isLoading = true);
    final success = await widget.authService.register(
      firstName: _fNameController.text,
      lastName: _lNameController.text,
      day: _dController.text,
      month: _mController.text,
      year: _yController.text,
      password: p,
    );
    setState(() => _isLoading = false);

    if (success) {
      Navigator.pop(context);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Account Created! Please Login.')));
    } else {
      _showError('Registration Failed. Check your details.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, elevation: 0),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          children: [
            const Text('XamePage', style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold, letterSpacing: 4)),
            const SizedBox(height: 30),
            _field(_fNameController, 'First Name'),
            _field(_lNameController, 'Last Name'),
            Row(
              children: [
                Expanded(child: _field(_dController, 'DD', type: TextInputType.number)),
                const SizedBox(width: 10),
                Expanded(child: _field(_mController, 'MM', type: TextInputType.number)),
                const SizedBox(width: 10),
                Expanded(child: _field(_yController, 'YYYY', type: TextInputType.number)),
              ],
            ),
            _field(_passwordController, 'Password (Secure)', obscure: true),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _handleSignup,
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF007AFF), padding: const EdgeInsets.symmetric(vertical: 16)),
                child: _isLoading ? const CircularProgressIndicator(color: Colors.white) : const Text('Create Account'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _field(TextEditingController ctrl, String hint, {bool obscure = false, TextInputType type = TextInputType.text}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextField(
        controller: ctrl,
        obscureText: obscure,
        keyboardType: type,
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: const TextStyle(color: Colors.white24),
          filled: true,
          fillColor: const Color(0xFF1C1C1E),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
        ),
      ),
    );
  }
}
