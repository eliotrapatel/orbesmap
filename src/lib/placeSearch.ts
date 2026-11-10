// "Ajouter un lieu" search, kept outside the modal: closing the modal does not lose a 1–2 min web search;
// the result comes back as a toast and when the modal reopens. Results belong to one trip.
import { useSyncExternalStore } from "react";
import type { Trip } from "../data/types";
import { ai, AiError, imageToBase64, type PlaceItem, type PlacesResult } from "./ai";
import { km, toWgs } from "./geo";
import type { Pin, PlaceState } from "./model";
import { getState, toast } from "./store";

export type Found = PlaceItem & {
  ll: [number, number] | null;
  /** approximate position (street only, or found by name): centres the map when placing by hand */
  hint?: [number, number];
  day: string;
  /** probably already on the map (programme place or one of my places): a warning, not a block */
  existing?: { kind: "place" | "pin"; id: string; name: string };
};
type Res = { kind: "precise" | "suggestions"; message: string; items: Found[] };
type State = { busy: boolean; startedAt: number; err: string | null; res: Res | null; picked: number[]; day: string; open: boolean; tripId: string };

const KEY = "orbes.placeSearch.v2";
let state: State = (() => {
  const base: State = { busy: false, startedAt: 0, err: null, res: null, picked: [], day: "ideas", open: false, tripId: "" };
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    return saved?.res ? { ...base, res: saved.res, picked: saved.picked || [], day: saved.day || "ideas", tripId: saved.tripId || "" } : base;
  } catch {
    return base;
  }
})();
const subs = new Set<() => void>();
function set(p: Partial<State>) {
  state = { ...state, ...p };
  try {
    if (state.res) sessionStorage.setItem(KEY, JSON.stringify({ res: state.res, picked: state.picked, day: state.day, tripId: state.tripId }));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  subs.forEach((f) => f());
}
export const placeSearch = {
  get: () => state,
  setOpen: (open: boolean) => set({ open }),
  setDay: (day: string) => set({ day }),
  toggle: (i: number) => set({ picked: state.picked.includes(i) ? state.picked.filter((x) => x !== i) : [...state.picked, i] }),
  reset: () => set({ res: null, err: null, picked: [] }),
  /** remove the places that were saved on the map; the others (to place by hand) stay available */
  removeItems: (names: string[]) => {
    if (!state.res) return;
    const items = state.res.items.filter((i) => !names.includes(i.name));
    set(items.length ? { res: { ...state.res, kind: "suggestions", items }, picked: [] } : { res: null, picked: [] });
  },
};
export function usePlaceSearch(): State {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => state,
  );
}

// ---------- positions ----------
type LL = [number, number];
let lastGeo = 0;
/** OpenStreetMap geocoder, one request per second max (its usage policy). rank: 28+ = number/building, 26–27 = street. */
async function geocode(q: string, box: [number, number, number, number], signal: AbortSignal): Promise<{ ll: LL; rank: number } | null> {
  if (q.trim().length < 2 || signal.aborted) return null;
  const wait = lastGeo + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (signal.aborted) return null;
  lastGeo = Date.now();
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), 6000);
  const onAbort = () => ctl.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    const [w, s, e, n] = box;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh,en&countrycodes=cn&viewbox=${w},${n},${e},${s}&bounded=1&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
    const hit = (await r.json())[0];
    if (!hit) return null;
    const rank = Number(hit.place_rank) || 0;
    if (rank < 26) return null; // a city, district or area is not a place
    return { ll: [+hit.lon, +hit.lat], rank };
  } catch {
    return null;
  } finally {
    window.clearTimeout(t);
    signal.removeEventListener("abort", onAbort);
  }
}

/** Search box: the trip's places (incl. Suzhou day trips) plus a margin, or ~5 km around "near me". */
function boxFor(trip: Trip, near?: { lat: number; lng: number }): [number, number, number, number] {
  if (near) return [near.lng - 0.05, near.lat - 0.05, near.lng + 0.05, near.lat + 0.05];
  const lats = trip.places.map((p) => p.lat);
  const lngs = trip.places.map((p) => p.lng);
  return [Math.min(...lngs) - 0.3, Math.min(...lats) - 0.3, Math.max(...lngs) + 0.3, Math.max(...lats) + 0.3];
}

async function locate(p: PlaceItem, trip: Trip, signal: AbortSignal, near?: { lat: number; lng: number }): Promise<{ ll: LL | null; hint?: LL }> {
  const box = boxFor(trip);
  const inBox = (ll: LL) => ll[0] >= box[0] && ll[0] <= box[2] && ll[1] >= box[1] && ll[1] <= box[3];
  let model: LL | null = null;
  if (p.coordSystem !== "none" && p.lat && p.lng) {
    const w = toWgs(p.lat, p.lng, p.coordSystem);
    if (inBox([w.lng, w.lat])) model = [w.lng, w.lat];
  }
  const addr = p.addressCn ? await geocode(p.addressCn, box, signal) : null;
  // an exact address (number / building) wins over doubtful coordinates (often mislabelled as WGS-84)
  if (addr && addr.rank >= 28 && (!model || km({ lat: model[1], lng: model[0] }, { lat: addr.ll[1], lng: addr.ll[0] }) > 0.25)) return { ll: addr.ll };
  if (model) return { ll: model };
  if (addr) return { ll: null, hint: addr.ll }; // street only
  // by name only: chains have many branches, so this is just a hint, the user places the pin
  if (p.nameCn) {
    const byName = await geocode(p.nameCn, near ? boxFor(trip, near) : box, signal);
    if (byName) return { ll: null, hint: byName.ll };
  }
  return { ll: null };
}

// ---------- duplicates ----------
const strip = (s: string) => (s || "").replace(/[（(].*?[)）]/g, "").toLowerCase().replace(/[\s'’"«»·.,\-–—&/]/g, "").replace(/^上海市?/, "");
/** Same name: equal, or one contains the other and is at least 60 % of it (no short generic names) */
function sameName(a: string, b: string): boolean {
  const x = strip(a);
  const y = strip(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const cjk = /[一-鿿]/.test(x + y);
  const min = cjk ? 2 : 4;
  if (x.length < min || y.length < min) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return l.includes(s) && s.length / l.length >= 0.6;
}
export function findExisting(f: Found, trip: Trip, pins: Pin[], states: Record<string, PlaceState>): Found["existing"] {
  const near = (o: { lat: number; lng: number }, m: number) => !!f.ll && km({ lat: f.ll[1], lng: f.ll[0] }, o) < m;
  const sameAddr = (a?: string) => !!a && !!f.addressCn && strip(a).length >= 6 && strip(a) === strip(f.addressCn);
  for (const p of trip.places) {
    if (sameName(f.name, p.name) || sameName(f.nameCn, p.name) || sameAddr(p.cn) || ((sameName(f.name, p.name) || sameName(f.nameCn, p.name)) && near(p, 0.15)))
      return { kind: "place", id: p.id, name: p.name };
  }
  for (const p of pins) {
    const x = (states[`_pin:${p.id}`] || {}) as Record<string, string>;
    if (sameName(f.name, p.name) || (!!x.nameCn && sameName(f.nameCn, x.nameCn)) || sameAddr(x.addressCn)) return { kind: "pin", id: p.id, name: p.name };
  }
  return undefined;
}

let ctl: AbortController | null = null;

export async function runPlaceSearch(opts: { trip: Trip; pins: Pin[]; text: string; shot: File | null; near?: { lat: number; lng: number } }) {
  if (state.busy) return;
  ctl = new AbortController();
  const signal = ctl.signal;
  let wentHidden = false;
  const onVis = () => {
    if (document.visibilityState === "hidden") wentHidden = true;
  };
  document.addEventListener("visibilitychange", onVis);
  set({ busy: true, startedAt: Date.now(), err: null, res: null, picked: [], tripId: opts.trip.id });
  try {
    const url = opts.text.match(/https?:\/\/\S+/)?.[0] || "";
    const rest = url ? opts.text.replace(url, "").trim() : opts.text.trim();
    const image = opts.shot ? await imageToBase64(opts.shot, 1600, 0.8) : undefined;
    if (signal.aborted) throw new AiError("Recherche arrêtée.");
    const known = [...opts.trip.places.filter((p) => p.type !== "transport" && p.type !== "hotel").map((p) => p.name), ...opts.pins.map((p) => p.name)];
    const near = opts.near ? { lat: opts.near.lat, lng: opts.near.lng, label: "ma position actuelle" } : undefined;
    const r = await ai<PlacesResult>("place", { url, text: rest, image, near, known }, 290_000, signal);
    const places = (r.places || []).filter((p) => p.name || p.nameCn).slice(0, 6);
    if (!places.length) throw new AiError(r.message || "Rien trouvé. Ajoutez des détails, un nom précis ou une capture d'écran.");
    const items: Found[] = [];
    for (const p of places) {
      if (signal.aborted) throw new AiError("Recherche arrêtée.");
      items.push({ ...p, ...(await locate(p, opts.trip, signal, opts.near)), day: state.day });
    }
    if (signal.aborted) throw new AiError("Recherche arrêtée.");
    // the user switched trip meanwhile: these places belong to another trip
    if (getState().tripId !== opts.trip.id) {
      set({ busy: false, res: null });
      return;
    }
    const states = getState().data.places;
    const pins = getState().data.pins;
    for (const f of items) f.existing = findExisting(f, opts.trip, pins, states);
    const kind = r.kind === "precise" && items.length === 1 ? "precise" : "suggestions";
    set({ busy: false, res: { kind, message: r.message, items }, picked: kind === "precise" && !items[0].existing ? [0] : [] });
    if (!state.open) toast(kind === "precise" ? `« ${items[0].name} » trouvé : touchez le bouton lien pour l'ajouter` : `${items.length} propositions prêtes : touchez le bouton lien`);
  } catch (e) {
    let msg = e instanceof AiError ? e.message : "La recherche a échoué. Réessayez.";
    if (wentHidden && !signal.aborted && !(e instanceof AiError && /introuvable|Rien trouvé|Connectez/.test(msg)))
      msg = "La recherche a été coupée quand l'écran s'est verrouillé ou que vous avez changé d'app. Relancez-la et gardez l'app ouverte (vous pouvez fermer cette fenêtre).";
    set({ busy: false, err: signal.aborted ? null : msg });
    if (!state.open && !signal.aborted) toast(`Ajout de lieu : ${msg}`);
  } finally {
    document.removeEventListener("visibilitychange", onVis);
    ctl = null;
  }
}

export function stopPlaceSearch() {
  ctl?.abort();
}
