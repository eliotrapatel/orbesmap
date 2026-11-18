// The offline pack's plan (lot cycle, R19): which routes to keep for each day, how a stored route is reused from where
// the traveller stands, and when the pack counts as complete. Pure, no import (its own distance maths), so
// scripts/offline-sim.mjs runs it under node.

export type LL = { lat: number; lng: number };
export type PackMode = "walk" | "car";
export type Leg = { mode: PackMode; from: LL; to: LL; key: string };
export type DayStops = { key: string; stops: LL[] };

/** Walking routes are kept only for hops up to this straight distance (driving always) */
export const WALK_MAX_M = 4000;
/** At most this many routes are asked (the OSRM servers are free and shared) */
export const MAX_LEGS = 400;
/** A stored route is reused from the traveller's position when they stand within this distance of it */
export const SLICE_MAX_OFF_M = 300;
/** Two points closer than this are the same stop (no route between them) */
const SAME_M = 30;

export const validLL = (p: Partial<LL> | null | undefined): p is LL =>
  !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat!) <= 90 && Math.abs(p.lng!) <= 180 && !(p.lat === 0 && p.lng === 0);

/** Great-circle distance in metres */
export function haversine(a: LL, b: LL): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** The stored name of one route (exact to ~1 m at both ends) */
export const routeKey = (mode: PackMode, from: LL, to: LL) => `${mode}:${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;
/** The route a stored name describes (null for anything else) */
export function parseRouteKey(k: string): { mode: PackMode; from: LL; to: LL } | null {
  const m = /^(walk|car):(-?\d+\.\d+),(-?\d+\.\d+)>(-?\d+\.\d+),(-?\d+\.\d+)$/.exec(k);
  return m ? { mode: m[1] as PackMode, from: { lat: +m[2], lng: +m[3] }, to: { lat: +m[4], lng: +m[5] } } : null;
}

/**
 * The routes of each scheduled day, in the day's order: hotel → first stop, each stop → the next, last stop → hotel.
 * Driving always, walking too when the hop is short; each route once; at most MAX_LEGS.
 */
export function legsFor(days: DayStops[], hotel: LL | null): Leg[] {
  const out: Leg[] = [];
  const seen = new Set<string>();
  const home = validLL(hotel) ? hotel : null;
  const push = (mode: PackMode, from: LL, to: LL) => {
    if (out.length >= MAX_LEGS) return;
    const key = routeKey(mode, from, to);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ mode, from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng }, key });
  };
  for (const d of days) {
    const stops = d.stops.filter(validLL);
    if (!stops.length) continue;
    const path = [...(home ? [home] : []), ...stops, ...(home ? [home] : [])];
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      const dist = haversine(a, b);
      if (dist < SAME_M) continue;
      push("car", a, b);
      if (dist <= WALK_MAX_M) push("walk", a, b);
    }
  }
  return out;
}

/**
 * A stored route cut from where the traveller stands (same projection as route.ts `progress`): the part still ahead,
 * starting at their position. Null when they are more than `maxOff` metres from it.
 */
export function sliceFromFix(coords: [number, number][], fix: LL, maxOff = SLICE_MAX_OFF_M): { coords: [number, number][]; off: number; left: number; total: number } | null {
  if (!Array.isArray(coords) || coords.length < 2 || !validLL(fix)) return null;
  const kx = 111320 * Math.cos((fix.lat * Math.PI) / 180);
  const ky = 110540;
  const P = (p: [number, number]) => [(p[0] - fix.lng) * kx, (p[1] - fix.lat) * ky];
  let best = Infinity;
  let bestI = 0;
  let bestT = 0;
  const seg: number[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = P(coords[i]);
    const [bx, by] = P(coords[i + 1]);
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    seg.push(Math.sqrt(L2));
    const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) {
      best = d;
      bestI = i;
      bestT = t;
    }
  }
  if (best > maxOff) return null;
  const total = seg.reduce((s, x) => s + x, 0);
  let left = seg[bestI] * (1 - bestT);
  for (let i = bestI + 1; i < seg.length; i++) left += seg[i];
  const a = coords[bestI];
  const b = coords[bestI + 1];
  const on: [number, number] = [a[0] + (b[0] - a[0]) * bestT, a[1] + (b[1] - a[1]) * bestT];
  return { coords: [[fix.lng, fix.lat], on, ...coords.slice(bestI + 1)], off: best, left: left + best, total };
}

export type PackCheck = {
  /** the map tiles (null = this browser keeps no map) */
  map: { expected: number; missing: number } | null;
  routes: { total: number; have: number; failed: number };
  /** null = photos are not kept here (only the installed app on orbesmap.vercel.app keeps them) */
  photos: { total: number; have: number } | null;
  /** the trip record and its places are in this phone's storage */
  trip: boolean;
  /** places with their local name to show a driver (informative: never makes the pack incomplete) */
  cards: { have: number; total: number };
};
export type PackSummary = { mapOk: boolean; routesOk: boolean; photosOk: boolean; complete: boolean };

/** Complete = the map, every route (or known impossible) and every photo kept here */
export function packSummary(c: PackCheck): PackSummary {
  const mapOk = !!c.map && c.map.missing === 0;
  const routesOk = c.routes.have + c.routes.failed >= c.routes.total;
  const photosOk = !c.photos || c.photos.have >= c.photos.total;
  return { mapOk, routesOk, photosOk, complete: mapOk && routesOk && photosOk && c.trip };
}

export type PackPhase = "map" | "routes" | "photos";
export type PackStatus = {
  state: "none" | "running" | "ready" | "error";
  done: number;
  total: number;
  bytes: number;
  at?: number;
  error?: string;
  points?: number;
  /** the trip of the pack (absent: a map-only download from before the pack) */
  trip?: string;
  /** in memory only: the routes or photos are being fetched (the map is ready) */
  phase?: PackPhase;
  routes?: { done: number; total: number; failed: number };
  photos?: { done: number; total: number } | null;
};
/** A status read back from the phone: anything but a ready map is "none"; the phase never survives a restart */
export function readStatus(raw: unknown): PackStatus {
  const s = raw as PackStatus | null;
  if (!s || s.state !== "ready") return { state: "none", done: 0, total: 0, bytes: 0 };
  const { phase: _phase, ...rest } = s;
  void _phase;
  return rest;
}
/** A map-only pack (downloaded before routes and photos were part of it) */
export const legacyPack = (s: PackStatus) => s.state === "ready" && !s.trip;
/**
 * A change of status during the routes or photos phase: the map's state never changes there (a route or a photo that
 * fails is counted, never an error of the whole mode).
 */
export function phaseUpdate(s: PackStatus, patch: Partial<PackStatus>): PackStatus {
  if (s.phase === "routes" || s.phase === "photos" || patch.phase === "routes" || patch.phase === "photos") {
    const { state: _state, error: _error, ...rest } = patch;
    void _state;
    void _error;
    return { ...s, ...rest };
  }
  return { ...s, ...patch };
}
