// Where a place fits in the programme: for each day, the best free slot given what is already planned that
// day (times, visit lengths, travel between places), the place's opening hours, the kind of place (meals at
// meal times, bars in the evening) and the flights. Runs on the phone: instant, free, works offline.
import type { Day, Place, PlaceType, Trip } from "../data/types";
import { travelMinutes } from "./geo";
import { fmtH, windowFor } from "./hours";
import type { PlaceState } from "./model";
import { dayStops, isHotel, stopTime } from "./plan";
import { localDate, parseTime } from "./time";

type LL = { lat: number; lng: number };

/** Typical visit length (minutes) when nothing better is known */
const TYPE_MIN: Partial<Record<PlaceType, number>> = {
  restaurant: 75, cafe: 30, bar: 60, club: 90, musee: 90, galerie: 45, jardin: 75, landmark: 45, mall: 60,
  fabricant: 60, salon: 120, luxe: 40, concept: 40, mode: 35, montres: 35, bijoux: 35, cuir: 35, textile: 40,
  cashmere: 35, design: 40, lifestyle: 40, tech: 40, packaging: 45, ajout: 45,
};

/** "12h40–13h40 (…)" → { start: 760, end: 820 }; "Dîner 19h40" → { start: 1180, end: null } */
export function rangeOf(text?: string): { start: number; end: number | null } | null {
  const r = text?.match(/(\d{1,2})\s*[h:]\s*(\d{2})?\s*[–—-]\s*(\d{1,2})\s*[h:]\s*(\d{2})?/i);
  if (r) {
    const start = +r[1] * 60 + (r[2] ? +r[2] : 0);
    let end = +r[3] * 60 + (r[4] ? +r[4] : 0);
    if (end <= start) end += 24 * 60;
    if (+r[1] <= 23 && end - start <= 10 * 60) return { start, end };
  }
  const start = parseTime(text);
  return start == null ? null : { start, end: null };
}

/** Visit length of a place: its own suggestion, else its planned slot, else a typical length for its kind */
export function durationOf(p: Place): number {
  const r = rangeOf(p.time);
  // a planned slot gives the length (the one chosen by hand wins); opening hours written as a slot ("11h–19h") do not
  if (r?.end != null && r.end - r.start <= 180) return Math.max(15, r.end - r.start);
  if (p.duration) return p.duration;
  return TYPE_MIN[p.type] ?? 45;
}

/** When a kind of place is worth starting (minutes): meals at meal times, bars and clubs at night */
function startRanges(t: PlaceType): [number, number][] {
  if (t === "restaurant") return [[11 * 60 + 30, 14 * 60], [18 * 60, 21 * 60 + 15]];
  if (t === "cafe") return [[8 * 60 + 30, 17 * 60 + 30]];
  if (t === "bar") return [[16 * 60 + 30, 23 * 60 + 25]];
  // starts stay before midnight: a slot written "0h30" would read as the morning of the same day
  if (t === "club") return [[21 * 60 + 30, 23 * 60 + 55]];
  return [[9 * 60, 21 * 60]];
}
/** Opening window assumed when the hours are unknown */
function guessOpen(t: PlaceType): { open: number; close: number } {
  if (t === "restaurant") return { open: 11 * 60, close: 22 * 60 };
  if (t === "cafe") return { open: 8 * 60, close: 19 * 60 };
  if (t === "bar") return { open: 17 * 60, close: 26 * 60 };
  if (t === "club") return { open: 21 * 60, close: 28 * 60 };
  if (t === "jardin" || t === "landmark") return { open: 8 * 60, close: 18 * 60 };
  return { open: 10 * 60, close: 20 * 60 };
}

/** Minutes after midnight, in the trip's time zone, of an ISO instant; and its local date */
function localMinutes(iso: string, tz: string): { date: string; min: number } {
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const h = +p.find((x) => x.type === "hour")!.value;
  const m = +p.find((x) => x.type === "minute")!.value;
  return { date: localDate(tz, d), min: h * 60 + m };
}

/** Hours of a day that can be planned: 9h–23h30, after landing (+2 h) and before leaving for the airport */
function dayBounds(trip: Trip, day: Day): { from: number; to: number; note?: string } {
  let from = 9 * 60;
  let to = 23 * 60 + 30;
  let note: string | undefined;
  const dates = day.dates || [];
  for (const f of trip.flights) {
    if (f.kind === "arrival") {
      const a = localMinutes(f.arriveAt || f.at, trip.timezone);
      if (dates[0] === a.date) {
        from = Math.max(from, a.min + 120);
        note = "jour d'arrivée";
      }
    } else {
      const d = localMinutes(f.departAt || f.at, trip.timezone);
      if (dates[dates.length - 1] === d.date) {
        to = Math.min(to, d.min - 225);
        note = "jour du départ";
      }
    }
  }
  return { from, to, note };
}

export type Busy = { place: Place; start: number; end: number };

/** What is already planned (with a time) that day, in order, without the place being placed */
export function busyOf(trip: Trip, dayKey: string, states: Record<string, PlaceState>, exclude?: string): Busy[] {
  return dayStops(trip, dayKey, states)
    .filter((p) => p.id !== exclude && !isHotel(trip, p))
    .map((p) => {
      const start = stopTime(p, states);
      if (start == null) return null;
      const r = rangeOf(p.time);
      const end = !states[p.id]?.appt && r && r.start === start && r.end != null ? r.end : start + durationOf(p);
      return { place: p, start, end };
    })
    .filter((b): b is Busy => !!b)
    .sort((a, b) => a.start - b.start);
}

export type DayFit =
  | {
      day: Day;
      ok: true;
      start: number;
      end: number;
      after: string | null;
      before: string | null;
      extra: number;
      guessed: boolean;
      /** full day: minutes this slot overlaps a planned place, and which one (0 = a real free slot) */
      tight: number;
      clash: string | null;
    }
  | { day: Day; ok: false; reason: string };

/** A full day still gets a proposal if it overlaps a planned place by this much at most */
const MAX_TIGHT = 45;

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const ceil5 = (m: number) => Math.ceil(m / 5) * 5;

/** Best slot for `place` on one day (null when the day has no date) */
export function fitDay(trip: Trip, day: Day, place: Place, states: Record<string, PlaceState>, dur = durationOf(place), now = new Date()): DayFit | null {
  const date = day.dates?.[0];
  if (!date || !day.scheduled) return null;
  const today = localDate(trip.timezone, now);
  if ((day.dates?.[day.dates.length - 1] ?? date) < today) return { day, ok: false, reason: "Jour passé" };
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  const h = trip.hours?.[place.id];
  let known = !!h && (h.always || h.byDay.length > 0 || (parseTime(h.open) != null && parseTime(h.close) != null));
  let open = 0;
  let close = 0;
  let lastEntry: number | null = null;
  // a weekly closing day is certain even when the opening times are not
  if (h?.closed.includes(dow)) return { day, ok: false, reason: `Fermé le ${WEEKDAYS[dow]}` };
  const w = known ? windowFor(h!, dow) : null;
  // no time known for this weekday (e.g. hours given for some days only): guessed, not "closed"
  if (known && w === null) known = false;
  if (known && w) {
    if (w === "always") {
      open = 0;
      close = 28 * 60;
    } else {
      open = w.open;
      close = w.close;
    }
    const le = parseTime(h!.lastEntry);
    if (le != null) lastEntry = le < open ? le + 24 * 60 : le;
  }
  if (!known) ({ open, close } = guessOpen(place.type));
  const bounds = dayBounds(trip, day);
  let from = bounds.from;
  // today: not before now + 15 min
  if (day.dates?.includes(today)) {
    const n = localMinutes(now.toISOString(), trip.timezone).min + 15;
    from = Math.max(from, n);
  }
  const breaks = (known ? h!.breaks : []).map((b) => ({ from: parseTime(b.from) ?? 0, to: parseTime(b.to) ?? 0 })).filter((b) => b.to > b.from);
  const busy = busyOf(trip, day.key, states, place.id);
  const hotel: LL = trip.hotel;
  const cands: Extract<DayFit, { ok: true }>[] = [];
  const tight: Extract<DayFit, { ok: true }>[] = [];
  for (let i = 0; i <= busy.length; i++) {
    const prev = i === 0 ? null : busy[i - 1];
    const next = i < busy.length ? busy[i] : null;
    const prevLL: LL = prev ? prev.place : hotel;
    const tin = travelMinutes(prevLL, place);
    const tout = next ? travelMinutes(place, next.place) : 0;
    const earliest = (prev ? prev.end : from) + tin;
    // last place of the day: free until the end of the day (back at the hotel in time on the day of the flight)
    const dayEnd = bounds.note === "jour du départ" ? bounds.to - travelMinutes(place, hotel) : bounds.to + (place.type === "bar" || place.type === "club" ? 120 : 0);
    const latestEnd = Math.min(next ? next.start - tout : dayEnd, close);
    const extra = tin + tout - (next ? travelMinutes(prevLL, next.place) : 0);
    for (const [a, b] of startRanges(place.type)) {
      let s = ceil5(Math.max(earliest, open, a, from));
      // a break in the opening hours: start after it
      for (const br of breaks) if (s < br.to && s + dur > br.from) s = ceil5(br.to);
      // the place itself must be open for the whole visit (and entered before its last entry)
      if (s >= 24 * 60 || s > Math.min(b, close - dur, lastEntry ?? Infinity)) continue;
      const base = { day, ok: true as const, start: s, end: s + dur, after: prev?.place.name ?? null, before: next?.place.name ?? null, extra, guessed: !known };
      if (s + dur <= latestEnd) {
        cands.push({ ...base, tight: 0, clash: null });
        break;
      }
      // no room with the travel time: kept as a "tight" proposal if it overlaps at most one planned place, a little
      const hit = busy.filter((x) => s < x.end && s + dur > x.start);
      const mins = hit.reduce((m, x) => m + Math.min(x.end, s + dur) - Math.max(x.start, s), 0);
      if (next && s < next.start && hit.length <= 1 && mins <= MAX_TIGHT) tight.push({ ...base, tight: Math.max(1, mins), clash: hit[0]?.place.name ?? null });
    }
  }
  if (cands.length) return cands.sort((x, y) => x.extra - y.extra || x.start - y.start)[0];
  if (tight.length) return tight.sort((x, y) => x.tight - y.tight || x.extra - y.extra)[0];
  return { day, ok: false, reason: bounds.note === "jour du départ" ? "Plus de créneau avant le départ" : busy.length ? "Journée pleine" : "Aucun créneau compatible avec les horaires" };
}

/** Every planned day, plus the recommended one (least detour; the place's own day first when tied) */
export function fitAll(trip: Trip, place: Place, states: Record<string, PlaceState>, dur = durationOf(place)): { fits: DayFit[]; best: DayFit | null } {
  const fits = trip.days.map((d) => fitDay(trip, d, place, states, dur)).filter((f): f is DayFit => !!f);
  const ok = fits.filter((f): f is Extract<DayFit, { ok: true }> => f.ok);
  // a real free slot first; among them the least detour; the place's own day first when tied
  const best = ok.sort((a, b) => a.tight - b.tight || a.extra - b.extra || Number(b.day.key === place.day) - Number(a.day.key === place.day))[0] || null;
  return { fits, best };
}

/** "15h10–15h55" */
export const slotText = (start: number, end: number) => `${fmtH(start)}–${fmtH(end)}`;

/** Places already planned that a manual slot would overlap */
export function overlaps(trip: Trip, dayKey: string, states: Record<string, PlaceState>, place: Place, start: number, dur: number): Busy[] {
  return busyOf(trip, dayKey, states, place.id).filter((b) => start < b.end && start + dur > b.start);
}
