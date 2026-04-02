import 'package:flutter/material.dart';
import '../services/wallet_service.dart';

class WalletScreen extends StatefulWidget {
  final WalletService walletService;

  const WalletScreen({super.key, required this.walletService});

  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _refreshWallet();
  }

  Future<void> _refreshWallet() async {
    setState(() => _isLoading = true);
    await widget.walletService.loadWallet();
    if (mounted) setState(() => _isLoading = false);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('WALLET', style: TextStyle(letterSpacing: 2)),
        backgroundColor: Colors.black,
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _refreshWallet,
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refreshWallet,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            // Balance Card
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: const Color(0xFF1C1C1E),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white10),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Total Balance', style: TextStyle(color: Colors.white.withOpacity(0.6))),
                  const SizedBox(height: 8),
                  Text(
                    widget.walletService.formatAmount(widget.walletService.balance),
                    style: const TextStyle(color: Colors.white, fontSize: 36, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 32),
            const Text('Recent Transactions', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 16),
            
            if (_isLoading)
              const Center(child: CircularProgressIndicator())
            else if (widget.walletService.transactions.isEmpty)
              const Center(child: Text('No transactions yet.', style: TextStyle(color: Colors.white54)))
            else
              ...widget.walletService.transactions.map((tx) => ListTile(
                contentPadding: EdgeInsets.zero,
                leading: CircleAvatar(
                  backgroundColor: tx['type'] == 'credit' ? Colors.green.withOpacity(0.2) : Colors.red.withOpacity(0.2),
                  child: Icon(
                    tx['type'] == 'credit' ? Icons.arrow_downward : Icons.arrow_upward,
                    color: tx['type'] == 'credit' ? Colors.green : Colors.red,
                  ),
                ),
                title: Text(tx['description'] ?? 'Transaction', style: const TextStyle(color: Colors.white)),
                subtitle: Text(tx['date'] ?? '', style: const TextStyle(color: Colors.white54)),
                trailing: Text(
                  widget.walletService.formatAmount(tx['amount'] ?? 0),
                  style: TextStyle(
                    color: tx['type'] == 'credit' ? Colors.green : Colors.white,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              )).toList(),
          ],
        ),
      ),
    );
  }
}
