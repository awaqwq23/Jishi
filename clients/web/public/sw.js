const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const scoped = (path) => `${SCOPE_PATH}${path}`;
const CACHE = `jishi-shell-v2:${SCOPE_PATH || "root"}`;
const SHELL = [scoped("/"), scoped("/manifest.webmanifest"), scoped("/favicon.svg")];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))));
self.addEventListener("fetch", (event) => {
  const pathname = new URL(event.request.url).pathname;
  const relativePath = SCOPE_PATH && pathname.startsWith(`${SCOPE_PATH}/`) ? pathname.slice(SCOPE_PATH.length) : pathname;
  if (event.request.method !== "GET" || relativePath.startsWith("/api/") || relativePath.startsWith("/updates/") || relativePath.startsWith("/downloads/")) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match(scoped("/")))));
});
self.addEventListener("notificationclick", (event) => { event.notification.close(); event.waitUntil(self.clients.openWindow(scoped("/"))); });
