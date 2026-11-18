// "Mettre à jour la fiche avec l'IA", for every place of the trip: the AI researches the place and writes its
// sheet (description, highlights, tip, metro, website, structured opening hours, visit length). Runs outside the
// sheet (closing it does not stop it), one place at a time; the result goes into the place's record (shared with
// the other phone). The sheet as it was before is kept and can be brought back ("Revenir à la fiche précédente").
import { useSyncExternalStore } from "react";
import { ai, AiError, type EnrichResult } from "./ai";
import { currentTrip, getState, toast, updateDef, programmeLocked, needPro } from "./store";
import { t } from "./i18n";

type One = { busy: boolean; startedAt: number; err: string | null };
const jobs = new Map<string, One>();
const subs = new Set<() => void>();
const IDLE: One = { busy: false, startedAt: 0, err: null };

function set(id: string, v: One) {
  jobs.set(id, v);
  subs.forEach((f) => f());
}

export function useEnrich(id: string | null): One {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => (id ? jobs.get(id) || IDLE : IDLE),
  );
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
/** Fields an AI update rewrites (kept in "prevSheet" so the former version can come back) */
const SHEET = ["desc", "highlights", "tip", "metro", "website", "hours", "duration", "type", "nameCn", "address", "addressCn", "price", "source"] as const;

// one sheet at a time: adding several places queues their sheets instead of starting parallel web searches
let chain: Promise<void> = Promise.resolve();

/**
 * Writes the sheet of a place with the AI. `auto` (right after adding a place): only when online and signed in
 * with access, silently skipped otherwise (the button stays on the sheet).
 */
export function enrichPlace(id: string, auto = false): Promise<void> {
  if (jobs.get(id)?.busy) return chain;
  // a validated trip's sheets are part of its programme: Pro (the screen opens when asked by hand)
  if (auto ? programmeLocked() : needPro()) return chain;
  const st = getState();
  if (auto && (!navigator.onLine || !st.session)) return chain;
  // queued: busy with no start time yet
  set(id, { busy: true, startedAt: 0, err: null });
  chain = chain.then(() => run(id));
  return chain;
}

async function run(id: string): Promise<void> {
  const tripId = getState().tripId;
  const trip = currentTrip();
  const place = trip.places.find((p) => p.id === id);
  if (!place) {
    set(id, IDLE);
    return;
  }
  set(id, { busy: true, startedAt: Date.now(), err: null });
  try {
    const r = await ai<EnrichResult>(
      "enrich",
      {
        place: {
          name: place.name, nameCn: place.nameCn || "", address: place.address, addressCn: place.cn, lat: place.lat, lng: place.lng, type: place.type,
          desc: place.desc, why: place.why || "", hours: place.hoursText || "", source: place.source || place.website || "", note: place.added?.note || "",
        },
        trip: { id: trip.id, title: trip.title, dates: trip.dateLabel },
      },
      290_000,
    );
    // the trip changed or the place was deleted meanwhile: nothing to save
    if (getState().tripId !== tripId || !currentTrip().places.some((p) => p.id === id)) {
      set(id, IDLE);
      return;
    }
    const cur = (getState().data.defs[id] || {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { enrichedAt: Date.now(), enrichConfidence: r.confidence };
    // an unsure match only fills what is empty: it never replaces a sheet that is already written
    const sure = r.confidence !== "faible";
    const empty = (k: string) => {
      const v = cur[k];
      return v == null || v === "" || (Array.isArray(v) && !v.length) || (k === "hours" && typeof v === "object" && !(v as Record<string, unknown>).open && !(v as Record<string, unknown>).always);
    };
    const may = (k: string) => sure || empty(k);
    if (s(r.desc) && may("desc")) patch.desc = s(r.desc);
    const hl = (r.highlights || []).map(s).filter(Boolean).slice(0, 5);
    if (hl.length && may("highlights")) patch.highlights = hl;
    if (s(r.tip) && may("tip")) patch.tip = s(r.tip);
    if (s(r.metro) && may("metro")) patch.metro = s(r.metro);
    if (/^https?:\/\//.test(s(r.website)) && may("website")) patch.website = s(r.website);
    const dur = Number(r.durationMin);
    if (Number.isFinite(dur) && dur >= 10 && dur <= 600 && may("duration")) patch.duration = Math.round(dur);
    const h = r.hours;
    if (h && (h.always || s(h.open) || (h.closed || []).length || (h.byDay || []).length || s(h.reservation) || s(h.note)) && may("hours")) patch.hours = h;
    // what was already found (and checked) is kept; only empty fields are filled.
    // An unsure match never gets an address: it would be shown to a driver while the point is elsewhere.
    for (const [k, v] of [["nameCn", r.nameCn], ["address", r.address], ["addressCn", r.addressCn], ["price", r.price]] as const) {
      if (!s(cur[k]) && s(v) && (sure || k === "price")) patch[k] = s(v);
    }
    if (!s(cur.source) && /^https?:\/\//.test(s(r.source))) patch.source = s(r.source);
    // "autre" = no better kind found: the current one is kept
    if ((!s(cur.type) || cur.type === "ajout") && s(r.type) && r.type !== "autre") patch.type = s(r.type);
    // the sheet as it was, to bring it back if the new one is worse (everything this update wrote)
    const prev: Record<string, unknown> = { at: Date.now() };
    for (const k of SHEET) if (k in patch) prev[k] = cur[k] ?? null;
    if (Object.keys(prev).length > 1) patch.prevSheet = prev;
    const saved = updateDef(id, patch);
    set(id, IDLE);
    if (saved) toast(t("Fiche de « {name} » mise à jour", { name: place.name }));
  } catch (e) {
    const msg = e instanceof AiError ? e.message : t("La fiche n'a pas pu être mise à jour. Réessayez.");
    set(id, { busy: false, startedAt: 0, err: msg });
    toast(t("Fiche de « {name} » : {msg}", { name: place.name, msg }));
  }
}

/** Brings back the sheet as it was before the last AI update */
export function restorePrevSheet(id: string) {
  const prev = (getState().data.defs[id] || {}).prevSheet as Record<string, unknown> | undefined;
  if (!prev) return;
  const patch: Record<string, unknown> = { prevSheet: null };
  for (const k of SHEET) if (k in prev) patch[k] = prev[k];
  if (updateDef(id, patch)) toast(t("Fiche précédente remise"));
}
