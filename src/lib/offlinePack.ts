// The offline pack of a trip (lot cycle, R19): besides the map (lib/offline.ts), the routes of each day (stored in the
// Cache API, "orbes-pack-v1", one small file per route) and the programme's photos (the service worker's photo cache,
// only in the installed app). Also the two steps recorded per trip: pack ready, pack used without network.
import type { Trip } from "../data/types";
import type { PlaceState } from "./model";
import type { Mode, Route } from "./route";
import { dayStops, isHotel } from "./plan";
import { PHOTO_CACHE, photoUrl } from "./placePhotos";
import { isRef } from "./photoData";
import { legsFor, parseRouteKey, routeFromStored, validLL, haversine, type Leg, type LL } from "./packPlan";
import { getState } from "./store";
import { track } from "./track";

export const PACK_CACHE = "orbes-pack-v1";
const ROUTE_URL = "https://pack.orbes.local/route/";
/** A photo the server no longer has (4xx): noted in the pack's cache, so the pack can still be complete */
const PHOTO_GONE_URL = "https://pack.orbes.local/photo-gone/";
const hasCache = typeof caches !== "undefined";

export type PackSpec = {
  tripId: string;
  /** the places the map is kept around (as the map-only mode did) */
  points: LL[];
  legs: Leg[];
  photos: string[];
  /** programme places with a local name to show a driver (text already in the trip data) */
  cards: { have: number; total: number };
};

/** What the pack of this trip holds */
export function packFor(trip: Trip, states: Record<string, PlaceState> = getState().data.places): PackSpec {
  const points = [...trip.places, trip.hotel, ...trip.zones.map((z) => ({ lng: z.center[0], lat: z.center[1] }))].filter(validLL).map((p) => ({ lat: p.lat, lng: p.lng }));
  const days = trip.days
    .filter((d) => d.scheduled)
    .map((d) => ({ key: d.key, stops: dayStops(trip, d.key, states).filter((p) => !isHotel(trip, p)).map((p) => ({ lat: p.lat, lng: p.lng })) }));
  const legs = legsFor(days, validLL(trip.hotel) ? { lat: trip.hotel.lat, lng: trip.hotel.lng } : null);
  const urls = new Set<string>();
  if (isRef(trip.cover)) {
    urls.add(photoUrl(trip.cover.path));
    urls.add(photoUrl(trip.cover.thumb));
  }
  for (const p of trip.places) {
    if (!isRef(p.photo)) continue;
    urls.add(photoUrl(p.photo.thumb));
    urls.add(photoUrl(p.photo.path));
  }
  const scheduled = new Set(trip.days.filter((d) => d.scheduled).map((d) => d.key));
  const prog = trip.places.filter((p) => scheduled.has(p.day) && !isHotel(trip, p));
  return { tripId: trip.id, points, legs, photos: [...urls].sort(), cards: { have: prog.filter((p) => String(p.cn || "").trim()).length, total: prog.length } };
}

// ---------- routes ----------
const routeReq = (key: string) => new Request(ROUTE_URL + encodeURIComponent(key));
export type Stored = Route | { failed: true };
export async function getLeg(key: string): Promise<Stored | null> {
  if (!hasCache) return null;
  try {
    const hit = await (await caches.open(PACK_CACHE)).match(routeReq(key));
    return hit ? ((await hit.json()) as Stored) : null;
  } catch {
    return null;
  }
}
export async function putLeg(key: string, v: Stored) {
  if (!hasCache) return;
  const cache = await caches.open(PACK_CACHE);
  await cache.put(routeReq(key), new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } }));
}
/** Every stored route's name */
async function storedKeys(): Promise<string[]> {
  if (!hasCache) return [];
  try {
    const ks = await (await caches.open(PACK_CACHE)).keys();
    return ks.filter((r) => r.url.startsWith(ROUTE_URL)).map((r) => decodeURIComponent(r.url.slice(ROUTE_URL.length))).filter(Boolean);
  } catch {
    return [];
  }
}
export async function routesHeld(legs: Leg[]): Promise<{ have: number; failed: number }> {
  const keys = new Set(await storedKeys());
  let have = 0;
  let failed = 0;
  for (const l of legs) {
    if (!keys.has(l.key)) continue;
    const v = await getLeg(l.key);
    if (v && "failed" in v) failed++;
    else if (v) have++;
  }
  return { have, failed };
}

/**
 * A route to this place from where the traveller stands, cut from a stored route of the pack (no network). Null when
 * none ends there or the traveller is too far from every one.
 */
export async function packRoute(from: LL, to: LL, mode: Mode): Promise<Route | null> {
  if (!hasCache || !validLL(from) || !validLL(to)) return null;
  const entries: { key: string; route: Stored | null }[] = [];
  for (const k of await storedKeys()) {
    const p = parseRouteKey(k);
    // only the stored routes that end at this place are read
    if (!p || p.mode !== mode || haversine(p.to, to) > 30) continue;
    entries.push({ key: k, route: await getLeg(k) });
  }
  return routeFromStored(entries, from, to, mode);
}

// ---------- photos ----------
const photoCacheOk = () => typeof caches !== "undefined" && !!navigator.serviceWorker?.controller && location.hostname.endsWith(".vercel.app");
const goneReq = (url: string) => new Request(PHOTO_GONE_URL + encodeURIComponent(url));
/** How many of these photos are kept here, and how many the server no longer has (null: not kept in this browser) */
export async function photosHeld(urls: string[]): Promise<{ total: number; have: number; failed: number } | null> {
  if (!photoCacheOk()) return null;
  try {
    const cache = await caches.open(PHOTO_CACHE);
    const pack = await caches.open(PACK_CACHE);
    let have = 0;
    let failed = 0;
    for (const u of urls) {
      if (await cache.match(u)) have++;
      else if (await pack.match(goneReq(u))) failed++;
    }
    return { total: urls.length, have, failed };
  } catch {
    return null;
  }
}
/**
 * Downloads the missing photos, 3 at a time; returns how many are kept (null: not kept in this browser). A photo the
 * server answers 4xx for is noted as gone (tried again at each update, it no longer keeps the pack incomplete); a
 * network or server error is not (fetched again at the next update).
 */
export async function fetchPhotos(urls: string[], signal: AbortSignal, onStep: (done: number) => void): Promise<number | null> {
  if (!photoCacheOk()) return null;
  const cache = await caches.open(PHOTO_CACHE);
  const pack = await caches.open(PACK_CACHE);
  let done = 0;
  let i = 0;
  const worker = async () => {
    while (i < urls.length && !signal.aborted) {
      const u = urls[i++];
      try {
        if (!(await cache.match(u))) {
          const r = await fetch(u, { mode: "cors", credentials: "omit", signal });
          if (r.ok) {
            await cache.put(u, r);
            await pack.delete(goneReq(u)).catch(() => false);
          } else {
            if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) await pack.put(goneReq(u), new Response("1")).catch(() => undefined);
            continue;
          }
        }
        done++;
        onStep(done);
      } catch {
        /* one photo missing: fetched again at the next update */
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return done;
}

/** The trip record and its places are in this phone's storage (they open without network) */
export function tripHeld(trip: Trip): boolean {
  try {
    const rec = (JSON.parse(localStorage.getItem("orbes.trips.v1") || "{}") as Record<string, unknown>)[trip.id];
    const code = trip.id === "sha-2026" || trip.id === "gz-2026";
    return (code || !!rec) && trip.places.length > 0 && (code || localStorage.getItem("orbes.v2." + trip.id) != null);
  } catch {
    return false;
  }
}

export async function clearPack() {
  if (hasCache) await caches.delete(PACK_CACHE).catch(() => false);
}

// ---------- steps recorded (once per trip and day) ----------
const READY_KEY = "orbes.offline.ready";
const USED_KEY = "orbes.offline.used";
const today = () => new Date().toISOString().slice(0, 10);
function readMap(k: string): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(k) || "{}");
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function writeMap(k: string, m: Record<string, number>) {
  try {
    // only the 40 most recent entries are kept
    localStorage.setItem(k, JSON.stringify(Object.fromEntries(Object.entries(m).slice(-40))));
  } catch {
    /* ignore */
  }
}
/** The pack of a trip checked on this phone: "full" (map, routes, photos) or "map" */
export function reportReady(tripId: string, full: boolean) {
  if (!tripId || !getState().session) return;
  const k = `${tripId}|${full ? "full" : "map"}|${today()}`;
  const m = readMap(READY_KEY);
  if (m[k]) return;
  m[k] = 1;
  writeMap(READY_KEY, m);
  track("offline_ready", full ? "full" : "map", tripId);
}
/** Reported "full" today already: the quiet check at start-up is skipped */
export const readyReportedToday = (tripId: string) => !!readMap(READY_KEY)[`${tripId}|full|${today()}`];
/** The quiet check at start-up runs at most once a day per trip, whatever it finds (an incomplete pack is not checked
 *  again at every opening): true = run it now (and it is marked for today) */
export function quietCheckDue(tripId: string): boolean {
  if (!tripId || readyReportedToday(tripId)) return false;
  const k = `${tripId}|checked|${today()}`;
  const m = readMap(READY_KEY);
  if (m[k]) return false;
  m[k] = 1;
  writeMap(READY_KEY, m);
  return true;
}
const marked = new Set<string>();
/** The pack used without network ("map", "route", "app"): queued here, recorded once the network is back */
export function markOfflineUse(tripId: string, what: "map" | "route" | "app") {
  if (!tripId) return;
  const k = `${tripId}|${what}|${today()}`;
  if (marked.has(k)) return;
  marked.add(k);
  const m = readMap(USED_KEY);
  if (k in m) return;
  m[k] = 0;
  writeMap(USED_KEY, m);
  if (typeof navigator !== "undefined" && navigator.onLine) flushOfflineUse();
}
export function flushOfflineUse() {
  if (!getState().session) return;
  const m = readMap(USED_KEY);
  let changed = false;
  for (const [k, sent] of Object.entries(m)) {
    if (sent) continue;
    const [trip, what] = k.split("|");
    track("offline_used", what, trip);
    m[k] = 1;
    changed = true;
  }
  if (changed) writeMap(USED_KEY, m);
}
if (typeof window !== "undefined") window.addEventListener("online", () => window.setTimeout(flushOfflineUse, 3000));
