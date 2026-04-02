import 'package:flutter/material.dart';
import '../core/services/auth_service.dart';

class SignupScreen extends StatefulWidget {
  final AuthService authService;
  const SignupScreen({super.key, required this.authService});

  @override
  State<SignupScreen> createState() => _SignupScreenState();
}

class _SignupScreenState extends State<SignupScreen> {
  final _firstNameController = TextEditingController();
  final _lastNameController = TextEditingController();
  final _xameIdController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _dayController = TextEditingController();
  final _monthController = TextEditingController();
  final _yearController = TextEditingController();
  bool _isLoading = false;

  void _handleSignup() async {
    setState(() => _isLoading = true);
    try {
      final dob = "${_yearController.text}-${_monthController.text.padLeft(2, '0')}-${_dayController.text.padLeft(2, '0')}";
      await widget.authService.register(
        firstName: _firstNameController.text,
        lastName: _lastNameController.text,
        xameId: _xameIdController.text,
        email: _emailController.text,
        password: _passwordController.text,
        dob: dob,
      );
      if (mounted) Navigator.pop(context);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign Up')),
      body: _isLoading 
        ? const Center(child: CircularProgressIndicator())
        : SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                TextField(controller: _firstNameController, decoration: const InputDecoration(labelText: 'First Name')),
                TextField(controller: _lastNameController, decoration: const InputDecoration(labelText: 'Last Name')),
                TextField(controller: _xameIdController, decoration: const InputDecoration(labelText: 'Xame ID')),
                TextField(controller: _emailController, decoration: const InputDecoration(labelText: 'Email')),
                TextField(controller: _passwordController, decoration: const InputDecoration(labelText: 'Password'), obscureText: true),
                Row(
                  children: [
                    Expanded(child: TextField(controller: _dayController, decoration: const InputDecoration(labelText: 'DD'))),
                    Expanded(child: TextField(controller: _monthController, decoration: const InputDecoration(labelText: 'MM'))),
                    Expanded(child: TextField(controller: _yearController, decoration: const InputDecoration(labelText: 'YYYY'))),
                  ],
                ),
                const SizedBox(height: 20),
                ElevatedButton(onPressed: _handleSignup, child: const Text('Register')),
              ],
            ),
          ),
    );
  }
}
