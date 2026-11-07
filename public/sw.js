// Financial and owner data must never be served from an offline response cache.
self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys())
    if (name.startsWith("btcc-live-manager-")) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request, { cache: "no-store" }));
});
