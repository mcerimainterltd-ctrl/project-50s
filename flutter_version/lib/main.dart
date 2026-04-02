import 'package:flutter/material.dart';
import 'services/auth_service.dart';
import 'services/wallet_service.dart';
import 'services/socket_service.dart';
import 'screens/login_screen.dart';
import 'screens/wallet_screen.dart';

void main() {
  const String url = 'https://project-50s.onrender.com'; 
  final authService = AuthService(serverUrl: url);
  final walletService = WalletService(serverUrl: url, auth: authService);
  final socketService = SocketService(serverUrl: url, auth: authService);
  
  runApp(XamePageNative(
    authService: authService, 
    walletService: walletService,
    socketService: socketService,
  ));
}

class XamePageNative extends StatefulWidget {
  final AuthService authService;
  final WalletService walletService;
  final SocketService socketService;
  
  const XamePageNative({
    super.key, 
    required this.authService, 
    required this.walletService,
    required this.socketService
  });

  @override
  State<XamePageNative> createState() => _XamePageNativeState();
}

class _XamePageNativeState extends State<XamePageNative> {
  bool _isLoggedIn = false;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark, 
        primaryColor: const Color(0xFF007AFF),
        scaffoldBackgroundColor: Colors.black,
      ),
      home: _isLoggedIn 
        ? WalletScreen(
            walletService: widget.walletService, 
            socketService: widget.socketService
          )
        : LoginScreen(
            authService: widget.authService,
            onLoginSuccess: () => setState(() => _isLoggedIn = true),
          ),
    );
  }
}
