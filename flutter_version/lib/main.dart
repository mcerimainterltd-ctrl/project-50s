import 'package:flutter/material.dart';
import 'services/auth_service.dart';
import 'services/wallet_service.dart';
import 'screens/login_screen.dart';
import 'screens/wallet_screen.dart';

void main() {
  // Your live Render server URL
  const String url = 'https://project-50s.onrender.com'; 
  
  final authService = AuthService(serverUrl: url);
  final walletService = WalletService(serverUrl: url, auth: authService);
  
  runApp(XamePageNative(
    authService: authService, 
    walletService: walletService
  ));
}

class XamePageNative extends StatefulWidget {
  final AuthService authService;
  final WalletService walletService;
  
  const XamePageNative({super.key, required this.authService, required this.walletService});

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
      theme: ThemeData(
        brightness: Brightness.dark, 
        primaryColor: const Color(0xFF007AFF),
        scaffoldBackgroundColor: Colors.black,
      ),
      home: _isLoggedIn 
        ? WalletScreen(walletService: widget.walletService)
        : LoginScreen(
            authService: widget.authService,
            onLoginSuccess: () => setState(() => _isLoggedIn = true),
          ),
    );
  }
}
