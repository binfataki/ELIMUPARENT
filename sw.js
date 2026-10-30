const CACHE = "elimu-parent-pwa-20261030-refonte-v4";
const CORE = ["./", "./index.html", "./styles.css?v=20261030-parent-refonte-4", "./config.js?v=20261030-parent-refonte-4", "./sync-schedule.js?v=20261030-parent-refonte-4", "./portal-config.js?v=20261030-parent-refonte-4", "./api.js?v=20261030-parent-refonte-4", "./storage.js?v=20261030-parent-refonte-4", "./app.js?v=20261030-parent-refonte-4", "./motion.js?v=20261030-parent-refonte-4", "./motion.css?v=20261030-parent-refonte-4", "./manifest.webmanifest", "./assets/school-logo.png", "./assets/static/whatsapp-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(CORE.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Réseau d'abord (données et code toujours à jour), cache en secours.
// Les appels Apps Script (autre origine) ne passent jamais par le cache.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error()))));
});
