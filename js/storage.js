/*
 * storage.js
 * Dual Storage: In-Memory Map + localStorage fallback.
 * XamePage v2.1
 *
 * Exports: memoryStorage, persistentStorage, storage,
 *          getChat, setChat, initializeMemoryFromPersistent
 *
 * Depends on: config.js  (KEYS)
 */

// ── Raw in-memory store ───────────────────────────────────────────────────
const memoryStorage = new Map();

// ── localStorage wrapper ──────────────────────────────────────────────────
const persistentStorage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (error) {
      console.error(`Persistent storage get error for key ${key}:`, error);
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error(`Persistent storage set error for key ${key}:`, error);
      return false;
    }
  },
  del(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (error) {
      console.error(`Persistent storage delete error for key ${key}:`, error);
      return false;
    }
  },
  clear() {
    try {
      localStorage.clear();
      return true;
    } catch (error) {
      console.error('Persistent storage clear error:', error);
      return false;
    }
  },
};

// ── Boot: warm the memory cache from localStorage ─────────────────────────
function initializeMemoryFromPersistent() {
  console.log('🔄 Initializing memory storage from persistent storage...');
  try {
    const user = persistentStorage.get(KEYS.user);
    if (user) {
      memoryStorage.set(KEYS.user, user);
      console.log('✅ Loaded user from persistent storage');
    }

    const contacts = persistentStorage.get(KEYS.contacts, []);
    memoryStorage.set(KEYS.contacts, contacts);
    console.log(`✅ Loaded ${contacts.length} contacts from persistent storage`);

    const drafts = persistentStorage.get(KEYS.drafts, {});
    memoryStorage.set(KEYS.drafts, drafts);
    console.log(`✅ Loaded ${Object.keys(drafts).length} drafts from persistent storage`);

    const settings = persistentStorage.get(KEYS.settings, {});
    memoryStorage.set(KEYS.settings, settings);
    console.log('✅ Loaded settings from persistent storage');

    // Chat histories are loaded on-demand to avoid memory bloat
  } catch (error) {
    console.error('❌ Failed to initialize memory from persistent storage:', error);
  }
}

// ── Dual storage manager (memory-first, async-persist) ────────────────────
const storage = {
  get(key, fallback = null) {
    if (memoryStorage.has(key)) return memoryStorage.get(key);
    try {
      const persistentValue = persistentStorage.get(key, fallback);
      if (persistentValue !== fallback) memoryStorage.set(key, persistentValue);
      return persistentValue;
    } catch (error) {
      console.error(`Dual storage get error for key ${key}:`, error);
      return fallback;
    }
  },

  set(key, value) {
    try {
      memoryStorage.set(key, value);
      // Write contacts synchronously to preserve unread counts across reloads
      if (key === 'contacts' || key === 'user' || key === 'settings') {
        try { persistentStorage.set(key, value); }
        catch (e) { console.warn(`Sync persistent storage set failed for ${key}:`, e); }
      } else {
        setTimeout(() => {
          try { persistentStorage.set(key, value); }
          catch (e) { console.warn(`Async persistent storage set failed for ${key}:`, e); }
        }, 0);
      }
      return true;
    } catch (error) {
      console.error(`Memory storage set error for key ${key}:`, error);
      return false;
    }
  },

  del(key) {
    try {
      memoryStorage.delete(key);
      setTimeout(() => {
        try { persistentStorage.del(key); }
        catch (e) { console.warn(`Async persistent storage delete failed for ${key}:`, e); }
      }, 0);
      return true;
    } catch (error) {
      console.error(`Memory storage delete error for key ${key}:`, error);
      return false;
    }
  },

  clear() {
    try {
      memoryStorage.clear();
      setTimeout(() => {
        try { persistentStorage.clear(); }
        catch (e) { console.warn('Async persistent storage clear failed:', e); }
      }, 0);
      return true;
    } catch (error) {
      console.error('Memory storage clear error:', error);
      return false;
    }
  },

  getFromMemory(key, fallback = null) {
    return memoryStorage.has(key) ? memoryStorage.get(key) : fallback;
  },

  getFromPersistent(key, fallback = null) {
    return persistentStorage.get(key, fallback);
  },

  syncToPersistent() {
    console.log('🔄 Syncing all memory data to persistent storage...');
    let syncedCount = 0;
    try {
      for (const [key, value] of memoryStorage.entries()) {
        if (key.startsWith('xame:')) {
          persistentStorage.set(key, value);
          syncedCount++;
        }
      }
      console.log(`✅ Synced ${syncedCount} items to persistent storage`);
      return syncedCount;
    } catch (error) {
      console.error('❌ Sync to persistent storage failed:', error);
      return 0;
    }
  },

  syncFromPersistent() {
    console.log('🔄 Syncing from persistent storage to memory...');
    return initializeMemoryFromPersistent();
  },

  getStats() {
    return {
      memoryItems:    memoryStorage.size,
      memoryKeys:     Array.from(memoryStorage.keys()),
      persistentKeys: Object.keys(localStorage).filter(k => k.startsWith('xame:')),
      memoryUsage:    this.getMemoryUsage(),
    };
  },

  getMemoryUsage() {
    if (performance.memory) {
      return {
        usedJSHeapSize:  (performance.memory.usedJSHeapSize  / 1048576).toFixed(2) + ' MB',
        totalJSHeapSize: (performance.memory.totalJSHeapSize / 1048576).toFixed(2) + ' MB',
      };
    }
    return 'Memory API not available';
  },
};

// ── Chat convenience helpers (used everywhere) ────────────────────────────
function getChat(id) {
  return storage.get(KEYS.chat(id), []);
}

function setChat(id, arr) {
  storage.set(KEYS.chat(id), arr);
}
