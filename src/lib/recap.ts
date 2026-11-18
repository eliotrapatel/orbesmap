// After a trip: what it was, in figures (days, places visited, photos, money spent, cities), and the same as a
// story image (1080 × 1920) to share or save. Everything is read from this phone's copy of the trip.
import type { Trip } from "../data/types";
import { expensesOf, toEur } from "./business";
import { countable } from "./plan";
import { getState } from "./store";
import { tripEndMs } from "./time";
import { dateLabel } from "./newTrip";
import { locale, t } from "./i18n";
import { currencyAffix, lineShown, seriesByDay, shortDay, type Series } from "./peakData";
import { paintPeakStill } from "../components/v3/ui/PeakCard";

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
  /** euros spent per calendar day of the trip (the signature card's line), null when the total is not shown */
  spend: Series | null;
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

/** The traveller's own answer for home in the onboarding ("Lyon", "CDG"); "" when none was given */
export function homeAnswerOf(): string {
  return String((getState().profile as { home?: unknown }).home || "").trim();
}

/** The trip's route: the outbound flight's airports when there is one (else the way back's, reversed), else the
 *  traveller's home answer to the destination by name. A flight's origin is never paired with the home answer, and
 *  the origin is null when nothing tells where the traveller comes from. */
export function routeOf(trip: Trip, home = homeAnswerOf()): Route {
  const arr = trip.flights?.find((f) => f.kind === "arrival");
  const dep = trip.flights?.find((f) => f.kind === "departure");
  // the origin: where the flight out leaves from (or where the way back lands)
  const rawFrom = ((arr ? arr.from : dep?.to) || "").trim();
  const fromCode = iata(arr?.from) || iata(dep?.to);
  const flightCity = ((arr ? arr.fromCity : dep?.toCity) || "").trim();
  let from: RouteEnd | null = null;
  if (fromCode || flightCity || rawFrom) from = { code: fromCode, city: flightCity || (fromCode ? "" : rawFrom) };
  else if (home) from = iata(home) ? { code: iata(home), city: "" } : { code: "", city: home };
  // the destination: the airport's own city under its code, else the trip's name
  const toArr = iata(arr?.to);
  const toCode = toArr || iata(dep?.from);
  const toCity = (toArr ? arr?.toCity : toCode ? dep?.fromCity : "") || "";
  const to: RouteEnd = { code: toCode, city: toCity.trim() || trip.title };
  return { from, to };
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
  const items: { date: string; value: number }[] = [];
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
      items.push({ date: e.date, value: v });
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
    // a partial total is never drawn, as it is never shown
    spend: known && !missing ? seriesByDay(items, trip.start, trip.end) : null,
    cities: cities.length ? cities : [trip.title],
    center: trip.center,
    route: routeOf(trip),
  };
}

/** The figures of a recap, two by row on the card and on the image. Places: "visited/planned" once a visit was
 *  ticked, else only the planned count (most travellers never tick, and "0/14 visited" would be untrue). */
export function recapStats(r: Recap, o: { eur?: boolean } = {}): [string, string][] {
  const stats: [string, string][] = [[String(r.days), r.days > 1 ? t("Jours") : t("Jour")]];
  if (r.visited > 0) stats.push([r.planned ? `${r.visited}/${r.planned}` : String(r.visited), t("Lieux visités")]);
  else if (r.planned > 0) stats.push([String(r.planned), r.planned > 1 ? t("Lieux") : t("Lieu")]);
  if (r.photos > 0) stats.push([String(r.photos), r.photos > 1 ? t("Photos") : t("Photo")]);
  // the euros are left out when the signature card already carries the total (never printed twice)
  if (o.eur !== false && r.eur != null && r.eur > 0) stats.push([eurText(r.eur), t("Dépenses")]);
  return stats;
}

export const eurText = (n: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

/** What the signature card shows on the recap (and on its story image) */
export type PeakSpec = {
  mode: "chart" | "number";
  data: number[];
  labels: string[];
  value: number;
  valuePrefix: string;
  valueSuffix: string;
  title: string;
  caption: string;
  updatedText: string;
};

/** The recap's signature card: euros spent per day when two days or more have expenses (the peak is the biggest
 *  day), else the places visited as a figure, else nothing */
export function recapPeak(r: Recap): PeakSpec | null {
  const updatedText = `${r.title} · ${r.dates}`;
  const loc = locale();
  if (r.eur != null && r.spend && lineShown(r.spend)) {
    const s = r.spend;
    const aff = currencyAffix(loc, "EUR");
    return {
      mode: "chart",
      data: s.values,
      labels: s.days.map((d) => shortDay(d, loc)),
      value: r.eur,
      valuePrefix: aff.prefix,
      valueSuffix: aff.suffix,
      title: t("Dépenses du voyage"),
      caption: t("Le plus gros jour : {day}, {amount}", { day: shortDay(s.days[s.peakIndex], loc), amount: eurText(s.values[s.peakIndex]) }),
      updatedText,
    };
  }
  if (r.visited > 0) {
    return {
      mode: "number",
      data: [],
      labels: [],
      value: r.visited,
      valuePrefix: "",
      valueSuffix: "",
      title: t("Lieux visités"),
      caption: r.planned ? t("{v} sur {n} lieux prévus", { v: r.visited, n: r.planned }) : "",
      updatedText,
    };
  }
  return null;
}

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
  const room = inner - minLine - gap * 2;
  const half = room / 2;
  const fits = (ls: string[], w: number) => ls.every((l) => c.measureText(l).width <= w + 0.5) && !ls.some((l) => l.endsWith("…"));
  /** the ends at the current size: one line each when they fit, else (names only) up to two lines each, the shorter
   *  end keeping its own width and the other taking the rest; null when they do not fit whole */
  const lay = (): [string[], string[]] | null => {
    c.font = `500 ${size}px ${DISPLAY}`;
    spacing(c, Math.round(size * 0.04));
    const na = a ? c.measureText(a).width : 0;
    const nb = c.measureText(b).width;
    if (na + nb <= room) return [a ? [a] : [], [b]];
    if (coded) return null;
    const wA = a ? (na <= half ? na : nb <= half ? room - nb : half) : 0;
    const la = a ? wrap(c, a, wA, 2) : [];
    const used = Math.max(0, ...la.map((l) => c.measureText(l).width));
    const lb = wrap(c, b, room - used, 2);
    return fits(la, wA) && fits(lb, room - used) ? [la, lb] : null;
  };
  let ends = lay();
  while (!ends && size > 40) {
    size -= 4;
    ends = lay();
  }
  // still too long at the smallest size: each end keeps half the room, cut with "…"
  const [la, lb] = ends || [a ? [fit(c, a, half)] : [], coded ? [fit(c, b, half)] : wrap(c, b, half, 2).map((l) => fit(c, l, half))];
  const widest = (ls: string[]) => Math.max(0, ...ls.map((l) => c.measureText(l).width));
  const [wa, wb] = [widest(la), widest(lb)];
  const lh = size * 1.12;
  c.fillStyle = INK;
  // each end's lines stand centred on the route's line
  const drawEnd = (ls: string[], x: number, align: CanvasTextAlign) => {
    c.textAlign = align;
    ls.forEach((l, i) => c.fillText(l, x, base + (i - (ls.length - 1) / 2) * lh));
  };
  drawEnd(la, L, "left");
  drawEnd(lb, L + inner, "right");
  spacing(c, 0);
  c.textAlign = "left";
  const ta = la.length > 0;
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
  if (size < 84) {
    size = 84;
    c.font = `500 ${size}px ${DISPLAY}`;
    lines = wrap(c, title, inner, 2);
  }
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

  // the signature card at rest (V09), when there is a line and room for it: the figures then stand in one row
  // under it, the euros inside the card; with no room (a long title), the image stays as it was
  if (drawPeakBlock(c, r, L, inner, y)) {
    paintSignature(c, L);
    return new Promise((ok, ko) => cv.toBlob((b) => (b ? ok(b) : ko(new Error("png"))), "image/png"));
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

  paintSignature(c, L);
  return new Promise((ok, ko) => cv.toBlob((b) => (b ? ok(b) : ko(new Error("png"))), "image/png"));
}

/** The image's last line: "Préparé avec ORBES Trips" and the address */
function paintSignature(c: CanvasRenderingContext2D, L: number) {
  hair(c, L, 1730, W - L);
  c.textAlign = "left";
  c.fillStyle = SOFT;
  c.font = `400 30px ${READ}`;
  c.fillText(t("Préparé avec ORBES Trips"), L, 1800);
  c.textAlign = "right";
  c.fillStyle = INK;
  c.font = `500 30px ${READ}`;
  c.fillText(APP, W - L, 1800);
}

/** The signature card on the story image (the Panorama shape, dark), its text drawn with fillText, then the other
 *  figures in one row and the cities line. Returns false, having drawn nothing, when there is no line to draw or
 *  not enough room (under 300 px of card height), or when the card cannot be painted. */
function drawPeakBlock(c: CanvasRenderingContext2D, r: Recap, L: number, inner: number, y: number): boolean {
  const peak = recapPeak(r);
  if (!peak || peak.mode !== "chart") return false;
  const showCities = r.cities.length > 1 || r.cities[0] !== r.title;
  const cardTop = Math.round(y + 70);
  const reserve = 40 + 150 + (showCities ? 82 : 0);
  const cardH = Math.min(500, 1690 - reserve - cardTop);
  if (cardH < 300) return false;
  const cw = Math.min(inner, Math.round((cardH * 16) / 9));
  const ch = Math.round((cw * 9) / 16);
  let still: ReturnType<typeof paintPeakStill>;
  try {
    still = paintPeakStill({ width: cw, aspect: "wide", tone: "dark", data: peak.data });
  } catch {
    return false;
  }
  c.drawImage(still.canvas, L - still.bleedX, cardTop - still.bleedY);

  // the card's text, at the wide card's geometry (960 units wide); the small type keeps a size that reads on a
  // story seen at phone width (about a third of the image's pixels), so its floors are higher than on screen
  const K = cw / 960;
  c.save();
  c.textAlign = "left";
  c.textBaseline = "top";
  spacing(c, 0);
  const status = Math.max(18.6 * K, 20);
  c.font = `300 ${status}px ${READ}`;
  c.fillStyle = "#99a3b6";
  c.fillText(fit(c, peak.updatedText, cw - 91.2 * K), L + 45.6 * K, cardTop + 43.6 * K);

  const bx = L + 64 * K;
  const bw = 300 * K;
  const ts = Math.max(22 * K, 24);
  c.font = `200 ${ts}px ${READ}`;
  const titleLines = wrap(c, peak.title, bw, 2).map((l) => fit(c, l, bw));
  let fs = 89.2 * K;
  const figure = eurText(peak.value);
  c.font = `500 ${fs}px ${READ}`;
  while (fs > 20 && c.measureText(figure).width > bw) c.font = `500 ${(fs -= 1)}px ${READ}`;
  const cs = Math.max(15 * K, 20);
  c.font = `300 ${cs}px ${READ}`;
  const capLines = peak.caption ? wrap(c, peak.caption, bw, 3) : [];
  const gap = Math.max(14 * K, 10);
  const tlh = ts * 1.2;
  const clh = cs * 1.25;
  const blockH = titleLines.length * tlh + gap + fs + (capLines.length ? gap + capLines.length * clh : 0);
  let by = cardTop + ch * 0.54 - blockH / 2;
  c.font = `200 ${ts}px ${READ}`;
  c.fillStyle = "#9298a5";
  titleLines.forEach((l, i) => c.fillText(l, bx, by + i * tlh));
  by += titleLines.length * tlh + gap;
  c.font = `500 ${fs}px ${READ}`;
  c.fillStyle = "#ffffff";
  c.fillText(figure, bx, by);
  by += fs + gap;
  c.font = `300 ${cs}px ${READ}`;
  c.fillStyle = "#9299a8";
  capLines.forEach((l, i) => c.fillText(l, bx, by + i * clh));
  c.restore();

  // the other figures, one row of up to three, each under its hairline
  const stats = recapStats(r, { eur: false }).slice(0, 3);
  const rowTop = cardTop + ch + 40;
  const cols = Math.max(1, stats.length);
  const colW = inner / cols;
  stats.forEach(([v, l], i) => {
    const x = L + i * colW;
    hair(c, x, rowTop, i === cols - 1 ? L + inner : x + colW - 32);
    c.fillStyle = INK;
    let size = 72;
    c.font = `500 ${size}px ${DISPLAY}`;
    while (size > 40 && c.measureText(v).width > colW - 40) c.font = `500 ${(size -= 4)}px ${DISPLAY}`;
    c.fillText(v, x, rowTop + 92);
    caps(c, l, x, rowTop + 130, 24, MUTE, 4, colW - 40);
  });
  if (showCities) {
    const cy = rowTop + 150 + 36;
    c.fillStyle = SOFT;
    c.font = `400 34px ${READ}`;
    const room = Math.min(2, Math.floor((1690 - cy) / 46) + 1);
    if (room > 0) wrap(c, r.cities.join(" · "), inner, room).forEach((l, i) => c.fillText(l, L, cy + i * 46));
  }
  return true;
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
