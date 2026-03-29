/*
 * keyboard.js
 * Mobile keyboard / viewport resize fix.
 * XamePage v2.1
 *
 * Depends on: (none — self-contained IIFE)
 */

(function () {
  const chat = document.getElementById('chat');
  if (!chat) {
    console.warn('Keyboard fix: #chat element not found');
    return;
  }

  // ── visualViewport API (modern, most reliable) ─────────────────────────
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const keyboardHeight = window.innerHeight - window.visualViewport.height;

      if (keyboardHeight > 100) {
        // Keyboard is open — shift chat up
        chat.style.top    = `${window.visualViewport.offsetTop}px`;
        chat.style.height = `${window.visualViewport.height}px`;
      } else {
        // Keyboard is closed — restore full height
        chat.style.top    = '0';
        chat.style.height = '100vh';
      }
    });
  } else {
    // ── Fallback: window resize ──────────────────────────────────────────
    window.addEventListener('resize', () => {
      if (document.activeElement &&
          (document.activeElement.tagName === 'INPUT' ||
           document.activeElement.tagName === 'TEXTAREA')) {
        chat.style.top    = '0';
        chat.style.height = `${window.innerHeight}px`;
      } else {
        chat.style.top    = '0';
        chat.style.height = '100vh';
      }
    });
  }

  // ── Prevent body scroll when touching the background ──────────────────
  document.addEventListener('touchmove', (e) => {
    if (e.target === document.body) e.preventDefault();
  }, { passive: false });

  // ── Track input focus for CSS class (used by external styles) ─────────
  const searchInputEl = document.getElementById('searchInput');
  if (searchInputEl) {
    searchInputEl.addEventListener('focus', () => document.body.classList.add('input-focused'));
    searchInputEl.addEventListener('blur',  () => document.body.classList.remove('input-focused'));
  }

  console.log('✅ Keyboard fix initialized');
})();
