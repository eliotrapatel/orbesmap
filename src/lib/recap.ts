// After a trip: what it was, in figures (days, places visited, photos, money spent, cities), and the same as a
// story image (1080 × 1920) to share or save. Everything is read from this phone's copy of the trip.
import type { Trip } from "../data/types";
import { expensesOf, toEur } from "./business";
import { countable } from "./plan";
import { getState } from "./store";
import { homeZone, tripEndMs } from "./time";
import { dateLabel } from "./newTrip";
import { locale, t } from "./i18n";

export type Recap = {
  tripId: string;
  title: string;
  dates: string;
  days: number;
  visited: number;
  planned: number;
  photos: number;
  /** total spent in euros, null when nothing was entered, or when one expense has no known rate (a partial total is never shown) */
  eur: number | null;
  cities: string[];
  center: [number, number];
  /** from home (or the outbound flight's airport) to the destination, as read from the trip */
  route: Route;
};

// ---------- the route: where from, where to (shared by the home's card and the story image) ----------
export type RouteEnd = { /** IATA code when a flight gives one (never guessed) */ code: string; city: string };
export type Route = { from: RouteEnd | null; to: RouteEnd };

const iata = (s?: string | null) => {
  const v = (s || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(v) ? v : "";
};

/** Home as a city name: the traveller's own answer in the onboarding ("Paris", "CDG"), else this phone's timezone
 *  (on site, the last one seen before the phone switched to the trip's time); "" when none is known */
export function homeCityOf(trip: Trip): string {
  const own = String((getState().profile as { home?: unknown }).home || "").trim();
  if (own) return own;
  const here = homeZone();
  let zone = here.zone !== trip.timezone ? here.zone : "";
  if (!zone) {
    try {
      const saved = localStorage.getItem("orbes.homeZone");
      if (saved && saved !== trip.timezone) zone = saved;
    } catch {
      /* ignore */
    }
  }
  return zone ? (zone.split("/").pop() || zone).replace(/_/g, " ") : "";
}

/** The trip's route: the outbound flight's airports when there is one (else the way back's, reversed), else home
 *  to the destination by name. The origin is null when nothing tells where the traveller comes from. */
export function routeOf(trip: Trip, home = homeCityOf(trip)): Route {
  const arr = trip.flights?.find((f) => f.kind === "arrival");
  const dep = trip.flights?.find((f) => f.kind === "departure");
  const homeCode = iata(home);
  const fromCode = iata(arr?.from) || iata(dep?.to) || homeCode;
  const fromCity = (arr ? arr.fromCity : dep?.toCity) || (homeCode ? "" : home) || "";
  const to: RouteEnd = { code: iata(arr?.to) || iata(dep?.from), city: trip.title };
  return { from: fromCode || fromCity ? { code: fromCode, city: fromCity } : null, to };
}

/** "43,77° N · 11,26° E" (two decimals, the reader's own decimal mark); "" for a point that is not one */
export function coordText(center: [number, number] | undefined): string {
  const [lng, lat] = center || [NaN, NaN];
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || (lng === 0 && lat === 0)) return "";
  const nf = new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const la = t(lat >= 0 ? "{v}° N" : "{v}° S", { v: nf.format(Math.abs(lat)) });
  const lo = t(lng >= 0 ? "{v}° E" : "{v}° O", { v: nf.format(Math.abs(lng)) });
  return `${la} · ${lo}`;
}

/** How long after its end a trip still shows its recap on the home */
export const RECAP_DAYS = 60;
export const recapDue = (trip: Trip, now = Date.now()) => now > tripEndMs(trip) && now - tripEndMs(trip) < RECAP_DAYS * 864e5;

type Raw = { places?: Record<string, Record<string, unknown>>; photos?: unknown[] } | null;
function rawOf(trip: Trip): Raw {
  try {
    const s = getState();
    return trip.id === s.tripId ? (s.data as unknown as Raw) : JSON.parse(localStorage.getItem("orbes.v2." + trip.id) || "null");
  } catch {
    return null;
  }
}

/** Units of `code` for 1 euro as last known on this phone (the expenses screen's cache), null when never known */
function rateOf(code: string): number | null {
  try {
    const r = Number(JSON.parse(localStorage.getItem("orbes.rate." + code) || "null")?.rate);
    if (r > 0) return r;
  } catch {
    /* ignore */
  }
  const fallback = code === "CNY" ? Number(getState().settings.eurRate) : 0;
  return fallback > 0 ? fallback : null;
}

export function recapOf(trip: Trip): Recap {
  const raw = rawOf(trip);
  const states = raw?.places || {};
  const list = countable(trip);
  let eur = 0;
  let known = false;
  let missing = false;
  const rates: Record<string, number | null> = { EUR: 1 };
  for (const e of expensesOf(states)) {
    // the value in euros saved with the expense, else today's rate known on this phone (as the expenses screen does)
    let v: number | null = e.currency === "EUR" ? e.amount : e.eur ?? null;
    if (v == null) {
      if (!(e.currency in rates)) rates[e.currency] = rateOf(e.currency);
      v = toEur(e, rates);
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      eur += v;
      known = true;
    } else missing = true;
  }
  const day = (iso: string) => Date.parse(iso + "T00:00:00Z") / 864e5;
  const draft = getState().trips[trip.id]?.draft as { cities?: { name?: string }[] } | undefined;
  const cities = [...new Set((draft?.cities || []).map((c) => (c?.name || "").trim()).filter(Boolean))];
  return {
    tripId: trip.id,
    title: trip.title,
    dates: dateLabel(trip.start, trip.end),
    days: Math.max(1, Math.round(day(trip.end) - day(trip.start)) + 1),
    visited: list.filter((p) => (states[p.id] as { visited?: boolean } | undefined)?.visited).length,
    planned: list.length,
    photos: Array.isArray(raw?.photos) ? raw!.photos!.length : 0,
    eur: known && !missing ? Math.round(eur) : null,
    cities: cities.length ? cities : [trip.title],
    center: trip.center,
    route: routeOf(trip),
  };
}

/** The figures of a recap, two by row on the card and on the image. Places: "visited/planned" once a visit was
 *  ticked, else only the planned count (most travellers never tick, and "0/14 visited" would be untrue). */
export function recapStats(r: Recap): [string, string][] {
  const stats: [string, string][] = [[String(r.days), r.days > 1 ? t("Jours") : t("Jour")]];
  if (r.visited > 0) stats.push([r.planned ? `${r.visited}/${r.planned}` : String(r.visited), t("Lieux visités")]);
  else if (r.planned > 0) stats.push([String(r.planned), r.planned > 1 ? t("Lieux") : t("Lieu")]);
  if (r.photos > 0) stats.push([String(r.photos), r.photos > 1 ? t("Photos") : t("Photo")]);
  if (r.eur != null && r.eur > 0) stats.push([eurText(r.eur), t("Dépenses")]);
  return stats;
}

export const eurText = (n: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

// ---------- the story image ----------
const W = 1080;
const H = 1920;
const INK = "#f6f2ea";
const SOFT = "#a7a29a";
const MUTE = "#6f6b65";
const READ = '"Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif';
const DISPLAY = `"Gravesend Sans", ${READ}`;
const APP = "theorbes.com/maps";

/** The plane of the route (the concierge's line icon, turned to fly right), on a 24 × 24 grid */
export const PLANE_PATH = "M21 15.5v-1.8l-7.5-4.7V4.4a1.5 1.5 0 0 0-3 0V9L3 13.7v1.8l7.5-2.3v4.6l-2 1.5V21l3.5-1 3.5 1v-1.7l-2-1.5v-4.6z";

/** Splits a text into at most `max` lines that fit `width` (the last one ends with "…" if cut) */
function wrap(c: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (c.measureText(next).width <= width || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  let last = kept[max - 1] + " " + lines.slice(max).join(" ");
  while (last.length > 1 && c.measureText(last + "…").width > width) last = last.slice(0, -1);
  kept[max - 1] = last.trimEnd() + "…";
  return kept;
}

const spacing = (c: CanvasRenderingContext2D, px: number) => {
  if ("letterSpacing" in c) (c as unknown as { letterSpacing: string }).letterSpacing = `${px}px`;
};
/** A label in fine tracked capitals (the card's small type) */
function caps(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, track: number, maxW?: number) {
  c.fillStyle = color;
  c.font = `500 ${size}px ${READ}`;
  spacing(c, track);
  let s = text.toLocaleUpperCase(locale());
  if (maxW) s = fit(c, s, maxW);
  c.fillText(s, x, y);
  spacing(c, 0);
}
/** `text` cut with "…" until it fits `width` in the current font */
function fit(c: CanvasRenderingContext2D, text: string, width: number): string {
  if (c.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && c.measureText(cut + "…").width > width) cut = cut.slice(0, -1);
  return cut.trimEnd() + "…";
}
const hair = (c: CanvasRenderingContext2D, x1: number, y: number, x2: number, color = "rgba(246,242,234,0.14)") => {
  c.strokeStyle = color;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x1, y);
  c.lineTo(x2, y);
  c.stroke();
};

/** The route as on the home's card: origin and destination (IATA codes when a flight gives them, else the cities),
 *  one line between them and the plane arrived at the destination */
function drawRoute(c: CanvasRenderingContext2D, route: Route, L: number, inner: number, base: number) {
  const up = (s: string) => s.toLocaleUpperCase(locale());
  const a = route.from ? up(route.from.code || route.from.city) : "";
  const b = up(route.to.code || route.to.city);
  const coded = !!route.to.code && (!route.from || !!route.from.code);
  const gap = 40;
  const minLine = 180;
  let size = coded ? 128 : 92;
  const widths = () => {
    c.font = `500 ${size}px ${DISPLAY}`;
    spacing(c, Math.round(size * 0.04));
    return [a ? c.measureText(a).width : 0, c.measureText(b).width];
  };
  let [wa, wb] = widths();
  while (size > 44 && wa + wb + minLine + gap * 2 > inner) {
    size -= 4;
    [wa, wb] = widths();
  }
  // still too long (two long names): each keeps half the room
  const half = (inner - minLine - gap * 2) / 2;
  const over = wa + wb + minLine + gap * 2 > inner;
  const ta = a && over && wa > half ? fit(c, a, half) : a;
  const tb = over && wb > half ? fit(c, b, half) : b;
  [wa, wb] = [ta ? c.measureText(ta).width : 0, c.measureText(tb).width];
  c.fillStyle = INK;
  c.textAlign = "left";
  if (ta) c.fillText(ta, L, base);
  c.textAlign = "right";
  c.fillText(tb, L + inner, base);
  spacing(c, 0);
  c.textAlign = "left";
  // the line, at the middle of the capitals
  const ly = base - size * 0.36;
  const x1 = ta ? L + wa + gap : L + 8;
  const x2 = L + inner - wb - gap;
  c.strokeStyle = "rgba(246,242,234,0.62)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x1 + 10, ly);
  c.lineTo(x2 - 64, ly);
  c.stroke();
  // origin: a ring; arrival: the plane, then the destination's point
  c.beginPath();
  c.arc(x1 + 4, ly, 6, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = INK;
  c.beginPath();
  c.arc(x2 - 4, ly, 6, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.translate(x2 - 38, ly);
  c.rotate(Math.PI / 2);
  c.scale(1.6, 1.6);
  c.translate(-12, -12);
  c.fill(new Path2D(PLANE_PATH));
  c.restore();
  // the cities under the codes
  const under = (end: RouteEnd | null) => (end && end.code && end.city && end.city.toUpperCase() !== end.code ? end.city : "");
  const ya = base + 66;
  const ua = under(route.from);
  if (ua) caps(c, ua, L, ya, 26, MUTE, 4, inner / 2 - 20);
  const ub = under(route.to);
  if (ub) {
    c.textAlign = "right";
    caps(c, ub, L + inner, ya, 26, MUTE, 4, inner / 2 - 20);
    c.textAlign = "left";
  }
}

/** Draws the story image of a recap: the route, the destination very large, the dates and its point on the map,
 *  then the figures on a grid of two, all set on one left edge (`_from` is kept for the callers, no longer drawn) */
export async function recapImage(r: Recap, _from?: [number, number] | null): Promise<Blob> {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d");
  if (!c) throw new Error("canvas");
  const route: Route = r.route || { from: null, to: { code: "", city: r.title } };
  try {
    const sample = [r.title, route.from?.code, route.from?.city, route.to.code].filter(Boolean).join(" ").toUpperCase();
    await Promise.race([document.fonts.load(`500 120px "Gravesend Sans"`, sample), new Promise((ok) => setTimeout(ok, 1500))]);
  } catch {
    /* the reading face is used */
  }
  const L = 96;
  const inner = W - L * 2;

  // ground: near black, a breath lighter at the top
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0e0e0f");
  bg.addColorStop(0.4, "#09090a");
  bg.addColorStop(1, "#070707");
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);

  c.textBaseline = "alphabetic";
  c.textAlign = "left";
  // top line: the name, the kind of page
  c.fillStyle = INK;
  c.font = `500 34px ${DISPLAY}`;
  spacing(c, 6);
  c.fillText("ORBES TRIPS", L, 168);
  spacing(c, 0);
  c.textAlign = "right";
  caps(c, t("Récapitulatif"), W - L, 166, 24, MUTE, 5);
  c.textAlign = "left";
  hair(c, L, 214, W - L);

  drawRoute(c, route, L, inner, 520);
  hair(c, L, 680, W - L);

  // the destination, as large as it fits on two lines
  let size = 148;
  let lines: string[] = [];
  const title = r.title.toLocaleUpperCase(locale());
  for (; size >= 84; size -= 8) {
    c.font = `500 ${size}px ${DISPLAY}`;
    lines = wrap(c, title, inner, 2);
    if (lines.every((l) => c.measureText(l).width <= inner) && !lines[lines.length - 1].endsWith("…")) break;
  }
  if (size < 84) size = 84;
  // a word longer than the width (a long name without spaces): smaller, then cut by letters with "…"
  while (size > 56 && lines.some((l) => c.measureText(l).width > inner)) {
    size -= 4;
    c.font = `500 ${size}px ${DISPLAY}`;
    lines = wrap(c, title, inner, 2);
  }
  lines = lines.map((l) => fit(c, l, inner));
  c.fillStyle = INK;
  let y = 780 + size * 0.78;
  c.save();
  c.beginPath();
  c.rect(L, 0, inner, H);
  c.clip();
  lines.forEach((l, i) => c.fillText(l, L, y + i * size * 0.94));
  c.restore();
  y += (lines.length - 1) * size * 0.94 + 72;
  c.fillStyle = SOFT;
  c.font = `400 40px ${READ}`;
  c.fillText(r.dates, L, y);
  const coords = coordText(r.center);
  if (coords) {
    y += 54;
    caps(c, coords, L, y, 26, MUTE, 4);
  }

  // figures, two by row, each under its hairline
  const stats = recapStats(r);
  const top = y + 90;
  const colW = inner / 2;
  const rowH = 180;
  stats.forEach(([v, l], i) => {
    const x = L + (i % 2) * colW;
    const yy = top + Math.floor(i / 2) * rowH;
    hair(c, x, yy, i % 2 ? L + inner : x + colW - 32);
    c.fillStyle = INK;
    let fs = 84;
    c.font = `500 ${fs}px ${DISPLAY}`;
    while (fs > 48 && c.measureText(v).width > colW - 40) c.font = `500 ${(fs -= 4)}px ${DISPLAY}`;
    c.fillText(v, x, yy + 108);
    caps(c, l, x, yy + 152, 24, MUTE, 4, colW - 40);
  });
  const cy = top + Math.ceil(stats.length / 2) * rowH + 36;
  if (r.cities.length > 1 || r.cities[0] !== r.title) {
    c.fillStyle = SOFT;
    c.font = `400 34px ${READ}`;
    const room = Math.min(2, Math.floor((1690 - cy) / 46) + 1);
    if (room > 0) wrap(c, r.cities.join(" · "), inner, room).forEach((l, i) => c.fillText(l, L, cy + i * 46));
  }

  // signature
  hair(c, L, 1730, W - L);
  c.textAlign = "left";
  c.fillStyle = SOFT;
  c.font = `400 30px ${READ}`;
  c.fillText(t("Préparé avec ORBES Trips"), L, 1800);
  c.textAlign = "right";
  c.fillStyle = INK;
  c.font = `500 30px ${READ}`;
  c.fillText(APP, W - L, 1800);

  return new Promise((ok, ko) => cv.toBlob((b) => (b ? ok(b) : ko(new Error("png"))), "image/png"));
}

export const recapFileName = (r: Recap) =>
  `orbes-trips-${r.title.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "voyage"}.png`;

/** Shares the image (the phone's share sheet) when possible, else saves it */
export async function shareRecapBlob(r: Recap, blob: Blob): Promise<"shared" | "saved" | "cancelled"> {
  const name = recapFileName(r);
  const file = new File([blob], name, { type: "image/png" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: r.title });
      return "shared";
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return "cancelled";
    // not allowed (too long after the touch) or not supported: saved instead
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "saved";
}
