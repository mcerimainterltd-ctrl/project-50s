import 'package:flutter/material.dart';
import '../core/services/socket_service.dart';

class ContactsScreen extends StatefulWidget {
  final SocketService socket;
  const ContactsScreen({super.key, required this.socket});

  @override
  State<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends State<ContactsScreen> {
  List<dynamic> _contacts = [];

  @override
  void initState() {
    super.initState();
    // Listen for the contact list from your Render server
    widget.socketService.socket?.on('contacts_update', (data) {
      if (mounted) setState(() => _contacts = data);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: const Text('CONTACTS', style: TextStyle(letterSpacing: 2)),
        backgroundColor: Colors.black,
      ),
      body: _contacts.isEmpty
          ? const Center(child: Text('No contacts found', style: TextStyle(color: Colors.white54)))
          : ListView.separated(
              itemCount: _contacts.length,
              separatorBuilder: (_, __) => const Divider(color: Colors.white10),
              itemBuilder: (context, index) {
                final contact = _contacts[index];
                final bool isOnline = contact['isOnline'] ?? false;

                return ListTile(
                  leading: Stack(
                    children: [
                      const CircleAvatar(
                        backgroundColor: Color(0xFF1C1C1E),
                        child: Icon(Icons.person, color: Colors.white70),
                      ),
                      if (isOnline)
                        Positioned(
                          right: 0,
                          bottom: 0,
                          child: Container(
                            width: 12,
                            height: 12,
                            decoration: BoxDecoration(
                              color: Colors.green,
                              shape: BoxShape.circle,
                              border: Border.all(color: Colors.black, width: 2),
                            ),
                          ),
                        ),
                    ],
                  ),
                  title: Text(contact['name'] ?? 'Unknown', style: const TextStyle(color: Colors.white)),
                  subtitle: Text(contact['xameId'] ?? '', style: const TextStyle(color: Colors.white54)),
                  onTap: () {
                    // We will build the Private Chat Screen next!
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Starting chat with ${contact['name']}...'))
                    );
                  },
                );
              },
            ),
    );
  }
}
