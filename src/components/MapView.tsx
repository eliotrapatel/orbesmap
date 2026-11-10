import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// The app ships as one HTML file, so the map's background worker is inlined and served from a Blob.
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";
import { STATUSES } from "../data/trip";
import type { Place, Trip } from "../data/types";
import type { Pin, PlaceState } from "../lib/model";
import { useLoc } from "../lib/locate";
import { registerOfflineProtocol, transformRequest } from "../lib/offline";

maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));
// basemap served from the device cache first (offline map)
registerOfflineProtocol();

// Free vector basemap (no key), restyled below to the ORBES "vault" palette.
const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const FALLBACK_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#0a0a0a" } }] };
const PARIS: [number, number] = [2.5479, 49.0097];

export interface FocusRequest {
  n: number;
  center?: [number, number];
  zoom?: number;
  bounds?: [[number, number], [number, number]];
  pitch?: number;
  duration?: number;
}

interface Props {
  trip: Trip;
  places: Place[];
  states: Record<string, PlaceState>;
  visibleIds: Set<string>;
  pins: Pin[];
  selected: { kind: "place" | "pin"; id: string } | null;
  route: Place[] | null;
  routeColor: string;
  focus: FocusRequest | null;
  padding: { top: number; bottom: number; left: number; right: number };
  pinMode: boolean;
  me: { lng: number; lat: number; acc: number; course: number | null; stale: boolean } | null;
  follow: boolean;
  navLine: [number, number][] | null;
  navMode: "walk" | "car" | null;
  point: [number, number] | null;
  onUserPan: () => void;
  onLongPress: (lngLat: [number, number]) => void;
  threeD: boolean;
  landing: boolean;
  dayColor: (key: string) => string;
  dayGlyph: (key: string) => string;
  onSelect: (kind: "place" | "pin", id: string) => void;
  onMapClick: (lngLat: [number, number]) => void;
  onBasemapError: (failed: boolean) => void;
}

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
    if (layer.type === "background") set(id, "background-color", "#0a0a0a");
    else if (id === "water" || (id.includes("water") && layer.type === "fill")) set(id, "fill-color", "#0f1316");
    else if (id.includes("waterway")) set(id, "line-color", "#0f1316");
    else if (/park|wood|landcover/.test(id) && layer.type === "fill") set(id, "fill-color", "#10120f");
    else if (id.includes("residential")) set(id, "fill-color", "#0d0d0c");
    else if (id === "building") {
      set(id, "fill-color", "#121110");
      set(id, "fill-outline-color", "#1f1d1b");
    } else if (layer.type === "line" && /casing/.test(id)) set(id, "line-color", "#262421");
    else if (layer.type === "line" && /motorway_inner|major_inner/.test(id)) set(id, "line-color", "#2b2825");
    else if (layer.type === "line" && /highway|road|path|minor|subtle/.test(id)) set(id, "line-color", "#1b1a18");
    else if (layer.type === "line" && /rail/.test(id)) set(id, id.includes("dash") ? "line-color" : "line-color", id.includes("dash") ? "#0a0a0a" : "#242220");
    else if (layer.type === "line" && /boundary/.test(id)) set(id, "line-color", "#33302c");
    if (layer.type === "symbol") {
      const big = /place_city|place_country|place_state/.test(id);
      set(id, "text-color", big ? "#cfc9be" : id.includes("water") ? "#4e5a62" : "#8a847b");
      set(id, "text-halo-color", "rgba(10,10,10,0.9)");
    }
  }
}

/** Great-circle arc between two points (for the landing flight line) */
function arc(a: [number, number], b: [number, number], n = 128): [number, number][] {
  const toR = (d: number) => (d * Math.PI) / 180;
  const toD = (r: number) => (r * 180) / Math.PI;
  const [l1, p1] = [toR(a[0]), toR(a[1])];
  const [l2, p2] = [toR(b[0]), toR(b[1])];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const A = Math.sin((1 - f) * d) / Math.sin(d);
    const B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    out.push([toD(Math.atan2(y, x)), toD(Math.atan2(z, Math.sqrt(x * x + y * y)))]);
  }
  return out;
}

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { m: maplibregl.Marker; node: HTMLDivElement }>());
  const pinMarkers = useRef(new Map<string, { m: maplibregl.Marker; node: HTMLDivElement }>());
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const pointMarker = useRef<maplibregl.Marker | null>(null);
  const cb = useRef(p);
  cb.current = p;
  const [ready, setReady] = useState(0);

  // --- create map once ---
  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: STYLE_URL,
      center: [60, 35],
      zoom: 1.4,
      minZoom: 0.8,
      maxZoom: 18.5,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      maxPitch: 70,
      transformRequest: (url) => transformRequest(url),
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    let styled = false;
    let failed = false;
    let tilesFailed = false; // style loaded but the tile index / tiles did not (slow network): reload later
    let retry: number | undefined;
    const tryAgain = () => {
      if (!failed && !tilesFailed) return;
      tilesFailed = false;
      map.setStyle(STYLE_URL);
    };
    const fallBack = () => {
      if (failed) return;
      failed = true;
      map.setStyle(FALLBACK_STYLE);
      cb.current.onBasemapError(true);
      window.clearInterval(retry);
      retry = window.setInterval(() => navigator.onLine && tryAgain(), 30_000);
    };
    // a style request that hangs: switch to the plain background after 15 s; retries bring the real map back
    const slow = window.setTimeout(() => !styled && fallBack(), 15_000);

    const addLayers = () => {
      if (!map.getSource("route")) {
        map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "route-glow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f6f2ea", "line-width": 8, "line-opacity": 0.08, "line-blur": 4 } });
        map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f6f2ea", "line-width": 2, "line-dasharray": [1, 2], "line-opacity": 0.9 } });
      }
      if (!map.getSource("nav")) {
        map.addSource("me-acc", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "me-acc", type: "fill", source: "me-acc", paint: { "fill-color": "#5aa7ff", "fill-opacity": 0.1 } });
        map.addLayer({ id: "me-acc-line", type: "line", source: "me-acc", paint: { "line-color": "#5aa7ff", "line-opacity": 0.35, "line-width": 1 } });
        map.addSource("nav", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "nav-casing", type: "line", source: "nav", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#0a0a0a", "line-width": 9, "line-opacity": 0.9 } });
        map.addLayer({ id: "nav", type: "line", source: "nav", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#5aa7ff", "line-width": 5 } });
      }
      if (!map.getSource("arc")) {
        map.addSource("arc", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("plane", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "arc-glow", type: "line", source: "arc", paint: { "line-color": "#f6f2ea", "line-width": 6, "line-opacity": 0.12, "line-blur": 3 } });
        map.addLayer({ id: "arc", type: "line", source: "arc", paint: { "line-color": "#f6f2ea", "line-width": 1.4, "line-opacity": 0.85 } });
        map.addLayer({ id: "plane", type: "circle", source: "plane", paint: { "circle-radius": 5, "circle-color": "#f6f2ea", "circle-blur": 0.2, "circle-stroke-width": 6, "circle-stroke-color": "rgba(246,242,234,0.15)" } });
      }
      if (map.getSource("openmaptiles") && !map.getLayer("orbes-3d")) {
        map.addLayer({
          id: "orbes-3d", type: "fill-extrusion", source: "openmaptiles", "source-layer": "building", minzoom: 13,
          layout: { visibility: cb.current.threeD ? "visible" : "none" },
          paint: {
            "fill-extrusion-color": ["interpolate", ["linear"], ["coalesce", ["get", "render_height"], 0], 0, "#151412", 120, "#24221f", 400, "#3a3632"],
            "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, ["coalesce", ["get", "render_height"], 0]],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
            "fill-extrusion-opacity": 0.92,
          },
        });
      }
      // the live route stays above the 3D buildings
      for (const id of ["me-acc", "me-acc-line", "nav-casing", "nav"]) if (map.getLayer(id)) map.moveLayer(id);
    };

    map.on("style.load", () => {
      const isFallback = (map.getStyle().layers?.length || 0) <= 1;
      if (!isFallback) {
        styled = true;
        failed = false;
        window.clearInterval(retry);
        window.clearTimeout(slow);
        cb.current.onBasemapError(false);
        restyle(map);
      }
      try {
        map.setProjection({ type: "globe" });
      } catch {
        /* older GPUs: stay flat */
      }
      addLayers();
      setReady((r) => r + 1);
    });
    map.on("error", (e: maplibregl.ErrorEvent & { sourceId?: string }) => {
      const msg = String(e.error?.message || "");
      if (!styled) {
        fallBack();
        return;
      }
      // basemap source lost after the style loaded: retry when the network comes back (or in 30 s)
      // (only when the tile index itself is missing: one missing tile offline is normal)
      const src = map.getSource("openmaptiles") as { tiles?: string[] } | undefined;
      if (e.sourceId === "openmaptiles" && !src?.tiles?.length && /Failed to fetch|NetworkError|Load failed|timeout|HTTP/i.test(msg) && !tilesFailed) {
        tilesFailed = true;
        window.clearInterval(retry);
        retry = window.setInterval(() => navigator.onLine && tryAgain(), 30_000);
      }
    });
    let longAt = 0; // the click that follows a long press must not close what it opened
    map.on("click", (e: maplibregl.MapMouseEvent) => {
      const t = e.originalEvent.target as HTMLElement;
      if (t.closest(".mk")) return;
      if (performance.now() - longAt < 800) return;
      cb.current.onMapClick([e.lngLat.lng, e.lngLat.lat]);
    });
    // the user moving the map stops "follow me"
    map.on("dragstart", (e: { originalEvent?: Event }) => {
      if (e.originalEvent) cb.current.onUserPan();
    });
    // long press (touch) or right click (mouse) picks a point to measure the distance to
    map.on("contextmenu", (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      if (performance.now() - longAt < 800) return; // already handled by the touch timer (Android)
      longAt = performance.now();
      cb.current.onLongPress([e.lngLat.lng, e.lngLat.lat]);
    });
    let press: number | undefined;
    let start: { x: number; y: number } | null = null;
    const canvas = map.getCanvasContainer();
    const cancel = () => {
      window.clearTimeout(press);
      start = null;
    };
    const tStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || map.isMoving() || (e.target as HTMLElement).closest?.(".mk, .me-pos, .pt-mark")) return cancel();
      const t = e.touches[0];
      const r = canvas.getBoundingClientRect();
      start = { x: t.clientX, y: t.clientY };
      window.clearTimeout(press);
      press = window.setTimeout(() => {
        if (!start) return;
        const ll = map.unproject([start.x - r.left, start.y - r.top]);
        start = null;
        longAt = performance.now();
        navigator.vibrate?.(15);
        cb.current.onLongPress([ll.lng, ll.lat]);
      }, 550);
    };
    const tMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (start && t && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) cancel();
    };
    canvas.addEventListener("touchstart", tStart, { passive: true });
    canvas.addEventListener("touchmove", tMove, { passive: true });
    canvas.addEventListener("touchend", cancel);
    canvas.addEventListener("touchcancel", cancel);
    map.on("movestart", cancel);
    const online = () => tryAgain();
    const vis = () => document.visibilityState === "visible" && tryAgain();
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", vis);
      window.clearInterval(retry);
      window.clearTimeout(slow);
      cancel();
      map.remove();
      mapRef.current = null;
      markers.current.clear();
      pinMarkers.current.clear();
      meMarker.current = null;
      pointMarker.current = null;
    };
  }, []);

  // --- camera insets: keep markers centred in the visible part of the map ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // never stop a running flight: apply the new insets once it ends
    if (map.isMoving()) map.once("moveend", () => map.setPadding(cb.current.padding));
    else map.easeTo({ padding: p.padding, duration: 300 });
  }, [p.padding.top, p.padding.bottom, p.padding.left, p.padding.right]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- place markers (rebuilt when the trip changes) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = (id: string) => `${p.trip.id}:${id}`;
    const keep = new Set(p.places.map((x) => key(x.id)));
    for (const [id, e] of markers.current) if (!keep.has(id)) { e.m.remove(); markers.current.delete(id); }
    const seq = new Map((p.route || []).map((x, i) => [x.id, i + 1]));
    p.places.forEach((place, i) => {
      let entry = markers.current.get(key(place.id));
      if (!entry) {
        // MapLibre moves the outer element with a CSS transform; the visual lives in an inner node.
        const wrap = document.createElement("div");
        const node = document.createElement("div");
        wrap.appendChild(node);
        node.setAttribute("role", "button");
        node.tabIndex = 0;
        node.style.setProperty("--delay", `${Math.min(i * 18, 700)}ms`);
        node.addEventListener("click", (ev) => {
          ev.stopPropagation();
          cb.current.onSelect("place", place.id);
        });
        node.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            cb.current.onSelect("place", place.id);
          }
        });
        const m = new maplibregl.Marker({ element: wrap }).setLngLat([place.lng, place.lat]).addTo(map);
        entry = { m, node };
        markers.current.set(key(place.id), entry);
      }
      entry.m.setLngLat([place.lng, place.lat]);
      const s = p.states[place.id] || {};
      const hotel = place.type === "hotel";
      const sel = p.selected?.kind === "place" && p.selected.id === place.id;
      const st = s.status && s.status !== "todo" ? STATUSES.find((x) => x.key === s.status) : null;
      const vis = p.visibleIds.has(place.id);
      entry.node.className = "mk" + (hotel ? " mk-hotel" : "") + (s.visited && !hotel ? " is-visited" : "") + (sel ? " is-sel" : "") + (vis ? "" : " is-dim");
      entry.node.style.setProperty("--c", p.dayColor(place.day));
      entry.node.setAttribute("aria-label", place.name);
      entry.node.title = place.name;
      const n = seq.get(place.id);
      entry.node.innerHTML =
        `<span>${hotel ? "H" : p.dayGlyph(place.day)}</span>` +
        (n ? `<span class="mk-seq">${n}</span>` : "") +
        (st ? `<span class="mk-st" style="--s:${st.color}"></span>` : "") +
        (s.favorite ? `<span class="mk-fav"><svg viewBox="0 0 24 24"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9L12 2.8Z"/></svg></span>` : "");
      entry.m.getElement().style.zIndex = sel ? "6" : hotel ? "4" : vis ? "3" : "1";
      entry.m.getElement().style.visibility = p.landing ? "hidden" : "";
    });
  }, [p.places, p.states, p.visibleIds, p.selected, p.route, p.landing, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- custom pins ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const keep = new Set(p.pins.map((x) => x.id));
    for (const [id, e] of pinMarkers.current) if (!keep.has(id)) { e.m.remove(); pinMarkers.current.delete(id); }
    for (const pin of p.pins) {
      let e = pinMarkers.current.get(pin.id);
      if (!e) {
        const wrap = document.createElement("div");
        const node = document.createElement("div");
        wrap.appendChild(node);
        node.setAttribute("role", "button");
        node.tabIndex = 0;
        node.addEventListener("click", (ev) => {
          ev.stopPropagation();
          cb.current.onSelect("pin", pin.id);
        });
        node.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            cb.current.onSelect("pin", pin.id);
          }
        });
        const m = new maplibregl.Marker({ element: wrap, anchor: "bottom-left", offset: [-4, 4] }).setLngLat([pin.lng, pin.lat]).addTo(map);
        e = { m, node };
        pinMarkers.current.set(pin.id, e);
      }
      e.m.setLngLat([pin.lng, pin.lat]);
      const sel = p.selected?.kind === "pin" && p.selected.id === pin.id;
      e.node.className = "mk mk-pin" + (sel ? " is-sel" : "");
      e.node.setAttribute("aria-label", pin.name);
      e.node.title = pin.name;
      e.node.innerHTML = "<span>●</span>";
      e.m.getElement().style.visibility = p.landing ? "hidden" : "";
    }
  }, [p.pins, p.selected, p.landing, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- my position: dot, accuracy circle, direction cone ---
  const me = p.me;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const acc = map.getSource("me-acc") as GeoJSONSource | undefined;
    if (!me || p.landing) {
      meMarker.current?.remove();
      meMarker.current = null;
      acc?.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    if (!meMarker.current) {
      const wrap = document.createElement("div");
      wrap.className = "me-pos";
      wrap.innerHTML = '<div class="me-cone"></div><div class="me-dot"></div>';
      meMarker.current = new maplibregl.Marker({ element: wrap }).setLngLat([me.lng, me.lat]).addTo(map);
    } else meMarker.current.setLngLat([me.lng, me.lat]);
    meMarker.current.getElement().classList.toggle("stale", me.stale);
    // accuracy circle (only worth drawing when it is larger than the dot)
    if (acc && !me.stale) {
      const r = Math.min(me.acc || 0, 2000);
      const pts: [number, number][] = [];
      const kx = 111320 * Math.cos((me.lat * Math.PI) / 180);
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        pts.push([me.lng + (Math.cos(a) * r) / kx, me.lat + (Math.sin(a) * r) / 110540]);
      }
      acc.setData(r > 15 ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [pts] } } : { type: "FeatureCollection", features: [] });
    } else acc?.setData({ type: "FeatureCollection", features: [] });
  }, [me?.lng, me?.lat, me?.acc, me?.stale, p.landing, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // direction cone: car course when driving, else the compass. Only the cone's CSS changes (cheap).
  const compass = useLoc((s) => s.compass);
  const heading = me ? (me.course ?? compass) : null;
  const shown = useRef<number | null>(null);
  useEffect(() => {
    const cone = meMarker.current?.getElement().querySelector<HTMLElement>(".me-cone");
    if (!cone) return;
    if (heading == null || me?.stale) {
      cone.style.display = "none";
      return;
    }
    cone.style.display = "";
    // shortest turn (359° → 1° turns 2°, not 358°)
    const last = shown.current ?? heading;
    const d = ((((heading - last) % 360) + 540) % 360) - 180;
    shown.current = last + d;
    cone.style.transform = `rotate(${shown.current}deg)`;
  }, [heading, me?.stale, !!me]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- follow me: keep my position in view as I move (zoom level untouched, little data) ---
  const followed = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !me || !p.follow || p.landing) {
      if (!p.follow) followed.current = false;
      return;
    }
    if (!followed.current) {
      followed.current = true;
      map.flyTo({ center: [me.lng, me.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 900, essential: true });
    } else if (!map.isMoving()) map.easeTo({ center: [me.lng, me.lat], duration: 700 });
  }, [me?.lng, me?.lat, p.follow, p.landing]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- navigation route ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("nav") as GeoJSONSource | undefined;
    if (!src) return;
    src.setData(p.navLine && p.navLine.length > 1 && !p.landing ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: p.navLine } } : { type: "FeatureCollection", features: [] });
    try {
      map.setPaintProperty("nav", "line-dasharray", p.navMode === "walk" ? [0.1, 1.8] : [1, 0]);
      map.setPaintProperty("nav", "line-width", p.navMode === "walk" ? 5 : 4.5);
    } catch {
      /* ignore */
    }
  }, [p.navLine, p.navMode, p.landing, ready]);

  // --- point picked by a long press ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!p.point || p.landing) {
      pointMarker.current?.remove();
      pointMarker.current = null;
      return;
    }
    if (!pointMarker.current) {
      const node = document.createElement("div");
      node.className = "pt-mark";
      pointMarker.current = new maplibregl.Marker({ element: node, anchor: "bottom" }).setLngLat(p.point).addTo(map);
    } else pointMarker.current.setLngLat(p.point);
  }, [p.point, p.landing, ready]);

  // --- day route ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("route") as GeoJSONSource | undefined;
    if (!src) return;
    const h = p.trip.hotel;
    const coords = p.route && p.route.length >= 1 && !p.landing ? [[h.lng, h.lat], ...p.route.map((x) => [x.lng, x.lat])] : [];
    src.setData({ type: "FeatureCollection", features: coords.length ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [] });
    try {
      map.setPaintProperty("route", "line-color", p.routeColor);
      map.setPaintProperty("route-glow", "line-color", p.routeColor);
    } catch {
      /* ignore */
    }
  }, [p.route, p.routeColor, p.trip, p.landing, ready]);

  // --- landing: flight arc Paris → destination, plane moving, globe slowly turning ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const arcSrc = map.getSource("arc") as GeoJSONSource | undefined;
    const planeSrc = map.getSource("plane") as GeoJSONSource | undefined;
    if (!arcSrc || !planeSrc) return;
    const labels = (map.getStyle().layers || []).filter((l) => l.type === "symbol").map((l) => l.id);
    labels.forEach((id) => {
      try {
        map.setPaintProperty(id, "text-opacity", p.landing ? 0 : 1);
      } catch {
        /* ignore */
      }
    });
    if (!p.landing) {
      arcSrc.setData({ type: "FeatureCollection", features: [] });
      planeSrc.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const line = arc(PARIS, p.trip.center);
    arcSrc.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } });
    const mid = line[Math.floor(line.length / 2)];
    map.jumpTo({ center: [mid[0] + 8, mid[1] - 6], zoom: window.innerWidth < 700 ? 1.25 : 1.9, pitch: 0 });
    const handlers = [map.dragPan, map.scrollZoom, map.touchZoomRotate, map.doubleClickZoom, map.keyboard];
    handlers.forEach((h) => h.disable());
    let raf = 0;
    const t0 = performance.now();
    let last = t0;
    let lastPlane = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = (t: number) => {
      if (t - lastPlane > 40) {
        lastPlane = t;
        const f = ((t - t0) / 6000) % 1;
        planeSrc.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: line[Math.floor(f * (line.length - 1))] } });
      }
      if (!reduce && !map.isMoving()) {
        const c = map.getCenter();
        map.setCenter([c.lng + ((t - last) / 1000) * 0.7, c.lat]); // 0.7° per second
      }
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      handlers.forEach((h) => h.enable());
      map.touchZoomRotate.disableRotation();
    };
  }, [p.landing, p.trip, ready]);

  // --- 3D buildings ---
  const prev3D = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("orbes-3d")) return;
    map.setLayoutProperty("orbes-3d", "visibility", p.threeD ? "visible" : "none");
    if (p.threeD !== prev3D.current) {
      prev3D.current = p.threeD;
      map.easeTo({ pitch: p.threeD ? 58 : 0, zoom: p.threeD ? Math.max(map.getZoom(), 15) : map.getZoom(), duration: 900 });
    }
  }, [p.threeD, ready]);

  // --- camera requests ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !p.focus) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 0 : p.focus.duration ?? 1100;
    map.setPadding(p.padding); // final insets, even if a padding animation was running
    if (p.focus.bounds) map.fitBounds(p.focus.bounds, { padding: 48, maxZoom: 14.5, duration, pitch: p.focus.pitch ?? map.getPitch() });
    else if (p.focus.center) map.flyTo({ center: p.focus.center, zoom: p.focus.zoom ?? Math.max(map.getZoom(), 14), duration, essential: true, pitch: p.focus.pitch ?? map.getPitch() });
  }, [p.focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mapRef.current?.getCanvas().style.setProperty("cursor", p.pinMode ? "crosshair" : "");
  }, [p.pinMode]);

  return <div ref={el} className="map" />;
}
