import 'package:flutter/material.dart';
import 'services/auth_service.dart';
import 'services/socket_service.dart';

void main() {
  runApp(const XamePageNative());
}

class XamePageNative extends StatelessWidget {
  const XamePageNative({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'XamePage',
      theme: ThemeData(
        brightness: Brightness.dark,
        primaryColor: const Color(0xFF007AFF),
        scaffoldBackgroundColor: Colors.black,
      ),
      home: const LoadingScreen(),
    );
  }
}

class LoadingScreen extends StatelessWidget {
  const LoadingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              'XAMEPAGE',
              style: TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.bold,
                letterSpacing: 4,
                color: Colors.white,
              ),
            ),
            SizedBox(height: 20),
            CircularProgressIndicator(color: Color(0xFF007AFF)),
          ],
        ),
      ),
    );
  }
}
