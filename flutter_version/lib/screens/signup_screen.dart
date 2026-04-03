import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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

  final _mFocus = FocusNode();
  final _yFocus = FocusNode();
  final _pFocus = FocusNode();
  
  bool _isLoading = false;

  void _handleRegister() async {
    if (_pass.text != _conf.text) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Passwords do not match")));
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
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text("Success! ID: ${result.xameId}")));
        Navigator.pop(context);
      } else {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Registration Failed. Try a different Name/DOB.")));
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text("Server Connection Error")));
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
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
            const SizedBox(height: 10),
            Row(children: [
              Expanded(child: _dobField(_d, "DD", 2, _mFocus)),
              const SizedBox(width: 10),
              Expanded(child: _dobField(_m, "MM", 2, _yFocus, focusNode: _mFocus)),
              const SizedBox(width: 10),
              Expanded(child: _dobField(_y, "YYYY", 4, _pFocus, focusNode: _yFocus)),
            ]),
            _field(_pass, "Password", obs: true, focusNode: _pFocus),
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

  Widget _dobField(TextEditingController c, String hint, int limit, FocusNode next, {FocusNode? focusNode}) {
    return TextField(
      controller: c,
      focusNode: focusNode,
      keyboardType: TextInputType.number,
      textAlign: TextAlign.center,
      style: const TextStyle(color: Colors.white),
      inputFormatters: [LengthLimitingTextInputFormatter(limit)],
      onChanged: (val) {
        if (val.length == limit) next.requestFocus();
      },
      decoration: InputDecoration(hintText: hint, hintStyle: const TextStyle(color: Colors.grey)),
    );
  }

  Widget _field(TextEditingController c, String l, {bool obs = false, FocusNode? focusNode}) {
    return TextField(
      controller: c,
      focusNode: focusNode,
      obscureText: obs,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(labelText: l, labelStyle: const TextStyle(color: Colors.grey)),
    );
  }
}
