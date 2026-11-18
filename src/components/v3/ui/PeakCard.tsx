// Peak Chart by Louis Studios.
// 200 more hand-made React components at https://studios.lou15.com/?ref=21st-code
// ORBES Trips build (lot CARTE SIGNATURE, Nov 2026).
//
// The card used in three places only: the trip recap (and its story image), the Expenses total and the admin's
// figures. It holds no text of its own: every word comes from its caller, through the app's translations.
// Motion kept: the figure counts up and comes out of a blur, a ring opens once on the dot. No breath of light, no
// bright head on the line, no bounce: the dot and the arrow settle with weight. Nothing is computed at rest.

import * as React from "react";
import "../../../styles/peak.css";

/** The app's reading face (`--font` in styles.css). Digits never use the display face. */
export const PEAK_FONT = '"Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif';

/* Card geometry, in card units (the card is 540 units wide, 696 tall). */
const CW = 540;
const CH = 696;
const CR = 56;
const HN = CH / CW;
const RN = CR / CW;
const BX = 0.32 * CW;
const BY = 0.16 * CW;

/* The glow field, measured from the reference and fitted as painted layers: a blue fill, soft black
   shades that carve the dark middle, hazes, then three inner rims pushed up from the bottom edge. Shapes are in card widths (cx, cy, sx, sy, angle; rims: offset, spread, softness). */
const FIELD_FILL = "#1678ff";
const FIELD_SHADES = [
  { shape: [0.4748, 0.8152, 0.7509, 0.8801, 0.7026], color: "#000000", opacity: 1.0 },
  { shape: [0.3741, 0.2723, 0.7371, 0.3009, 0.1168], color: "#020000", opacity: 1.0 },
  { shape: [0.7846, 0.0251, 0.3833, 0.1301, -0.5566], color: "#2e85ff", opacity: 0.4756 },
  { shape: [0.6206, -0.2018, 0.1282, 0.5909, 0.2754], color: "#3584ff", opacity: 0.3146 },
  { shape: [0.6, 1.2391, 0.827, 0.2111, -1.6357], color: "#000d1e", opacity: 1.0 },
  { shape: [0.0964, 0.5388, 1000.0, 0.1285, 0.5421], color: "#000005", opacity: 0.2298 },
];
const FIELD_RIMS = [
  { shape: [0.1207, -0.0365, 0.0492], color: "#2667ff", opacity: 1.0 },
  { shape: [0.0667, -0.0166, 0.0176], color: "#467dff", opacity: 1.0 },
  { shape: [0.037, -0.0134, 0.0154], color: "#c2ffff", opacity: 0.8091 },
];
/* The porcelain table for the light tone (same shapes, pale ground, blue hazes, same rims). */
const LIGHT_FILL = "#eef2fb";
const LIGHT_SHADES = [
  { shape: FIELD_SHADES[0].shape, color: "#ffffff", opacity: 0.9 },
  { shape: FIELD_SHADES[1].shape, color: "#ffffff", opacity: 0.9 },
  { shape: FIELD_SHADES[2].shape, color: "#2f6bff", opacity: 0.18 },
  { shape: FIELD_SHADES[3].shape, color: "#2f6bff", opacity: 0.18 },
  { shape: FIELD_SHADES[4].shape, color: "#e3eaf9", opacity: 1.0 },
  { shape: FIELD_SHADES[5].shape, color: "#ffffff", opacity: 0.2298 },
];
const HALO = { cx: 0.4996, cy: 0.6438, sx: 0.2498, sy: 0.2433, opacity: 0.845, color: "#0e50ff" };
const GRAIN = 1.7;

/* Plot frame and marks. */
const PLOT_X0 = 20.29;
const PLOT_X1 = 503.69;
const PLOT_TOP = 158.49;
const PLOT_BOTTOM = 385.28;
const LINE_W = 7.1;
const LINE_COLOR = "#6496e2";
const LINE_FALLOFF = 108;
const LINE_POWER = 1.44;
const LINE_CENTER = 12;
const DOT_R = 13;
const DOT_DX = 8;
const DOT_DY = 2.6;
const GRID_DX = 40.64;
const GRID_DY = 40.07;
const GRID_Y0 = 468.7;
const GRID_COLOR = "#5a87e1";
const GRID_ALPHA = 0.23;

/* Timeline (seconds). */
const T_GRID = 0.9;
const T_DRAW0 = 0.25;
const T_DRAW = 2.1;
const T_NUM0 = 1.0;
const T_NUM = 1.7;
const T_ARROW = 2.65;
const T_REST = 3.3;
const T_MORPH = 0.75;

const DOT_TOP = "#2680ff";
const DOT_MID = "#75aafa";
const DOT_BOTTOM = "#d0e4fd";
const DOT_GLOW = "#287dff";
const PULSE_COLOR = "#78afff";

/* Geometry per aspect. The wide card (960 x 540 units) reads the fitted portrait shade table stretched to its
   height, keeps the rims at the portrait's thickness in units, and has its own plot frame. */
type Geom = {
  kind: "portrait" | "wide";
  cw: number; ch: number; cr: number; hn: number; rn: number; bx: number; by: number;
  x0: number; x1: number; top: number; bottom: number;
  grid: { cx: number; top: number; y0: number; sigma: number; fade0: number; fadeLen: number; nx: number };
  vs: number;
  rs: number;
  halo: { cx: number; cy: number; sx: number; sy: number };
  hover: [number, number, number, number];
};
const PORTRAIT: Geom = {
  kind: "portrait", cw: CW, ch: CH, cr: CR, hn: HN, rn: RN, bx: BX, by: BY,
  x0: PLOT_X0, x1: PLOT_X1, top: PLOT_TOP, bottom: PLOT_BOTTOM,
  grid: { cx: CW / 2, top: 250, y0: GRID_Y0, sigma: 92, fade0: 350, fadeLen: 230, nx: 6 },
  vs: 1, rs: 1, halo: { cx: HALO.cx, cy: HALO.cy, sx: HALO.sx, sy: HALO.sy }, hover: [0, 96, CW, 330],
};
const WCW = 960;
const WCH = 540;
const WIDE: Geom = {
  kind: "wide", cw: WCW, ch: WCH, cr: CR, hn: WCH / WCW, rn: CR / WCW, bx: BX, by: BY,
  x0: 380, x1: 920, top: 110, bottom: 360,
  grid: { cx: 650, top: 60, y0: 360, sigma: 170, fade0: 110, fadeLen: 260, nx: 9 },
  vs: HN / (WCH / WCW), rs: CW / WCW, halo: { cx: 0.5, cy: 0.3, sx: 0.3, sy: 0.15 }, hover: [330, 70, 630, 320],
};
/** The wide card's text block: from 64 units to the plot's left edge less 16 (300 units) */
const WIDE_BLOCK = WCW - 64 - (WCW - WIDE.x0 + 16);
const NUM_UNITS = 89.2;

export const PEAK_RATIO = { portrait: HN, wide: WCH / WCW };

type Tone = "dark" | "light";

export interface PeakChartProps {
  /** Series drawn as the line, oldest first. Changing it morphs the line. */
  data?: number[];
  /** Point labels for the readout, one per data point (for example dates). */
  labels?: string[];
  /** Headline number. It counts up from zero when the card is revealed and re-tweens when it changes. */
  value?: number;
  /** Text drawn right before the headline number ("€" in en-GB). */
  valuePrefix?: string;
  /** Text drawn right after the headline number (" €" in fr-FR). */
  valueSuffix?: string;
  /** Decimal places for the headline number. */
  decimals?: number;
  /** Small label above the headline number. */
  title?: string;
  /** Caption below the headline number. */
  caption?: string;
  /** Status text in the top-left corner. An empty string hides it. */
  updatedText?: string;
  /** The small trend arrow beside the number: green up, red down, or hidden. */
  trend?: "up" | "down" | "none";
  /** Options listed in the period menu. An empty list hides the pill. */
  periods?: string[];
  /** Selected period (controlled). Pair it with onPeriodChange. */
  period?: string;
  /** Initially selected period when uncontrolled. */
  defaultPeriod?: string;
  /** Called with the period picked from the menu. */
  onPeriodChange?: (period: string) => void;
  /** The menu's accessible name (callers pass t("Période")). */
  periodLabel?: string;
  /** Card width in pixels. Height follows the card ratio and everything scales with it. */
  width?: number;
  /** Formats the readout value. Defaults to the rounded value with its affixes. */
  formatValue?: (value: number) => string;
  /** Formats the headline digits. Overrides locale and decimals for them. */
  format?: (value: number) => string;
  /** Font stack for every label. */
  font?: string;
  className?: string;
  style?: React.CSSProperties;
  /** "chart": line, dot, grid. "number": field and figure only. */
  mode?: "chart" | "number";
  /** "wide": a 16:9 card, figure on the left, line on the right. */
  aspect?: "portrait" | "wide";
  /** "light": the porcelain card (pale ground, blue light, navy text). */
  tone?: Tone;
  /** Locale for the headline and readout numbers. */
  locale?: string;
}

/* ---------- maths ---------- */

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
};
const easeInOut = (x: number) => {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
/** Cubic ease-out: never passes 1, so what it moves lands with weight and does not overshoot */
const easeOut = (x: number) => 1 - Math.pow(1 - clamp01(x), 3);
function erf(x: number) {
  const s = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));
/** Signed distance to the card outline in card widths, negative inside. */
function sdf(u: number, v: number, rn = RN, hn = HN) {
  const qx = Math.abs(u - 0.5) - (0.5 - rn);
  const qy = Math.abs(v - hn / 2) - (hn / 2 - rn);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - rn;
}
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rgbOf(color: string): [number, number, number] {
  const c = color.trim();
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i.exec(c);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((d) => d + d).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
  return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
}
const rgba = (color: string, a: number) => `rgba(${rgbOf(color).join(",")},${a.toFixed(4)})`;

/* ---------- static layers ---------- */

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Paints the card glow at `px` pixels per card width (the resting field; there is no breath copy). */
function buildField(px: number, seed: number, G: Geom, tone: Tone) {
  const w = Math.round(px);
  const h = Math.round(px * G.hn);
  const rest = makeCanvas(w, h);
  const c1 = rest.getContext("2d");
  if (!c1) return rest;
  const i1 = c1.createImageData(w, h);
  const d1 = i1.data;
  const rand = rng(seed);
  const fill = rgbOf(tone === "light" ? LIGHT_FILL : FIELD_FILL);
  const shades = (tone === "light" ? LIGHT_SHADES : FIELD_SHADES).map(({ shape: [cx, cy, sx, sy, th], color, opacity }) => ({
    cx, cy, isx: 1 / Math.abs(sx), isy: 1 / Math.abs(sy), c: Math.cos(th), s: Math.sin(th), rgb: rgbOf(color), a: opacity,
  }));
  const rims = FIELD_RIMS.map(({ shape: [off, sp, sg], color, opacity }) => ({ off: off * G.rs, sp: sp * G.rs, sg: sg * G.rs, rgb: rgbOf(color), a: opacity }));
  const HNg = G.hn;
  for (let j = 0; j < h; j++) {
    const v = (j + 0.5) / w;
    const vt = v * G.vs;
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / w;
      let r = fill[0], g = fill[1], b = fill[2];
      for (const o of shades) {
        const du = u - o.cx, dv = vt - o.cy;
        const x = (o.c * du + o.s * dv) * o.isx;
        const y = (-o.s * du + o.c * dv) * o.isy;
        const m = o.a * Math.exp(-0.5 * (x * x + y * y));
        r += m * (o.rgb[0] - r); g += m * (o.rgb[1] - g); b += m * (o.rgb[2] - b);
      }
      for (const o of rims) {
        // inner shadow of the card pushed up by `off`: a blurred box, with extra light in the round corners
        const vs = v + o.off;
        const dx = Math.min(u, 1 - u), dy = Math.min(vs, HNg - vs);
        const ratio = Math.min(1, phi((-sdf(u, vs, G.rn, HNg) - o.sp) / o.sg) / Math.max(1e-9, phi((Math.min(dx, dy) - o.sp) / o.sg)));
        const k = 1 - phi((dx - o.sp) / o.sg) * phi((dy - o.sp) / o.sg) * ratio;
        const m = o.a * k;
        r += m * (o.rgb[0] - r); g += m * (o.rgb[1] - g); b += m * (o.rgb[2] - b);
      }
      const n = (rand() + rand() + rand() - 1.5) * 2 * GRAIN;
      const p = (j * w + i) * 4;
      d1[p] = r + n; d1[p + 1] = g + n; d1[p + 2] = b + n; d1[p + 3] = 255;
    }
  }
  c1.putImageData(i1, 0, 0);
  return rest;
}

/** Soft blue light that spills from behind the card (dark tone only). */
function buildHalo(px: number, G: Geom) {
  const s = 0.25;
  const w = Math.max(8, Math.round(((G.cw + 2 * G.bx) * px * s) / G.cw));
  const h = Math.max(8, Math.round(((G.ch + 2 * G.by) * px * s) / G.cw));
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const img = ctx.createImageData(w, h);
  const [hr, hg, hb] = rgbOf(HALO.color);
  const H = G.halo;
  // the light fades to nothing at the window's own edges, so its rectangle never shows (the wide card's light
  // is still about 6 % at the edge of its window)
  const edge = (p: number, n: number) => smooth(Math.min(p + 0.5, n - p - 0.5) / (n * 0.14));
  for (let j = 0; j < h; j++) {
    const v = (((j + 0.5) / h) * (G.ch + 2 * G.by) - G.by) / G.cw;
    const ey = edge(j, h);
    for (let i = 0; i < w; i++) {
      const u = (((i + 0.5) / w) * (G.cw + 2 * G.bx) - G.bx) / G.cw;
      const a = (u - H.cx) / H.sx, e = (v - H.cy) / H.sy;
      const k = Math.exp(-0.5 * (a * a + e * e)) * HALO.opacity * ey * edge(i, w);
      const p = (j * w + i) * 4;
      img.data[p] = hr; img.data[p + 1] = hg; img.data[p + 2] = hb; img.data[p + 3] = Math.min(255, k * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Faint grid that fades out upward and toward the sides. */
function buildGrid(px: number, G: Geom, tone: Tone) {
  const w = Math.round(px);
  const h = Math.round(px * G.hn);
  const c = makeCanvas(w, h);
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const s = px / G.cw;
  const gr = G.grid;
  ctx.scale(s, s);
  ctx.strokeStyle = tone === "light" ? "#2f6bff" : GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let k = -gr.nx; k <= gr.nx; k++) {
    const x = gr.cx + GRID_DX * k;
    ctx.moveTo(x, gr.top); ctx.lineTo(x, G.ch);
  }
  for (let k = -8; k <= 8; k++) {
    const y = gr.y0 + GRID_DY * k;
    if (y < gr.top || y > G.ch) continue;
    ctx.moveTo(0, y); ctx.lineTo(G.cw, y);
  }
  ctx.stroke();
  // alpha mask: plateau in the lower middle, smooth fade up and out
  const alpha = tone === "light" ? 0.16 : GRID_ALPHA;
  const mw = 64, mh = Math.round(64 * G.hn);
  const m = makeCanvas(mw, mh);
  const mc = m.getContext("2d");
  if (!mc) return c;
  const img = mc.createImageData(mw, mh);
  for (let j = 0; j < mh; j++) {
    const y = ((j + 0.5) / mh) * G.ch;
    const my = smooth((y - gr.fade0) / gr.fadeLen);
    for (let i = 0; i < mw; i++) {
      const x = ((i + 0.5) / mw) * G.cw;
      const mx = Math.exp(-0.5 * Math.pow((x - gr.cx) / gr.sigma, 2));
      img.data[(j * mw + i) * 4 + 3] = Math.round(255 * alpha * mx * my);
    }
  }
  mc.putImageData(img, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(m, 0, 0, w, h);
  return c;
}

/* One cache for the whole app: cards of the same size, aspect and tone share one field. Each map keeps its
   8 most recent entries (the oldest is dropped on insert). */
const CACHE_MAX = 8;
const FIELD_CACHE = new Map<string, HTMLCanvasElement>();
const GRID_CACHE = new Map<string, HTMLCanvasElement>();
const HALO_CACHE = new Map<string, HTMLCanvasElement>();
function cached(map: Map<string, HTMLCanvasElement>, key: string, make: () => HTMLCanvasElement) {
  let v = map.get(key);
  if (v) {
    map.delete(key);
    map.set(key, v);
    return v;
  }
  v = make();
  map.set(key, v);
  while (map.size > CACHE_MAX) map.delete(map.keys().next().value as string);
  return v;
}
const fieldFor = (px: number, G: Geom, tone: Tone) => {
  const w = Math.round(px);
  return cached(FIELD_CACHE, `${G.kind}|${tone}|${w}`, () => buildField(w, 11, G, tone));
};
const gridFor = (px: number, G: Geom, tone: Tone) => cached(GRID_CACHE, `${G.kind}|${tone}|${Math.round(px)}`, () => buildGrid(px, G, tone));
const haloFor = (px: number, G: Geom) => cached(HALO_CACHE, `${G.kind}|dark|${Math.round(px)}`, () => buildHalo(px, G));
/** For checks in the browser: how many layers each cache holds */
export const peakCacheSizes = () => ({ field: FIELD_CACHE.size, grid: GRID_CACHE.size, halo: HALO_CACHE.size });

/* ---------- curve ---------- */

type Curve = { ys: Float32Array; peakX: number; lo: number; hi: number; n: number };

/** Monotone cubic (Steffen) through evenly spaced points, sampled once per card unit. It never
    overshoots, so the highest data point is the top of the curve and the dot sits on it. */
function buildCurve(data: number[], G: Geom): Curve {
  const clean = data.map((v) => (Number.isFinite(v) ? v : 0));
  const vals = clean.length >= 2 ? clean : clean.length === 1 ? [clean[0], clean[0]] : [0, 0];
  const n = vals.length;
  let lo = Infinity, hi = -Infinity, pk = 0;
  for (let i = 0; i < n; i++) {
    if (vals[i] < lo) lo = vals[i];
    if (vals[i] > hi) { hi = vals[i]; pk = i; }
  }
  const span = hi - lo || 1;
  const yv = vals.map((v) => (hi === lo ? (G.top + G.bottom) / 2 : G.top + (1 - (v - lo) / span) * (G.bottom - G.top)));
  const h = (G.x1 - G.x0) / (n - 1);
  const sl: number[] = [];
  for (let i = 0; i < n - 1; i++) sl.push((yv[i + 1] - yv[i]) / h);
  const m: number[] = [sl[0]];
  for (let i = 1; i < n - 1; i++) {
    const a = sl[i - 1], b = sl[i];
    m.push((Math.sign(a) + Math.sign(b)) * Math.min(Math.abs(a), Math.abs(b), 0.25 * Math.abs(a + b)));
  }
  m.push(sl[n - 2]);
  const ys = new Float32Array(G.cw + 1);
  for (let x = 0; x <= G.cw; x++) {
    let y: number;
    if (x <= G.x0) y = yv[0] + (x - G.x0) * m[0];
    else if (x >= G.x1) y = yv[n - 1] + (x - G.x1) * m[n - 1];
    else {
      const t = (x - G.x0) / h;
      const i = Math.min(n - 2, Math.floor(t));
      const f = t - i;
      const f2 = f * f, f3 = f2 * f;
      y = (2 * f3 - 3 * f2 + 1) * yv[i] + (f3 - 2 * f2 + f) * h * m[i] + (-2 * f3 + 3 * f2) * yv[i + 1] + (f3 - f2) * h * m[i + 1];
    }
    ys[x] = y;
  }
  return { ys, peakX: G.x0 + pk * h, lo, hi, n };
}
function curveY(ys: Float32Array, x: number) {
  const cw = ys.length - 1;
  const xc = Math.max(0, Math.min(cw, x));
  const i = Math.min(cw - 1, Math.floor(xc));
  const f = xc - i;
  return ys[i] * (1 - f) + ys[i + 1] * f;
}
/** How far right of the peak the dot rests: the original 8 units, less on a dense series (30 days) so the dot
 *  stays on the top of a narrow spike instead of sliding down its side */
const dotDxOf = (c: Curve, G: Geom) => Math.min(DOT_DX, ((G.x1 - G.x0) / Math.max(1, c.n - 1)) * 0.14);
const lineAlpha = (d: number) => Math.exp(-Math.pow(Math.abs(d) / LINE_FALLOFF, LINE_POWER));

/* ---------- timeline ---------- */

type Frame = { grid: number; draw: number; dotS: number; dotA: number; num: number; numA: number; numY: number; arrow: number; arrowA: number };

function inverseEase(target: number) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (easeInOut(m) < target) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/** The reveal, played once: grid, line drawn left to right, the dot riding it and settling on the peak (0.4 s,
 *  no overshoot), the figure counting up out of a blur, the arrow settling (0.45 s, no overshoot). */
function frameAt(t: number): Frame {
  return {
    grid: smooth(t / T_GRID),
    draw: easeInOut((t - T_DRAW0) / T_DRAW),
    dotS: easeOut((t - T_DRAW0) / 0.4),
    dotA: smooth((t - T_DRAW0) / 0.2),
    num: easeOut((t - T_NUM0) / T_NUM),
    numA: smooth((t - T_NUM0) / 0.45),
    numY: 1 - easeOut((t - T_NUM0) / 0.7),
    arrow: easeOut((t - T_ARROW) / 0.45),
    arrowA: smooth((t - T_ARROW) / 0.18),
  };
}
const REST_FRAME = (): Frame => frameAt(T_REST + 10);
const tLand = (frac: number) => T_DRAW0 + T_DRAW * inverseEase(frac);

/* ---------- one painter for the live card and the still image ---------- */

type Layers = { G: Geom; tone: Tone; field: HTMLCanvasElement; grid: HTMLCanvasElement | null; halo: HTMLCanvasElement | null; chart: boolean };
type Scene = { ys: Float32Array; peakX: number; dotDx: number; F: Frame; hoverX: number; hoverMix: number; pulseK: number };

function roundRect(ctx: CanvasRenderingContext2D, G: Geom) {
  const { cw, ch, cr } = G;
  ctx.beginPath();
  ctx.moveTo(cr, 0);
  ctx.arcTo(cw, 0, cw, ch, cr);
  ctx.arcTo(cw, ch, 0, ch, cr);
  ctx.arcTo(0, ch, 0, 0, cr);
  ctx.arcTo(0, 0, cw, 0, cr);
  ctx.closePath();
}

/** Paints the card in card units (the caller sets the transform so 0,0 is the card's top-left corner). Returns
 *  where the dot stands, or null when there is none. */
function paintCard(ctx: CanvasRenderingContext2D, P: Layers, S: Scene): { x: number; y: number } | null {
  const { G, tone } = P;
  const { F, ys } = S;
  const CWg = G.cw, CHg = G.ch;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (P.halo) ctx.drawImage(P.halo, -G.bx, -G.by, CWg + 2 * G.bx, CHg + 2 * G.by);
  ctx.save();
  roundRect(ctx, G);
  ctx.clip();
  ctx.drawImage(P.field, 0, 0, CWg, CHg);
  if (P.grid && F.grid > 0.001) {
    ctx.globalAlpha = F.grid;
    ctx.drawImage(P.grid, 0, 0, CWg, CHg);
  }
  ctx.globalAlpha = 1;
  let dot: { x: number; y: number } | null = null;
  if (P.chart) {
    const lineColor = tone === "light" ? "#2f6bff" : LINE_COLOR;
    const x1 = F.draw * CWg;
    if (x1 > 0.5) {
      // the line keeps its light around the peak only (no bright head while drawing)
      const g = ctx.createLinearGradient(0, 0, CWg, 0);
      for (let i = 0; i <= 54; i++) {
        const x = (i / 54) * CWg;
        g.addColorStop(i / 54, rgba(lineColor, lineAlpha(x - S.peakX - LINE_CENTER)));
      }
      ctx.strokeStyle = g;
      ctx.lineWidth = LINE_W;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(0, curveY(ys, 0));
      for (let x = 1; x < x1; x++) ctx.lineTo(x, ys[x]);
      ctx.lineTo(x1, curveY(ys, x1));
      ctx.stroke();
    }
    // dot: rides the drawing tip, rests on the peak, follows the pointer on hover
    if (F.dotA > 0.001) {
      const restX = S.peakX + S.dotDx;
      const baseX = Math.min(x1, restX);
      const dx = baseX + (S.hoverX - baseX) * S.hoverMix;
      const dy = curveY(ys, dx) + DOT_DY * (1 - S.hoverMix) * clamp01(baseX / restX);
      const pk = S.pulseK;
      ctx.save();
      ctx.globalAlpha = F.dotA;
      ctx.translate(dx, dy);
      ctx.scale(F.dotS, F.dotS);
      const boost = pk >= 0 ? Math.sin(Math.PI * Math.min(1, pk * 1.6)) : 0;
      const hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
      const ha = (a: number) => rgba(DOT_GLOW, Math.min(1, a * (1 + 0.9 * boost)));
      hg.addColorStop(0, ha(0.47)); hg.addColorStop(15 / 30, ha(0.47)); hg.addColorStop(17 / 30, ha(0.41));
      hg.addColorStop(19 / 30, ha(0.31)); hg.addColorStop(21 / 30, ha(0.17)); hg.addColorStop(23 / 30, ha(0.1));
      hg.addColorStop(25 / 30, ha(0.06)); hg.addColorStop(27 / 30, ha(0.03)); hg.addColorStop(1, ha(0));
      ctx.fillStyle = hg;
      ctx.beginPath(); ctx.arc(0, 0, 30, 0, Math.PI * 2); ctx.fill();
      if (pk >= 0) {
        // the ring opens once when the dot lands
        const r = DOT_R + 26 * easeOut(pk);
        ctx.strokeStyle = rgba(PULSE_COLOR, 0.55 * (1 - pk) * (1 - pk));
        ctx.lineWidth = 2.2 * (1 - pk) + 0.6;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
      }
      const bg = ctx.createLinearGradient(0, -DOT_R, 0, DOT_R);
      bg.addColorStop(0, DOT_TOP);
      bg.addColorStop(0.45, DOT_MID);
      bg.addColorStop(1, DOT_BOTTOM);
      ctx.fillStyle = bg;
      ctx.beginPath(); ctx.arc(0, 0, DOT_R, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      dot = { x: dx, y: dy };
    }
  }
  ctx.restore();
  return dot;
}

/** The card at rest as a still canvas (the story image): halo for the dark tone, field, grid, line, dot. No text.
 *  `bleedX` / `bleedY` say where the card starts inside the canvas. */
export function paintPeakStill(o: { width: number; aspect: "portrait" | "wide"; tone: Tone; data: number[] }): { canvas: HTMLCanvasElement; bleedX: number; bleedY: number } {
  const G = o.aspect === "wide" ? WIDE : PORTRAIT;
  const width = Math.max(8, Math.round(o.width));
  const u = width / G.cw;
  const dark = o.tone !== "light";
  const bleedX = dark ? Math.ceil(G.bx * u) : 0;
  const bleedY = dark ? Math.ceil(G.by * u) : 0;
  const canvas = makeCanvas(Math.ceil(G.cw * u + 2 * bleedX), Math.ceil(G.ch * u + 2 * bleedY));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const chart = o.data.length > 0;
  const C = buildCurve(o.data, G);
  ctx.setTransform(u, 0, 0, u, bleedX, bleedY);
  paintCard(
    ctx,
    { G, tone: o.tone, field: fieldFor(Math.min(width, Math.max(width, 700)), G, o.tone), grid: chart ? gridFor(width, G, o.tone) : null, halo: dark ? haloFor(width, G) : null, chart },
    { ys: C.ys, peakX: C.peakX, dotDx: dotDxOf(C, G), F: REST_FRAME(), hoverX: 0, hoverMix: 0, pulseK: -1 },
  );
  return { canvas, bleedX, bleedY };
}

/* ---------- the figure's size on the wide card ---------- */

const FIT_CACHE = new Map<string, number>();
/** How much the figure shrinks so its digits and affixes fit `block` card units (the wide card's 300-unit block,
 *  the portrait card's width less its margins); 1 = full size, never larger. Measured once per text with a
 *  canvas, never per frame. */
function figureFit(text: string, font: string, block: number): number {
  const key = `${font}|${block}|${text}`;
  const hit = FIT_CACHE.get(key);
  if (hit != null) return hit;
  let k = 1;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (ctx) {
      ctx.font = `500 100px ${font}`;
      const w = (ctx.measureText(text).width / 100) * NUM_UNITS;
      // a small margin for the wider digits the page may use (font-stretch)
      const room = block * 0.94;
      if (w > room) k = room / w;
    }
  } catch {
    /* no canvas: full size */
  }
  if (FIT_CACHE.size > 64) FIT_CACHE.clear();
  FIT_CACHE.set(key, k);
  return k;
}

/* ---------- component ---------- */

const INK = {
  dark: {
    updated: "#99a3b6", title: "#9298a5", num: "#fff", caption: "#9299a8", pillBg: "rgba(255,255,255,0.13)", pillText: "#b9cdf2",
    period: "#acc1e7", chevron: "#9fb7e0", menuBg: "rgba(20,34,64,0.55)", menuBorder: "1px solid rgba(255,255,255,0.12)",
    optOn: "#e6eeff", optOff: "#aebcd6", optBg: "rgba(255,255,255,0.09)", optHover: "rgba(255,255,255,0.06)", check: "#9fc0ff",
    readBg: "rgba(18,36,72,0.55)", readBorder: "1px solid rgba(160,195,255,0.18)", readVal: "#fff", readLab: "#9fb0cc",
  },
  light: {
    updated: "#5b6478", title: "#4a5163", num: "#0b1530", caption: "#5b6478", pillBg: "rgba(11,21,48,0.07)", pillText: "#3a4a6b",
    period: "#3a4a6b", chevron: "#3a4a6b", menuBg: "rgba(255,255,255,0.82)", menuBorder: "1px solid rgba(11,21,48,0.1)",
    optOn: "#0b1530", optOff: "#4a5163", optBg: "rgba(11,21,48,0.06)", optHover: "rgba(11,21,48,0.04)", check: "#2f6bff",
    readBg: "rgba(255,255,255,0.8)", readBorder: "1px solid rgba(47,107,255,0.22)", readVal: "#0b1530", readLab: "#5b6478",
  },
};
const SHADOW = "0 24px 60px -24px rgba(16,40,120,.35), 0 2px 6px rgba(0,0,0,.12), 0 0 0 1px rgba(10,20,60,.08)";

type Live = {
  curve: Curve;
  curveG: Geom;
  data: number[];
  from: Curve | null;
  morph: number;
  labels?: string[];
  value: number;
  shownValue: number;
  valueFrom: number;
  valueT: number;
  hover: number | null;
  hoverX: number;
  hoverMix: number;
  fmt?: (v: number) => string;
  hfmt?: (v: number) => string;
  prefix: string;
  suffix: string;
  decimals: number;
  locale: string;
  /** the reveal's clock, kept across a size or tone change so a resize never replays it */
  clock: number;
  started: boolean;
  kick: () => void;
};

const numText = (n: number, loc: string, dec: number, fmt?: (v: number) => string) =>
  fmt ? fmt(Number(n.toFixed(dec))) : n.toLocaleString(loc, { minimumFractionDigits: dec, maximumFractionDigits: dec });

export function PeakChart({
  data = [],
  labels,
  value = 0,
  valuePrefix = "",
  valueSuffix = "",
  decimals = 0,
  title = "",
  caption = "",
  updatedText = "",
  trend = "none",
  periods = [],
  period,
  defaultPeriod,
  onPeriodChange,
  periodLabel,
  width = 400,
  formatValue,
  format,
  font = PEAK_FONT,
  className,
  style,
  mode = "chart",
  aspect = "portrait",
  tone = "dark",
  locale = "fr-FR",
}: PeakChartProps) {
  const G = aspect === "wide" ? WIDE : PORTRAIT;
  const light = tone === "light";
  const chart = mode === "chart";
  const ink = INK[light ? "light" : "dark"];
  const [innerPeriod, setInnerPeriod] = React.useState(defaultPeriod ?? periods[0] ?? "");
  const current = period ?? innerPeriod;
  const [open, setOpen] = React.useState(false);
  const u = width / G.cw;

  const cardRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const digitsRef = React.useRef<HTMLSpanElement>(null);
  const numRef = React.useRef<HTMLDivElement>(null);
  const arrowRef = React.useRef<SVGSVGElement>(null);
  const readRef = React.useRef<HTMLDivElement>(null);
  const readValRef = React.useRef<HTMLSpanElement>(null);
  const readLabRef = React.useRef<HTMLSpanElement>(null);
  const pillRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // filled once (the host may re-render every second)
  const liveRef = React.useRef<Live | null>(null);
  if (!liveRef.current) {
    liveRef.current = {
      curve: buildCurve(data, G), curveG: G, data, from: null, morph: 1, labels, value, shownValue: 0, valueFrom: 0, valueT: 1,
      hover: null, hoverX: 0, hoverMix: 0, prefix: valuePrefix, suffix: valueSuffix, decimals, locale, clock: 0, started: false, kick: () => {},
    };
  }
  const L0 = liveRef.current;
  L0.labels = labels;
  L0.fmt = formatValue;
  L0.hfmt = format;
  L0.prefix = valuePrefix;
  L0.suffix = valueSuffix;
  L0.decimals = decimals;
  L0.locale = locale;

  // data changes morph the line
  const key = data.join(",");
  const firstData = React.useRef(true);
  React.useEffect(() => {
    if (firstData.current) { firstData.current = false; return; }
    const L = liveRef.current!;
    const next = buildCurve(data, L.curveG);
    const t = easeInOut(L.morph);
    if (L.from && L.morph < 1 && L.from.ys.length === L.curve.ys.length) {
      const ys = new Float32Array(L.curve.ys.length);
      for (let x = 0; x < ys.length; x++) ys[x] = L.from.ys[x] + (L.curve.ys[x] - L.from.ys[x]) * t;
      L.from = { ...L.curve, ys, peakX: L.from.peakX + (L.curve.peakX - L.from.peakX) * t };
    } else L.from = L.curve;
    L.curve = next;
    L.data = data;
    L.morph = 0;
    L.kick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // headline value changes re-tween the number
  React.useEffect(() => {
    const L = liveRef.current!;
    if (L.value === value) return;
    L.valueFrom = L.shownValue;
    L.value = value;
    L.valueT = 0;
    L.kick();
  }, [value]);

  // the render loop: set up again only on a real size, shape, tone or mode change
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (!canvas || !card) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const L = liveRef.current!;
    if (L.curveG !== G) {
      L.curve = buildCurve(L.data, G);
      L.curveG = G;
      L.from = null;
      L.morph = 1;
    }
    const CWg = G.cw;
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      L.started = true;
      if (L.clock < T_REST) L.clock = T_REST + 0.01;
    }
    const haloOn = !light;
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const BXg = haloOn ? G.bx : 0;
    const BYg = haloOn ? G.by : 0;
    // whole device pixels for the bleed and the size, so the canvas is never resampled
    const bxc = Math.ceil(BXg * u);
    const byc = Math.ceil(BYg * u);
    const bx = bxc * dpr;
    const by = byc * dpr;
    canvas.width = Math.ceil(G.cw * u * dpr + 2 * bx);
    canvas.height = Math.ceil(G.ch * u * dpr + 2 * by);
    canvas.style.left = `${-bxc}px`;
    canvas.style.top = `${-byc}px`;
    canvas.style.width = `${canvas.width / dpr}px`;
    canvas.style.height = `${canvas.height / dpr}px`;
    // the slot clips the light 20 px beside the card (no sideways scroll on a phone): it fades out within those
    // 20 px instead of ending on a hard edge
    const mask = haloOn && bxc > 20
      ? `linear-gradient(to right, transparent ${bxc - 20}px, #000 ${bxc}px, #000 calc(100% - ${bxc}px), transparent calc(100% - ${bxc - 20}px))`
      : "";
    canvas.style.setProperty("mask-image", mask);
    canvas.style.setProperty("-webkit-mask-image", mask);
    const fieldPx = Math.min(width * dpr, Math.max(width, 700));
    const layers: Layers = {
      G, tone, chart,
      field: fieldFor(fieldPx, G, tone),
      grid: chart ? gridFor(width * dpr, G, tone) : null,
      halo: haloOn ? haloFor(width, G) : null,
    };

    let visible = true;
    let raf = 0;
    let last = performance.now();

    const draw = (dt: number) => {
      const hovering = L.hover !== null;
      // clock: holds still while hovered once at rest
      if (L.started && !reduce && !(hovering && L.clock >= T_REST)) L.clock += dt;
      const t = L.clock;
      const F = L.started ? frameAt(t) : frameAt(0);

      // morph
      if (L.morph < 1) L.morph = reduce ? 1 : Math.min(1, L.morph + dt / T_MORPH);
      const mk = easeInOut(L.morph);
      const C = L.curve;
      const morphing = !!L.from && L.morph < 1 && L.from.ys.length === C.ys.length;
      let ys = C.ys;
      if (morphing && L.from) {
        ys = new Float32Array(C.ys.length);
        for (let x = 0; x < ys.length; x++) ys[x] = L.from.ys[x] + (C.ys[x] - L.from.ys[x]) * mk;
      }
      const peakX = morphing && L.from ? L.from.peakX + (C.peakX - L.from.peakX) * mk : C.peakX;
      const lo = morphing && L.from ? L.from.lo + (C.lo - L.from.lo) * mk : C.lo;
      const hi = morphing && L.from ? L.from.hi + (C.hi - L.from.hi) * mk : C.hi;

      // hover easing
      const dotDx = dotDxOf(C, G);
      const restX = peakX + dotDx;
      const landT = tLand(restX / CWg);
      const landed = t >= landT && F.dotA > 0.99;
      const wantHover = hovering && (landed || reduce);
      if (L.hover !== null) L.hoverX = reduce ? L.hover : L.hoverX + (L.hover - L.hoverX) * (1 - Math.exp(-dt * 14));
      L.hoverMix = reduce ? (wantHover ? 1 : 0) : L.hoverMix + ((wantHover ? 1 : 0) - L.hoverMix) * (1 - Math.exp(-dt * 10));

      // number: counts up, comes out of a blur
      if (L.valueT < 1) L.valueT = reduce ? 1 : Math.min(1, L.valueT + dt / 0.9);
      const target = L.valueFrom + (L.value - L.valueFrom) * easeOut(L.valueT);
      const shown = target * F.num;
      L.shownValue = shown;
      if (digitsRef.current) {
        const txt = numText(shown, L.locale, L.decimals, L.hfmt);
        if (digitsRef.current.textContent !== txt) digitsRef.current.textContent = txt;
      }
      if (numRef.current) {
        numRef.current.style.opacity = String(F.numA);
        numRef.current.style.transform = `translateY(${(F.numY * 5 * u).toFixed(2)}px)`;
        const blur = Math.abs(F.numY) * 6 * u;
        numRef.current.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "";
      }
      if (arrowRef.current) {
        arrowRef.current.style.opacity = String(F.arrowA);
        arrowRef.current.style.transform = `scale(${Math.max(0, F.arrow).toFixed(3)})`;
      }

      // canvas
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const s = dpr * u;
      ctx.setTransform(s, 0, 0, s, bx, by);
      const sinceLand = t - landT;
      const pulseK = sinceLand > 0 && sinceLand < 1.1 && !reduce ? sinceLand / 1.1 : -1;
      const dot = paintCard(ctx, layers, { ys, peakX, dotDx, F, hoverX: L.hoverX, hoverMix: L.hoverMix, pulseK });

      // readout
      const rd = readRef.current;
      if (rd && dot) {
        rd.style.opacity = L.hoverMix.toFixed(3);
        rd.style.transform = `translate(${(dot.x * u).toFixed(1)}px, ${((dot.y - 26) * u).toFixed(1)}px) translate(-50%, -100%) scale(${(0.92 + 0.08 * L.hoverMix).toFixed(3)})`;
        if (L.hoverMix > 0.01) {
          const v = lo + ((G.bottom - curveY(ys, dot.x)) / (G.bottom - G.top)) * (hi - lo);
          const txt = L.fmt ? L.fmt(v) : `${L.prefix}${Math.round(v).toLocaleString(L.locale)}${L.suffix}`;
          if (readValRef.current && readValRef.current.textContent !== txt) readValRef.current.textContent = txt;
          const idx = Math.round(((Math.max(G.x0, Math.min(G.x1, dot.x)) - G.x0) / (G.x1 - G.x0)) * (C.n - 1));
          const lab = L.labels?.[idx] ?? "";
          if (readLabRef.current && readLabRef.current.textContent !== lab) readLabRef.current.textContent = lab;
          if (readLabRef.current) readLabRef.current.style.display = lab ? "" : "none";
        }
      }
    };

    // the loop sleeps once the reveal and any tween have settled: nothing runs at rest
    const busy = () => {
      if (!L.started) return false;
      const hoverMoving = Math.abs(L.hoverMix - (L.hover !== null ? 1 : 0)) > 0.001;
      if (reduce) return L.morph < 1 || hoverMoving;
      return L.clock < T_REST + 1.3 || L.morph < 1 || L.valueT < 1 || L.hover !== null || hoverMoving;
    };
    const tick = () => {
      raf = 0;
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      draw(dt);
      if (visible && !document.hidden && busy()) raf = requestAnimationFrame(tick);
    };
    const kick = () => {
      if (!raf && visible && !document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    L.kick = kick;
    draw(0);
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible) { L.started = true; kick(); }
        else if (raf) { cancelAnimationFrame(raf); raf = 0; }
      });
      io.observe(card);
    } else {
      L.started = true;
      kick();
    }
    const onVis = () => { if (!document.hidden) kick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      if (raf) cancelAnimationFrame(raf);
      L.kick = () => {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, G, tone, mode]);

  // close the menu on outside press and Escape
  React.useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || pillRef.current?.contains(t)) return;
      setOpen(false);
    };
    const keyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setOpen(false); pillRef.current?.focus(); }
    };
    window.addEventListener("pointerdown", down);
    window.addEventListener("keydown", keyDown);
    return () => { window.removeEventListener("pointerdown", down); window.removeEventListener("keydown", keyDown); };
  }, [open]);

  const choose = (p: string) => {
    setOpen(false);
    if (p === current) return;
    if (period === undefined) setInnerPeriod(p);
    onPeriodChange?.(p);
  };

  const onMove = (e: React.PointerEvent) => {
    const r = cardRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * G.cw;
    const L = liveRef.current!;
    const nx = Math.max(G.x0, Math.min(G.x1, x));
    if (L.hover === null && L.hoverMix < 0.02) L.hoverX = nx;
    L.hover = nx;
    L.kick();
  };
  const onLeave = () => {
    const L = liveRef.current!;
    L.hover = null;
    L.kick();
  };

  const px = (n: number) => `${(n * u).toFixed(3)}px`;
  const pxf = (n: number, floor: number) => `${Math.max(floor, n * u).toFixed(3)}px`;
  const wide = G.kind === "wide";
  const textBase: React.CSSProperties = { position: "absolute", whiteSpace: "nowrap", fontFamily: font, fontStretch: "110%", fontWeight: 300, margin: 0, lineHeight: 1 };
  const trendColor = trend !== "down" ? "#93cfa2" : "#f08a8a";
  const finalDigits = numText(value, locale, decimals, format);
  const showUpdated = updatedText !== "";
  const showPill = periods.length > 0;
  const showCaption = caption !== "";
  const isNumber = mode === "number";

  // sizes: everything scales by u; the wide card floors its small type and fits its figure to the block
  const fit = figureFit(`${valuePrefix}${finalDigits}${valueSuffix}`, font, wide ? WIDE_BLOCK : CW - 56);
  const fsTitle = wide ? pxf(22, 10.5) : px(20.2);
  const fsNum = px(NUM_UNITS * fit);
  const fsCaption = wide ? pxf(15, 10.5) : pxf(11.6, 10);

  const valueEl = (
    <div data-part="value" style={{ position: "relative", fontFamily: font, fontWeight: 500, fontSize: fsNum, lineHeight: 1, letterSpacing: px(-0.5 * fit), whiteSpace: "nowrap", marginLeft: wide ? 0 : px(-8.5), color: ink.num }}>
      {valuePrefix && <span data-part="prefix" style={{ display: "inline-block", whiteSpace: "pre", marginRight: "0.02em" }}>{valuePrefix}</span>}
      <span style={{ position: "relative", display: "inline-block", fontVariantNumeric: "tabular-nums", fontStretch: "106%" }}>
        <span style={{ visibility: "hidden" }}>{finalDigits}</span>
        <span ref={digitsRef} style={{ position: "absolute", right: 0, top: 0 }}>{finalDigits}</span>
      </span>
      {valueSuffix && <span data-part="suffix" style={{ display: "inline-block", whiteSpace: "pre", fontStretch: "76%", marginLeft: px(1.5), marginRight: px(-4), transform: "scaleX(0.93)", transformOrigin: "0 50%" }}>{valueSuffix}</span>}
      {trend !== "none" && (
        <svg
          ref={arrowRef}
          viewBox="0 0 8 8"
          aria-hidden
          style={{ position: "absolute", left: "100%", marginLeft: px(5.5), top: px(16.4), width: px(7), height: px(7), overflow: "visible", transformOrigin: "0% 100%", opacity: 0, rotate: trend === "down" ? "90deg" : undefined }}
        >
          <path d="M0.6 7.4 L7.2 0.8 M2 0.6 L7.4 0.6 L7.4 6" fill="none" stroke={trendColor} strokeWidth={1.1} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
      )}
    </div>
  );

  // text that wraps instead of being cut (same information on phone and computer)
  const clampLines = (n: number): React.CSSProperties => ({ whiteSpace: "normal", display: "-webkit-box", WebkitLineClamp: n, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.25, overflowWrap: "anywhere" });

  let textBlock: React.ReactNode;
  if (!wide) {
    // the original layout; number mode moves the block to the middle of the card
    const tTop = isNumber ? 268 : 441.4;
    const nTop = isNumber ? 296 : 469;
    const cTop = isNumber ? 388 : 560.9;
    textBlock = (
      <>
        <p data-part="title" style={{ ...textBase, left: px(28), right: px(28), textAlign: "center", top: px(tTop), fontSize: fsTitle, fontStretch: "115%", fontWeight: 200, color: ink.title, overflow: "hidden", textOverflow: "ellipsis" }}>{title}</p>
        <div ref={numRef} style={{ position: "absolute", left: 0, right: 0, top: px(nTop), display: "flex", justifyContent: "center", opacity: 0 }}>
          {valueEl}
        </div>
        {showCaption && <p data-part="caption" style={{ ...textBase, ...clampLines(4), left: px(28), right: px(28), textAlign: "center", top: px(cTop), fontSize: fsCaption, fontStretch: "108%", fontWeight: 250, color: ink.caption }}>{caption}</p>}
      </>
    );
  } else {
    // wide: a left-aligned block of 300 units, centred vertically
    const blockStyle: React.CSSProperties = {
      position: "absolute", left: px(64), width: px(WIDE_BLOCK), top: "50%", transform: "translateY(-46%)",
      display: "flex", flexDirection: "column", alignItems: "flex-start", gap: pxf(14, 5),
    };
    const inner: React.CSSProperties = { ...textBase, position: "relative", maxWidth: "100%" };
    textBlock = (
      <div style={blockStyle}>
        <p data-part="title" style={{ ...inner, ...clampLines(2), fontSize: fsTitle, fontStretch: "115%", fontWeight: 200, color: ink.title }}>{title}</p>
        <div ref={numRef} style={{ position: "relative", display: "flex", opacity: 0 }}>
          {valueEl}
        </div>
        {showCaption && <p data-part="caption" style={{ ...inner, ...clampLines(3), fontSize: fsCaption, fontStretch: "108%", fontWeight: 250, color: ink.caption }}>{caption}</p>}
      </div>
    );
  }

  const hv = G.hover;
  return (
    <div className={className} style={{ display: "inline-block", verticalAlign: "top", ...style }}>
      <div
        ref={cardRef}
        data-peak-chart=""
        style={{ position: "relative", width, height: width * G.hn, borderRadius: px(G.cr), flex: "none", fontFamily: font, color: ink.num, userSelect: "none", WebkitUserSelect: "none", boxShadow: light ? SHADOW : undefined }}
      >
        <canvas ref={canvasRef} aria-hidden style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }} />
        {chart && (
          <div
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={onLeave}
            onPointerCancel={onLeave}
            style={{ position: "absolute", left: px(hv[0]), top: px(hv[1]), width: px(hv[2]), height: px(hv[3]), touchAction: "pan-y", cursor: "crosshair" }}
          />
        )}
        {showUpdated && (
          <p data-part="updated" style={{ ...textBase, left: px(45.6), right: showPill ? px(250) : px(46), top: px(43.6), fontSize: wide ? pxf(18.6, 10) : pxf(18.6, 9.5), fontStretch: "107.7%", fontWeight: 200, color: ink.updated, overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.15 }}>{updatedText}</p>
        )}

        {showPill && (
          <button
            ref={pillRef}
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            title={periodLabel}
            onClick={() => setOpen((o) => !o)}
            style={{
              position: "absolute", right: px(46), top: px(35), height: pxf(37, 26), borderRadius: 999, border: 0, padding: `0 ${pxf(19.8, 10)} 0 ${pxf(19.4, 10)}`,
              display: "flex", alignItems: "center", gap: pxf(6.72, 5), background: ink.pillBg, cursor: "pointer", color: ink.pillText, fontFamily: font,
            }}
          >
            <span data-part="period" style={{ ...textBase, position: "relative", display: "block", fontSize: pxf(17.2, 11), fontStretch: "115%", fontWeight: 300, color: ink.period }}>{current}</span>
            <svg viewBox="0 0 12 7" aria-hidden style={{ flex: "none", width: pxf(12, 8), height: pxf(7, 5), overflow: "visible", transition: "transform .2s ease", transform: open ? "rotate(180deg)" : "none" }}>
              <path d="M0.8 0.8 L6 6 L11.2 0.8" fill="none" stroke={ink.chevron} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
          </button>
        )}

        {showPill && (
          <div
            ref={menuRef}
            role="listbox"
            aria-label={periodLabel}
            style={{
              position: "absolute", right: px(46), top: `calc(${px(35)} + ${pxf(37, 26)} + 6px)`, minWidth: pxf(150, 110), padding: pxf(6, 4), borderRadius: pxf(16, 10), zIndex: 3,
              background: ink.menuBg, border: ink.menuBorder,
              boxShadow: "0 18px 40px -12px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)",
              backdropFilter: "blur(18px) saturate(150%)", WebkitBackdropFilter: "blur(18px) saturate(150%)",
              transformOrigin: "top right", transition: "opacity .18s ease, transform .22s cubic-bezier(.2,.8,.3,1), visibility .22s",
              opacity: open ? 1 : 0, transform: open ? "none" : "translateY(-4px) scale(0.97)", visibility: open ? "visible" : "hidden",
            }}
          >
            {periods.map((p) => (
              <button
                key={p}
                type="button"
                role="option"
                aria-selected={p === current}
                tabIndex={open ? 0 : -1}
                onClick={() => choose(p)}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, width: "100%", height: pxf(36, 32), padding: `0 ${pxf(12, 10)}`,
                  border: 0, borderRadius: pxf(10, 7), background: p === current ? ink.optBg : "transparent", cursor: "pointer",
                  color: p === current ? ink.optOn : ink.optOff, fontFamily: font, fontStretch: "116%", fontSize: pxf(15.5, 12.5), textAlign: "left", whiteSpace: "nowrap",
                }}
                onPointerEnter={(e) => { if (p !== current) e.currentTarget.style.background = ink.optHover; }}
                onPointerLeave={(e) => { if (p !== current) e.currentTarget.style.background = "transparent"; }}
              >
                {p}
                {p === current && (
                  <svg viewBox="0 0 12 9" aria-hidden style={{ width: pxf(12, 10), height: pxf(9, 7.5) }}>
                    <path d="M1 4.6 L4.4 8 L11 1" fill="none" stroke={ink.check} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}

        {chart && (
          <div
            ref={readRef}
            aria-hidden
            style={{
              position: "absolute", left: 0, top: 0, opacity: 0, pointerEvents: "none", zIndex: 2, display: "flex", alignItems: "baseline", gap: px(7),
              padding: `${pxf(7, 4)} ${pxf(11, 7)}`, borderRadius: pxf(11, 8), background: ink.readBg, border: ink.readBorder,
              backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", whiteSpace: "nowrap", fontFamily: font, fontStretch: "116%",
            }}
          >
            <span ref={readValRef} style={{ fontSize: pxf(16, 11), fontWeight: 600, color: ink.readVal }} />
            <span ref={readLabRef} style={{ fontSize: pxf(12.5, 10), color: ink.readLab }} />
          </div>
        )}

        {textBlock}
      </div>
    </div>
  );
}

export const PeakCard = PeakChart;

/* ---------- the slot: width, shape (V06), tone (V08), lazy mount ---------- */

const DESKTOP_Q = "(min-width: 900px)";
const floor8 = (n: number) => Math.max(0, Math.floor(n / 8) * 8);

function useMatch(q: string): boolean {
  const [on, setOn] = React.useState(() => typeof matchMedia !== "undefined" && matchMedia(q).matches);
  React.useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const m = matchMedia(q);
    const sync = () => setOn(m.matches);
    sync();
    m.addEventListener?.("change", sync);
    return () => m.removeEventListener?.("change", sync);
  }, [q]);
  return on;
}

/** "light" when the page asks for light (`color-scheme: light`, or `light dark` on a device set to light), else "dark" */
export function useAppTone(): Tone {
  const read = (): Tone => {
    if (typeof document === "undefined") return "dark";
    const cs = (getComputedStyle(document.documentElement).colorScheme || "").trim();
    if (cs === "light") return "light";
    const parts = cs.split(/\s+/);
    if (parts.includes("light") && parts.includes("dark")) return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    return "dark";
  };
  const [tone, setTone] = React.useState<Tone>(read);
  React.useEffect(() => {
    const again = () => setTone(read());
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(again) : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const m = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: light)") : null;
    m?.addEventListener?.("change", again);
    again();
    return () => {
      mo?.disconnect();
      m?.removeEventListener?.("change", again);
    };
  }, []);
  return tone;
}

export type PeakSlotProps = Omit<PeakChartProps, "width" | "aspect" | "tone"> & { maxPortrait?: number; maxWide?: number };

/** The card where it is used: as wide as its place (to 8 px, re-painted only on a real size change), the 16:9
 *  Panorama on a computer and the portrait card on a phone, the porcelain card in light mode, and mounted only
 *  when it comes near the screen (an empty box of the same size holds its place until then). */
export function PeakSlot({ maxPortrait = 400, maxWide = 880, ...rest }: PeakSlotProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState(0);
  const [near, setNear] = React.useState(false);
  const wide = useMatch(DESKTOP_Q);
  const tone = useAppTone();

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      setW(floor8(Math.min(400, el.parentElement?.clientWidth || el.clientWidth || 400)));
      return;
    }
    setW(floor8(el.clientWidth));
    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const next = floor8(el.clientWidth);
        setW((cur) => (cur === next ? cur : next));
      }, 150);
    });
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const aspect = wide ? "wide" : "portrait";
  const width = Math.min(w, wide ? maxWide : maxPortrait);
  const G = wide ? WIDE : PORTRAIT;
  return (
    <div ref={ref} className="peak-slot">
      {width > 0 &&
        (near ? (
          <PeakChart key={aspect} {...rest} width={width} aspect={aspect} tone={tone} />
        ) : (
          <div className="peak-wait" aria-hidden style={{ width, height: width * PEAK_RATIO[aspect], borderRadius: (width * G.cr) / G.cw }} />
        ))}
    </div>
  );
}

export default PeakChart;
