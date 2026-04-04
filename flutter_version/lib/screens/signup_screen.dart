import 'package:flutter/material.dart';
import '../core/services/auth_service.dart';

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});
  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final AuthService _authService = AuthService();
  final _fName = TextEditingController();
  final _lName = TextEditingController();
  final _d = TextEditingController();
  final _m = TextEditingController();
  final _y = TextEditingController();
  final _pass = TextEditingController();
  final _conf = TextEditingController();
  bool _isLoading = false;

  void _handleRegister() async {
    if (_fName.text.isEmpty || _lName.text.isEmpty || _pass.text.isEmpty) {
      _msg("Please fill all fields"); return;
    }
    setState(() => _isLoading = true);
    try {
      final res = await _authService.register(
        firstName: _fName.text, lastName: _lName.text,
        dob: "${_d.text}-${_m.text}-${_y.text}", password: _pass.text,
      );
      if (res != null) {
        _msg("Account Created!"); Navigator.pop(context);
      } else {
        _msg("Registration failed. Check details.");
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _msg(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      appBar: AppBar(backgroundColor: Colors.transparent, elevation: 0, iconTheme: const IconThemeData(color: Colors.white)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 30),
        child: Column(
          children: [
            const Text("Create Account", style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold)),
            const SizedBox(height: 30),
            _field(_fName, "First Name"),
            _field(_lName, "Last Name"),
            Row(children: [
              Expanded(child: _field(_d, "DD", isNum: true)),
              const SizedBox(width: 10),
              Expanded(child: _field(_m, "MM", isNum: true)),
              const SizedBox(width: 10),
              Expanded(child: _field(_y, "YYYY", isNum: true)),
            ]),
            _field(_pass, "Password", isPass: true),
            _field(_conf, "Confirm Password", isPass: true),
            const SizedBox(height: 30),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _handleRegister,
                style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF238636), padding: const EdgeInsets.symmetric(vertical: 15)),
                child: _isLoading ? const CircularProgressIndicator(color: Colors.white) : const Text("Register"),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _field(TextEditingController c, String l, {bool isPass = false, bool isNum = false}) {
    return TextField(
      controller: c,
      obscureText: isPass,
      keyboardType: isNum ? TextInputType.number : TextInputType.text,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(labelText: l, labelStyle: const TextStyle(color: Colors.grey)),
    );
  }
}
