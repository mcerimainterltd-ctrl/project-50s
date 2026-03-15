/*
 * push.js
 * Web Push notification subscription.
 * XamePage v2.1
 *
 * Depends on: config.js (VAPID_PUBLIC_KEY), state.js (USER),
 *             utils.js (urlBase64ToUint8Array, showNotification)
 */

async function subscribeToPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push notifications not supported'); return;
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { console.warn('Push notification permission denied'); return; }

    const registration = await navigator.serviceWorker.ready;
    let subscription   = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    await fetch(serverURL+'/api/save-push-subscription', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId: USER.xameId, subscription }),
    });

    console.log(' Push subscription saved');
  } catch (error) {
    console.error('Push subscription error:', error);
  }
}

// ── FCM Token Registration ────────────────────────────────────────────────
async function registerFCMToken() {
  try {
    if (!window.Capacitor?.isNativePlatform?.()) return;
    const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
    await FirebaseMessaging.requestPermissions();
    const { token } = await FirebaseMessaging.getToken();
    if (token && USER?.xameId) {
      await fetch(serverURL + '/api/save-fcm-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: USER.xameId, fcmToken: token })
      });
      console.log('FCM token saved');
    }
  } catch(e) { console.warn('FCM token registration failed:', e.message); }
}
