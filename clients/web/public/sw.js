const SCOPE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const scoped = (path) => `${SCOPE_PATH}${path}`;
const CACHE = `jishi-shell-v5:${SCOPE_PATH || "root"}`;
const SHELL = [scoped("/"), scoped("/manifest.webmanifest"), scoped("/favicon.svg"), scoped('/app-icon.png')];
self.addEventListener("install", (event) => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await cache.addAll(SHELL);
  const html = await (await cache.match(scoped('/'))).text();
  const assets = [...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g)].map(match => new URL(match[1], self.registration.scope).href);
  // Cache the complete built shell on the first installation, before taking control.
  await cache.addAll(assets);
  await self.skipWaiting();
})()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('jishi-shell-') && key !== CACHE && key.endsWith(`:${SCOPE_PATH || 'root'}`)).map((key) => caches.delete(key)));
  await self.clients.claim();
  const clients = await self.clients.matchAll({type:'window'});
  // Controlled navigations can wait for activation; never make activation wait
  // for those navigations in turn. Existing clients still refresh once.
  for (const client of clients.filter(client => new URL(client.url).pathname.startsWith(`${SCOPE_PATH}/`))) {
    void client.navigate(client.url).catch(() => {});
  }
})()));
self.addEventListener("fetch", (event) => {
  const pathname = new URL(event.request.url).pathname;
  const relativePath = SCOPE_PATH && pathname.startsWith(`${SCOPE_PATH}/`) ? pathname.slice(SCOPE_PATH.length) : pathname;
  if (event.request.method !== "GET" || relativePath.startsWith("/api/") || relativePath.startsWith("/updates/") || relativePath.startsWith("/downloads/")) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.status >= 500) throw new Error('Shell temporarily unavailable');
    if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy))); }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    if (event.request.mode === 'navigate') return await caches.match(scoped('/')) || Response.error();
    return Response.error();
  }));
});
self.addEventListener("notificationclick", (event) => { event.notification.close(); event.waitUntil(self.clients.openWindow(scoped("/"))); });
