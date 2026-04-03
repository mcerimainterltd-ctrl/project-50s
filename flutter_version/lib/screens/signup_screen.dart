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
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Please fill all fields")));
      return;
    }
    setState(() => _isLoading = true);
    try {
      final result = await _authService.register(
        firstName: _fName.text,
        lastName: _lName.text,
        dob: "${_d.text}-${_m.text}-${_y.text}",
        password: _pass.text,
      );
      if (result != null) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Account Created!")));
        Navigator.pop(context);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Registration failed.")));
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      appBar: AppBar(
        backgroundColor: Colors.transparent, 
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.pop(context),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(horizontal: 30),
        child: Column(
          children: [
            const Text("Create Account", style: TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.bold)),
            const SizedBox(height: 30),
            _input(_fName, "First Name"),
            _input(_lName, "Last Name"),
            Row(children: [
              Expanded(child: _input(_d, "DD", isNum: true)),
              const SizedBox(width: 10),
              Expanded(child: _input(_m, "MM", isNum: true)),
              const SizedBox(width: 10),
              Expanded(child: _input(_y, "YYYY", isNum: true)),
            ]),
            _input(_pass, "Password", isPass: true),
            _input(_conf, "Confirm Password", isPass: true),
            const SizedBox(height: 30),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _handleRegister,
                style: ElevatedButton.styleFrom(backgroundColor: Colors.blueAccent, padding: const EdgeInsets.symmetric(vertical: 15)),
                child: _isLoading ? const CircularProgressIndicator(color: Colors.white) : const Text("Register"),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _input(TextEditingController c, String l, {bool isPass = false, bool isNum = false}) {
    return TextField(
      controller: c,
      obscureText: isPass,
      keyboardType: isNum ? TextInputType.number : TextInputType.text,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(labelText: l, labelStyle: const TextStyle(color: Colors.grey)),
    );
  }
}
