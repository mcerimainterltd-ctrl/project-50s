import 'dart:convert';
import 'package:http/http.dart' as http;
import 'auth_service.dart';

class WalletService {
  final String serverUrl;
  final AuthService auth;

  double _balance = 0.0;
  String _currency = 'NGN';
  List<dynamic> _transactions = [];

  static const Map<String, String> SYM = {
    'NGN': '\u20a6', 'GHS': 'GH\u20b5', 'KES': 'KSh', 'ZAR': 'R',
    'USD': '$', 'EUR': '\u20ac', 'GBP': '\u00a3', 'INR': '\u20b9',
    'AED': 'AED', 'CAD': 'CA$', 'AUD': 'A$', 'JPY': '\u00a5',
  };

  WalletService({required this.serverUrl, required this.auth});

  double get balance => _balance;
  String get currency => _currency;
  List<dynamic> get transactions => _transactions;

  String formatAmount(num amount) {
    String symbol = SYM[_currency] ?? '$_currency ';
    return "$symbol${amount.toStringAsFixed(2)}";
  }

  Future<void> loadWallet() async {
    final xameId = auth.currentUser?['xameId'];
    if (xameId == null) return;

    try {
      final response = await http.get(
        Uri.parse('$serverUrl/api/wallet/me?userId=$xameId'),
      );
      final data = jsonDecode(response.body);

      if (data['success'] == true) {
        _balance = (data['balance'] ?? 0).toDouble();
        _transactions = data['transactions'] ?? [];
        _currency = data['currency'] ?? 'NGN';
      }
    } catch (e) {
      print('Wallet load failed: $e');
    }
  }

  Future<bool> transfer({required String toId, required double amount}) async {
    if (amount > _balance) return false;

    try {
      final response = await http.post(
        Uri.parse('$serverUrl/api/wallet/transfer'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'fromId': auth.currentUser?['xameId'],
          'toId': toId,
          'amount': amount,
        }),
      );

      final data = jsonDecode(response.body);
      if (data['success'] == true) {
        await loadWallet();
        return true;
      }
    } catch (e) {
      print('Transfer failed: $e');
    }
    return false;
  }
}
