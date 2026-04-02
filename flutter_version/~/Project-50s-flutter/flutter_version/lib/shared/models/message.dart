// lib/shared/models/message.dart
// Matches the exact message object shape from socket.js receive-message handler:
// { id, text, file, type, ts, status, expiresAt, replyTo, forwarded, viewOnce }

enum MessageType      { text, image, video, audio, file }
enum MessageDirection { sent, received }

class XameMessage {
  final String  id;
  final String  senderId;
  final String  recipientId;
  final String  text;
  final MessageType      type;
  final MessageDirection direction;
  final int     ts;              // unix ms — matches message.ts in socket.js
  final String  status;          // 'sending' | 'delivered' | 'seen'
  final bool    isDisappearing;
  final int?    expiresAt;       // unix ms — matches message.expiresAt
  final String? replyToId;       // matches message.replyTo.id
  final String? replyToText;     // matches message.replyTo.text
  final bool    forwarded;       // matches message.forwarded
  final bool    viewOnce;        // matches message.viewOnce
  final String? fileUrl;
  final String? fileName;
  final int?    fileSize;
  final Map<String, String>? reactions; // mirrors reactions.js

  const XameMessage({
    required this.id,
    required this.senderId,
    required this.recipientId,
    required this.text,
    required this.type,
    required this.direction,
    required this.ts,
    required this.status,
    this.isDisappearing = false,
    this.expiresAt,
    this.replyToId,
    this.replyToText,
    this.forwarded  = false,
    this.viewOnce   = false,
    this.fileUrl,
    this.fileName,
    this.fileSize,
    this.reactions,
  });

  XameMessage copyWith({String? status, Map<String, String>? reactions}) => XameMessage(
    id:            id,
    senderId:      senderId,
    recipientId:   recipientId,
    text:          text,
    type:          type,
    direction:     direction,
    ts:            ts,
    status:        status ?? this.status,
    isDisappearing: isDisappearing,
    expiresAt:     expiresAt,
    replyToId:     replyToId,
    replyToText:   replyToText,
    forwarded:     forwarded,
    viewOnce:      viewOnce,
    fileUrl:       fileUrl,
    fileName:      fileName,
    fileSize:      fileSize,
    reactions:     reactions ?? this.reactions,
  );

  DateTime get dateTime => DateTime.fromMillisecondsSinceEpoch(ts);
  bool get isSent     => direction == MessageDirection.sent;
  bool get isReceived => direction == MessageDirection.received;
}
