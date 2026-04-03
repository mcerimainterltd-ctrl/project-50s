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
    // NEW: Validation Check
    if (_fName.text.isEmpty || _lName.text.isEmpty || _pass.text.isEmpty) {
      _showMsg("Please fill in all required fields");
      return;
    }
    if (_d.text.length < 2 || _m.text.length < 2 || _y.text.length < 4) {
      _showMsg("Please enter a valid Date of Birth");
      return;
    }
    if (_pass.text != _conf.text) {
      _showMsg("Passwords do not match");
      return;
    }

    setState(() => _isLoading = true);
    final dob = "${_d.text}-${_m.text}-${_y.text}";

    try {
      final result = await _authService.register(
        firstName: _fName.text,
        lastName: _lName.text,
        dob: dob,
        password: _pass.text,
      );

      if (result != null) {
        _showMsg("Success! Welcome ${result.firstName}");
        Navigator.pop(context);
      } else {
        _showMsg("Server rejected registration. Try a unique name.");
      }
    } catch (e) {
      _showMsg("Connection Error: Check internet/server");
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  void _showMsg(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      appBar: AppBar(title: const Text("Create Account"), backgroundColor: Colors.transparent),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(25),
        child: Column(
          children: [
            _field(_fName, "First Name"),
            _field(_lName, "Last Name"),
            Row(children: [
              Expanded(child: _field(_d, "DD", num: true)),
              const SizedBox(width: 10),
              Expanded(child: _field(_m, "MM", num: true)),
              const SizedBox(width: 10),
              Expanded(child: _field(_y, "YYYY", num: true)),
            ]),
            _field(_pass, "Password", obs: true),
            _field(_conf, "Confirm Password", obs: true),
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

  Widget _field(TextEditingController c, String l, {bool obs = false, bool num = false}) {
    return TextField(
      controller: c,
      obscureText: obs,
      keyboardType: num ? TextInputType.number : TextInputType.text,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(labelText: l, labelStyle: const TextStyle(color: Colors.grey)),
    );
  }
}
