import 'package:flutter/material.dart';
import '../core/services/auth_service.dart';

class SignupScreen extends StatefulWidget {
  const SignupScreen({super.key});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final AuthService _authService = AuthService();
  
  // Controllers for your existing fields
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _dController = TextEditingController();
  final _mController = TextEditingController();
  final _yController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmController = TextEditingController();
  
  bool _isLoading = false;

  void _handleRegister() async {
    if (_passwordController.text != _confirmController.text) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Passwords do not match"))
      );
      return;
    }

    setState(() => _isLoading = true);
    
    // Formatting the DOB string for your Node.js backend
    final dob = "${_dController.text}-${_mController.text}-${_yController.text}";
    
    try {
      final result = await _authService.register(
        firstName: _firstNameController.text,
        lastName: _lastNameController.text,
        dob: dob,
        password: _passwordController.text,
      );

      if (result != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text("Success! ID: ${result.xameId}"))
        );
        Navigator.pop(context); // Go back to login
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text("Registration failed. Please check your details."))
        );
      }
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Network error. Is the server awake?"))
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      appBar: AppBar(title: const Text("Sign Up"), backgroundColor: Colors.transparent),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            _buildInput(_firstNameController, "First Name"),
            _buildInput(_lastNameController, "Last Name"),
            Row(
              children: [
                Expanded(child: _buildInput(_dController, "DD", isNum: true)),
                const SizedBox(width: 10),
                Expanded(child: _buildInput(_mController, "MM", isNum: true)),
                const SizedBox(width: 10),
                Expanded(child: _buildInput(_yController, "YYYY", isNum: true)),
              ],
            ),
            _buildInput(_passwordController, "Password", obscure: true),
            _buildInput(_confirmController, "Confirm Password", obscure: true),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _handleRegister,
                child: _isLoading 
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) 
                  : const Text("Register"),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInput(TextEditingController controller, String label, {bool obscure = false, bool isNum = false}) {
    return TextField(
      controller: controller,
      obscureText: obscure,
      keyboardType: isNum ? TextInputType.number : TextInputType.text,
      style: const TextStyle(color: Colors.white),
      decoration: InputDecoration(labelText: label, labelStyle: const TextStyle(color: Colors.grey)),
    );
  }
}
