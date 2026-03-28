const CACHE_NAME = "xamepage-v2.1-v1773970835921";
const urlsToCache = [
  "./",
  "index.html",
  "manifest.json",
  "css/style.css",
  "js/config.js",
  "js/storage.js",
  "js/state.js",
  "js/utils.js",
  "js/ui.js",
  "js/auth.js",
  "js/app.js"
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
      Promise.all(names.map(name => name !== CACHE_NAME && name !== IMAGE_CACHE && caches.delete(name)))
    )
  );
});

const IMAGE_CACHE = 'xamepage-images-v1773970835921';

// Serve from cache, fallback to network, then to offline page
self.addEventListener("fetch", event => {
  const url = event.request.url;

  // Cache profile pictures and media from Cloudinary and Supabase
  if (url.includes('cloudinary.com') || url.includes('supabase.co') || url.includes('res.cloudinary')) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached || new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

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
      fetch(event.request).catch(() => caches.match('index.html'))
    );
  } else {
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request)
          .catch(() => caches.match('index.html'))
        )
    );
  }
});
