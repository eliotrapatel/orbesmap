// After a trip: what it was, in figures (days, places visited, photos, money spent, cities), and the same as a
// story image (1080 × 1920) to share or save. Everything is read from this phone's copy of the trip.
import type { Trip } from "../data/types";
import { expensesOf } from "./business";
import { countable } from "./plan";
import { getState } from "./store";
import { tripEndMs } from "./time";
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
  /** total spent in euros, null when nothing was entered (or no rate was known) */
  eur: number | null;
  cities: string[];
  center: [number, number];
};

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

export function recapOf(trip: Trip): Recap {
  const raw = rawOf(trip);
  const states = raw?.places || {};
  const list = countable(trip);
  let eur = 0;
  let known = false;
  for (const e of expensesOf(states)) {
    const v = e.currency === "EUR" ? e.amount : e.eur;
    if (typeof v === "number" && Number.isFinite(v)) {
      eur += v;
      known = true;
    }
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
    eur: known ? Math.round(eur) : null,
    cities: cities.length ? cities : [trip.title],
    center: trip.center,
  };
}

export const eurText = (n: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

// ---------- the story image ----------
const W = 1080;
const H = 1920;
const INK = "#f6f2ea";
const SOFT = "#a7a29a";
const MUTE = "#6f6b65";
const GOLD = "#d8c47e";
const READ = '"Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif';
const DISPLAY = `"Gravesend Sans", ${READ}`;
const APP = "theorbes.com/maps";

const rad = Math.PI / 180;
const toVec = ([lng, lat]: [number, number]) => [Math.cos(lat * rad) * Math.cos(lng * rad), Math.cos(lat * rad) * Math.sin(lng * rad), Math.sin(lat * rad)];
const toLL = (v: number[]): [number, number] => [Math.atan2(v[1], v[0]) / rad, Math.asin(Math.max(-1, Math.min(1, v[2]))) / rad];
function along(a: [number, number], b: [number, number], f: number): [number, number] {
  const A = toVec(a), B = toVec(b);
  const w = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  if (w < 1e-6) return a;
  const s = Math.sin(w), k1 = Math.sin((1 - f) * w) / s, k2 = Math.sin(f * w) / s;
  return toLL([k1 * A[0] + k2 * B[0], k1 * A[1] + k2 * B[1], k1 * A[2] + k2 * B[2]]);
}

/** The globe of the home's card, larger: meridians, parallels and the flight from home to the destination */
function drawGlobe(c: CanvasRenderingContext2D, cx: number, cy: number, R: number, from: [number, number] | null, to: [number, number]) {
  const mid = from ? along(from, to, 0.6) : to;
  const l0 = mid[0] + (from ? 0 : -18), p0 = Math.max(-60, mid[1] - (from ? 26 : 10));
  const sp0 = Math.sin(p0 * rad), cp0 = Math.cos(p0 * rad);
  const proj = ([lng, lat]: [number, number], lift = 1) => {
    const cp = Math.cos(lat * rad), sp = Math.sin(lat * rad), dl = (lng - l0) * rad;
    return { x: cx + R * lift * cp * Math.sin(dl), y: cy - R * lift * (cp0 * sp - sp0 * cp * Math.cos(dl)), vis: sp0 * sp + cp0 * cp * Math.cos(dl) };
  };
  const line = (pts: [number, number][], lift?: (i: number) => number, min = 0) => {
    let pen = false;
    c.beginPath();
    pts.forEach((p, i) => {
      const q = proj(p, lift ? lift(i) : 1);
      if (q.vis > min) {
        if (pen) c.lineTo(q.x, q.y);
        else c.moveTo(q.x, q.y);
        pen = true;
      } else pen = false;
    });
    c.stroke();
  };
  // halo and sphere
  const halo = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.2);
  halo.addColorStop(0, "rgba(216,196,126,0)");
  halo.addColorStop(0.4, "rgba(216,196,126,0.10)");
  halo.addColorStop(1, "rgba(216,196,126,0)");
  c.fillStyle = halo;
  c.beginPath();
  c.arc(cx, cy, R * 1.2, 0, Math.PI * 2);
  c.fill();
  const sphere = c.createRadialGradient(cx + R * 0.36, cy - R * 0.44, R * 0.05, cx, cy, R * 1.05);
  sphere.addColorStop(0, "#1d1c1a");
  sphere.addColorStop(0.55, "#0c0c0d");
  sphere.addColorStop(1, "#050505");
  c.fillStyle = sphere;
  c.beginPath();
  c.arc(cx, cy, R, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "rgba(246,242,234,0.16)";
  c.lineWidth = 2;
  c.stroke();
  c.strokeStyle = "rgba(246,242,234,0.09)";
  c.lineWidth = 1.5;
  for (let lng = -180; lng < 180; lng += 20) line(Array.from({ length: 61 }, (_, i) => [lng, -90 + i * 3] as [number, number]));
  for (let lat = -60; lat <= 60; lat += 20) line(Array.from({ length: 121 }, (_, i) => [-180 + i * 3, lat] as [number, number]));
  if (from) {
    const N = 64;
    const pts = Array.from({ length: N + 1 }, (_, i) => along(from, to, i / N));
    c.strokeStyle = GOLD;
    c.lineWidth = 4;
    c.lineCap = "round";
    line(pts, (i) => 1 + 0.16 * Math.sin((Math.PI * i) / N), -0.12);
    const s = proj(from);
    if (s.vis > 0) {
      c.fillStyle = "rgba(246,242,234,0.7)";
      c.beginPath();
      c.arc(s.x, s.y, 6, 0, Math.PI * 2);
      c.fill();
    }
  }
  const e = proj(to);
  if (e.vis > 0) {
    c.strokeStyle = "rgba(216,196,126,0.35)";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(e.x, e.y, 22, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = GOLD;
    c.beginPath();
    c.arc(e.x, e.y, 9, 0, Math.PI * 2);
    c.fill();
  }
}

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

/** Draws the story image of a recap */
export async function recapImage(r: Recap, from: [number, number] | null): Promise<Blob> {
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const c = cv.getContext("2d");
  if (!c) throw new Error("canvas");
  try {
    await Promise.race([document.fonts.load(`500 120px "Gravesend Sans"`, r.title.toUpperCase()), new Promise((ok) => setTimeout(ok, 1500))]);
  } catch {
    /* the reading face is used */
  }
  const L = 96;
  const inner = W - L * 2;

  // ground
  const bg = c.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0d0f14");
  bg.addColorStop(0.52, "#09090a");
  bg.addColorStop(1, "#0c0a08");
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  drawGlobe(c, 730, 580, 370, from, r.center);
  // the globe fades into the ground under it
  const fade = c.createLinearGradient(0, 660, 0, 960);
  fade.addColorStop(0, "rgba(9,9,10,0)");
  fade.addColorStop(1, "rgba(9,9,10,1)");
  c.fillStyle = fade;
  c.fillRect(0, 660, W, 300);

  c.textBaseline = "alphabetic";
  c.textAlign = "left";
  // top line
  c.fillStyle = INK;
  c.font = `500 34px ${DISPLAY}`;
  c.fillText("ORBES TRIPS", L, 168);
  c.fillStyle = MUTE;
  c.font = `500 26px ${READ}`;
  if ("letterSpacing" in c) (c as unknown as { letterSpacing: string }).letterSpacing = "5px";
  c.fillText(t("Récapitulatif").toLocaleUpperCase(locale()), L, 214);
  if ("letterSpacing" in c) (c as unknown as { letterSpacing: string }).letterSpacing = "0px";

  // title and dates
  let size = 132;
  let lines: string[] = [];
  const title = r.title.toLocaleUpperCase(locale());
  for (; size >= 84; size -= 8) {
    c.font = `500 ${size}px ${DISPLAY}`;
    lines = wrap(c, title, inner, 2);
    if (lines.every((l) => c.measureText(l).width <= inner) && !lines[lines.length - 1].endsWith("…")) break;
  }
  c.fillStyle = INK;
  let y = lines.length > 1 ? 1010 : 1090;
  lines.forEach((l, i) => c.fillText(l, L, y + i * size * 0.96));
  y += (lines.length - 1) * size * 0.96 + 66;
  c.fillStyle = SOFT;
  c.font = `400 40px ${READ}`;
  c.fillText(r.dates, L, y);

  // figures, two by row
  const stats: [string, string][] = [
    [String(r.days), r.days > 1 ? t("Jours") : t("Jour")],
    [r.planned ? `${r.visited}/${r.planned}` : String(r.visited), t("Lieux visités")],
  ];
  if (r.photos > 0) stats.push([String(r.photos), r.photos > 1 ? t("Photos") : t("Photo")]);
  if (r.eur != null && r.eur > 0) stats.push([eurText(r.eur), t("Dépenses")]);
  const top = y + 90;
  const colW = inner / 2;
  const rowH = 180;
  stats.forEach(([v, l], i) => {
    const x = L + (i % 2) * colW;
    const yy = top + Math.floor(i / 2) * rowH;
    c.strokeStyle = "rgba(246,242,234,0.12)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, yy);
    c.lineTo(x + colW - 32, yy);
    c.stroke();
    c.fillStyle = INK;
    c.font = `500 84px ${READ}`;
    let fs = 84;
    while (fs > 48 && c.measureText(v).width > colW - 40) c.font = `500 ${(fs -= 4)}px ${READ}`;
    c.fillText(v, x, yy + 104);
    c.fillStyle = MUTE;
    c.font = `500 26px ${READ}`;
    if ("letterSpacing" in c) (c as unknown as { letterSpacing: string }).letterSpacing = "4px";
    c.fillText(l.toLocaleUpperCase(locale()), x, yy + 150);
    if ("letterSpacing" in c) (c as unknown as { letterSpacing: string }).letterSpacing = "0px";
  });
  const cy = top + Math.ceil(stats.length / 2) * rowH + 36;
  if (r.cities.length > 1 || r.cities[0] !== r.title) {
    c.fillStyle = SOFT;
    c.font = `400 34px ${READ}`;
    const room = Math.min(2, Math.floor((1690 - cy) / 46) + 1);
    if (room > 0) wrap(c, r.cities.join(" · "), inner, room).forEach((l, i) => c.fillText(l, L, cy + i * 46));
  }

  // signature
  c.strokeStyle = "rgba(246,242,234,0.12)";
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(L, 1730);
  c.lineTo(W - L, 1730);
  c.stroke();
  c.textAlign = "left";
  c.fillStyle = SOFT;
  c.font = `400 30px ${READ}`;
  c.fillText(t("Préparé avec ORBES Trips"), L, 1800);
  c.textAlign = "right";
  c.fillStyle = GOLD;
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
