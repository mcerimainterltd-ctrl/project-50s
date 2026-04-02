// lib/core/config/constants.dart
// Exact mirror of config.js — XamePage v2.1

class AppConstants {
  // ── Server ────────────────────────────────────────────────────────────────
  // Matches: const serverURL = 'https://project-50s.onrender.com'
  static const serverUrl = 'https://project-50s.onrender.com';

  // ── App version ───────────────────────────────────────────────────────────
  // Matches: const APP_VERSION = '2.1'
  static const appVersion = '2.1';

  // ── Storage keys ─────────────────────────────────────────────────────────
  // Matches: const KEYS = { ... }
  static const keyUser          = 'xame:user';
  static const keyContacts      = 'xame:contacts';
  static const keyDrafts        = 'xame:drafts';
  static const keySettings      = 'xame:settings';
  static const keySessionToken  = 'xame:sessionToken';
  static const keyStealth       = 'xame:stealth';
  static String keyChat(String id) => 'xame:chat:$id';

  // ── File upload limits ────────────────────────────────────────────────────
  // Matches: FILE_CONFIG.maxSize = 500 * 1024 * 1024
  static const maxFileSizeBytes = 500 * 1024 * 1024; // 500 MB

  static const allowedImageTypes    = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  static const allowedVideoTypes    = ['video/mp4', 'video/webm', 'video/ogg'];
  static const allowedAudioTypes    = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'];
  static const allowedDocumentTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/javascript',
    'application/javascript',
    'text/css',
    'text/html',
    'application/vnd.android.package-archive',
  ];

  // ── WebRTC ICE servers ────────────────────────────────────────────────────
  // Matches: const rtcConfig = { iceServers: [...] }
  static const iceServers = [
    {'urls': 'stun:stun.l.google.com:19302'},
    {
      'urls':       'turn:openrelay.metered.ca:80',
      'username':   'openrelayproject',
      'credential': 'openrelayproject',
    },
  ];

  // ── Socket / reconnection ─────────────────────────────────────────────────
  // Matches: MAX_RECONNECT_ATTEMPTS, RECONNECT_BASE_DELAY, HEARTBEAT_INTERVAL
  static const maxReconnectAttempts = 10;
  static const reconnectBaseDelayMs = 1500;
  static const heartbeatIntervalMs  = 30000;
  static const offlineGracePeriodMs = 10000; // wait before marking contacts offline

  // ── Call timeouts ─────────────────────────────────────────────────────────
  static const callTimeoutSeconds    = 60;
  static const stealthHeartbeatMs    = 8000;

  // ── Message pagination ────────────────────────────────────────────────────
  // Matches: const MESSAGE_PAGE_SIZE = 100
  static const messagePageSize = 100;

  // ── API endpoints ─────────────────────────────────────────────────────────
  static const apiSearchUser  = '$serverUrl/api/search-user';
  static const apiAddContact  = '$serverUrl/api/add-contact';
  static const apiSetPassword = '$serverUrl/api/set-password';
  static const apiSessionKill = '$serverUrl/api/sessions/kill';

  // ── MethodChannel names (for Java/Kotlin native bridges) ─────────────────
  static const channelAndroidBridge = 'com.xamepage.app/android_bridge';
}
