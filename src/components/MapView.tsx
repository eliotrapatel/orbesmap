import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { LngLatLike, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// The app ships as one HTML file, so the map's background worker is inlined and served from a Blob.
import workerSource from "maplibre-gl/dist/maplibre-gl-worker.mjs?raw";
import { DAY_BY_KEY, STATUSES, TRIP } from "../data/trip";
import type { Place } from "../data/types";
import type { Pin, PlaceState } from "../lib/model";

maplibregl.setWorkerUrl(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));

// Free vector basemap, no API key. Restyled below to the ORBES steel palette.
const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#e4e6e7" } }],
};

export interface FocusRequest {
  /** change to re-trigger */
  n: number;
  center?: [number, number];
  zoom?: number;
  bounds?: [[number, number], [number, number]];
}

interface Props {
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
    if (layer.type === "background") set(id, "background-color", "#e4e6e7");
    else if (id.includes("water") && layer.type === "fill") set(id, "fill-color", "#c9d1d6");
    else if (id.includes("water") && layer.type === "line") set(id, "line-color", "#c9d1d6");
    else if ((id.includes("park") || id.includes("landcover") || id.includes("landuse")) && layer.type === "fill") set(id, "fill-color", "#dadedf");
    else if (id.includes("building") && layer.type === "fill") set(id, "fill-color", "#d6d9db");
    else if (layer.type === "line" && /road|highway|street|tunnel|bridge/.test(id)) set(id, "line-color", id.includes("casing") ? "#d4d7d9" : "#f7f8f8");
    else if (layer.type === "line" && /rail|transit/.test(id)) set(id, "line-color", "#c3c7ca");
    if (layer.type === "symbol") {
      set(id, "text-color", id.includes("water") ? "#7f8b93" : "#5b6167");
      set(id, "text-halo-color", "rgba(246,247,247,0.9)");
    }
  }
}

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { m: maplibregl.Marker; node: HTMLDivElement }>());
  const pinMarkers = useRef(new Map<string, { m: maplibregl.Marker; node: HTMLDivElement }>());
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const cb = useRef(p);
  cb.current = p;
  const [ready, setReady] = useState(false);

  // --- create map once ---
  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current!,
      style: STYLE_URL,
      center: TRIP.center,
      zoom: 11.6,
      minZoom: 8,
      maxZoom: 18.5,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      cooperativeGestures: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
    mapRef.current = map;

    let styled = false;
    const fail = window.setTimeout(() => {
      if (!styled) {
        map.setStyle(FALLBACK_STYLE);
        cb.current.onBasemapError(true);
      }
    }, 9000);

    const addRouteLayer = () => {
      if (map.getSource("route")) return;
      map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#000", "line-width": 2, "line-dasharray": [1, 2.2], "line-opacity": 0.75 } });
    };
    map.on("style.load", () => {
      if (map.getStyle().layers?.length !== 1) {
        styled = true;
        window.clearTimeout(fail);
        cb.current.onBasemapError(false);
        restyle(map);
      }
      addRouteLayer();
      setReady(true);
    });
    map.on("error", (e: maplibregl.ErrorEvent) => {
      // a style that cannot be fetched (offline, blocked network) → keep markers visible on a plain background
      if (!styled && /style|Failed to fetch|NetworkError/i.test(String(e.error?.message || ""))) {
        window.clearTimeout(fail);
        map.setStyle(FALLBACK_STYLE);
        cb.current.onBasemapError(true);
      }
    });
    map.on("click", (e: maplibregl.MapMouseEvent) => {
      const t = e.originalEvent.target as HTMLElement;
      if (t.closest(".mk")) return;
      cb.current.onMapClick([e.lngLat.lng, e.lngLat.lat]);
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      window.clearTimeout(fail);
      map.remove();
      mapRef.current = null;
      markers.current.clear();
      pinMarkers.current.clear();
      meMarker.current = null;
      setReady(false);
    };
  }, []);

  // --- place markers ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const place of p.places) {
      let entry = markers.current.get(place.id);
      if (!entry) {
        // MapLibre moves the outer element with a CSS transform; the visual lives in an inner node.
        const wrap = document.createElement("div");
        const node = document.createElement("div");
        wrap.appendChild(node);
        node.setAttribute("role", "button");
        node.setAttribute("aria-label", place.name);
        node.tabIndex = 0;
        node.addEventListener("click", (ev) => {
          ev.stopPropagation();
          cb.current.onSelect("place", place.id);
        });
        node.addEventListener("keydown", (ev) => {
          if (ev.key === "Enter") cb.current.onSelect("place", place.id);
        });
        const m = new maplibregl.Marker({ element: wrap }).setLngLat([place.lng, place.lat]).addTo(map);
        entry = { m, node };
        markers.current.set(place.id, entry);
      }
      const s = p.states[place.id] || {};
      const day = DAY_BY_KEY[place.day];
      const sel = p.selected?.kind === "place" && p.selected.id === place.id;
      const st = s.status && s.status !== "todo" ? STATUSES.find((x) => x.key === s.status) : null;
      entry.node.className = "mk" + (s.visited ? " is-visited" : "") + (sel ? " is-sel" : "") + (p.visibleIds.has(place.id) ? "" : " is-dim");
      entry.node.style.setProperty("--c", day.color);
      entry.node.innerHTML =
        `<span>${day.glyph}</span>` +
        (st ? `<span class="mk-st" style="--s:${st.color}"></span>` : "") +
        (s.favorite ? `<span class="mk-fav"><svg viewBox="0 0 24 24"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9L12 2.8Z"/></svg></span>` : "");
      entry.node.title = place.name;
      entry.m.getElement().style.zIndex = sel ? "5" : p.visibleIds.has(place.id) ? "2" : "1";
    }
  }, [p.places, p.states, p.visibleIds, p.selected, ready]);

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
        const m = new maplibregl.Marker({ element: wrap, anchor: "bottom-left", offset: [-4, 4] }).setLngLat([pin.lng, pin.lat]).addTo(map);
        e = { m, node };
        pinMarkers.current.set(pin.id, e);
      }
      e.m.setLngLat([pin.lng, pin.lat]);
      const sel = p.selected?.kind === "pin" && p.selected.id === pin.id;
      const node = e.node;
      node.className = "mk mk-pin" + (sel ? " is-sel" : "");
      node.setAttribute("aria-label", pin.name);
      node.title = pin.name;
      node.innerHTML = "<span>●</span>";
    }
  }, [p.pins, p.selected, ready]);

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

  // --- route line ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const coords = p.route && p.route.length > 1 ? [[TRIP.hotel.lng, TRIP.hotel.lat], ...p.route.map((x) => [x.lng, x.lat])] : [];
    src.setData({ type: "FeatureCollection", features: coords.length ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [] });
    try {
      map.setPaintProperty("route", "line-color", p.routeColor);
    } catch {
      /* ignore */
    }
  }, [p.route, p.routeColor, ready]);

  // --- camera ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !p.focus) return;
    const padding = { top: p.padding.top + 40, bottom: p.padding.bottom + 40, left: p.padding.left + 40, right: p.padding.right + 40 };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (p.focus.bounds) map.fitBounds(p.focus.bounds, { padding, maxZoom: 14.5, duration: reduce ? 0 : 900 });
    else if (p.focus.center) map.flyTo({ center: p.focus.center as LngLatLike, zoom: p.focus.zoom ?? Math.max(map.getZoom(), 14), padding, duration: reduce ? 0 : 900, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focus?.n]);

  useEffect(() => {
    mapRef.current?.getCanvas().style.setProperty("cursor", p.pinMode ? "crosshair" : "");
  }, [p.pinMode]);

  return <div ref={el} className="map" />;
}
