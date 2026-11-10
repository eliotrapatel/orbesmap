import type { Place } from "../data/types";

type LL = { lat: number; lng: number };

/** Straight-line distance in km */
export function km(a: LL, b: LL): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Rough door-to-door time in Guangzhou traffic (same estimate as the June version: 4.5 min per km, 5 min minimum) */
export function travelMinutes(a: LL, b: LL): number {
  return Math.max(5, Math.round(km(a, b) * 4.5));
}

export function formatMinutes(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, "0")}` : `${h} h`;
}

/** Nearest-neighbour tour starting from `start` */
export function optimizeOrder(start: LL, places: Place[]): Place[] {
  const rest = places.slice();
  const out: Place[] = [];
  let cur: LL = start;
  while (rest.length) {
    let bi = 0;
    let bd = Infinity;
    rest.forEach((p, i) => {
      const d = km(cur, p);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    });
    cur = rest[bi];
    out.push(rest.splice(bi, 1)[0]);
  }
  return out;
}

export const googleDirections = (p: LL) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}&travelmode=transit`;
export const amapDirections = (p: LL & { name: string }) =>
  // Amap (Gaode) works in mainland China without VPN. It expects GCJ-02, so convert from WGS-84.
  (() => {
    const g = wgsToGcj(p.lat, p.lng);
    return `https://uri.amap.com/navigation?to=${g.lng.toFixed(6)},${g.lat.toFixed(6)},${encodeURIComponent(p.name)}&mode=car&coordinate=gaode&callnative=1`;
  })();

// WGS-84 → GCJ-02 (standard public algorithm used for maps in mainland China)
export function wgsToGcj(lat: number, lng: number): LL {
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  const tLat = (x: number, y: number) => {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
    r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
    r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
    return r;
  };
  const tLng = (x: number, y: number) => {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
    r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
    r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
    return r;
  };
  let dLat = tLat(lng - 105, lat - 35);
  let dLng = tLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sq = Math.sqrt(magic);
  dLat = (dLat * 180) / (((a * (1 - ee)) / (magic * sq)) * Math.PI);
  dLng = (dLng * 180) / ((a / sq) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
