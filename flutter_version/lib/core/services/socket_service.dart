// lib/core/services/socket_service.dart
// Exact mirror of socket.js — XamePage v2.1
//
// Every socket.on() and socket.emit() event name is copied verbatim from socket.js.
// Connection options mirror connectSocket() exactly.

import 'dart:async';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import '../config/constants.dart';

// ── Provider ──────────────────────────────────────────────────────────────
final socketServiceProvider = Provider<SocketService>((ref) => SocketService());

// ── Connection state ──────────────────────────────────────────────────────
enum SocketState { disconnected, connecting, connected, reconnecting, failed }

// ── SocketService ─────────────────────────────────────────────────────────
class SocketService {
  IO.Socket? _socket;
  int  _reconnectAttempts  = 0;
  Timer? _heartbeatTimer;
  Timer? _stealthTimer;
  Timer? _offlineTimer;

  // Stream controllers — one per event type consumed by Flutter UI
  final _connectionStateCtrl  = StreamController<SocketState>.broadcast();
  final _receiveMessageCtrl   = StreamController<Map<String, dynamic>>.broadcast();
  final _typingCtrl           = StreamController<String>.broadcast();         // senderId
  final _stopTypingCtrl       = StreamController<String>.broadcast();         // senderId
  final _msgStatusCtrl        = StreamController<MsgStatusUpdate>.broadcast();
  final _msgSeenCtrl          = StreamController<MsgSeenUpdate>.broadcast();
  final _onlineUsersCtrl      = StreamController<List<String>>.broadcast();
  final _contactsListCtrl     = StreamController<List<Map<String, dynamic>>>.broadcast();
  final _chatHistoryCtrl      = StreamController<dynamic>.broadcast();
  final _incomingCallCtrl     = StreamController<IncomingCallData>.broadcast();
  final _callAnswerCtrl       = StreamController<CallAnswerData>.broadcast();
  final _iceCandidateCtrl     = StreamController<IceCandidateData>.broadcast();
  final _callAcceptedCtrl     = StreamController<String>.broadcast();         // recipientId
  final _callRejectedCtrl     = StreamController<CallRejectedData>.broadcast();
  final _callEndedCtrl        = StreamController<String>.broadcast();         // senderId
  final _callAcknowledgedCtrl = StreamController<String>.broadcast();         // senderId
  final _messagesDeletedCtrl  = StreamController<MessagesDeletedData>.broadcast();
  final _disappearExpiredCtrl = StreamController<DisappearExpiredData>.broadcast();
  final _walletReceiveCtrl    = StreamController<WalletReceiveData>.broadcast();
  final _profileUpdatedCtrl   = StreamController<Map<String, dynamic>>.broadcast();
  final _contactStatusCtrl    = StreamController<ContactStatusData>.broadcast();
  final _forceLogoutCtrl      = StreamController<String>.broadcast();         // reason
  final _missedCallCountCtrl  = StreamController<String>.broadcast();         // senderId

  // ── Public streams ────────────────────────────────────────────────────────
  Stream<SocketState>                get connectionState   => _connectionStateCtrl.stream;
  Stream<Map<String, dynamic>>       get receiveMessage    => _receiveMessageCtrl.stream;
  Stream<String>                     get typing            => _typingCtrl.stream;
  Stream<String>                     get stopTyping        => _stopTypingCtrl.stream;
  Stream<MsgStatusUpdate>            get messageStatus     => _msgStatusCtrl.stream;
  Stream<MsgSeenUpdate>              get messageSeen       => _msgSeenCtrl.stream;
  Stream<List<String>>               get onlineUsers       => _onlineUsersCtrl.stream;
  Stream<List<Map<String, dynamic>>> get contactsList      => _contactsListCtrl.stream;
  Stream<dynamic>                    get chatHistory       => _chatHistoryCtrl.stream;
  Stream<IncomingCallData>           get incomingCall      => _incomingCallCtrl.stream;
  Stream<CallAnswerData>             get callAnswer        => _callAnswerCtrl.stream;
  Stream<IceCandidateData>           get iceCandidate      => _iceCandidateCtrl.stream;
  Stream<String>                     get callAccepted      => _callAcceptedCtrl.stream;
  Stream<CallRejectedData>           get callRejected      => _callRejectedCtrl.stream;
  Stream<String>                     get callEnded         => _callEndedCtrl.stream;
  Stream<String>                     get callAcknowledged  => _callAcknowledgedCtrl.stream;
  Stream<MessagesDeletedData>        get messagesDeleted   => _messagesDeletedCtrl.stream;
  Stream<DisappearExpiredData>       get disappearExpired  => _disappearExpiredCtrl.stream;
  Stream<WalletReceiveData>          get walletReceive     => _walletReceiveCtrl.stream;
  Stream<Map<String, dynamic>>       get profileUpdated    => _profileUpdatedCtrl.stream;
  Stream<ContactStatusData>          get contactStatus     => _contactStatusCtrl.stream;
  Stream<String>                     get forceLogout       => _forceLogoutCtrl.stream;
  Stream<String>                     get missedCallCount   => _missedCallCountCtrl.stream;

  bool get isConnected => _socket?.connected ?? false;

  // ── connectSocket() — mirrors connectSocket() in socket.js ───────────────
  // Query param: { userId } — NOT a token header, matches JS exactly
  // Transports: ['polling', 'websocket'] — matches JS order exactly
  void connect(String xameId, {bool stealth = false}) {
    if (_socket?.connected == true) {
      debugPrint('✅ Socket already connected for: $xameId');
      return;
    }

    // Clean up stale socket — mirrors socket.removeAllListeners(); socket.disconnect()
    if (_socket != null) {
      debugPrint('🔄 Cleaning up stale socket');
      _socket!.clearListeners();
      _socket!.disconnect();
      _socket = null;
    }

    debugPrint('🔌 Connecting socket for user: $xameId');
    _connectionStateCtrl.add(SocketState.connecting);

    try {
      // Mirrors: io(serverURL, { query: { userId }, transports: ['polling','websocket'],
      //           path: '/socket.io/', reconnection: true, ... })
      _socket = IO.io(AppConstants.serverUrl, IO.OptionBuilder()
        .setQuery({'userId': xameId})
        .setTransports(['polling', 'websocket'])
        .setPath('/socket.io/')
        .enableReconnection()
        .setReconnectionDelay(1000)
        .setReconnectionDelayMax(5000)
        .setReconnectionAttempts(double.infinity.toInt())
        .setTimeout(20000)
        .build(),
      );

      _registerHandlers(_socket!, xameId, stealth: stealth);

    } catch (e) {
      debugPrint('❌ Socket connection error: $e');
      _connectionStateCtrl.add(SocketState.failed);
      _scheduleReconnect(xameId, stealth: stealth);
    }
  }

  // ── _scheduleReconnect() — mirrors scheduleReconnect() ───────────────────
  // Exponential backoff: RECONNECT_BASE_DELAY * 1.5^attempts, capped at 15000ms
  void _scheduleReconnect(String xameId, {bool stealth = false}) {
    if (_reconnectAttempts >= AppConstants.maxReconnectAttempts) {
      debugPrint('❌ Max reconnection attempts reached');
      _connectionStateCtrl.add(SocketState.failed);
      return;
    }
    final delay = min(
      AppConstants.reconnectBaseDelayMs * pow(1.5, _reconnectAttempts),
      15000,
    ).toInt();
    _reconnectAttempts++;
    debugPrint('🔄 Reconnecting in ${delay}ms (attempt $_reconnectAttempts)');
    Future.delayed(Duration(milliseconds: delay), () => connect(xameId, stealth: stealth));
  }

  // ── _registerHandlers() — mirrors registerSocketHandlers() ───────────────
  void _registerHandlers(IO.Socket socket, String xameId, {bool stealth = false}) {

    // ── connect ──────────────────────────────────────────────────────────────
    // Mirrors: socket.on('connect', () => { socket.emit('user-online'/'user-offline');
    //           socket.emit('request_online_users'); 'get_contacts'; 'get_chat_history' })
    socket.onConnect((_) {
      debugPrint('✅ Connected to server!');
      _reconnectAttempts = 0;
      _connectionStateCtrl.add(SocketState.connected);

      if (stealth) {
        // Briefly connect then go offline — mirrors stealth mode
        Future.delayed(const Duration(milliseconds: 500), () {
          if (socket.connected) emit('user-offline', {'userId': xameId});
        });
      } else {
        emit('user-online', {'userId': xameId, 'timestamp': DateTime.now().millisecondsSinceEpoch});
      }

      // Request sync data — 100ms delay matches JS
      Future.delayed(const Duration(milliseconds: 100), () {
        if (socket.connected) {
          emit('request_online_users', null);
          emit('get_contacts',         xameId);
          emit('get_chat_history',     {'userId': xameId});
        }
      });
    });

    // ── connect_error / connect_timeout / reconnect_attempt ──────────────────
    socket.on('connect_error',     (err) {
      debugPrint('Socket connection error: $err');
      _connectionStateCtrl.add(SocketState.reconnecting);
    });
    socket.on('connect_timeout',   (_) => debugPrint('Socket connection timeout'));
    socket.on('reconnect_attempt', (n) {
      debugPrint('Reconnection attempt $n');
      _connectionStateCtrl.add(SocketState.reconnecting);
    });
    socket.on('reconnect', (n) {
      debugPrint('Reconnected after $n attempts');
      _reconnectAttempts = 0;
      _offlineTimer?.cancel();
      _connectionStateCtrl.add(SocketState.connected);
      if (stealth) {
        Future.delayed(const Duration(milliseconds: 500),
          () { if (socket.connected) emit('user-offline', {'userId': xameId}); });
      } else {
        emit('user-online', {'userId': xameId, 'timestamp': DateTime.now().millisecondsSinceEpoch});
      }
      emit('request_online_users', null);
    });
    socket.on('reconnect_failed', (_) {
      debugPrint('Failed to reconnect after all attempts');
      _connectionStateCtrl.add(SocketState.failed);
    });

    // ── disconnect ────────────────────────────────────────────────────────────
    // Mirrors: wait 10s before marking contacts offline (window._offlineTimer)
    socket.onDisconnect((_) {
      _offlineTimer?.cancel();
      _offlineTimer = Timer(
        Duration(milliseconds: AppConstants.offlineGracePeriodMs),
        () { if (!isConnected) _connectionStateCtrl.add(SocketState.disconnected); },
      );
    });

    // ── Messaging ─────────────────────────────────────────────────────────────
    // receive-message: { senderId, message: { id, text, file, ts, status, expiresAt, replyTo, forwarded, viewOnce } }
    socket.on('receive-message', (data) {
      if (data == null) return;
      _receiveMessageCtrl.add(Map<String, dynamic>.from(data));
    });

    // typing: { senderId }
    socket.on('typing', (data) {
      final senderId = data?['senderId'] as String?;
      if (senderId != null) _typingCtrl.add(senderId);
    });

    // stop-typing: { senderId }
    socket.on('stop-typing', (data) {
      final senderId = data?['senderId'] as String?;
      if (senderId != null) _stopTypingCtrl.add(senderId);
    });

    // message-status-update: { recipientId, messageId, status }
    socket.on('message-status-update', (data) {
      if (data == null) return;
      _msgStatusCtrl.add(MsgStatusUpdate(
        recipientId: data['recipientId'],
        messageId:   data['messageId'],
        status:      data['status'],
      ));
    });

    // message-seen-update: { recipientId, messageIds: [] }
    socket.on('message-seen-update', (data) {
      if (data == null) return;
      _msgSeenCtrl.add(MsgSeenUpdate(
        recipientId: data['recipientId'],
        messageIds:  List<String>.from(data['messageIds'] ?? []),
      ));
    });

    // ── Contacts / presence ────────────────────────────────────────────────
    // online_users: [id, id, ...]
    socket.on('online_users', (ids) {
      _onlineUsersCtrl.add(List<String>.from(ids ?? []));
    });

    // contacts_list: [{ xameId, name, profilePic, isOnline, personalStatus, ... }]
    socket.on('contacts_list', (data) {
      if (data == null || data is! List) return;
      _contactsListCtrl.add(List<Map<String, dynamic>>.from(
        (data as List).map((c) => Map<String, dynamic>.from(c)),
      ));
    });

    // chat_history: full history blob
    socket.on('chat_history', (data) => _chatHistoryCtrl.add(data));

    // contact-status-update: { userId, status: { emoji, message } }
    socket.on('contact-status-update', (data) {
      if (data == null) return;
      _contactStatusCtrl.add(ContactStatusData(
        userId: data['userId'],
        status: '${data['status']?['emoji'] ?? ''} ${data['status']?['message'] ?? ''}'.trim(),
      ));
    });

    // profile-updated: { userId, profilePic, preferredName, hideProfilePicture, hidePreferredName }
    socket.on('profile-updated', (data) {
      if (data != null) _profileUpdatedCtrl.add(Map<String, dynamic>.from(data));
    });

    // new_missed_call_count: { senderId }
    socket.on('new_missed_call_count', (data) {
      final senderId = data?['senderId'] as String?;
      if (senderId != null) _missedCallCountCtrl.add(senderId);
    });

    // messages-deleted: { deleterId, contactId, messageIds, permanently }
    socket.on('messages-deleted', (data) {
      if (data == null) return;
      _messagesDeletedCtrl.add(MessagesDeletedData(
        deleterId:   data['deleterId'],
        contactId:   data['contactId'],
        messageIds:  List<String>.from(data['messageIds'] ?? []),
        permanently: data['permanently'] ?? false,
      ));
    });

    // disappearing:expired: { messageId, contactId }
    socket.on('disappearing:expired', (data) {
      if (data == null) return;
      _disappearExpiredCtrl.add(DisappearExpiredData(
        messageId: data['messageId'],
        contactId: data['contactId'],
      ));
    });

    // ── WebRTC signaling ──────────────────────────────────────────────────
    // call-user: { offer, callerId, caller, callType, callId }
    socket.on('call-user', (data) {
      if (data == null) return;
      debugPrint('📞 Incoming call from: ${data['callerId']} Type: ${data['callType']}');
      _incomingCallCtrl.add(IncomingCallData(
        offer:    data['offer'],
        callerId: data['callerId'],
        caller:   Map<String, dynamic>.from(data['caller'] ?? {}),
        callType: data['callType'] ?? 'voice',
        callId:   data['callId'],
      ));
    });

    // make-answer: { answer, senderId }
    socket.on('make-answer', (data) {
      if (data == null) return;
      debugPrint('📞 Received answer from: ${data['senderId']}');
      _callAnswerCtrl.add(CallAnswerData(
        answer:   data['answer'],
        senderId: data['senderId'],
      ));
    });

    // ice-candidate: { candidate, senderId }
    socket.on('ice-candidate', (data) {
      if (data == null) return;
      debugPrint('📞 Received ICE candidate from: ${data['senderId']}');
      _iceCandidateCtrl.add(IceCandidateData(
        candidate: data['candidate'],
        senderId:  data['senderId'],
      ));
    });

    // call-accepted: { recipientId }
    socket.on('call-accepted', (data) {
      debugPrint('📞 Call accepted by: ${data?['recipientId']}');
      if (data?['recipientId'] != null) _callAcceptedCtrl.add(data['recipientId']);
    });

    // call-rejected: { senderId, reason }
    // reasons: 'ended' | 'offline' | 'blocked' | 'user-rejected'
    socket.on('call-rejected', (data) {
      _callRejectedCtrl.add(CallRejectedData(
        senderId: data?['senderId'],
        reason:   data?['reason'] ?? 'user-rejected',
      ));
    });

    // call-acknowledged: { senderId }
    socket.on('call-acknowledged', (data) {
      debugPrint('📞 Call acknowledged by: ${data?['senderId']}');
      if (data?['senderId'] != null) _callAcknowledgedCtrl.add(data['senderId']);
    });

    // call-ended: { senderId }
    socket.on('call-ended', (data) {
      debugPrint('📞 Call ended by: ${data?['senderId']}');
      _callEndedCtrl.add(data?['senderId'] ?? '');
    });

    // stream-ready — signals remote stream is ready
    socket.on('stream-ready', (_) => debugPrint('📞 Remote stream ready'));

    // ── Wallet ────────────────────────────────────────────────────────────
    // wallet:receive: { senderId, senderName, amount, currency }
    socket.on('wallet:receive', (data) {
      if (data == null) return;
      _walletReceiveCtrl.add(WalletReceiveData(
        senderId:   data['senderId'],
        senderName: data['senderName'],
        amount:     (data['amount'] as num).toDouble(),
        currency:   data['currency'] ?? 'USD',
      ));
    });

    // ── Force logout ──────────────────────────────────────────────────────
    // force-logout: { reason }
    socket.on('force-logout', (data) {
      _forceLogoutCtrl.add(data?['reason'] ?? 'You have been logged out remotely.');
    });

    debugPrint('✅ Socket event handlers registered for: $xameId');
  }

  // ── emit() helpers — every emit from JS mapped here ──────────────────────

  void emit(String event, dynamic data) {
    if (data != null) {
      _socket?.emit(event, data);
    } else {
      _socket?.emit(event);
    }
  }

  // Messaging
  // Mirrors: socket.emit('typing', { recipientId })
  void emitTyping(String recipientId) =>
      emit('typing', {'recipientId': recipientId});

  // Mirrors: socket.emit('stop-typing', { recipientId })
  void emitStopTyping(String recipientId) =>
      emit('stop-typing', {'recipientId': recipientId});

  // Mirrors: socket.emit('message-seen', { recipientId, messageIds })
  void emitMessageSeen(String recipientId, List<String> messageIds) =>
      emit('message-seen', {'recipientId': recipientId, 'messageIds': messageIds});

  // Contacts
  // Mirrors: socket.emit('get_contacts', USER.xameId)
  void emitGetContacts(String xameId) => emit('get_contacts', xameId);

  // Mirrors: socket.emit('get_chat_history', { userId })
  void emitGetChatHistory(String xameId) =>
      emit('get_chat_history', {'userId': xameId});

  // Mirrors: socket.emit('request_online_users')
  void emitRequestOnlineUsers() => emit('request_online_users', null);

  // Presence
  // Mirrors: socket.emit('user-online', { userId, timestamp })
  void emitUserOnline(String xameId) =>
      emit('user-online', {'userId': xameId, 'timestamp': DateTime.now().millisecondsSinceEpoch});

  // Mirrors: socket.emit('user-offline', { userId })
  void emitUserOffline(String xameId) =>
      emit('user-offline', {'userId': xameId});

  // Mirrors: socket.emit('heartbeat', { userId, timestamp })
  void emitHeartbeat(String xameId) =>
      emit('heartbeat', {'userId': xameId, 'timestamp': DateTime.now().millisecondsSinceEpoch});

  // WebRTC signaling
  // Mirrors: socket.emit('call-user', { recipientId, offer, callType })
  void emitCallUser(String recipientId, dynamic offer, String callType) =>
      emit('call-user', {'recipientId': recipientId, 'offer': offer, 'callType': callType});

  // Mirrors: socket.emit('make-answer', { recipientId, answer })
  void emitMakeAnswer(String recipientId, dynamic answer) =>
      emit('make-answer', {'recipientId': recipientId, 'answer': answer});

  // Mirrors: socket.emit('ice-candidate', { recipientId, candidate })
  void emitIceCandidate(String recipientId, dynamic candidate) =>
      emit('ice-candidate', {'recipientId': recipientId, 'candidate': candidate});

  // Mirrors: socket.emit('call-accepted', { recipientId, callId? })
  void emitCallAccepted(String recipientId, {String? callId}) =>
      emit('call-accepted', {'recipientId': recipientId, if (callId != null) 'callId': callId});

  // Mirrors: socket.emit('call-rejected', { recipientId, reason })
  void emitCallRejected(String recipientId, String reason) =>
      emit('call-rejected', {'recipientId': recipientId, 'reason': reason});

  // Mirrors: socket.emit('call-ended', { recipientId })
  void emitCallEnded(String recipientId) =>
      emit('call-ended', {'recipientId': recipientId});

  // Groups typing — mirrors: socket.emit('group:typing', { groupId, userId, name })
  void emitGroupTyping(String groupId, String userId, String name) =>
      emit('group:typing', {'groupId': groupId, 'userId': userId, 'name': name});

  // ── Heartbeat — mirrors startHeartbeat() / stopHeartbeat() ───────────────
  void startHeartbeat(String xameId, {bool stealth = false}) {
    stopHeartbeat();
    debugPrint('💓 Starting presence heartbeat');
    _heartbeatTimer = Timer.periodic(
      Duration(milliseconds: AppConstants.heartbeatIntervalMs),
      (_) {
        if (isConnected && !stealth) emitHeartbeat(xameId);
      },
    );
    // Immediate heartbeat on start
    if (isConnected && !stealth) emitHeartbeat(xameId);
  }

  void stopHeartbeat() {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    debugPrint('🛑 Stopped presence heartbeat');
  }

  // ── Stealth mode — mirrors startStealthMode() / stopStealthMode() ─────────
  void startStealthMode(String xameId) {
    stopStealthMode();
    if (isConnected) emitUserOffline(xameId);
    _stealthTimer = Timer.periodic(
      Duration(milliseconds: AppConstants.stealthHeartbeatMs),
      (_) { if (isConnected) emitUserOffline(xameId); },
    );
  }

  void stopStealthMode() {
    _stealthTimer?.cancel();
    _stealthTimer = null;
  }

  // ── disconnect() — mirrors logout handler ────────────────────────────────
  void disconnect() {
    stopHeartbeat();
    stopStealthMode();
    _offlineTimer?.cancel();
    _socket?.clearListeners();
    _socket?.disconnect();
    _socket = null;
    _connectionStateCtrl.add(SocketState.disconnected);
  }

  void dispose() {
    disconnect();
    _connectionStateCtrl.close();
    _receiveMessageCtrl.close();
    _typingCtrl.close();
    _stopTypingCtrl.close();
    _msgStatusCtrl.close();
    _msgSeenCtrl.close();
    _onlineUsersCtrl.close();
    _contactsListCtrl.close();
    _chatHistoryCtrl.close();
    _incomingCallCtrl.close();
    _callAnswerCtrl.close();
    _iceCandidateCtrl.close();
    _callAcceptedCtrl.close();
    _callRejectedCtrl.close();
    _callEndedCtrl.close();
    _callAcknowledgedCtrl.close();
    _messagesDeletedCtrl.close();
    _disappearExpiredCtrl.close();
    _walletReceiveCtrl.close();
    _profileUpdatedCtrl.close();
    _contactStatusCtrl.close();
    _forceLogoutCtrl.close();
    _missedCallCountCtrl.close();
  }
}

// ── Data classes for typed stream events ─────────────────────────────────
class MsgStatusUpdate {
  final String recipientId, messageId, status;
  const MsgStatusUpdate({required this.recipientId, required this.messageId, required this.status});
}

class MsgSeenUpdate {
  final String recipientId;
  final List<String> messageIds;
  const MsgSeenUpdate({required this.recipientId, required this.messageIds});
}

class IncomingCallData {
  final dynamic offer;
  final String callerId, callType;
  final String? callId;
  final Map<String, dynamic> caller; // { xameId, name, profilePic }
  const IncomingCallData({required this.offer, required this.callerId, required this.caller, required this.callType, this.callId});
}

class CallAnswerData {
  final dynamic answer;
  final String senderId;
  const CallAnswerData({required this.answer, required this.senderId});
}

class IceCandidateData {
  final dynamic candidate;
  final String senderId;
  const IceCandidateData({required this.candidate, required this.senderId});
}

class CallRejectedData {
  final String? senderId;
  final String reason; // 'ended' | 'offline' | 'blocked' | 'user-rejected'
  const CallRejectedData({this.senderId, required this.reason});
}

class MessagesDeletedData {
  final String deleterId, contactId;
  final List<String> messageIds;
  final bool permanently;
  const MessagesDeletedData({required this.deleterId, required this.contactId, required this.messageIds, required this.permanently});
}

class DisappearExpiredData {
  final String messageId;
  final String? contactId;
  const DisappearExpiredData({required this.messageId, this.contactId});
}

class WalletReceiveData {
  final String senderId, currency;
  final String? senderName;
  final double amount;
  const WalletReceiveData({required this.senderId, this.senderName, required this.amount, required this.currency});

  // Currency symbol map — mirrors const sym = {...} in socket.js
  static const _symbols = {'NGN':'₦','GHS':'GH₵','KES':'KSh','ZAR':'R','USD':'\$','EUR':'€','GBP':'£'};
  String get symbol => _symbols[currency] ?? '$currency ';
}

class ContactStatusData {
  final String userId, status;
  const ContactStatusData({required this.userId, required this.status});
}
