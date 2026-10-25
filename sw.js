// BookNook service worker: makes the site installable as an app and keeps the
// last loaded shell available offline. Network first, so deploys show up at once.
const CACHE = "booknook-shell-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Supabase, Simania and covers are cross-origin: leave them to the browser.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () =>
        (await caches.match(req)) ??
          (req.mode === "navigate" ? await caches.match("./") : undefined) ??
          Response.error()
      ),
  );
});
