import 'package:flutter/material.dart';
import '../core/services/socket_service.dart';

class WalletScreen extends StatefulWidget {
  final SocketService socketService;
  const WalletScreen({super.key, required this.socketService});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text("Wallet")),
      body: const Center(child: Text("Wallet Module Coming Soon")),
    );
  }
}
