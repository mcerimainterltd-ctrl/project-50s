/*
 * main.js
 * XamePage v2.1 — Module load-order manifest.
 *
 * Include these <script> tags in your HTML <body>, in this exact order,
 * BEFORE closing </body>:
 *
 * <!-- 1. Configuration (constants only, no DOM, no dependencies) -->
 * <script src="js/config.js"></script>
 *
 * <!-- 2. Storage (depends on: config.js → KEYS) -->
 * <script src="js/storage.js"></script>
 *
 * <!-- 3. State (depends on: config.js, storage.js → persistentStorage) -->
 * <script src="js/state.js"></script>
 *
 * <!-- 4. Utilities (depends on: config.js → FILE_CONFIG, state.js → renderScheduled) -->
 * <script src="js/utils.js"></script>
 *
 * <!-- 5. Audio (depends on: state.js → APP_SOUNDS/FEEDBACK, utils.js) -->
 * <script src="js/audio.js"></script>
 *
 * <!-- 6. UI / DOM references (depends on: utils.js, state.js, config.js) -->
 * <script src="js/ui.js"></script>
 *
 * <!-- 7. Auth (depends on: config.js, state.js, storage.js, utils.js, ui.js) -->
 * <script src="js/auth.js"></script>
 *
 * <!-- 8. Contacts (depends on: config.js, state.js, storage.js, utils.js, ui.js) -->
 * <script src="js/contacts.js"></script>
 *
 * <!-- 9. Messaging (depends on: config.js, state.js, storage.js, utils.js, ui.js, audio.js) -->
 * <script src="js/messaging.js"></script>
 *
 * <!-- 10. Socket (depends on: config.js, state.js, storage.js, utils.js, audio.js,
 *                              messaging.js, contacts.js, webrtc.js) -->
 * <script src="js/socket.js"></script>
 *
 * <!-- 11. WebRTC (depends on: config.js → rtcConfig, state.js, utils.js, ui.js,
 *                              audio.js, contacts.js → openChat) -->
 * <script src="js/webrtc.js"></script>
 *
 * <!-- 12. Camera (depends on: state.js, utils.js, ui.js, messaging.js → sendFile) -->
 * <script src="js/camera.js"></script>
 *
 * <!-- 13. Voice (depends on: state.js, utils.js, ui.js, messaging.js → sendFile) -->
 * <script src="js/voice.js"></script>
 *
 * <!-- 14. Profile (depends on: config.js, state.js, storage.js, utils.js, ui.js,
 *                               contacts.js) -->
 * <script src="js/profile.js"></script>
 *
 * <!-- 15. Push notifications (depends on: config.js → VAPID_PUBLIC_KEY,
 *                                          state.js → USER, utils.js) -->
 * <script src="js/push.js"></script>
 *
 * <!-- 16. PWA install prompt (depends on: state.js, storage.js, utils.js) -->
 * <script src="js/pwa.js"></script>
 *
 * <!-- 17. Chat: file/message compose, add-contact, logout
 *              (depends on: all messaging + contacts + auth) -->
 * <script src="js/chat.js"></script>
 *
 * <!-- 18. Keyboard / viewport fix (self-contained IIFE) -->
 * <script src="js/keyboard.js"></script>
 *
 * <!-- 19. Lifecycle: visibility, unload, online/offline
 *              (depends on: state.js, utils.js, messaging.js, socket.js,
 *                           webrtc.js, audio.js) -->
 * <script src="js/lifecycle.js"></script>
 *
 * <!-- 20. Debug helpers (depends on: everything — load last before app.js) -->
 * <script src="js/debug.js"></script>
 *
 * <!-- 21. App bootstrap + event listeners (depends on: ALL) -->
 * <script src="js/app.js"></script>
 *
 * ─────────────────────────────────────────────────────────────────────────
 * NOTES
 * ─────────────────────────────────────────────────────────────────────────
 * • All files use plain globals — no import/export — so load order matters.
 * • Third-party libs (socket.io, WaveSurfer, Cropper.js) must be loaded
 *   BEFORE config.js, typically from a CDN in <head>.
 * • If you migrate to ES Modules later, each file's "Depends on:" comment
 *   maps directly to its import list.
 * ─────────────────────────────────────────────────────────────────────────
 */
