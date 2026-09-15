const CACHE = "xiaoman-shell-v3";
async function cacheShell(response, root) {
  // Clone before the first await: the navigation response may already be
  // consumed by the browser while this background cache task is running.
  const snapshot = response.clone();
  const cache = await caches.open(CACHE);
  const html = await snapshot.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => new URL(match[1], root)).filter(url => url.origin === root.origin);
  // Publish the new offline HTML only after all its fingerprinted assets exist.
  await cache.addAll([...assets.map(url => url.href), new URL('art/xiaoman-forest.png', root).href]);
  await cache.put(root, snapshot);
}
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const root = new URL("./", self.registration.scope);
    const response = await fetch(root);
    if (!response.ok) throw new Error("App shell unavailable");
    await cacheShell(response, root);
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
    const network = fetch(event.request);
    event.waitUntil(network.then(response => response.ok ? cacheShell(response, root) : undefined).catch(() => {}));
    event.respondWith(network.catch(async () => (await caches.open(CACHE)).match(root).then(response => response || Response.error())));
  } else if (/\.(?:js|css|png|woff2)$/.test(url.pathname)) {
    event.respondWith((async () => {
      // These same-origin public assets are identical regardless of Origin.
      // Preview servers add Vary: Origin, while preload and module requests
      // can send different Origin headers. Preserve their offline identity.
      const cache = await caches.open(CACHE), stored = await cache.match(event.request, { ignoreVary: true });
      if (stored) return stored;
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    })());
  }
});

