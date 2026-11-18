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
  e.waitUntil(trimPhotos());
});

// The photos of the places and trips (public Supabase Storage bucket "place-photos"): kept for offline use, the
// stored copy first (a photo file never changes: its name carries its source and width). The app fills this cache
// with the open trip's photos (src/lib/placePhotos.ts); every photo viewed is kept too, up to PHOTOS_MAX files (the
// oldest go first, checked every PHOTOS_TRIM_EVERY files kept: the cache never grows enough for the browser to empty
// this site's storage, the app shell with it).
const PHOTOS = "orbes-photos-v1";
const PHOTOS_MAX = 600;
const PHOTOS_TRIM_EVERY = 25;
let photoPuts = 0;
const PHOTO_URL = /^https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/public\/place-photos\//;
async function trimPhotos() {
  try {
    const c = await caches.open(PHOTOS);
    const ks = await c.keys();
    // the oldest first (keys come back in insertion order)
    for (const k of ks.slice(0, Math.max(0, ks.length - PHOTOS_MAX))) await c.delete(k);
  } catch {
    /* no cache storage */
  }
}
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || !PHOTO_URL.test(req.url)) return;
  e.respondWith(
    (async () => {
      try {
        const c = await caches.open(PHOTOS);
        const hit = await c.match(req.url);
        if (hit) return hit;
        const res = await fetch(req.url, { mode: "cors", credentials: "omit" });
        if (res.ok) e.waitUntil(c.put(req.url, res.clone()).then(() => (++photoPuts % PHOTOS_TRIM_EVERY === 0 ? trimPhotos() : undefined)).catch(() => {}));
        return res;
      } catch {
        return Response.error();
      }
    })(),
  );
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
