// ORBES app shell (carnet / orbesmap.vercel.app only; theorbes.com/maps serves a single file).
// The stored page opens at once (no waiting on a slow or filtered network); a fresh copy is fetched
// in the background and the page is told when a new version is ready.
const SHELL = "orbes-shell-v2";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.add(new Request("/", { cache: "reload" }))).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("orbes-shell-") && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const sig = (r) => r && (r.headers.get("etag") || r.headers.get("last-modified") || r.headers.get("content-length") || "");
async function refresh(cache, req, old) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 20000);
    const res = await fetch(req, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) return null;
    await cache.put("/", res.clone());
    if (old && sig(old) && sig(res) && sig(old) !== sig(res)) {
      for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "orbes-update" });
    }
    return res;
  } catch {
    return null;
  }
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.mode !== "navigate" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match("/");
      if (hit) {
        e.waitUntil(refresh(cache, req, hit));
        return hit;
      }
      return (await refresh(cache, req, null)) || Response.error();
    })(),
  );
});

// Alerts (lot 6g): the morning summary and the reminder before each place, sent by api/cron
self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = { title: "ORBES Trips", body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(self.registration.showNotification(d.title || "ORBES Trips", { body: d.body || "", tag: d.tag, data: { url: d.url || "/" }, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(
    (async () => {
      for (const c of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
        if (new URL(c.url).origin === self.location.origin) {
          await c.focus();
          c.navigate(url).catch(() => {});
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
