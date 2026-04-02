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
  final _confirmPasswordController = TextEditingController();
  bool _isLoading = false;

  void _showError(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red)
    );
  }

  Future<void> _handleSignup() async {
    final p = _passwordController.text;
    final cp = _confirmPasswordController.text;

    if (p != cp) {
      _showError('Passwords do not match');
      return;
    }

    if (!widget.authService.validatePassword(p)) {
      _showError('Password needs: 8+ chars, Uppercase, Number, and Special Char');
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
      _showError('Registration Failed. Check server requirements.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, elevation: 0, iconTheme: const IconThemeData(color: Colors.white)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Center(child: Text('XamePage', style: TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold, letterSpacing: 4))),
            const SizedBox(height: 30),
            _labeledField('First Name', _fNameController, 'e.g. Gibson'),
            _labeledField('Last Name', _lNameController, 'e.g. Abang'),
            const Text('Date of Birth', style: TextStyle(color: Colors.white70, fontSize: 14, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(child: _field(_dController, 'DD', type: TextInputType.number)),
                const SizedBox(width: 10),
                Expanded(child: _field(_mController, 'MM', type: TextInputType.number)),
                const SizedBox(width: 10),
                Expanded(child: _field(_yController, 'YYYY', type: TextInputType.number)),
              ],
            ),
            const SizedBox(height: 16),
            _labeledField('Password', _passwordController, 'Min 8 chars, 1 Upper, 1 Symbol', obscure: true),
            _labeledField('Confirm Password', _confirmPasswordController, 'Repeat password', obscure: true),
            const SizedBox(height: 30),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _handleSignup,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF007AFF), 
                  padding: const EdgeInsets.symmetric(vertical: 18),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))
                ),
                child: _isLoading 
                  ? const CircularProgressIndicator(color: Colors.white) 
                  : const Text('CREATE ACCOUNT', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _labeledField(String label, TextEditingController ctrl, String hint, {bool obscure = false}) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Colors.white70, fontSize: 14, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        _field(ctrl, hint, obscure: obscure),
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _field(TextEditingController ctrl, String hint, {bool obscure = false, TextInputType type = TextInputType.text}) {
    return TextField(
      controller: ctrl,
      obscureText: obscure,
      keyboardType: type,
      style: const TextStyle(color: Colors.white, fontSize: 16), // Forced white text for visibility
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: Colors.white24),
        filled: true,
        fillColor: const Color(0xFF1C1C1E),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Colors.white10)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF007AFF))),
      ),
    );
  }
}
