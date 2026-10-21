const CACHE = "elimu-parent-pwa-20261021-v5";
const CORE = ["./","./index.html","./styles.css","./app.js","./api.js","./storage.js","./manifest.webmanifest","./config.js","./portal-config.js","./online-only.js","./sync-schedule.js","./assets/school-logo.png","./assets/static/elimu-logo.png","./assets/static/whatsapp-icon.png"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => { if (new URL(event.request.url).origin !== self.location.origin) return; event.respondWith(fetch(event.request).then(response => { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(event.request, copy)); return response; }).catch(() => caches.match(event.request))); });
