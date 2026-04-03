import 'package:flutter/material.dart';
import 'signup_screen.dart';
class LoginScreen extends StatelessWidget {
  const LoginScreen({super.key});
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF0D1117),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text("Xame Login", style: TextStyle(color: Colors.white, fontSize: 32)),
            const SizedBox(height: 40),
            const Padding(padding: EdgeInsets.symmetric(horizontal: 40), child: TextField(decoration: InputDecoration(labelText: "Xame ID"))),
            const Padding(padding: EdgeInsets.symmetric(horizontal: 40), child: TextField(obscureText: true, decoration: InputDecoration(labelText: "Password"))),
            const SizedBox(height: 30),
            ElevatedButton(onPressed: () {}, child: const Text("Login")),
            const SizedBox(height: 20),
            // THE LINK
            GestureDetector(
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (context) => const SignupScreen())),
              child: const Text("Don't have an account? Sign Up", style: TextStyle(color: Colors.blueAccent)),
            ),
          ],
        ),
      ),
    );
  }
}
