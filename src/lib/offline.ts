// Offline map: every basemap request goes through the "ofm" protocol, which serves from the
// device cache first (tiles, fonts, icons) and stores what it downloads. "Préparer hors ligne"
// pre-downloads the trip's neighbourhoods so the map works in the metro or without data.
import * as maplibregl from "maplibre-gl";
import { useSyncExternalStore } from "react";

const HOST = "https://tiles.openfreemap.org";
const CACHE = "orbes-map-v1";
const PROTO = "ofm";
const STATUS_KEY = "orbes.offline.v1";
const STYLE_URL = `${HOST}/styles/dark`;
const FONT = "Noto Sans Regular";
// Latin + punctuation ranges (Chinese characters are drawn with the phone's own font, no download)
const GLYPH_RANGES = [0, 256, 512, 768, 8192, 8448, 12288, 65280];

const hasCache = typeof caches !== "undefined";

/** Tiles are versioned weekly on the server: cache them by z/x/y so an older download still serves. */
function keyOf(url: string): string {
  const m = url.match(/\/planet\/[^/]+\/(\d+)\/(\d+)\/(\d+)\.pbf/);
  return m ? `${HOST}/planet/_/${m[1]}/${m[2]}/${m[3]}.pbf` : url;
}
const immutable = (url: string) => /\/planet\/[^/]+\/\d+\/\d+\/\d+\.pbf|\/fonts\/|\/sprites\/|\/natural_earth\//.test(url);

/** A timeout must look like a network failure (not a cancel), or MapLibre silently gives up on the source. */
async function fetchWithTimeout(url: string, ms: number, signal?: AbortSignal): Promise<Response> {
  if (!ms) return fetch(url, { signal });
  const ctl = new AbortController();
  let timedOut = false;
  const t = window.setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, ms);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { signal: ctl.signal });
  } catch (e) {
    if (timedOut && !signal?.aborted) throw new TypeError(`Failed to fetch (timeout) ${url}`);
    throw e;
  } finally {
    window.clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function cachedFetch(url: string, signal?: AbortSignal): Promise<Response> {
  if (!hasCache) return fetch(url, { signal });
  const cache = await caches.open(CACHE);
  const key = keyOf(url);
  if (immutable(url)) {
    const hit = await cache.match(key);
    if (hit) return hit;
    const res = await fetch(url, { signal });
    if (res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  }
  // style and tile index: fresh when the network answers quickly, else the stored copy
  const hit = await cache.match(key);
  try {
    // with a stored copy: give the network 5 s; without one: no time limit (a slow eSIM must not leave the map empty)
    const res = await fetchWithTimeout(url, hit ? 5000 : 0, signal);
    if (res.ok) {
      cache.put(key, res.clone()).catch(() => {});
      return res;
    }
    if (hit) return hit;
    return res;
  } catch (e) {
    if (hit) return hit;
    throw e;
  }
}

let registered = false;
export function registerOfflineProtocol() {
  if (registered || !hasCache) return;
  registered = true;
  maplibregl.addProtocol(PROTO, async (params, abort) => {
    const url = "https://" + params.url.slice(PROTO.length + 3);
    const res = await cachedFetch(url, abort.signal);
    if (!res.ok) throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
    if (params.type === "json") return { data: await res.json() };
    if (params.type === "string") return { data: await res.text() };
    return { data: await res.arrayBuffer() };
  });
}
/** MapLibre transformRequest: send the basemap through the caching protocol */
export function transformRequest(url: string): { url: string } | undefined {
  if (!hasCache || !url.startsWith(HOST)) return undefined;
  return { url: `${PROTO}://${url.slice(8)}` };
}

// ---------- pre-download ----------
type LL = { lat: number; lng: number };
export type OfflineStatus = { state: "none" | "running" | "ready" | "error"; done: number; total: number; bytes: number; at?: number; error?: string; points?: number };
let status: OfflineStatus = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(STATUS_KEY) || "null");
    return s && s.state === "ready" ? s : { state: "none", done: 0, total: 0, bytes: 0 };
  } catch {
    return { state: "none", done: 0, total: 0, bytes: 0 };
  }
})();
const subs = new Set<() => void>();
const setStatus = (s: Partial<OfflineStatus>) => {
  status = { ...status, ...s };
  if (status.state === "ready" || status.state === "none") {
    try {
      localStorage.setItem(STATUS_KEY, JSON.stringify(status));
    } catch {
      /* ignore */
    }
  }
  subs.forEach((f) => f());
};
export function useOffline(): OfflineStatus {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => status,
  );
}

const lon2x = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};
function bboxTiles(out: Set<string>, z: number, s: number, w: number, n: number, e: number) {
  for (let x = lon2x(w, z); x <= lon2x(e, z); x++) for (let y = lat2y(n, z); y <= lat2y(s, z); y++) out.add(`${z}/${x}/${y}`);
}

/** Tiles to keep: the whole region at low zoom, the city at mid zoom, ~2.5 km around each place at street level */
export function tilesFor(points: LL[]): string[] {
  const out = new Set<string>();
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  // whole world at z0–3 (the globe on the home screen) and the region at z4–9
  for (let z = 0; z <= 3; z++) bboxTiles(out, z, -60, -180, 75, 180);
  for (let z = 4; z <= 9; z++) bboxTiles(out, z, s - 0.4, w - 0.4, n + 0.4, e + 0.4);
  // mid zoom: only around the dense part (points within ~60 km of the median), so a far day trip does not blow up the count
  const med = (v: number[]) => v.slice().sort((x, y) => x - y)[v.length >> 1];
  const mid = { lat: med(lats), lng: med(lngs) };
  const core = points.filter((p) => Math.abs(p.lat - mid.lat) < 0.5 && Math.abs(p.lng - mid.lng) < 0.6);
  const cl = core.map((p) => p.lat), cg = core.map((p) => p.lng);
  for (let z = 10; z <= 12; z++) bboxTiles(out, z, Math.min(...cl) - 0.05, Math.min(...cg) - 0.05, Math.max(...cl) + 0.05, Math.max(...cg) + 0.05);
  for (const p of points) {
    const dLat = 2.5 / 110.5;
    const dLng = 2.5 / (111.3 * Math.cos((p.lat * Math.PI) / 180));
    for (let z = 13; z <= 14; z++) bboxTiles(out, z, p.lat - dLat, p.lng - dLng, p.lat + dLat, p.lng + dLng);
  }
  return [...out];
}

let running: AbortController | null = null;

export async function prepareOffline(points: LL[]): Promise<void> {
  if (!hasCache) {
    setStatus({ state: "error", error: "Ce navigateur ne permet pas de garder la carte hors ligne." });
    return;
  }
  if (running) return;
  const prev = status.state === "ready" ? { ...status, error: undefined } : null;
  running = new AbortController();
  const signal = running.signal;
  let lock: { release: () => Promise<void> } | null = null;
  try {
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    if (est?.quota && est.quota - (est.usage || 0) < 80e6) {
      setStatus({ state: "error", error: "Plus assez de place sur le téléphone (il faut environ 80 Mo libres)." });
      return;
    }
    await navigator.storage?.persist?.().catch(() => false);
    // keep the screen on during the download (a locked screen stops it)
    lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen").catch(() => null) ?? null;
    const cache = await caches.open(CACHE);
    // style, sprite, tile index, fonts
    const style = await (await cachedFetch(STYLE_URL, signal)).json();
    const tj = await (await cachedFetch(`${HOST}/planet`, signal)).json();
    const template: string = tj.tiles[0];
    const extras: string[] = [];
    if (typeof style.sprite === "string") for (const sfx of [".json", ".png", "@2x.json", "@2x.png"]) extras.push(style.sprite + sfx);
    for (const r of GLYPH_RANGES) extras.push(`${HOST}/fonts/${encodeURIComponent(FONT)}/${r}-${r + 255}.pbf`);
    const tiles = tilesFor(points).map((t) => {
      const [z, x, y] = t.split("/");
      return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    });
    const all = [...extras, ...tiles];
    let done = 0;
    let bytes = 0;
    let quota = false;
    setStatus({ state: "running", done: 0, total: all.length, bytes: 0, error: undefined });
    const pass = async (list: string[]) => {
      const failed: string[] = [];
      let i = 0;
      const worker = async () => {
        while (i < list.length && !signal.aborted && !quota) {
          const url = list[i++];
          try {
            const hit = await cache.match(keyOf(url));
            if (hit) {
              bytes += Number(hit.headers.get("content-length")) || 40_000;
              done++;
            } else {
              const res = await fetchWithTimeout(url, 20000, signal);
              if (res.ok) {
                const buf = await res.clone().arrayBuffer();
                await cache.put(keyOf(url), res);
                bytes += buf.byteLength;
                done++;
              } else if (res.status === 404 || res.status === 204) done++; // empty sea tiles
              else failed.push(url);
            }
          } catch (e) {
            if ((e as Error)?.name === "QuotaExceededError") quota = true;
            else if (!signal.aborted) failed.push(url);
          }
          if (done % 8 === 0) setStatus({ done, bytes });
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      return failed;
    };
    let failed = await pass(all);
    for (let retry = 0; retry < 2 && failed.length && !signal.aborted && !quota; retry++) {
      await new Promise((r) => setTimeout(r, 1500));
      failed = await pass(failed);
    }
    if (signal.aborted) setStatus(prev || { state: "none", done: 0, total: 0, bytes: 0 });
    else if (quota) setStatus(prev ? { ...prev, error: "Plus assez de place : la carte précédente reste disponible." } : { state: "error", error: "Plus assez de place sur le téléphone." });
    else if (failed.length) {
      const msg = `${failed.length} morceaux de carte manquent (réseau). Touchez « Mettre à jour » en Wi-Fi pour les récupérer.`;
      setStatus({ state: "ready", done, total: all.length, bytes, at: Date.now(), points: points.length, error: msg });
    } else setStatus({ state: "ready", done, total: all.length, bytes, at: Date.now(), points: points.length, error: undefined });
  } catch (e) {
    const msg = (e as Error)?.name === "QuotaExceededError" ? "Plus assez de place sur le téléphone." : "Téléchargement interrompu. Réessayez en Wi-Fi.";
    setStatus(prev ? { ...prev, error: `${msg} La carte précédente reste disponible.` } : { state: "error", error: msg });
  } finally {
    running = null;
    lock?.release().catch(() => {});
  }
}

export function cancelOffline() {
  running?.abort();
}

export async function deleteOffline() {
  cancelOffline();
  if (hasCache) await caches.delete(CACHE);
  setStatus({ state: "none", done: 0, total: 0, bytes: 0, at: undefined });
}

export const offlineSupported = hasCache;
