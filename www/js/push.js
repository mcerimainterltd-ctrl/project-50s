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
    if (!window.Capacitor?.isNativePlatform?.()) {
      console.warn('FCM: not native platform, skipping');
      return;
    }
    await new Promise(resolve => {
      if (window.Capacitor?.Plugins?.FirebaseMessaging) return resolve();
      document.addEventListener('deviceready', resolve, { once: true });
      setTimeout(resolve, 3000);
    });
    const FirebaseMessaging = window.Capacitor?.Plugins?.FirebaseMessaging;
    if (!FirebaseMessaging) {
      console.warn('FCM: FirebaseMessaging plugin not available');
      return;
    }
    const perm = await FirebaseMessaging.requestPermissions();
    console.log('FCM permissions:', JSON.stringify(perm));
    if (perm?.receive !== 'granted') {
      console.warn('FCM: permission not granted:', perm);
      return;
    }
    await saveFCMToken(FirebaseMessaging);
    FirebaseMessaging.addListener('tokenReceived', async ({ token }) => {
      console.log('FCM token refreshed');
      if (token && USER?.xameId) await sendFCMTokenToServer(token);
    });
    FirebaseMessaging.addListener('notificationReceived', ({ notification }) => {
      console.log('FCM foreground message:', notification?.title);
      showNotification(notification?.title || 'New message', notification?.body || '');
    });
  } catch (e) {
    console.warn('FCM registration failed:', e.message);
  }
}
async function saveFCMToken(FirebaseMessaging) {
  const { token } = await FirebaseMessaging.getToken();
  console.log('FCM token:', token ? token.substring(0, 30) + '...' : 'EMPTY');
  if (token && USER?.xameId) {
    await sendFCMTokenToServer(token);
  } else {
    console.warn('FCM: empty token or no user');
  }
}
async function sendFCMTokenToServer(token) {
  try {
    const resp = await fetch(serverURL + '/api/save-fcm-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: USER.xameId, fcmToken: token })
    });
    const data = await resp.json();
    console.log('FCM token saved:', JSON.stringify(data));
  } catch (e) {
    console.warn('FCM token save failed:', e.message);
  }
}
