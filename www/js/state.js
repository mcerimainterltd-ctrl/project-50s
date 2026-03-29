/*
 * state.js
 * All mutable global application state.
 * XamePage v2.1
 *
 * Depends on: config.js, storage.js (persistentStorage)
 */

// ── Auth / user ────────────────────────────────────────────────────────────
let USER      = null;
let CONTACTS  = [];
let DRAFTS    = {};
let ACTIVE_ID = null;

// ── Chat history cache ─────────────────────────────────────────────────────
let CHAT_HISTORY = {};

// ── Upload handle (for XHR abort) ─────────────────────────────────────────
let currentUpload = null;

// ── Message selection ──────────────────────────────────────────────────────
let selectedMessages = [];

// ── Image cropper instance ─────────────────────────────────────────────────
let cropper = null;

// ── Typing indicator ──────────────────────────────────────────────────────
let isTyping      = false;
let typingTimeout = null;

// ── Socket ────────────────────────────────────────────────────────────────
let socket = null;

// ── Socket reconnection ───────────────────────────────────────────────────
let isConnected       = false;
let reconnectAttempts = 0;

// ── Heartbeat ─────────────────────────────────────────────────────────────
let heartbeatInterval = null;

// ── Render batching ───────────────────────────────────────────────────────
let renderScheduled   = false;
let pendingRenderType = null;

// ── Message pagination ─────────────────────────────────────────────────────
let currentMessagePage    = 1;
let isLoadingMoreMessages = false;

// ── Resource cleanup tracking ──────────────────────────────────────────────
const RESOURCES = {
  wavesurfers:     new Map(),
  mediaRecorders:  [],
  peerConnections: [],
  localStreams:     [],
};

// ── Sound / vibration feedback ────────────────────────────────────────────
const FEEDBACK = {
  soundEnabled:     persistentStorage.get('xame:sound', true),
  vibrationEnabled: persistentStorage.get('xame:vibration', true),
  vibrationPattern: [0, 150, 80, 150],
};

// Restore on boot
try {
  FEEDBACK.soundEnabled     = persistentStorage.get('xame:sound', true);
  FEEDBACK.vibrationEnabled = persistentStorage.get('xame:vibration', true);
  console.log('🔊 Feedback settings restored:', FEEDBACK);
} catch (e) {
  console.warn('Could not restore feedback settings:', e);
}

// UI mirror of FEEDBACK (updated by toggle buttons)
let soundOn     = FEEDBACK.soundEnabled;
let vibrationOn = FEEDBACK.vibrationEnabled;

// ── PWA deferred install prompt ───────────────────────────────────────────
let deferredInstallPrompt = null;

// ── WebRTC call state ─────────────────────────────────────────────────────
let peerConnection       = null;
let localStream          = null;
let remoteStream         = null;
let isAudioMuted         = false;
let isVideoMuted         = false;
let isLoudspeakerOn      = false;
let pendingIceCandidates = [];

// ── Voice / audio recording ───────────────────────────────────────────────
let mediaRecorder    = null;
let audioChunks      = [];
let audioBlob        = null;
let speechRecognizer = null;

// ── Camera ────────────────────────────────────────────────────────────────
let cameraModal             = null;
let cameraVideoElement      = null;
let cameraCanvasElement     = null;
let cameraStartRecordingBtn = null;
let cameraStopRecordingBtn  = null;
let cameraCaptureBtn        = null;
let cameraCloseBtn          = null;
let cameraFullscreenBtn     = null;
let cameraSwitchBtn         = null;

let cameraStream          = null;
let cameraMediaRecorder   = null;
let cameraRecordedChunks  = [];
let isCameraRecording     = false;
let currentCameraMode     = 'thumbnail';
let currentFacingMode     = 'user';

let recordingStartTime     = 0;
let recordingTimerInterval = null;

// ── Sounds (populated by audio.js after DOM ready) ────────────────────────
let APP_SOUNDS = {};
