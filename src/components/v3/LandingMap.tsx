import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// The app ships as one HTML file: the map's worker is inlined (the app's map sets it first; this only covers a page
// opened without it)
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";
import { locale, t } from "../../lib/i18n";

/**
 * The landing's stage: a real city at night, seen from above at an angle, with one day's route drawn once and its
 * stops appearing in turn, like a timetable; then a cross-fade to the next city. The page is whole before the map:
 * the timetable of the day (the "board") is real text and runs on its own clock; the map starts after the first paint,
 * when the browser is idle, and only fades in once its tiles are drawn. It pauses off screen and when the tab is
 * hidden; with less motion, one city, still, its route drawn. Without WebGL or tiles, the board alone stays.
 */

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const SVG = "http://www.w3.org/2000/svg";
const PITCH = 58;

type LL = [lng: number, lat: number];
type Stop = { at: string; name: string; ll: LL };
type City = { name: () => string; country: () => string; day: () => string; at: LL; bearing: number; stops: Stop[] };

/** Real places, real coordinates (the city's own centre for the board's line) */
const CITIES: City[] = [
  {
    name: () => "Florence",
    country: () => t("Italie"),
    day: () => t("Jour 2 · Centro storico"),
    at: [11.2558, 43.7696],
    bearing: -28,
    stops: [
      { at: "09:30", name: "Mercato Centrale", ll: [11.2534, 43.7766] },
      { at: "11:00", name: "Galleria dell'Accademia", ll: [11.2589, 43.7768] },
      { at: "14:00", name: "Duomo di Firenze", ll: [11.256, 43.7731] },
      { at: "18:30", name: "Ponte Vecchio", ll: [11.2531, 43.768] },
    ],
  },
  {
    name: () => "Kyoto",
    country: () => t("Japon"),
    day: () => t("Jour 3 · Higashiyama"),
    at: [135.7681, 35.0116],
    bearing: 24,
    stops: [
      { at: "08:00", name: "Kiyomizu-dera", ll: [135.785, 34.9949] },
      { at: "10:30", name: "Sannenzaka", ll: [135.781, 34.9965] },
      { at: "12:30", name: "Yasaka-jinja", ll: [135.7786, 35.0036] },
      { at: "17:00", name: "Gion Shirakawa", ll: [135.7747, 35.0059] },
    ],
  },
  {
    name: () => t("Lisbonne"),
    country: () => t("Portugal"),
    day: () => t("Jour 1 · Alfama"),
    at: [-9.1393, 38.7223],
    bearing: -14,
    stops: [
      { at: "09:30", name: "Castelo São Jorge", ll: [-9.1334, 38.7139] },
      { at: "11:30", name: "Santa Luzia", ll: [-9.1302, 38.7117] },
      { at: "13:00", name: "Sé de Lisboa", ll: [-9.1335, 38.7099] },
      { at: "18:00", name: "Praça do Comércio", ll: [-9.1364, 38.7075] },
    ],
  },
];

// ---------------------------------------------------------------- the clock of a scene (ms)

const T_FIRST = 700; // the first stop
const T_DRAW = 1500; // the first leg starts
const LEG = 1900; // one leg drawn
const STAY = 700; // a pause at each stop
const T_OUT = T_DRAW + 3 * LEG + 2 * STAY + 4400; // the map fades out
const T_END = T_OUT + 1000; // the next city
const T_STILL = T_OUT - 1; // with less motion: everything shown
const DRIFT_BEARING = 16; // degrees over a scene
const DRIFT_ZOOM = 0.32;
const HOLD_MAX = 5000; // how long the board waits for the map's tiles

const stopAt = (i: number) => (i === 0 ? T_FIRST : T_DRAW + i * LEG + (i - 1) * STAY);
const legAt = (i: number) => T_DRAW + i * (LEG + STAY);
const stepAt = (ms: number, n: number) => {
  let k = 0;
  for (let i = 0; i < n; i++) if (ms >= stopAt(i)) k = i + 1;
  return k;
};
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

// ---------------------------------------------------------------- geometry

const rad = Math.PI / 180;
function meters(a: LL, b: LL) {
  const p1 = a[1] * rad, p2 = b[1] * rad;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
/** Minutes on foot between two stops (the straight line, lengthened for the streets) */
export const walkMin = (a: LL, b: LL) => Math.max(3, Math.round((meters(a, b) * 1.3) / 80));

/** The day's line: a gentle curve from stop to stop (an itinerary, not a turn-by-turn route), and where each stop
 *  falls along it (0–1, by length on the map) */
function routeOf(c: City) {
  const lat0 = c.stops[0].ll[1] * rad;
  const pts: LL[] = [];
  const at: number[] = [0];
  let len = 0;
  const xy = (p: LL) => [p[0] * Math.cos(lat0), p[1]] as const;
  const legs: number[] = [];
  const run: number[] = [0];
  c.stops.forEach((s, i) => {
    if (i === 0) {
      pts.push(s.ll);
      return;
    }
    const a = c.stops[i - 1].ll, b = s.ll;
    const [ax, ay] = xy(a), [bx, by] = xy(b);
    const dx = bx - ax, dy = by - ay;
    const bend = (i % 2 ? 1 : -1) * 0.14;
    const mx = (ax + bx) / 2 - dy * bend, my = (ay + by) / 2 + dx * bend;
    let px = ax, py = ay, l = 0;
    for (let k = 1; k <= 24; k++) {
      const f = k / 24;
      const x = (1 - f) ** 2 * ax + 2 * (1 - f) * f * mx + f * f * bx;
      const y = (1 - f) ** 2 * ay + 2 * (1 - f) * f * my + f * f * by;
      l += Math.hypot(x - px, y - py);
      px = x;
      py = y;
      pts.push([x / Math.cos(lat0), y]);
      run.push(len + l);
    }
    legs.push(l);
    len += l;
  });
  let acc = 0;
  for (const l of legs) {
    acc += l;
    at.push(acc / len);
  }
  return { pts, at, frac: run.map((r) => r / len) };
}
const ROUTES = CITIES.map(routeOf);

/** How much of the line is drawn at time ms */
function drawnAt(ms: number, at: number[]) {
  for (let i = at.length - 2; i >= 0; i--) {
    const s = legAt(i);
    if (ms >= s) return at[i] + (at[i + 1] - at[i]) * easeInOut(Math.min(1, (ms - s) / LEG));
  }
  return 0;
}

/** The part of the line drawn at fraction d (by length), its last point cut where the pen is */
function cut(r: (typeof ROUTES)[number], d: number): LL[] {
  if (d >= 1) return r.pts;
  const out: LL[] = [r.pts[0]];
  for (let i = 1; i < r.pts.length; i++) {
    if (r.frac[i] <= d) {
      out.push(r.pts[i]);
      continue;
    }
    const f = (d - r.frac[i - 1]) / Math.max(1e-9, r.frac[i] - r.frac[i - 1]);
    const a = r.pts[i - 1], b = r.pts[i];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    break;
  }
  return out;
}

/** "43,77° N · 11,26° E" in French, "43.77° N · 11.26° E" in English */
export function coords([lng, lat]: LL) {
  const f = (v: number) => Math.abs(v).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const ns = lat >= 0 ? t("{v}° N", { v: f(lat) }) : t("{v}° S", { v: f(lat) });
  const ew = lng >= 0 ? t("{v}° E", { v: f(lng) }) : t("{v}° O", { v: f(lng) });
  return `${ns} · ${ew}`;
}

// ---------------------------------------------------------------- environment

const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};
function webglOk() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
const saveData = () => !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

/** The night palette of the app's map, quieter: no labels at all (the stops are the only words) */
function restyle(map: maplibregl.Map) {
  const set = (id: string, prop: string, value: unknown) => {
    try {
      (map.setPaintProperty as (this: maplibregl.Map, l: string, p: string, v: unknown) => void).call(map, id, prop, value);
    } catch {
      /* layer without that property */
    }
  };
  for (const layer of map.getStyle().layers || []) {
    const id = layer.id;
    if (layer.type === "symbol") {
      map.setLayoutProperty(id, "visibility", "none");
      continue;
    }
    if (layer.type === "background") set(id, "background-color", "#070707");
    else if (id === "water" || (id.includes("water") && layer.type === "fill")) set(id, "fill-color", "#0b0e10");
    else if (id.includes("waterway")) set(id, "line-color", "#0b0e10");
    else if (/park|wood|landcover|grass/.test(id) && layer.type === "fill") set(id, "fill-color", "#0b0c0a");
    else if (/residential|landuse/.test(id) && layer.type === "fill") set(id, "fill-color", "#090909");
    else if (id === "building") {
      set(id, "fill-color", "#11100f");
      set(id, "fill-outline-color", "#1a1917");
    } else if (layer.type === "line" && /casing/.test(id)) set(id, "line-color", "#1d1c1a");
    else if (layer.type === "line" && /motorway|major|trunk|primary/.test(id)) set(id, "line-color", "#2a2724");
    else if (layer.type === "line" && /highway|road|path|minor|subtle|street|service/.test(id)) set(id, "line-color", "#1f1d1b");
    else if (layer.type === "line" && /rail/.test(id)) set(id, "line-color", "#161514");
    else if (layer.type === "line" && /boundary/.test(id)) set(id, "line-color", "#24221f");
  }
}

/** A stop on the map: MapLibre owns the outer element (its position and opacity), the drawing lives inside */
function markerEl(s: Stop) {
  const outer = document.createElement("div");
  outer.className = "lp2-mk-at";
  const el = document.createElement("div");
  el.className = "lp2-mk";
  outer.append(el);
  const dot = document.createElement("i");
  const tag = document.createElement("span");
  const tm = document.createElement("b");
  tm.textContent = s.at;
  tag.append(tm, document.createTextNode(s.name));
  el.append(dot, tag);
  return outer;
}

// ---------------------------------------------------------------- the stage

type Phase = "pending" | "loading" | "ready" | "dead";

/** True while the element is on screen and the page is visible */
function useActive(ref: RefObject<HTMLElement | null>) {
  const [onScreen, setOnScreen] = useState(true);
  const [shown, setShown] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  useEffect(() => {
    const f = () => setShown(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);
  return onScreen && shown;
}

/**
 * The hero: the map stage behind, the copy (children) and the board of the day over it.
 * `copyRef` is the block of the headline: the route is framed away from it.
 */
export default function LandingHero({ children, copyRef }: { children: ReactNode; copyRef: RefObject<HTMLDivElement | null> }) {
  const hero = useRef<HTMLElement>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  const board = useRef<HTMLDivElement>(null);
  const active = useActive(hero);
  const [still] = useState(reducedMotion);
  const [scene, setScene] = useState(0);
  const [step, setStep] = useState(() => (still ? CITIES[0].stops.length : 0));
  const [mapOn, setMapOn] = useState(false);

  // everything the frame loop reads and writes, outside React's renders
  const st = useRef({
    scene: 0,
    ms: still ? T_STILL : 0,
    held: 0,
    phase: "pending" as Phase,
    map: null as maplibregl.Map | null,
    markers: [] as { m: maplibregl.Marker; el: HTMLElement }[],
    cam: null as { center: maplibregl.LngLat; zoom: number; bearing: number } | null,
    drawn: 0,
    shown: false,
    line: null as SVGPathElement | null,
    step: still ? CITIES[0].stops.length : 0,
    on: false,
    active: false,
  });

  // ---- the map: one instance, after the first paint and when the browser is idle; destroyed on unmount
  useEffect(() => {
    const s = st.current;
    if (!webglOk() || saveData()) {
      s.phase = "dead";
      return;
    }
    let map: maplibregl.Map | null = null;
    let gaveUp: number | undefined;
    let idleId: number | undefined;
    let cancelled = false;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };

    const kill = () => {
      s.phase = "dead";
      s.map = null;
      s.markers = [];
      setMapOn(false);
      s.on = false;
      try {
        map?.remove();
      } catch {
        /* already gone */
      }
      map = null;
    };

    const create = () => {
      if (cancelled || !mapBox.current) return;
      try {
        if (!maplibregl.getWorkerUrl().startsWith("blob:")) maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));
      } catch {
        /* keep the default */
      }
      const c = CITIES[s.scene];
      try {
        map = new maplibregl.Map({
          container: mapBox.current,
          style: STYLE_URL,
          center: c.stops[1].ll,
          zoom: 15,
          pitch: PITCH,
          bearing: c.bearing,
          maxPitch: 70,
          interactive: false,
          attributionControl: false,
          fadeDuration: 0,
          pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
          canvasContextAttributes: { antialias: true },
        });
      } catch {
        kill();
        return;
      }
      s.map = map;
      // the day's line: drawn over the city (a line on the ground would hide behind the buildings), under the stops
      const svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("class", "lp2-line");
      svg.setAttribute("aria-hidden", "true");
      const path = document.createElementNS(SVG, "path");
      svg.append(path);
      map.getCanvasContainer().append(svg);
      s.line = path;
      map.on("render", () => drawLine());
      s.phase = "loading";
      gaveUp = window.setTimeout(() => {
        if (s.phase === "loading" && !s.shown) kill();
      }, 15000);
      let styled = false;
      map.on("error", () => {
        // the style or WebGL failing leaves the board alone; a missing tile is not worth a black stage (a city whose
        // tiles never arrive is given up by the timer above)
        if (!styled) kill();
      });
      map.on("style.load", () => {
        if (!map) return;
        styled = true;
        try {
          restyle(map);
          map.setLight({ anchor: "viewport", color: "#f6f2ea", intensity: 0.4, position: [1.4, 210, 35] });
          if (map.getSource("openmaptiles")) {
            map.addLayer({
              id: "lp2-3d",
              type: "fill-extrusion",
              source: "openmaptiles",
              "source-layer": "building",
              minzoom: 13,
              paint: {
                "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 0], 0, "#1a1917", 30, "#24221f", 120, "#36322d"],
                "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
                "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
                "fill-extrusion-opacity": 0.94,
              },
            });
          }
        } catch {
          kill();
          return;
        }
        goToScene(s.scene);
      });
    };

    // after the first paint, then when the main thread is free
    const raf = requestAnimationFrame(() => {
      if (w.requestIdleCallback) idleId = w.requestIdleCallback(create, { timeout: 1800 });
      else idleId = window.setTimeout(create, 600);
    });

    const onResize = () => {
      if (s.phase === "ready" || s.phase === "loading") frame(s.scene);
    };
    let rz: number | undefined;
    const resized = () => {
      window.clearTimeout(rz);
      rz = window.setTimeout(onResize, 160);
    };
    window.addEventListener("resize", resized);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (idleId !== undefined) {
        if (w.cancelIdleCallback) w.cancelIdleCallback(idleId);
        window.clearTimeout(idleId);
      }
      window.clearTimeout(gaveUp);
      window.clearTimeout(rz);
      window.removeEventListener("resize", resized);
      try {
        map?.remove();
      } catch {
        /* already gone */
      }
      s.map = null;
      s.markers = [];
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Frames the day's stops in the open part of the stage (away from the headline and the board) */
  function frame(n: number) {
    const s = st.current;
    const map = s.map;
    const box = hero.current;
    if (!map || !box) return;
    const c = CITIES[n];
    const hr = box.getBoundingClientRect();
    const cr = copyRef.current?.getBoundingClientRect();
    const br = board.current?.getBoundingClientRect();
    const W = hr.width, H = hr.height;
    let pad: { top: number; bottom: number; left: number; right: number };
    if (W < 1024) {
      // phone and tablet: between the board's line at the top and the headline below
      const top = br ? Math.max(96, br.top - hr.top + 64) : 120;
      const bottom = cr ? Math.max(120, hr.bottom - cr.top + 8) : H * 0.5;
      pad = { top, bottom, left: 24, right: 24 };
    } else {
      // computer: the upper right, beside the headline, above the board
      const left = cr ? Math.min(W * 0.5, cr.right - hr.left + 24) : W * 0.42;
      const bottom = br ? Math.max(H * 0.3, hr.bottom - br.top + 8) : H * 0.38;
      pad = { top: 104, bottom, left, right: 96 };
    }
    // never an impossible frame on a small window
    if (pad.top + pad.bottom > H - 80) {
      const k = (H - 80) / (pad.top + pad.bottom);
      pad.top *= k;
      pad.bottom *= k;
    }
    if (pad.left + pad.right > W - 80) {
      const k = (W - 80) / (pad.left + pad.right);
      pad.left *= k;
      pad.right *= k;
    }
    // fitted on screen, in perspective: the stops' box (plus room for their labels) brought to the open area,
    // in a few passes (a bounds fit ignores the tilt and leaves the city far too small)
    const n0 = c.stops.length;
    let center = new maplibregl.LngLat(c.stops.reduce((a, p) => a + p.ll[0], 0) / n0, c.stops.reduce((a, p) => a + p.ll[1], 0) / n0);
    let zoom = 15.4;
    // the labels keep their size while the city scales: measured
    const lw = s.markers.map((mk) => (mk.el.firstElementChild as HTMLElement | null)?.offsetWidth || 160);
    const maxLw = Math.max(...lw);
    // the city turned so that the day reads down the open area, labels on the right, each stop on its own line:
    // of every heading, the one that frames the day largest with at least a label's height between two stops
    // (the tilt flattens the height: about half), the city's own view breaking ties
    const en = c.stops.map((p) => [(p.ll[0] - c.stops[0].ll[0]) * Math.cos(p.ll[1] * rad) * 111320, (p.ll[1] - c.stops[0].ll[1]) * 110540] as const);
    const near = (x: number) => Math.abs(((((x - c.bearing) % 360) + 540) % 360) - 180);
    let bearing = c.bearing, best = -Infinity;
    for (let b = -180; b < 180; b += 3) {
      const at = (h: number) => {
        const cb = Math.cos(h * rad), sb = Math.sin(h * rad);
        return { xs: en.map(([e, nn]) => e * cb - nn * sb), ys: en.map(([e, nn]) => -(e * sb + nn * cb) * 0.5) };
      };
      const { xs, ys } = at(b);
      const bw = Math.max(...xs) - Math.min(...xs) + 1, bh = Math.max(...ys) - Math.min(...ys) + 1;
      const scale = Math.min(Math.max(40, W - pad.left - pad.right - 24 - maxLw) / bw, Math.max(40, H - pad.top - pad.bottom - 40) / bh);
      // the drift turns the city by a few degrees: the stops must stay apart all along
      let gap = Infinity;
      for (const h of [b - DRIFT_BEARING / 2, b, b + DRIFT_BEARING / 2]) {
        const sy = [...at(h).ys].sort((u, v) => u - v);
        for (let i = 1; i < sy.length; i++) gap = Math.min(gap, (sy[i] - sy[i - 1]) * scale);
      }
      const score = (gap >= 44 ? 1000 + scale * 100 : gap) - near(b) * 0.02;
      if (score > best) {
        best = score;
        bearing = b;
      }
    }
    const aw = Math.max(80, W - pad.left - pad.right - 24);
    const ah = Math.max(60, H - pad.top - pad.bottom - 40);
    for (let k = 0; k < 6; k++) {
      map.jumpTo({ center, zoom, bearing, pitch: PITCH, padding: pad });
      const pts = c.stops.map((p) => map.project(p.ll));
      const x0 = Math.min(...pts.map((p) => p.x - 6));
      const x1 = Math.max(...pts.map((p, i) => p.x + lw[i]));
      const ys = pts.map((p) => p.y);
      const y0 = Math.min(...ys) - 16, y1 = Math.max(...ys) + 16;
      center = map.unproject([(x0 + x1) / 2, (y0 + y1) / 2]);
      zoom = Math.max(13.2, Math.min(16.6, zoom + 0.8 * Math.log2(Math.min(aw / Math.max(1, x1 - x0), ah / Math.max(1, y1 - y0)))));
    }
    // the drift ends a little closer: start a little back
    s.cam = { center, zoom: zoom - DRIFT_ZOOM / 2, bearing: bearing - DRIFT_BEARING / 2 };
    place(s.ms);
  }

  /** The camera and the line at time ms of the scene */
  function place(ms: number) {
    const s = st.current;
    const map = s.map;
    if (!map || !s.cam) return;
    // with less motion: the still frame is the middle of the drift (the one the day was framed for)
    const k = still ? 0.5 : Math.min(1, ms / T_END);
    map.jumpTo({ center: s.cam.center, zoom: s.cam.zoom + DRIFT_ZOOM * k, bearing: s.cam.bearing + DRIFT_BEARING * k, pitch: PITCH });
    s.drawn = drawnAt(ms, ROUTES[s.scene].at);
    drawLine();
  }

  /** Puts the map on city n: its line, its stops (hidden until their time), its frame; ready once the tiles are drawn */
  function goToScene(n: number) {
    const s = st.current;
    const map = s.map;
    if (!map || s.phase === "dead") return;
    for (const mk of s.markers) mk.m.remove();
    s.markers = CITIES[n].stops.map((p) => {
      const el = markerEl(p);
      const m = new maplibregl.Marker({ element: el, anchor: "left", offset: [-5, 0] }).setLngLat(p.ll).addTo(map);
      return { m, el };
    });
    s.drawn = drawnAt(s.ms, ROUTES[n].at);
    s.phase = "loading";
    frame(n);
    syncMarkers();
    map.once("idle", () => {
      if (s.map !== map || s.scene !== n) return;
      s.phase = "ready";
      // a city that comes in late (slow network) waits for the next one rather than flashing at the end
      if (s.ms < T_OUT - 2500 || still) {
        s.on = true;
        s.shown = true;
        setMapOn(true);
      }
    });
  }

  /** The drawn part of the day's line, projected on the screen as the camera stands now */
  function drawLine() {
    const s = st.current;
    const map = s.map;
    if (!map || !s.line) return;
    if (s.drawn <= 0) {
      s.line.setAttribute("d", "");
      return;
    }
    const pts = cut(ROUTES[s.scene], s.drawn).map((p) => map.project(p));
    s.line.setAttribute("d", pts.map((p, i) => (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1)).join(""));
  }

  function syncMarkers() {
    const s = st.current;
    s.markers.forEach((mk, i) => mk.el.firstElementChild?.classList.toggle("on", i < s.step));
  }

  // ---- the clock: runs while the hero is on screen and the tab visible (never with less motion)
  useEffect(() => {
    const s = st.current;
    s.active = active;
    if (still || !active) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      const c = CITIES[s.scene];
      // the board waits at the start of a city while its tiles arrive (never long)
      const waiting = (s.phase === "pending" || s.phase === "loading") && s.ms >= T_FIRST - 100 && s.held < HOLD_MAX;
      if (waiting) s.held += dt;
      else s.ms += dt;

      const k = stepAt(s.ms, c.stops.length);
      if (k !== s.step) {
        s.step = k;
        setStep(k);
        syncMarkers();
      }
      if (s.phase === "ready" && s.on) place(s.ms);
      if (s.on && s.ms >= T_OUT) {
        s.on = false;
        setMapOn(false);
      }
      if (s.ms >= T_END) {
        const n = (s.scene + 1) % CITIES.length;
        s.scene = n;
        s.ms = 0;
        s.held = 0;
        s.step = 0;
        setScene(n);
        setStep(0);
        if (s.map && s.phase !== "dead") goToScene(n);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, still]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = CITIES[scene];
  const legs = c.stops.map((p, i) => (i ? walkMin(c.stops[i - 1].ll, p.ll) : 0));

  return (
    <section ref={hero} className={"lp2-hero" + (mapOn ? " map-on" : "")} aria-labelledby="lp2-h1">
      <div className="lp2-stage" aria-hidden="true">
        <div ref={mapBox} className={"lp2-map" + (mapOn ? " on" : "")} />
        <div className="lp2-vig" />
      </div>
      <div className="lp2-hero-in lp2-grid">
        <div ref={board} className="lp2-board">
          <div className="lp2-board-head">
            <span className="v3-lbl">{t("Exemple de journée")}</span>
            <span className="lp2-board-n" aria-hidden="true">
              {String(scene + 1).padStart(2, "0")}
              <i>/</i>
              {String(CITIES.length).padStart(2, "0")}
            </span>
          </div>
          <div key={scene} className="lp2-board-body">
            <p className="lp2-city">
              <span className="v3-d">{c.name()}</span>
              <small>
                {c.country()} · {coords(c.at)}
              </small>
            </p>
            <p className="lp2-day">{c.day()}</p>
            <ol className="lp2-rows">
              {c.stops.map((p, i) => (
                <li key={p.name} className={i < step ? "on" : ""}>
                  <span className="lp2-tm">{p.at}</span>
                  <span className="lp2-nm">{p.name}</span>
                  <span className="lp2-walk">{i ? t("{n} min à pied", { n: legs[i] }) : ""}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        {children}
      </div>
      <p className={"lp2-attrib" + (mapOn ? " on" : "")}>
        <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>
        <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OpenMapTiles</a>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
      </p>
    </section>
  );
}

