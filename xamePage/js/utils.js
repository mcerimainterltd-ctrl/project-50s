/*
 * utils.js
 * Pure utility / helper functions.
 * XamePage v2.1
 *
 * Depends on: config.js (FILE_CONFIG), state.js (renderScheduled, pendingRenderType)
 */

// ── DOM helpers ───────────────────────────────────────────────────────────
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ── ID / slug ─────────────────────────────────────────────────────────────
const uid  = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// ── HTML escaping (includes backticks) ────────────────────────────────────
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"'`]/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;',
    '"': '&quot;', "'": '&#39;', '`': '&#96;',
  }[m]));
}

// ── Time ──────────────────────────────────────────────────────────────────
function now() { return Date.now(); }

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return '--:--'; }
}

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return 'Unknown date'; }
}

function dayLabel(ts) {
  try {
    const one   = 86400000;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yest  = new Date(today - one);
    const t     = new Date(ts); t.setHours(0, 0, 0, 0);
    if (t.getTime() === today.getTime()) return 'Today';
    if (t.getTime() === yest.getTime())  return 'Yesterday';
    return fmtDate(ts);
  } catch { return fmtDate(ts); }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDuration(seconds) {
  if (!isFinite(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ── Debounce ──────────────────────────────────────────────────────────────
const debounce = (fn, ms, leading = false) => {
  let t, lastCall = 0;
  return (...args) => {
    const n = Date.now();
    if (leading && n - lastCall > ms) { fn(...args); lastCall = n; }
    clearTimeout(t);
    t = setTimeout(() => { fn(...args); lastCall = Date.now(); }, ms);
  };
};

// ── URL helpers ───────────────────────────────────────────────────────────
function cleanUrl(url) {
  if (!url) return url;
  try { return url.split('?')[0]; } catch { return url; }
}

function addCacheBuster(url) {
  if (!url) return url;
  try {
    const clean = cleanUrl(url);
    return `${clean}${clean.includes('?') ? '&' : '?'}ts=${Date.now()}`;
  } catch { return url; }
}

function constructFileUrl(fileUrl) {
  if (!fileUrl) return '';
  try {
    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) return fileUrl;
    if (fileUrl.startsWith('data:')) return fileUrl;
    const normalized = fileUrl.startsWith('/') ? fileUrl : '/' + fileUrl;
    if (normalized.startsWith('/uploads/')) {
      const filename = normalized.replace('/uploads/', '');
      // Try all possible sources for userId
      const userId = (typeof USER !== 'undefined' && USER?.xameId) ||
                     (typeof window !== 'undefined' && window.USER?.xameId) ||
                     (typeof storage !== 'undefined' && storage.get && storage.get('user')?.xameId) || '';
      return '/api/file/' + filename + (userId ? '?userId=' + encodeURIComponent(userId) : '');
    }
    return normalized;
  } catch { return fileUrl; }
}

// ── VAPID key converter ───────────────────────────────────────────────────
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData  = atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}

// ── File validation ───────────────────────────────────────────────────────
function validateFile(file) {
  if (!file) return { valid: false, error: 'No file selected' };
  if (file.size > FILE_CONFIG.maxSize)
    return { valid: false, error: `File size exceeds ${formatFileSize(FILE_CONFIG.maxSize)} limit` };

  const all = [
    ...FILE_CONFIG.allowedTypes.images,
    ...FILE_CONFIG.allowedTypes.videos,
    ...FILE_CONFIG.allowedTypes.audio,
    ...FILE_CONFIG.allowedTypes.documents,
  ];
  if (!all.includes(file.type)) return { valid: false, error: 'File type not supported' };
  return { valid: true };
}

// ── Password validation ───────────────────────────────────────────────────
function validatePassword(password) {
  const errors = [];
  if (password.length < 8)                                              errors.push('Password must be at least 8 characters long');
  if (!/[A-Z]/.test(password))                                         errors.push('Password must contain at least one uppercase letter');
  if (!/[a-z]/.test(password))                                         errors.push('Password must contain at least one lowercase letter');
  if (!/[0-9]/.test(password))                                         errors.push('Password must contain at least one number');
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password))       errors.push('Password must contain at least one special character');
  return { valid: errors.length === 0, errors };
}

// ── Date of birth validation ──────────────────────────────────────────────
function isValidISO(dateString) {
  const regex = /^(\d{4})-(\d{2})-(\d{2})$/;
  const match = dateString.match(regex);
  if (!match) return false;

  const year  = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day   = parseInt(match[3], 10);

  if (year  < 1900 || year > new Date().getFullYear()) return false;
  if (month < 1    || month > 12)   return false;
  if (day   < 1    || day   > 31)   return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  if (date >= today) return false;

  const minAge = new Date(); minAge.setFullYear(minAge.getFullYear() - 13); minAge.setUTCHours(0, 0, 0, 0);
  if (date > minAge) return false;

  return true;
}

// ── File icon helper ──────────────────────────────────────────────────────
function getFileIcon(fileType, fileName = '') {
  if (fileType.startsWith('image/'))  return '🖼️';
  if (fileType.startsWith('video/'))  return '📹';
  if (fileType.startsWith('audio/'))  return '🎵';
  if (fileType === 'application/pdf') return '📄';
  if (['application/msword',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(fileType)) return '📝';
  if (['application/vnd.ms-excel',
       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(fileType)) return '📊';
  if (['application/vnd.ms-powerpoint',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation'].includes(fileType)) return '📋';
  if (fileType === 'text/plain') return '📜';
  if (fileName.endsWith('.zip') || fileName.endsWith('.rar')) return '🗜️';
  return '📁';
}

// ── User initials ─────────────────────────────────────────────────────────
function initialsOf(user) {
  if (!user) return '?';
  const f = (user.firstName    || '').trim();
  const l = (user.lastName     || '').trim();
  const p = (user.preferredName|| '').trim();
  const n = (user.name         || '').trim();
  let a = '';
  if (f) a += f[0];
  if (l) a += l[0];
  if (!a && p) {
    const parts = p.split(/\s+/);
    if (parts[0]) a += parts[0][0];
    if (parts[1]) a += parts[1][0];
  }
  if (!a && n) {
    const parts = n.split(/\s+/);
    if (parts[0]) a += parts[0][0];
    if (parts[1]) a += parts[1][0];
  }
  return a.toUpperCase().slice(0, 2) || '?';
}

// ── Render-batching scheduler ─────────────────────────────────────────────
function scheduleRender(renderFn, type = 'messages') {
  if (renderScheduled && pendingRenderType === type) return;
  renderScheduled   = true;
  pendingRenderType = type;
  requestAnimationFrame(() => {
    renderFn();
    renderScheduled   = false;
    pendingRenderType = null;
  });
}

// ── Notification toast ────────────────────────────────────────────────────
function showNotification(message) {
  let existing = document.querySelector('.status-notification');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className   = 'status-notification';
  el.textContent = escapeHtml(message);
  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add('visible'));

  setTimeout(() => {
    el.classList.remove('visible');
    el.classList.add('fade-out');
    setTimeout(() => { if (document.body.contains(el)) el.remove(); }, 500);
  }, 3000);
}

// ── Scroll helpers ────────────────────────────────────────────────────────
function scrollToBottom() {
  requestAnimationFrame(() => {
    const scroller = document.querySelector('.chat-bg');
    if (scroller) {
      scroller.scrollTop = scroller.scrollHeight;
    }
    const lastBubble = messagesEl?.lastElementChild;
    if (lastBubble) {
      lastBubble.scrollIntoView({ block: 'end', behavior: 'instant' });
    }
  });
}
