/*
 * debug.js
 * Debug helpers exposed on window.__XAME_DEBUG__.
 * XamePage v2.1
 *
 * Depends on: all other modules (loaded last)
 */

window.__XAME_DEBUG__ = {
  // Storage
  storage,
  persistentStorage,
  memoryStorage,
  KEYS,
  getChat,
  setChat,

  // Live state getters
  get USER()      { return USER;      },
  get CONTACTS()  { return CONTACTS;  },
  get ACTIVE_ID() { return ACTIVE_ID; },
  get socket()    { return socket;    },

  // Rendering
  renderMessages,
  renderContacts:  () => renderContacts(),
  scheduleRender,

  // Cleanup
  cleanupWaveSurfers,
  endCall,

  // Version / resources
  version: APP_VERSION,
  resources: RESOURCES,

  // Storage debugging
  storageStats:      () => storage.getStats(),
  syncStorage:       () => storage.syncToPersistent(),
  reloadFromStorage: () => storage.syncFromPersistent(),

  // Performance
  getMemoryUsage: () => storage.getMemoryUsage(),
  getResourceCount: () => ({
    wavesurfers:     RESOURCES.wavesurfers.size,
    mediaRecorders:  RESOURCES.mediaRecorders.length,
    peerConnections: RESOURCES.peerConnections.length,
    localStreams:     RESOURCES.localStreams.length,
  }),

  clearAllResources: () => {
    cleanupWaveSurfers();
    endCall();
    RESOURCES.mediaRecorders = [];
    console.log('All resources cleared');
  },
};

console.log(`
╔════════════════════════════════════════╗
║                                        ║
║   XamePage v${APP_VERSION} - OPTIMIZED      ║
║   Performance Fixes Applied ✅         ║
║   - WaveSurfer cleanup fixed           ║
║   - Render batching added              ║
║   - Message pagination (100 msgs)      ║
║   - Socket event cleanup               ║
║   - In-memory storage (no localStorage)║
║   - Async merge with chunking          ║
║                                        ║
╚════════════════════════════════════════╝
`);

console.log('✅ XamePage initialized successfully');
console.log('🔍 Debug helpers available at window.__XAME_DEBUG__');
console.log('📊 Memory usage:',   window.__XAME_DEBUG__.getMemoryUsage());
console.log('📦 Active resources:', window.__XAME_DEBUG__.getResourceCount());
