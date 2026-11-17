// "Compléter la fiche": the AI writes the full sheet of a place added to the map (description, highlights,
// tip, metro, website, structured opening hours, visit length), in the programme's format. Runs outside the
// sheet: closing the sheet or opening another place does not stop it; the result is saved in the place's
// shared record (synced to the other phone) and announced by a toast.
import { useSyncExternalStore } from "react";
import { TRIP_BY_ID } from "../data/trip";
import { ai, AiError, type EnrichResult } from "./ai";
import { pinPlaceId } from "./live";
import { getState, toast, updateRecord } from "./store";

type One = { busy: boolean; startedAt: number; err: string | null };
const jobs = new Map<string, One>();
const subs = new Set<() => void>();
const IDLE: One = { busy: false, startedAt: 0, err: null };

function set(pinId: string, v: One) {
  jobs.set(pinId, v);
  subs.forEach((f) => f());
}

export function useEnrich(pinId: string | null): One {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => (pinId ? jobs.get(pinId) || IDLE : IDLE),
  );
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// one sheet at a time: adding several places queues their sheets instead of starting parallel web searches
let chain: Promise<void> = Promise.resolve();

/**
 * Writes the full sheet of an added place. `auto` (right after adding a place): only when online and signed in
 * with access, silently skipped otherwise (the "Compléter la fiche" button stays on the sheet).
 */
export function enrichPin(pinId: string, auto = false): Promise<void> {
  if (jobs.get(pinId)?.busy) return chain;
  const st = getState();
  if (auto && (!navigator.onLine || !st.session || !st.member)) return chain;
  // queued: busy with no start time yet ("En attente…")
  set(pinId, { busy: true, startedAt: 0, err: null });
  chain = chain.then(() => run(pinId));
  return chain;
}

async function run(pinId: string): Promise<void> {
  const st = getState();
  const tripId = st.tripId;
  const pin = st.data.pins.find((p) => p.id === pinId);
  if (!pin) {
    set(pinId, IDLE);
    return;
  }
  const base = TRIP_BY_ID[tripId];
  const id = pinPlaceId(pinId);
  const x = (st.data.places[id] || {}) as Record<string, unknown>;
  set(pinId, { busy: true, startedAt: Date.now(), err: null });
  try {
    const r = await ai<EnrichResult>(
      "enrich",
      {
        place: { name: pin.name, nameCn: s(x.nameCn), address: s(x.address), addressCn: s(x.addressCn), lat: pin.lat, lng: pin.lng, type: s(x.type), desc: s(x.desc), why: s(x.why), hours: s(x.hours), source: s(x.source), note: s(pin.note) },
        trip: { title: base?.title || "", dates: base?.dateLabel || "" },
      },
      290_000,
    );
    const now = getState();
    // the trip changed or the place was deleted meanwhile: nothing to save
    if (now.tripId !== tripId || !now.data.pins.some((p) => p.id === pinId)) {
      set(pinId, IDLE);
      return;
    }
    const cur = (now.data.places[id] || {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { enrichedAt: Date.now(), enrichConfidence: r.confidence };
    // the sheet's text: the new, fuller version replaces the short one
    if (s(r.desc)) patch.desc = s(r.desc);
    const hl = (r.highlights || []).map(s).filter(Boolean).slice(0, 5);
    if (hl.length) patch.highlights = hl;
    if (s(r.tip)) patch.tip = s(r.tip);
    if (s(r.metro)) patch.metro = s(r.metro);
    if (/^https?:\/\//.test(s(r.website))) patch.website = s(r.website);
    const dur = Number(r.durationMin);
    if (Number.isFinite(dur) && dur >= 10 && dur <= 600) patch.duration = Math.round(dur);
    const h = r.hours;
    if (h && (h.always || s(h.open) || (h.closed || []).length || (h.byDay || []).length || s(h.reservation) || s(h.note))) patch.hoursData = h;
    // what was already found (and checked) for this place is kept; only empty fields are filled.
    // An unsure match never gets an address: it would be shown to a driver while the point is elsewhere.
    const sure = r.confidence !== "faible";
    for (const [k, v] of [["nameCn", r.nameCn], ["address", r.address], ["addressCn", r.addressCn], ["price", r.price]] as const) {
      if (!s(cur[k]) && s(v) && (sure || k === "price")) patch[k] = s(v);
    }
    if (!s(cur.source) && /^https?:\/\//.test(s(r.source))) patch.source = s(r.source);
    // "autre" = no better kind found: the current one is kept
    if ((!s(cur.type) || cur.type === "ajout") && s(r.type) && r.type !== "autre") patch.type = s(r.type);
    updateRecord(id, patch);
    set(pinId, IDLE);
    toast(`Fiche de « ${pin.name} » complétée`);
  } catch (e) {
    const msg = e instanceof AiError ? e.message : "La fiche n'a pas pu être complétée. Réessayez.";
    set(pinId, { busy: false, startedAt: 0, err: msg });
    toast(`Fiche de « ${pin.name} » : ${msg}`);
  }
}
