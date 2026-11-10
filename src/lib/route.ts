// Walking and driving routes from the free OSRM servers of FOSSGIS (OpenStreetMap data, no key).
// One request is ~3 KB. Results are cached on the device, so the same trip is never downloaded twice.
// Without network, a straight-line estimate is shown instead.
import { km } from "./geo";

export type Mode = "walk" | "car";
export type LL = { lat: number; lng: number };
export type Route = { coords: [number, number][]; distance: number; duration: number; estimate: boolean; raw?: number };

const BASE: Record<Mode, string> = {
  walk: "https://routing.openstreetmap.de/routed-foot/route/v1/driving/",
  car: "https://routing.openstreetmap.de/routed-car/route/v1/driving/",
};
const CACHE_KEY = "orbes.routes.v1";
const MAX_CACHE = 40;

/** Car times from OSRM assume empty roads; Shanghai traffic is slower. */
// parking / getting in the car: up to 2 min, less for very short hops
const carSeconds = (osrm: number, meters: number) => Math.max(osrm * 1.6, (meters / 1000 / 24) * 3600) + Math.min(120, meters / 5);
const walkSeconds = (meters: number) => (meters / 1000 / 4.8) * 3600;

/** Instant estimate without network (straight line × detour factor). */
export function estimate(from: LL, to: LL, mode: Mode): Route {
  const straight = km(from, to) * 1000;
  const distance = straight * (mode === "walk" ? 1.25 : 1.35);
  return { coords: [[from.lng, from.lat], [to.lng, to.lat]], distance, duration: mode === "walk" ? walkSeconds(distance) : carSeconds(0, distance), estimate: true };
}

type Cached = { k: string; r: Route; t: number };
function readCache(): Cached[] {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "[]");
  } catch {
    return [];
  }
}
function writeCache(list: Cached[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(list.slice(-MAX_CACHE)));
  } catch {
    /* storage full: no cache, no problem */
  }
}
// start rounded to ~100 m, destination to ~1 m
const keyOf = (from: LL, to: LL, mode: Mode) => `${mode}:${from.lat.toFixed(3)},${from.lng.toFixed(3)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;

/** Google "polyline" decoding (precision 6) */
function decode(str: string, precision = 6): [number, number][] {
  const f = 10 ** precision;
  const out: [number, number][] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lng += d;
    }
    out.push([lng / f, lat / f]);
  }
  return out;
}

export async function fetchRoute(from: LL, to: LL, mode: Mode, signal?: AbortSignal): Promise<Route> {
  const k = keyOf(from, to, mode);
  const cache = readCache();
  const hit = cache.find((c) => c.k === k);
  if (hit && Date.now() - hit.t < 7 * 864e5) return hit.r;
  if (!navigator.onLine) return estimate(from, to, mode);
  const url = `${BASE[mode]}${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}?overview=full&geometries=polyline6&steps=false&alternatives=false`;
  const timeout = AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined;
  const sig = signal && timeout && "any" in AbortSignal ? (AbortSignal as unknown as { any: (s: AbortSignal[]) => AbortSignal }).any([signal, timeout]) : signal || timeout;
  try {
    const res = await fetch(url, { signal: sig });
    if (!res.ok) throw new Error(String(res.status));
    const j = await res.json();
    const r0 = j?.routes?.[0];
    if (!r0?.geometry) throw new Error("no route");
    const coords = decode(r0.geometry);
    const route: Route = { coords, distance: r0.distance, duration: mode === "car" ? carSeconds(r0.duration, r0.distance) : Math.max(r0.duration, walkSeconds(r0.distance)), estimate: false, raw: r0.duration };
    writeCache([...cache.filter((c) => c.k !== k), { k, r: route, t: Date.now() }]);
    return route;
  } catch (e) {
    if ((e as Error)?.name === "AbortError" && signal?.aborted) throw e;
    return estimate(from, to, mode);
  }
}

/** Where am I on the route: distance left along it (m) and how far I am from the line (m). Local, no network. */
export function progress(route: Route, pos: LL): { left: number; off: number } {
  const c = route.coords;
  if (c.length < 2) return { left: km(pos, { lat: c[0][1], lng: c[0][0] }) * 1000, off: 0 };
  const kx = 111320 * Math.cos((pos.lat * Math.PI) / 180);
  const ky = 110540;
  const P = (p: [number, number]) => [(p[0] - pos.lng) * kx, (p[1] - pos.lat) * ky];
  let best = Infinity, bestI = 0, bestT = 0;
  const seg: number[] = [];
  for (let i = 0; i < c.length - 1; i++) {
    const [ax, ay] = P(c[i]);
    const [bx, by] = P(c[i + 1]);
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    seg.push(Math.sqrt(L2));
    const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const px = ax + t * dx, py = ay + t * dy;
    const d = Math.sqrt(px * px + py * py);
    if (d < best) {
      best = d;
      bestI = i;
      bestT = t;
    }
  }
  let left = seg[bestI] * (1 - bestT);
  for (let i = bestI + 1; i < seg.length; i++) left += seg[i];
  return { left: left + best, off: best };
}

/** Time left for the distance left on a route */
export function secondsLeft(route: Route, left: number, mode: Mode): number {
  const ratio = route.distance > 0 ? Math.min(1, left / route.distance) : 0;
  if (mode === "walk") return Math.max((route.raw ?? route.duration) * ratio, walkSeconds(left));
  return carSeconds((route.raw ?? 0) * ratio, left);
}

export function fmtDistance(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(m < 9950 ? 1 : 0).replace(".", ",")} km`;
}
export function fmtDuration(s: number): string {
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}
