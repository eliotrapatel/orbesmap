// ORBES app shell: opens the app without network (orbesmap.vercel.app only; theorbes.com/maps serves a single file).
// Network first for the page (always the latest version when online), stored copy when offline.
const SHELL = "orbes-shell-v1";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.add(new Request("/", { cache: "reload" }))).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("orbes-shell-") && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.mode !== "navigate" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 6000);
        const res = await fetch(req, { signal: ctl.signal });
        clearTimeout(t);
        if (res.ok) cache.put("/", res.clone());
        return res;
      } catch {
        return (await cache.match("/")) || Response.error();
      }
    })(),
  );
});
