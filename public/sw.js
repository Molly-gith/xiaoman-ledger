const CACHE = "xiaoman-shell-v2";
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const root = new URL("./", self.registration.scope);
    const response = await fetch(root);
    if (!response.ok) throw new Error("App shell unavailable");
    await cache.put(root, response.clone());
    // GitHub Pages shell assets are fingerprinted. Precache those only; never API responses.
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => new URL(match[1], root)).filter(url => url.origin === root.origin);
    await cache.addAll(assets.map(url => url.href));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith("xiaoman-shell-") && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  const root = new URL("./", self.registration.scope);
  if (event.request.mode === "navigate" && url.pathname === root.pathname) {
    event.respondWith(fetch(event.request).catch(async () => (await caches.open(CACHE)).match(root).then(response => response || Response.error())));
  } else if (/\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE), stored = await cache.match(event.request);
      if (stored) return stored;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    })());
  }
});

