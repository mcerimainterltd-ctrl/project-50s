const CACHE_NAME = "xamepage-v2.1-v21"; // Renamed cache for a new version
const urlsToCache = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "offline.html", // New: Add the fallback page to the cache
  "icons/icon-192x192.png",
  "icons/icon-512x512.png"
];

// Force immediate activation
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(clients.claim()));

// Install and cache assets
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// Clean up old caches
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.map(name => name !== CACHE_NAME && caches.delete(name)))
    )
  );
});

// Serve from cache, fallback to network, then to offline page
self.addEventListener("fetch", event => {
  const url = event.request.url;

  // Never intercept API calls - always go to network
  if (url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ success: false, message: 'No internet connection' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Always fetch JS and CSS from network to avoid stale cache issues
  if (url.endsWith('.js') || url.includes('.js?') || url.endsWith('.css') || url.includes('.css?')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('offline.html'))
    );
  } else {
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request)
          .catch(() => caches.match('offline.html'))
        )
    );
  }
});
