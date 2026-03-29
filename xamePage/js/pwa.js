/*
 * pwa.js
 * PWA install prompt handling (beforeinstallprompt, appinstalled).
 * XamePage v2.1
 *
 * Depends on: state.js (deferredInstallPrompt), storage.js (persistentStorage),
 *             utils.js (showNotification)
 */

window.addEventListener('beforeinstallprompt', (e) => {
  console.log('💾 PWA install prompt available');
  e.preventDefault();
  deferredInstallPrompt = e;
  showPWAInstallBanner();
});

function showPWAInstallBanner() {
  const banner = document.getElementById('pwaInstallBanner');
  if (!banner) return;

  // Already installed (standalone mode)
  if (window.matchMedia('(display-mode: standalone)').matches) return;

  // Dismissed recently (within 3 days)
  const dismissed = persistentStorage.get('xame:pwa_dismissed');
  if (dismissed) {
    const dismissedTime = new Date(dismissed).getTime();
    const threeDays     = 3 * 24 * 60 * 60 * 1000;
    if (Date.now() - dismissedTime < threeDays) return;
  }

  banner.style.display = 'flex';
}

document.getElementById('pwaInstallBtn')?.addEventListener('click', async () => {
  if (!deferredInstallPrompt) {
    showNotification('To install: tap your browser menu → "Add to Home Screen"'); return;
  }

  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  console.log(`PWA install outcome: ${outcome}`);

  if (outcome === 'accepted') showNotification('XamePage installed successfully!');

  deferredInstallPrompt = null;
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'none';
});

document.getElementById('pwaInstallDismiss')?.addEventListener('click', () => {
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'none';
  persistentStorage.set('xame:pwa_dismissed', new Date().toISOString());
});

window.addEventListener('appinstalled', () => {
  console.log('✅ XamePage was installed');
  showNotification('XamePage installed! Opening from home screen for best experience.');
  deferredInstallPrompt = null;
  const banner = document.getElementById('pwaInstallBanner');
  if (banner) banner.style.display = 'none';
});
