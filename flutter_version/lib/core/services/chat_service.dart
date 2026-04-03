// lib/core/services/chat_service.dart
// Exact mirror of chat.js + messaging patterns — XamePage v2.1
//
// Mirrors:
//   sendMessage(text)   → sendMessage()
//   sendFile(file)      → sendFile()
//   typing indicator    → emitTyping() / emitStopTyping()
//   search-user API     → searchUser()
//   add-contact API     → addContact()
//   logout              → handled in auth_service.dart
//   validateFile()      → validateFile()

import 'dart:async';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:uuid/uuid.dart';
import '../config/constants.dart';
import 'socket_service.dart';
import '../../shared/models/message.dart';
import '../../shared/models/contact.dart';

// ── Providers ─────────────────────────────────────────────────────────────
final chatServiceProvider = Provider<ChatService>((ref) {
  final socket = ref.read(socketServiceProvider);
  return ChatService(socket);
});

// ── Active chat state — mirrors: ACTIVE_ID global ────────────────────────
final activeContactIdProvider = StateProvider<String?>((ref) => null);

// ── ChatService ────────────────────────────────────────────────────────────
class ChatService {
  final SocketService _socket;
  final _dio     = Dio(BaseOptions(baseUrl: AppConstants.serverUrl));
  final _storage = const FlutterSecureStorage();
  final _uuid    = const Uuid();

  // Typing debounce — mirrors: let typingTimer in chat.js
  Timer? _typingTimer;

  // Drafts — mirrors: DRAFTS = storage.get(KEYS.drafts, {})
  final Map<String, String> _drafts = {};

  // In-memory chat store — mirrors: getChat(id) / setChat(id, chat)
  // key: contactId, value: list of messages
  final Map<String, List<XameMessage>> _chatCache = {};

  ChatService(this._socket);

  // ── sendMessage() — mirrors sendMessage(text) in messaging.js ─────────────
  // Emits via socket, saves to local cache optimistically
  Future<XameMessage> sendMessage({
    required String recipientId,
    required String text,
    String? replyToId,
    String? replyToText,
    bool    isDisappearing  = false,
    int?    expiresAt,        // unix ms timestamp
  }) async {
    final msg = XameMessage(
      id:            _uuid.v4(),
      senderId:      await _getSelfId(),
      recipientId:   recipientId,
      text:          text,
      type:          MessageType.text,
      direction:     MessageDirection.sent,
      ts:            DateTime.now().millisecondsSinceEpoch,
      status:        'sending',
      replyToId:     replyToId,
      replyToText:   replyToText,
      isDisappearing: isDisappearing,
      expiresAt:     expiresAt,
    );

    // Optimistic local save
    _addToCache(recipientId, msg);

    // Mirrors: socket.emit('send-message', { ... })
    // Event name from messaging.js — 'send-message'
    _socket.emit('send-message', {
      'recipientId': recipientId,
      'message': {
        'id':        msg.id,
        'text':      text,
        'ts':        msg.ts,
        'replyTo':   replyToId != null ? {'id': replyToId, 'text': replyToText} : null,
        'expiresAt': expiresAt,
      },
    });

    // Save draft cleanup — mirrors: delete DRAFTS[ACTIVE_ID]; storage.set(KEYS.drafts, DRAFTS)
    _drafts.remove(recipientId);
    await _saveDrafts();

    return msg;
  }

  // ── sendFile() — mirrors sendFile(file, caption, viewOnce) ───────────────
  // Uploads to server then emits socket event with file URL
  Future<XameMessage> sendFile({
    required String  recipientId,
    required File    file,
    required String  mimeType,
    String?  caption,
    bool     viewOnce = false,
  }) async {
    // Validate file first — mirrors: const validation = validateFile(file)
    final validation = validateFile(file, mimeType);
    if (!validation.isValid) throw Exception(validation.error);

    // Upload to server
    final formData = FormData.fromMap({
      'file':   await MultipartFile.fromFile(file.path),
      'userId': await _getSelfId(),
    });
    final res = await _dio.post('/api/upload', data: formData);
    final fileUrl = res.data['url'] as String;

    final msg = XameMessage(
      id:          _uuid.v4(),
      senderId:    await _getSelfId(),
      recipientId: recipientId,
      text:        caption ?? '',
      type:        _typeFromMime(mimeType),
      direction:   MessageDirection.sent,
      ts:          DateTime.now().millisecondsSinceEpoch,
      status:      'sending',
      fileUrl:     fileUrl,
      fileName:    file.path.split('/').last,
      fileSize:    await file.length(),
      viewOnce:    viewOnce,
    );

    _addToCache(recipientId, msg);

    _socket.emit('send-message', {
      'recipientId': recipientId,
      'message': {
        'id':      msg.id,
        'text':    caption ?? '',
        'ts':      msg.ts,
        'file':    {'url': fileUrl, 'name': msg.fileName, 'type': mimeType, 'size': msg.fileSize},
        'viewOnce': viewOnce,
      },
    });

    return msg;
  }

  // ── handleIncomingMessage() — mirrors socket.on('receive-message') ─────────
  // Called by the UI layer after receiving from SocketService.receiveMessage stream
  XameMessage incomingMessageFromSocket(Map<String, dynamic> data) {
    final senderId = data['senderId'] as String;
    final m        = data['message']  as Map<String, dynamic>;

    final msg = XameMessage(
      id:            m['id']        ?? _uuid.v4(),
      senderId:      senderId,
      recipientId:   '', // self
      text:          m['text']      ?? '',
      type:          m['file'] != null ? _typeFromFile(m['file']) : MessageType.text,
      direction:     MessageDirection.received,
      ts:            m['ts']        ?? DateTime.now().millisecondsSinceEpoch,
      status:        'delivered',
      expiresAt:     m['expiresAt'],
      replyToId:     m['replyTo']?['id'],
      replyToText:   m['replyTo']?['text'],
      forwarded:     m['forwarded'] ?? false,
      viewOnce:      m['viewOnce']  ?? false,
      fileUrl:       m['file']?['url'],
      fileName:      m['file']?['name'],
      fileSize:      m['file']?['size'],
    );

    _addToCache(senderId, msg);
    return msg;
  }

  // ── emitTyping() — mirrors messageInput 'input' handler in chat.js ─────────
  // socket.emit('typing', { recipientId: ACTIVE_ID })
  // Debounced 3s stop — mirrors: setTimeout(() => socket.emit('stop-typing'), 3000)
  void emitTyping(String recipientId, {bool typingEnabled = true}) {
    if (!typingEnabled) return;
    _socket.emitTyping(recipientId);
    _typingTimer?.cancel();
    _typingTimer = Timer(const Duration(seconds: 3), () {
      _socket.emitStopTyping(recipientId);
    });
  }

  // ── emitMessageSeen() — mirrors socket.emit('message-seen', ...) ──────────
  void emitMessageSeen(String senderId, List<String> messageIds) {
    _socket.emitMessageSeen(senderId, messageIds);
  }

  // ── saveDraft() — mirrors DRAFTS[ACTIVE_ID] = messageInput.value ──────────
  Future<void> saveDraft(String contactId, String text) async {
    if (text.isEmpty) {
      _drafts.remove(contactId);
    } else {
      _drafts[contactId] = text;
    }
    await _saveDrafts();
  }

  String? getDraft(String contactId) => _drafts[contactId];

  // ── searchUser() — mirrors fetch('/api/search-user') in chat.js ───────────
  // POST { xameId } → { success, user: { firstName, lastName, xameId } }
  Future<Map<String, dynamic>?> searchUser(String xameId) async {
    final res = await _dio.post('/api/search-user', data: {'xameId': xameId.trim()});
    final data = res.data as Map<String, dynamic>;
    if (data['success'] != true) return null;
    return data['user'] as Map<String, dynamic>;
  }

  // ── addContact() — mirrors fetch('/api/add-contact') then 'get_contacts' ───
  // POST { userId, contactId } then socket.emit('get_contacts', userId)
  Future<bool> addContact(String selfId, String contactId) async {
    final res = await _dio.post('/api/add-contact', data: {
      'userId':    selfId,
      'contactId': contactId,
    });
    final data = res.data as Map<String, dynamic>;
    if (data['success'] == true) {
      // Mirrors: socket.emit('get_contacts', USER.xameId)
      _socket.emitGetContacts(selfId);
      return true;
    }
    return false;
  }

  // ── validateFile() — mirrors validateFile(file) ───────────────────────────
  // Uses FILE_CONFIG from config.js
  FileValidation validateFile(File file, String mimeType) {
    final allAllowed = [
      ...AppConstants.allowedImageTypes,
      ...AppConstants.allowedVideoTypes,
      ...AppConstants.allowedAudioTypes,
      ...AppConstants.allowedDocumentTypes,
    ];

    if (!allAllowed.contains(mimeType)) {
      return const FileValidation(isValid: false, error: 'File type not allowed');
    }

    final size = file.lengthSync();
    if (size > AppConstants.maxFileSizeBytes) {
      return const FileValidation(isValid: false, error: 'File exceeds 500MB limit');
    }

    return const FileValidation(isValid: true, error: null);
  }

  // ── Local chat cache helpers (mirrors getChat/setChat) ────────────────────
  List<XameMessage> getChat(String contactId) =>
      List.unmodifiable(_chatCache[contactId] ?? []);

  void _addToCache(String contactId, XameMessage msg) {
    _chatCache.putIfAbsent(contactId, () => []).add(msg);
  }

  void updateMessageStatus(String contactId, String messageId, String status) {
    final chat = _chatCache[contactId];
    if (chat == null) return;
    final idx = chat.indexWhere((m) => m.id == messageId);
    if (idx != -1) {
      chat[idx] = chat[idx].copyWith(status: status);
    }
  }

  void deleteMessages(String contactId, List<String> messageIds) {
    final chat = _chatCache[contactId];
    if (chat == null) return;
    chat.removeWhere((m) => messageIds.contains(m.id));
  }

  void removeExpiredMessage(String contactId, String messageId) {
    deleteMessages(contactId, [messageId]);
  }

  // ── Drafts persistence ────────────────────────────────────────────────────
  Future<void> _saveDrafts() async {
    // Mirrors: storage.set(KEYS.drafts, DRAFTS)
    // Use secure storage for drafts (simple JSON)
    import 'dart:convert';
    await _storage.write(
      key:   AppConstants.keyDrafts,
      value: jsonEncode(_drafts),
    );
  }

  Future<void> loadDrafts() async {
    final raw = await _storage.read(key: AppConstants.keyDrafts);
    if (raw != null) {
      try {
        final map = jsonDecode(raw) as Map<String, dynamic>;
        _drafts.addAll(map.cast<String, String>());
      } catch (_) {}
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  Future<String> _getSelfId() async {
    final raw = await _storage.read(key: AppConstants.keyUser);
    if (raw == null) return '';
    try {
      final map = jsonDecode(raw) as Map<String, dynamic>;
      return map['xameId'] as String? ?? '';
    } catch (_) {
      return '';
    }
  }

  MessageType _typeFromMime(String mime) {
    if (AppConstants.allowedImageTypes.contains(mime)) return MessageType.image;
    if (AppConstants.allowedVideoTypes.contains(mime)) return MessageType.video;
    if (AppConstants.allowedAudioTypes.contains(mime)) return MessageType.audio;
    return MessageType.file;
  }

  MessageType _typeFromFile(Map<String, dynamic> file) {
    return _typeFromMime(file['type'] as String? ?? '');
  }

  void dispose() {
    _typingTimer?.cancel();
  }
}

// ── Validation results ────────────────────────────────────────────────────
class FileValidation {
  final bool    isValid;
  final String? error;
  const FileValidation({required this.isValid, required this.error});
}
