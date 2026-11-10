// "Ajouter un lieu" search, kept outside the modal: closing the modal (or the phone locking) does not
// lose a 1–2 min web search; the result comes back as a toast and when the modal reopens.
import { useSyncExternalStore } from "react";
import type { Trip } from "../data/types";
import { ai, AiError, imageToBase64, type PlaceItem, type PlacesResult } from "./ai";
import { km, toWgs } from "./geo";
import type { Pin } from "./model";
import { toast } from "./store";

export type Found = PlaceItem & {
  ll: [number, number] | null;
  /** approximate position (found by name only): used to centre the map when placing by hand */
  hint?: [number, number];
  day: string;
  /** already on the map (programme place or one of my places) */
  existing?: { kind: "place" | "pin"; id: string; name: string };
};
type Res = { kind: "precise" | "suggestions"; message: string; items: Found[] };
type State = { busy: boolean; startedAt: number; err: string | null; res: Res | null; picked: number[]; day: string; open: boolean };

const KEY = "orbes.placeSearch.v1";
let state: State = (() => {
  const base: State = { busy: false, startedAt: 0, err: null, res: null, picked: [], day: "ideas", open: false };
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) || "null");
    return saved?.res ? { ...base, res: saved.res, picked: saved.picked || [], day: saved.day || "ideas" } : base;
  } catch {
    return base;
  }
})();
const subs = new Set<() => void>();
function set(p: Partial<State>) {
  state = { ...state, ...p };
  try {
    if (state.res) sessionStorage.setItem(KEY, JSON.stringify({ res: state.res, picked: state.picked, day: state.day }));
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
let lastGeo = 0;
/** OpenStreetMap geocoder, one request per second max (its usage policy). */
async function geocode(q: string, center: [number, number], span = 0.7): Promise<[number, number] | null> {
  if (q.trim().length < 2) return null;
  const wait = lastGeo + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeo = Date.now();
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), 6000);
  try {
    const vb = `${center[0] - span},${center[1] + span},${center[0] + span},${center[1] - span}`;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh,en&countrycodes=cn&viewbox=${vb}&bounded=1&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
    const hit = (await r.json())[0];
    // a whole city / district is not a place
    if (!hit || ["city", "state", "county", "district", "suburb", "province", "region", "country"].includes(hit.addresstype)) return null;
    return [+hit.lon, +hit.lat];
  } catch {
    return null;
  } finally {
    window.clearTimeout(t);
  }
}

async function locate(p: PlaceItem, trip: Trip, near?: { lat: number; lng: number }): Promise<{ ll: [number, number] | null; hint?: [number, number] }> {
  const far = (ll: [number, number]) => Math.abs(ll[1] - trip.center[1]) > 3 || Math.abs(ll[0] - trip.center[0]) > 3;
  if (p.coordSystem !== "none" && p.lat && p.lng) {
    const w = toWgs(p.lat, p.lng, p.coordSystem);
    const ll: [number, number] = [w.lng, w.lat];
    if (!far(ll)) return { ll };
  }
  const byAddress = await geocode(p.addressCn, trip.center);
  if (byAddress) return { ll: byAddress };
  // by name only: chains have many branches, so this is just a hint, the user places the pin
  if (p.nameCn) {
    const c: [number, number] = near ? [near.lng, near.lat] : trip.center;
    const byName = await geocode(p.nameCn, c, near ? 0.05 : 0.7);
    if (byName) return { ll: null, hint: byName };
  }
  return { ll: null };
}

const norm = (s: string) => s.toLowerCase().replace(/[\s'’"«»·.,()（）\-–—]/g, "");
function findExisting(f: Found, trip: Trip, pins: Pin[]): Found["existing"] {
  const names = [norm(f.name), norm(f.nameCn)].filter((x) => x.length >= 3);
  for (const p of trip.places) {
    const n = norm(p.name);
    if (names.some((x) => n.includes(x) || x.includes(n)) || (f.ll && km({ lat: f.ll[1], lng: f.ll[0] }, p) < 0.06)) return { kind: "place", id: p.id, name: p.name };
  }
  for (const p of pins) {
    const n = norm(p.name);
    if (names.some((x) => n.includes(x) || x.includes(n)) || (f.ll && km({ lat: f.ll[1], lng: f.ll[0] }, p) < 0.06)) return { kind: "pin", id: p.id, name: p.name };
  }
  return undefined;
}

let ctl: AbortController | null = null;

export async function runPlaceSearch(opts: { trip: Trip; pins: Pin[]; text: string; shot: File | null; near?: { lat: number; lng: number } }) {
  if (state.busy) return;
  ctl = new AbortController();
  const signal = ctl.signal;
  set({ busy: true, startedAt: Date.now(), err: null, res: null, picked: [] });
  try {
    const url = opts.text.match(/https?:\/\/\S+/)?.[0] || "";
    const rest = url ? opts.text.replace(url, "").trim() : opts.text.trim();
    const image = opts.shot ? await imageToBase64(opts.shot, 1600, 0.8) : undefined;
    const known = [...opts.trip.places.filter((p) => p.type !== "transport" && p.type !== "hotel").map((p) => p.name), ...opts.pins.map((p) => p.name)];
    const near = opts.near ? { lat: opts.near.lat, lng: opts.near.lng, label: "ma position actuelle" } : undefined;
    const r = await ai<PlacesResult>("place", { url, text: rest, image, near, known }, 290_000, signal);
    const places = (r.places || []).filter((p) => p.name || p.nameCn).slice(0, 6);
    if (!places.length) throw new AiError(r.message || "Rien trouvé. Ajoutez des détails, un nom précis ou une capture d'écran.");
    const items: Found[] = [];
    for (const p of places) {
      const pos = await locate(p, opts.trip, opts.near);
      const f: Found = { ...p, ...pos, day: state.day };
      f.existing = findExisting(f, opts.trip, opts.pins);
      items.push(f);
    }
    const kind = r.kind === "precise" && items.length === 1 ? "precise" : "suggestions";
    const picked = kind === "precise" && !items[0].existing ? [0] : [];
    set({ busy: false, res: { kind, message: r.message, items }, picked });
    if (!state.open) toast(kind === "precise" ? `« ${items[0].name} » trouvé : touchez le bouton lien pour l'ajouter` : `${items.length} propositions prêtes : touchez le bouton lien`);
  } catch (e) {
    const msg = e instanceof AiError ? e.message : "La recherche a échoué. Réessayez.";
    set({ busy: false, err: msg });
    if (!state.open && !signal.aborted) toast(`Ajout de lieu : ${msg}`);
  } finally {
    ctl = null;
  }
}

export function stopPlaceSearch() {
  ctl?.abort();
}
