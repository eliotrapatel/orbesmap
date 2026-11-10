import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// The app ships as one HTML file, so the map's background worker is inlined and served from a Blob.
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";
import { STATUSES } from "../data/trip";
import type { Place, Trip } from "../data/types";
import type { Pin, PlaceState } from "../lib/model";

maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));

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
  me: [number, number] | null;
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
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    let styled = false;
    let failed = false;
    let retry: number | undefined;
    const tryAgain = () => {
      if (!failed) return;
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
    // slow networks: tell the user after 12 s but keep loading
    const slow = window.setTimeout(() => !styled && cb.current.onBasemapError(true), 12_000);

    const addLayers = () => {
      if (!map.getSource("route")) {
        map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({ id: "route-glow", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f6f2ea", "line-width": 8, "line-opacity": 0.08, "line-blur": 4 } });
        map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#f6f2ea", "line-width": 2, "line-dasharray": [1, 2], "line-opacity": 0.9 } });
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
    map.on("error", (e: maplibregl.ErrorEvent) => {
      const msg = String(e.error?.message || "");
      if (!styled && /style|Failed to fetch|NetworkError|Load failed/i.test(msg)) fallBack();
    });
    map.on("click", (e: maplibregl.MapMouseEvent) => {
      const t = e.originalEvent.target as HTMLElement;
      if (t.closest(".mk")) return;
      cb.current.onMapClick([e.lngLat.lng, e.lngLat.lat]);
    });
    const online = () => tryAgain();
    const vis = () => document.visibilityState === "visible" && tryAgain();
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", vis);
      window.clearInterval(retry);
      window.clearTimeout(slow);
      map.remove();
      mapRef.current = null;
      markers.current.clear();
      pinMarkers.current.clear();
      meMarker.current = null;
    };
  }, []);

  // --- camera insets: keep markers centred in the visible part of the map ---
  useEffect(() => {
    mapRef.current?.setPadding(p.padding);
  }, [p.padding.top, p.padding.bottom, p.padding.left, p.padding.right]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- place markers (rebuilt when the trip changes) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const keep = new Set(p.places.map((x) => x.id));
    for (const [id, e] of markers.current) if (!keep.has(id)) { e.m.remove(); markers.current.delete(id); }
    const seq = new Map((p.route || []).map((x, i) => [x.id, i + 1]));
    p.places.forEach((place, i) => {
      let entry = markers.current.get(place.id);
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
        markers.current.set(place.id, entry);
      }
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

  // --- my position ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!p.me) {
      meMarker.current?.remove();
      meMarker.current = null;
      return;
    }
    if (!meMarker.current) {
      const node = document.createElement("div");
      node.className = "me-dot";
      meMarker.current = new maplibregl.Marker({ element: node }).setLngLat(p.me).addTo(map);
    } else meMarker.current.setLngLat(p.me);
  }, [p.me, ready]);

  // --- day route ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("route") as GeoJSONSource | undefined;
    if (!src) return;
    const h = p.trip.hotel;
    const coords = p.route && p.route.length > 1 && !p.landing ? [[h.lng, h.lat], ...p.route.map((x) => [x.lng, x.lat])] : [];
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
    if (!p.landing) {
      arcSrc.setData({ type: "FeatureCollection", features: [] });
      planeSrc.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const line = arc(PARIS, p.trip.center);
    arcSrc.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } });
    const mid = line[Math.floor(line.length / 2)];
    map.jumpTo({ center: [mid[0] + 8, mid[1] - 6], zoom: window.innerWidth < 700 ? 1.25 : 1.9, pitch: 0 });
    let raf = 0;
    const t0 = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = (t: number) => {
      const f = ((t - t0) / 6000) % 1;
      const pt = line[Math.floor(f * (line.length - 1))];
      planeSrc.setData({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: pt } });
      if (!reduce) {
        const c = map.getCenter();
        map.setCenter([c.lng + 0.012, c.lat]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p.landing, p.trip, ready]);

  // --- 3D buildings ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !map.getLayer("orbes-3d")) return;
    map.setLayoutProperty("orbes-3d", "visibility", p.threeD ? "visible" : "none");
    map.easeTo({ pitch: p.threeD ? 58 : 0, zoom: p.threeD ? Math.max(map.getZoom(), 15) : map.getZoom(), duration: 900 });
  }, [p.threeD, ready]);

  // --- camera requests ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !p.focus) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reduce ? 0 : p.focus.duration ?? 1100;
    if (p.focus.bounds) map.fitBounds(p.focus.bounds, { padding: 48, maxZoom: 14.5, duration, pitch: p.focus.pitch ?? map.getPitch() });
    else if (p.focus.center) map.flyTo({ center: p.focus.center, zoom: p.focus.zoom ?? Math.max(map.getZoom(), 14), duration, essential: true, pitch: p.focus.pitch ?? map.getPitch() });
  }, [p.focus?.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mapRef.current?.getCanvas().style.setProperty("cursor", p.pinMode ? "crosshair" : "");
  }, [p.pinMode]);

  return <div ref={el} className="map" />;
}
