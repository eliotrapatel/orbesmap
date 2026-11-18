// Preparing a new trip with the AI, day by day: the trame (outline), the essentials of the destination, then
// one research per day (real places, checked, with their time slots). Each step is saved in the trip's record
// ("draft"), so a closed app picks up where it stopped. One request at a time (the AI is capped per account).
import { useSyncExternalStore } from "react";
import type { Trip } from "../data/types";
import { TYPE_LABEL } from "../data/trip";
import { ai, AiError, type DayResult, type EssentialsResult, type FixedItem, type OutlineResult } from "./ai";
import { km, toWgs } from "./geo";
import { geocode } from "./placeSearch";
import { slotText } from "./slots";
import { createPlace, currentTrip, getState, updateDef, updateTrip } from "./store";

/** What the creation wizard collected, kept in the trip's record */
export type Draft = {
  status: "preparing" | "review" | "done";
  cities: { name: string; lat: number; lng: number; country?: string }[];
  hotelText?: string;
  flightsText?: string;
  pace: string;
  interests: string[];
  wishes: string[];
  dayWishes: Record<string, string>;
  places: { name: string; city: string; why: string; mustSee: boolean; source: string }[];
  fixed: FixedItem[];
  outline?: OutlineResult["days"];
  essentials?: boolean;
  days?: Record<string, "done" | "error">;
  error?: string;
};

type Run = { tripId: string; busy: boolean; step: string; found: number; placed: number; err: string | null };
let run: Run = { tripId: "", busy: false, step: "", found: 0, placed: 0, err: null };
const subs = new Set<() => void>();
const setRun = (p: Partial<Run>) => {
  run = { ...run, ...p };
  subs.forEach((f) => f());
};
export function useDraftRun(): Run {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => run,
  );
}

export const draftOf = (tripId: string): Draft | undefined => getState().trips[tripId]?.draft as Draft | undefined;
const saveDraft = (tripId: string, patch: Partial<Draft>) => {
  const cur = draftOf(tripId);
  if (cur) updateTrip(tripId, { draft: { ...cur, ...patch } });
};

const PACE: Record<string, string> = { relaxed: "tranquille", balanced: "équilibré", packed: "dense" };
const hm = (s: string) => {
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : null;
};
const fixedLine = (f: FixedItem) => [f.name, f.date, f.time && `${f.time}${f.endTime ? `–${f.endTime}` : ""}`, f.address, f.notes].filter(Boolean).join(" · ");

/** The plan the creation tasks read (who, where, when, what was said) */
function planOf(trip: Trip, d: Draft) {
  return {
    cities: d.cities.map((c) => c.name).join(", "),
    hotel: d.hotelText || trip.hotel.name,
    flights: d.flightsText || trip.flights.map((f) => `${f.code} ${f.from}→${f.to} départ ${f.departAt || f.at} arrivée ${f.arriveAt || f.at}`).join(" ; "),
    pace: PACE[d.pace] || d.pace,
    interests: d.interests.join(", "),
    wishes: d.wishes.join(" ; "),
    dayWishes: Object.entries(d.dayWishes).filter(([, v]) => v.trim()).map(([k, v]) => `${k} : ${v}`).join(" ; "),
  };
}

/** Where a found place is: its own coordinates if credible (near the trip), else its address */
async function position(p: DayResult["places"][number], trip: Trip, signal: AbortSignal): Promise<[number, number] | null> {
  const near = (ll: { lat: number; lng: number }) => km(ll, { lat: trip.center[1], lng: trip.center[0] }) < 250;
  if (p.coordSystem !== "none" && p.lat && p.lng) {
    const w = toWgs(p.lat, p.lng, p.coordSystem);
    if (near(w)) return [w.lng, w.lat];
  }
  const box: [number, number, number, number] = [trip.center[0] - 2.5, trip.center[1] - 2.5, trip.center[0] + 2.5, trip.center[1] + 2.5];
  for (const q of [p.addressCn, p.address, p.nameCn && `${p.nameCn}`, `${p.name} ${trip.title}`]) {
    if (!q) continue;
    const g = await geocode(q, box, signal, trip.country || "");
    if (g) return g.ll;
  }
  return null;
}

let ctl: AbortController | null = null;

/** Prepares (or resumes) the trip: outline, essentials, then each day not done yet */
export async function prepare(tripId: string): Promise<void> {
  if (run.busy) return;
  const d0 = draftOf(tripId);
  if (!d0 || d0.status !== "preparing") return;
  ctl = new AbortController();
  const signal = ctl.signal;
  setRun({ tripId, busy: true, step: "Trame du voyage", err: null, found: 0, placed: 0 });
  try {
    let trip = currentTrip();
    if (trip.id !== tripId) throw new AiError("Ouvrez ce voyage pour continuer sa préparation.");
    const days = trip.days.filter((x) => x.scheduled && x.dates?.length);
    // 1. the trame: themes, areas, which of the traveller's places on which day
    let d = draftOf(tripId)!;
    if (!d.outline) {
      const r = await ai<OutlineResult>("outline", {
        plan: planOf(trip, d),
        days: days.map((x) => `${x.dates![0]} (${x.short})`).join(", "),
        places: d.places.map((p) => `${p.name}${p.city ? ` (${p.city})` : ""}${p.mustSee ? " [incontournable]" : ""}${p.why ? ` : ${p.why}` : ""}`).join(" ; "),
        fixed: d.fixed.map(fixedLine).join(" ; "),
      }, 100_000, signal);
      saveDraft(tripId, { outline: r.days || [] });
      // the days get their themes
      const themes = new Map((r.days || []).map((x) => [x.date, x.theme]));
      updateTrip(tripId, { days: trip.days.map((x) => (x.dates?.[0] && themes.get(x.dates[0]) ? { ...x, theme: themes.get(x.dates[0]) } : x)) });
    }
    // 2. the essentials of the destination (language, checklist, phrases, emergency, practical)
    d = draftOf(tripId)!;
    if (!d.essentials) {
      setRun({ step: "L'essentiel pratique" });
      try {
        const e = await ai<EssentialsResult>("essentials", { plan: planOf(trip, d), country: d.cities[0]?.country || "" }, 290_000, signal);
        const consulate = e.consulate?.name ? { name: e.consulate.name, address: e.consulate.address, cn: "", lat: trip.center[1], lng: trip.center[0], phone: e.consulate.phone, emergency: e.consulate.emergency, hours: "", website: e.consulate.website } : undefined;
        updateTrip(tripId, {
          lang: e.lang?.code ? e.lang : undefined,
          checklist: (e.checklist || []).map((c, i) => ({ id: `c${i + 1}`, text: c.text, due: c.due || undefined, group: c.group || undefined })),
          phrases: (e.phrases || []).map((g) => ({ title: g.title, items: g.items.map((x) => ({ zh: x.local, pinyin: x.romanized, fr: x.fr })) })),
          practical: e.practical || [],
          emergency: consulate ? { numbers: e.emergency || [], consulate, hospitals: [] } : undefined,
        });
      } catch (err) {
        if (signal.aborted) throw err;
        // not blocking: the programme matters more; the essentials can be asked again from the trip
      }
      saveDraft(tripId, { essentials: true });
    }
    // 3. day by day
    trip = currentTrip();
    const used = () => currentTrip().places.map((p) => p.name).join(", ");
    for (const day of days) {
      d = draftOf(tripId)!;
      const date = day.dates![0];
      if (d.days?.[date] === "done") continue;
      setRun({ step: `${day.short} · ${d.outline?.find((o) => o.date === date)?.theme || day.title}` });
      const o = d.outline?.find((x) => x.date === date);
      const fixedToday = d.fixed.filter((f) => f.date === date);
      const lines = [
        `Date : ${date} (${day.short})`,
        o?.theme && `Thème : ${o.theme}`,
        o?.area && `Quartiers : ${o.area}`,
        o?.include?.length ? `Lieux à placer : ${o.include.join(" ; ")}` : "",
        fixedToday.length ? `Fixe ce jour : ${fixedToday.map(fixedLine).join(" ; ")}` : "",
        d.dayWishes[date] ? `Souhait du voyageur pour ce jour : ${d.dayWishes[date]}` : "",
        day.theme === "Arrivée" || days[0] === day ? "Jour d'arrivée : journée légère, après l'arrivée du vol et le passage à l'hôtel." : "",
        days[days.length - 1] === day ? "Jour du départ : terminer à temps pour l'aéroport." : "",
      ].filter(Boolean).join("\n");
      try {
        const r = await ai<DayResult>("day", { plan: planOf(trip, d), day: lines, used: used() }, 290_000, signal);
        setRun({ found: run.found + (r.places || []).length });
        for (const p of r.places || []) {
          if (signal.aborted) break;
          if (!p.name) continue;
          const ll = await position(p, currentTrip(), signal);
          if (!ll) continue;
          const s = hm(p.start);
          const e = hm(p.end);
          const type = p.type in TYPE_LABEL ? p.type : "lifestyle";
          createPlace({
            name: p.name, nameCn: p.nameCn, address: p.address, addressCn: p.addressCn, lng: ll[0], lat: ll[1], type, day: day.key,
            slot: s != null && e != null && e > s ? slotText(s, e) : s != null ? slotText(s, s + 60) : "",
            duration: s != null && e != null && e > s ? e - s : undefined,
            desc: p.desc, why: p.why, tip: p.tip, metro: p.metro, website: /^https?:\/\//.test(p.website) ? p.website : "", source: /^https?:\/\//.test(p.source) ? p.source : "",
            fromDraft: date, enrichConfidence: p.confidence,
          });
          setRun({ placed: run.placed + 1 });
        }
        if (r.theme) updateTrip(tripId, { days: currentTrip().days.map((x) => (x.key === day.key && !x.theme ? { ...x, theme: r.theme } : x)) });
        saveDraft(tripId, { days: { ...(draftOf(tripId)?.days || {}), [date]: "done" } });
      } catch (err) {
        if (signal.aborted) throw err;
        saveDraft(tripId, { days: { ...(draftOf(tripId)?.days || {}), [date]: "error" } });
        // a daily limit or the network: stop here, the rest resumes later
        if (err instanceof AiError && /Limite du jour|réseau|Connectez/i.test(err.message)) throw err;
      }
    }
    const left = days.filter((x) => draftOf(tripId)?.days?.[x.dates![0]] !== "done");
    saveDraft(tripId, { status: left.length ? "preparing" : "review", error: left.length ? "Certains jours n'ont pas pu être préparés." : undefined });
    setRun({ busy: false, step: "" });
  } catch (e) {
    const msg = e instanceof AiError ? e.message : "La préparation s'est arrêtée. Elle reprendra à la prochaine ouverture.";
    if (!signal.aborted) saveDraft(tripId, { error: msg });
    setRun({ busy: false, step: "", err: signal.aborted ? null : msg });
  } finally {
    ctl = null;
  }
}

export function stopPrepare() {
  ctl?.abort();
}

/** Prepares one day again: its places from the preparation are removed, then the day is researched again */
export async function regenerateDay(tripId: string, date: string) {
  for (const p of currentTrip().places) if (getState().data.defs[p.id]?.fromDraft === date) updateDef(p.id, { deleted: true });
  const d = draftOf(tripId);
  if (!d) return;
  const days = { ...(d.days || {}) };
  delete days[date];
  updateTrip(tripId, { draft: { ...d, days, status: "preparing", error: undefined } });
  await prepare(tripId);
  // back to the review once the day is done
  const after = draftOf(tripId);
  if (after && after.status === "review") return;
}

/** The trip is confirmed: the preparation screens close, the trip opens */
export function confirmTrip(tripId: string) {
  saveDraft(tripId, { status: "done" });
}

/** "Ajuster en une phrase": the AI says what to change, the app applies it; returns what changed */
export async function adjustProgramme(request: string): Promise<string> {
  const trip = currentTrip();
  const days = trip.days.filter((x) => x.scheduled && x.dates?.length);
  const programme = days
    .map((x) => `${x.dates![0]} (${x.short}${x.theme ? ` · ${x.theme}` : ""}) : ${trip.places.filter((p) => p.day === x.key).map((p) => `${p.time ? `${p.time} ` : ""}${p.name}`).join(" ; ") || "rien"}`)
    .join("\n");
  const r = await ai<import("./ai").AdjustResult>("adjust", { programme, request }, 100_000);
  const keyOf = (date: string) => days.find((x) => x.dates![0] === date)?.key;
  const find = (date: string, name: string) => {
    const k = keyOf(date);
    const n = name.trim().toLowerCase();
    return trip.places.find((p) => (!k || p.day === k) && (p.name.toLowerCase() === n || p.name.toLowerCase().includes(n) || n.includes(p.name.toLowerCase())));
  };
  const slot = (s: string, e: string) => {
    const a = hm(s);
    const b = hm(e);
    return a != null && b != null && b > a ? slotText(a, b) : a != null ? slotText(a, a + 60) : null;
  };
  let applied = 0;
  for (const c of r.changes || []) {
    if (c.action === "add") {
      const k = keyOf(c.day);
      if (!k || !c.query) continue;
      try {
        const f = await ai<import("./ai").PlacesResult>("place", { text: c.query, known: trip.places.map((p) => p.name) }, 290_000);
        const p = f.places?.[0];
        if (!p) continue;
        const ll = await position({ ...p, start: c.start, end: c.end, desc: p.desc, why: c.why || p.why, tip: "", metro: "", website: "", fixed: false } as unknown as DayResult["places"][number], trip, new AbortController().signal);
        if (!ll) continue;
        createPlace({ name: p.name, nameCn: p.nameCn, address: p.address, addressCn: p.addressCn, lng: ll[0], lat: ll[1], type: p.type in TYPE_LABEL ? p.type : "lifestyle", day: k, slot: slot(c.start, c.end) || "", desc: p.desc, why: c.why || p.why, source: p.source });
        applied++;
      } catch {
        /* one addition failing does not stop the others */
      }
      continue;
    }
    const p = find(c.day, c.name);
    if (!p || p.type === "hotel") continue;
    if (c.action === "remove") updateDef(p.id, { removed: true });
    else if (c.action === "move") {
      const k = keyOf(c.toDay);
      if (!k) continue;
      updateDef(p.id, { day: k, slot: slot(c.start, c.end) ?? "" });
    } else if (c.action === "retime") {
      const s = slot(c.start, c.end);
      if (!s) continue;
      updateDef(p.id, { slot: s });
    }
    applied++;
  }
  return applied ? r.message || "Programme ajusté." : "Rien n'a changé : précisez la demande (jour, lieu, heure).";
}
