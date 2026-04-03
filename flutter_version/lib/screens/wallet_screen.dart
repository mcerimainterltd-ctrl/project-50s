import 'package:flutter/material.dart';
// import '../services/wallet_service.dart';
import '../core/services/socket_service.dart';
import 'contacts_screen.dart';

class WalletScreen extends StatefulWidget {
  // final WalletService walletService;
  final SocketService socketService;

  const WalletScreen({super.key, required this.walletService, required this.socketService});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _isLoading = true);
    await widget.walletService.loadWallet();
    widget.socketService.connect(AppConstants.serverUrl); // Connect socket on login
    if (mounted) setState(() => _isLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('XAMEPAGE', style: TextStyle(letterSpacing: 2)),
        backgroundColor: Colors.black,
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: const Color(0xFF1C1C1E),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Balance', style: TextStyle(color: Colors.white54)),
                  Text(
                    widget.walletService.formatAmount(widget.walletService.balance),
                    style: const TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            const Text('Recent Activity', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            if (_isLoading) const Center(child: CircularProgressIndicator())
            else ...widget.walletService.transactions.map((tx) => ListTile(
              title: Text(tx['type'] ?? 'Transfer', style: const TextStyle(color: Colors.white)),
              trailing: Text(widget.walletService.formatAmount(tx['amount'] ?? 0)),
            )),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        backgroundColor: const Color(0xFF007AFF),
        child: const Icon(Icons.chat_bubble_outline, color: Colors.white),
        onPressed: () => Navigator.push(
          context, 
          MaterialPageRoute(builder: (context) => ContactsScreen(socket: widget.socketService))
        ),
      ),
    );
  }
}
