// Offline map: every basemap request goes through the "ofm" protocol, which serves from the
// device cache first (tiles, fonts, icons) and stores what it downloads. "Préparer hors ligne"
// pre-downloads the trip's neighbourhoods so the map works in the metro or without data.
import * as maplibregl from "maplibre-gl";
import { useSyncExternalStore } from "react";
import { t } from "./i18n";
import type { Trip } from "../data/types";
import { packSummary, phaseUpdate, readStatus, type PackCheck, type PackStatus } from "./packPlan";
import { clearPack, fetchPhotos, flushOfflineUse, getLeg, markOfflineUse, packFor, photosHeld, putLeg, readyReportedToday, reportReady, routesHeld, tripHeld, type PackSpec } from "./offlinePack";
import { osrmRoute } from "./route";
import { currentTrip } from "./store";

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
    if (hit) {
      // the offline map used without network (recorded once per trip and day, when the network is back)
      if (!mapUseMarked && typeof navigator !== "undefined" && navigator.onLine === false) {
        mapUseMarked = true;
        try {
          markOfflineUse(currentTrip().id, "map");
        } catch {
          /* ignore */
        }
      }
      return hit;
    }
    // a tile missing from the copy must not hang the map: after 10 s MapLibre draws the stored zoomed-out tile
    const res = await fetchWithTimeout(url, 10000, signal);
    if (res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  }
  // style and tile index: the stored copy right away (no waiting on a filtered hotel Wi-Fi),
  // refreshed in the background for next time. A new style is kept only once its sprite (map icons)
  // is stored too, so a silent refresh can never point the offline map at icons it does not have.
  const hit = await cache.match(key);
  if (hit) {
    fetchWithTimeout(url, 15000)
      .then(async (res) => {
        if (!res.ok) return;
        const j = await res.clone().json().catch(() => null);
        if (j && typeof j.sprite === "string") {
          for (const sfx of [".json", ".png", "@2x.json", "@2x.png"]) {
            const k = keyOf(j.sprite + sfx);
            if (await cache.match(k)) continue;
            const r = await fetchWithTimeout(j.sprite + sfx, 15000);
            if (!r.ok) return; // keep the old style
            await cache.put(k, r);
          }
        }
        await cache.put(key, res);
      })
      .catch(() => {});
    return hit;
  }
  return fetchWithTimeout(url, 20000, signal).then((res) => {
    if (res.ok) cache.put(key, res.clone()).catch(() => {});
    return res;
  });
}

let mapUseMarked = false;
let registered = false;
export function registerOfflineProtocol() {
  if (registered || !hasCache) return;
  registered = true;
  if (typeof window !== "undefined") {
    // the app opened without network; the steps kept from an earlier offline use are sent when online
    try {
      if (navigator.onLine === false) markOfflineUse(currentTrip().id, "app");
      else window.setTimeout(flushOfflineUse, 8000);
    } catch {
      /* ignore */
    }
    // a pack ready for the open trip: checked quietly once a day, so the J-3 reminder knows it is there
    window.setTimeout(() => void quietCheck(), 10000);
  }
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
/** The map's state (state "ready" = the map is on the phone), and since the pack (lot cycle) its routes and photos */
export type OfflineStatus = PackStatus;
let status: OfflineStatus = (() => {
  try {
    return readStatus(JSON.parse(localStorage.getItem(STATUS_KEY) || "null"));
  } catch {
    return { state: "none", done: 0, total: 0, bytes: 0 };
  }
})();
const subs = new Set<() => void>();
const save = () => {
  if (status.state === "ready" || status.state === "none") {
    try {
      // the phase lives in memory only
      const { phase: _phase, ...kept } = status;
      void _phase;
      localStorage.setItem(STATUS_KEY, JSON.stringify(kept));
    } catch {
      /* ignore */
    }
  }
  subs.forEach((f) => f());
};
const setStatus = (s: Partial<OfflineStatus>) => {
  status = { ...status, ...s };
  save();
};
/** During the routes and photos: the map's state never changes (lib/packPlan.ts phaseUpdate) */
const setPhase = (s: Partial<OfflineStatus>) => {
  status = phaseUpdate(status, s);
  save();
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
  // whole world at z0–3 (the globe on the home screen), the region at z4–6 (cheap even if a pin is far away,
  // e.g. the Paris airport), then ~45 km around each place at z7–9 (a far pin no longer multiplies the download)
  for (let z = 0; z <= 3; z++) bboxTiles(out, z, -60, -180, 75, 180);
  for (let z = 4; z <= 6; z++) bboxTiles(out, z, s - 0.4, w - 0.4, n + 0.4, e + 0.4);
  for (const p of points) for (let z = 7; z <= 9; z++) bboxTiles(out, z, p.lat - 0.4, p.lng - 0.4, p.lat + 0.4, p.lng + 0.4);
  // mid zoom: only around the dense part (points within ~60 km of the median), so a far day trip does not blow up the count
  const med = (v: number[]) => v.slice().sort((x, y) => x - y)[v.length >> 1];
  const mid = { lat: med(lats), lng: med(lngs) };
  const core = points.filter((p) => Math.abs(p.lat - mid.lat) < 0.5 && Math.abs(p.lng - mid.lng) < 0.6);
  const cl = core.map((p) => p.lat), cg = core.map((p) => p.lng);
  for (let z = 10; z <= 12; z++) bboxTiles(out, z, Math.min(...cl) - 0.05, Math.min(...cg) - 0.05, Math.max(...cl) + 0.05, Math.max(...cg) + 0.05);
  for (const p of points) {
    const k = 1 / (111.3 * Math.cos((p.lat * Math.PI) / 180));
    // ~12 km around each place at mid zoom (Suzhou and other places outside the city stay sharp when zooming out)
    for (let z = 10; z <= 12; z++) bboxTiles(out, z, p.lat - 12 / 110.5, p.lng - 12 * k, p.lat + 12 / 110.5, p.lng + 12 * k);
    // ~2.5 km around each place at street level
    for (let z = 13; z <= 14; z++) bboxTiles(out, z, p.lat - 2.5 / 110.5, p.lng - 2.5 * k, p.lat + 2.5 / 110.5, p.lng + 2.5 * k);
  }
  return [...out];
}

/** Every file the offline map needs: sprite (map icons), label font, vector tiles.
 * (The style declares a shaded-relief source but no layer draws it, so the map never asks for it.) */
function urlsFor(points: LL[], style: { sprite?: unknown }, template: string): string[] {
  const extras: string[] = [];
  if (typeof style.sprite === "string") for (const sfx of [".json", ".png", "@2x.json", "@2x.png"]) extras.push(style.sprite + sfx);
  for (const r of GLYPH_RANGES) extras.push(`${HOST}/fonts/${encodeURIComponent(FONT)}/${r}-${r + 255}.pbf`);
  const tiles = tilesFor(points).map((t) => {
    const [z, x, y] = t.split("/");
    return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  });
  return [...extras, ...tiles];
}

/** Fresh copy from the network (stored), else the stored one: the download must use the current tile version. */
async function freshJson(url: string, signal: AbortSignal): Promise<{ sprite?: unknown; tiles?: string[] }> {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetchWithTimeout(url, 20000, signal);
    if (res.ok) {
      await cache.put(keyOf(url), res.clone());
      return await res.json();
    }
  } catch {
    if (signal.aborted) throw new Error("aborted");
  }
  const hit = await cache.match(keyOf(url));
  if (!hit) throw new Error("no copy");
  return hit.json();
}

/** Checks what is really on the phone right now (Safari can clear storage; places may have been added). */
export async function verifyOffline(points: LL[]): Promise<{ expected: number; missing: number } | null> {
  if (!hasCache) return null;
  try {
    const cache = await caches.open(CACHE);
    const styleRes = await cache.match(keyOf(STYLE_URL));
    const tjRes = await cache.match(keyOf(`${HOST}/planet`));
    if (!styleRes || !tjRes) return { expected: 1, missing: 1 };
    const style = await styleRes.json();
    const template: string = (await tjRes.json()).tiles[0];
    const urls = urlsFor(points, style, template);
    let missing = 0;
    for (let i = 0; i < urls.length; i += 50) {
      const found = await Promise.all(urls.slice(i, i + 50).map((u) => cache.match(keyOf(u))));
      missing += found.filter((f) => !f).length;
    }
    return { expected: urls.length + 2, missing };
  } catch {
    return null;
  }
}

let running: AbortController | null = null;

export async function prepareOffline(points: LL[]): Promise<void> {
  if (!hasCache) {
    setStatus({ state: "error", error: t("Ce navigateur ne permet pas de garder la carte hors ligne.") });
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
      setStatus({ state: "error", error: t("Plus assez de place sur le téléphone (il faut environ 80 Mo libres).") });
      return;
    }
    await navigator.storage?.persist?.().catch(() => false);
    // keep the screen on during the download (a locked screen stops it)
    lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen").catch(() => null) ?? null;
    const cache = await caches.open(CACHE);
    // style and tile index fetched fresh (current tile version), then sprite, fonts, tiles
    const style = await freshJson(STYLE_URL, signal);
    const tj = await freshJson(`${HOST}/planet`, signal);
    const template = String(tj.tiles?.[0] || "");
    if (!template) throw new Error("no template");
    const all = urlsFor(points, style, template);
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
              // real size of what is already stored (stored responses often have no length header)
              bytes += (await hit.blob()).size; // space used on the phone (same measure as new downloads)
              done++;
            } else {
              const res = await fetchWithTimeout(url, 20000, signal);
              if (res.ok) {
                const buf = await res.clone().arrayBuffer();
                await cache.put(keyOf(url), res);
                bytes += buf.byteLength;
                done++;
              } else if (res.status === 204) done++; // nothing to draw there
              else failed.push(url); // 404 included: a real empty tile answers 200 with a tiny file
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
    else if (quota) setStatus(prev ? { ...prev, error: t("Plus assez de place : la carte précédente reste disponible.") } : { state: "error", error: t("Plus assez de place sur le téléphone.") });
    else if (failed.length) {
      const msg = t("{n} morceaux de carte manquent (réseau). Touchez « Mettre à jour » en Wi-Fi pour les récupérer.", { n: failed.length });
      setStatus({ state: "ready", done, total: all.length, bytes, at: Date.now(), points: points.length, error: msg });
    } else setStatus({ state: "ready", done, total: all.length, bytes, at: Date.now(), points: points.length, error: undefined });
  } catch (e) {
    const msg = (e as Error)?.name === "QuotaExceededError" ? t("Plus assez de place sur le téléphone.") : t("Téléchargement interrompu. Réessayez en Wi-Fi.");
    setStatus(prev ? { ...prev, error: t("{msg} La carte précédente reste disponible.", { msg }) } : { state: "error", error: msg });
  } finally {
    running = null;
    lock?.release().catch(() => {});
  }
}

export function cancelOffline() {
  packStop = true;
  running?.abort();
}

export async function deleteOffline() {
  cancelOffline();
  if (hasCache) await caches.delete(CACHE);
  await clearPack();
  setStatus({ state: "none", done: 0, total: 0, bytes: 0, at: undefined, trip: undefined, phase: undefined, routes: undefined, photos: undefined });
}

// ---------- the complete pack (lot cycle, R19): the map, then each day's routes, then the programme's photos ----------
let packStop = false;
let packing = false;
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const tm = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(tm);
      resolve();
    }, { once: true });
  });
/** OSRM answered that no route exists (an island, a closed area): kept as impossible, the app shows an estimate */
const noRoute = (e: unknown) => /^(no route|400)$/.test(String((e as Error)?.message || ""));

/**
 * Downloads the whole pack of a trip: the map (same download as before, unchanged), then the routes one by one (at
 * least 1.1 s apart, the OSRM servers are free), then the photos (3 at a time, the installed app only). A route or a
 * photo that fails never touches the map: it is counted and fetched again at the next update.
 */
export async function preparePack(spec: PackSpec): Promise<void> {
  if (running || packing) return;
  packing = true;
  packStop = false;
  let reached = false;
  let lock: { release: () => Promise<void> } | null = null;
  try {
    setStatus({ routes: { done: 0, total: spec.legs.length, failed: 0 }, photos: { done: 0, total: spec.photos.length } });
    await prepareOffline(spec.points);
    if (packStop || status.state !== "ready" || running) return;
    reached = true;
    const ctl = new AbortController();
    running = ctl;
    const signal = ctl.signal;
    lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen").catch(() => null) ?? null;
    const total = spec.legs.length;
    let done = 0;
    let failed = 0;
    setPhase({ phase: "routes", trip: spec.tripId, routes: { done, total, failed } });
    let last = 0;
    for (const leg of spec.legs) {
      if (signal.aborted) break;
      const have = await getLeg(leg.key);
      if (have && !("failed" in have)) {
        done++;
        setPhase({ routes: { done, total, failed } });
        continue;
      }
      const wait = last + 1100 - Date.now();
      if (wait > 0) await sleep(wait, signal);
      if (signal.aborted) break;
      last = Date.now();
      try {
        await putLeg(leg.key, await osrmRoute(leg.from, leg.to, leg.mode, signal));
        done++;
      } catch (e) {
        if (signal.aborted) break;
        if (noRoute(e)) {
          await putLeg(leg.key, { failed: true }).catch(() => undefined);
          failed++;
        }
      }
      setPhase({ routes: { done, total, failed } });
    }
    if (!signal.aborted) {
      setPhase({ phase: "photos", photos: { done: 0, total: spec.photos.length } });
      const kept = await fetchPhotos(spec.photos, signal, (d) => setPhase({ photos: { done: d, total: spec.photos.length } }));
      if (kept === null) setPhase({ photos: null });
    }
  } catch {
    /* the map stays as it is; what is missing shows in the check */
  } finally {
    if (reached) {
      running = null;
      setPhase({ phase: undefined, at: Date.now() });
    }
    packing = false;
    lock?.release().catch(() => {});
  }
}

/** What the pack of this trip holds on this phone right now */
export async function verifyPack(spec: PackSpec, trip: Trip): Promise<PackCheck | null> {
  try {
    const map = await verifyOffline(spec.points);
    const routes = await routesHeld(spec.legs);
    const photos = await photosHeld(spec.photos);
    return { map, routes: { total: spec.legs.length, ...routes }, photos, trip: tripHeld(trip), cards: spec.cards };
  } catch {
    return null;
  }
}

async function quietCheck() {
  try {
    if (status.state !== "ready" || !status.trip || running || packing) return;
    const trip = currentTrip();
    if (trip.id !== status.trip || readyReportedToday(trip.id)) return;
    const c = await verifyPack(packFor(trip), trip);
    if (!c) return;
    const s = packSummary(c);
    if (s.mapOk) reportReady(trip.id, s.complete);
  } catch {
    /* ignore */
  }
}

export const offlineSupported = hasCache;
