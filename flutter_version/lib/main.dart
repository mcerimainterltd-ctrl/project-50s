import 'package:flutter/material.dart';
import 'services/auth_service.dart';
import 'screens/login_screen.dart';

void main() {
  // Replace with your actual XamePage server URL
  final authService = AuthService(serverUrl: 'https://your-server-url.com');
  runApp(XamePageNative(authService: authService));
}

class XamePageNative extends StatefulWidget {
  final AuthService authService;
  const XamePageNative({super.key, required this.authService});

  @override
  State<XamePageNative> createState() => _XamePageNativeState();
}

class _XamePageNativeState extends State<XamePageNative> {
  bool _isLoggedIn = false;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'XamePage',
      theme: ThemeData(brightness: Brightness.dark, primaryColor: const Color(0xFF007AFF)),
      home: _isLoggedIn 
        ? Scaffold(body: Center(child: Text("Welcome back, Gibson!", style: TextStyle(color: Colors.white, fontSize: 24))))
        : LoginScreen(
            authService: widget.authService,
            onLoginSuccess: () => setState(() => _isLoggedIn = true),
          ),
    );
  }
}
