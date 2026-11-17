// The trip as it is used everywhere in the app: the programme written in the code, plus what was changed
// in the app and shared between the two phones:
// - a programme place can be moved to another day or slot (fields "day" / "slot" of its place state);
// - every place added in the app (from a link, a search or by hand) becomes a place of the trip, with the
//   same sheet format as the programme (its extra fields live in the "_pin:<id>" record).
// Nothing in the programme itself is ever modified: clearing "day" and "slot" brings a place back.
import { TYPE_LABEL } from "../data/trip";
import type { Place, PlaceType, Trip } from "../data/types";
import type { Hours } from "./hours";
import type { Data } from "./model";

/** Place id of an added place */
export const pinPlaceId = (pinId: string) => `_pin:${pinId}`;
/** Pin id of an added place id, or null for a programme place */
export const pinIdOf = (placeId: string) => (placeId.startsWith("_pin:") ? placeId.slice(5) : null);

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

/** "10h", "10h30", "10:30", "9:5" → "10:00" / "10:30" (the format of the structured hours); "" if unreadable */
export function hhmm(v: unknown): string {
  const m = String(v ?? "").match(/(\d{1,2})\s*[h:]\s*(\d{0,2})/i);
  if (!m) return "";
  const h = +m[1];
  const mm = m[2] ? +m[2] : 0;
  if (h > 29 || mm > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/** Structured hours written by the AI (or anything close) → the app's Hours, or undefined */
export function normHours(v: unknown): Hours | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const days = (a: unknown) => (Array.isArray(a) ? a.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6) : []);
  const h: Hours = {
    always: o.always === true,
    closed: [...new Set(days(o.closed))],
    open: hhmm(o.open),
    close: hhmm(o.close),
    lastEntry: hhmm(o.lastEntry),
    breaks: (Array.isArray(o.breaks) ? o.breaks : [])
      .map((b) => ({ from: hhmm((b as Record<string, unknown>)?.from), to: hhmm((b as Record<string, unknown>)?.to) }))
      .filter((b) => b.from && b.to),
    byDay: (Array.isArray(o.byDay) ? o.byDay : [])
      .map((b) => ({ day: Number((b as Record<string, unknown>)?.day), open: hhmm((b as Record<string, unknown>)?.open), close: hhmm((b as Record<string, unknown>)?.close) }))
      .filter((b) => Number.isInteger(b.day) && b.day >= 0 && b.day <= 6 && b.open && b.close),
    reservation: str(o.reservation),
    confidence: o.confidence === "sûr" || o.confidence === "probable" ? o.confidence : "inconnu",
    note: str(o.note),
  };
  // every weekday closed means the hours were not understood
  if (h.closed.length >= 7) h.closed = [];
  // closing days without any opening time would read as "closed" every day: kept as text instead
  if (!h.always && !h.byDay.length && !(h.open && h.close) && h.closed.length) {
    const names = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
    h.note = [`Fermé le ${h.closed.map((d) => names[d]).join(", ")}`, h.note].filter(Boolean).join(" · ");
    h.closed = [];
  }
  return h;
}

/** Day an added place goes to when none is set ("Pistes" when the trip has it) */
export function fallbackDay(trip: Trip): string {
  return trip.days.some((d) => d.key === "ideas") ? "ideas" : trip.days[trip.days.length - 1].key;
}

/** A day where a place can be put by hand (the hotel's "base" is not one) */
const placeableDay = (trip: Trip, k: unknown): k is string => typeof k === "string" && k !== "base" && trip.days.some((d) => d.key === k);

export function liveTrip(base: Trip, data: Pick<Data, "places" | "pins">): Trip {
  const st = data.places as Record<string, Record<string, unknown> | undefined>;
  let changed = false;
  const programme = base.places.map((p) => {
    const s = st[p.id];
    if (!s || p.type === "hotel" || p.id === base.hotel.placeId) return p;
    const day = placeableDay(base, s.day) ? s.day : p.day;
    // a place moved to another day without a slot keeps no time (its old slot belongs to its old day)
    const time = typeof s.slot === "string" ? s.slot : day !== p.day ? "" : p.time;
    if (day === p.day && time === p.time) return p;
    changed = true;
    return { ...p, day, time, orig: { day: p.day, time: p.time } };
  });
  const hours: Record<string, Hours> = { ...(base.hours || {}) };
  const fb = fallbackDay(base);
  const added: Place[] = data.pins.map((pin) => {
    const id = pinPlaceId(pin.id);
    const x = st[id] || {};
    const type = (typeof x.type === "string" && x.type in TYPE_LABEL && x.type !== "hotel" ? x.type : "ajout") as PlaceType;
    const h = normHours(x.hoursData);
    if (h) hours[id] = h;
    const nameCn = str(x.nameCn);
    const duration = Number(x.duration);
    return {
      id,
      name: pin.name,
      day: placeableDay(base, x.day) ? x.day : fb,
      type,
      lat: pin.lat,
      lng: pin.lng,
      time: str(x.slot),
      address: str(x.address),
      cn: str(x.addressCn) || nameCn,
      metro: str(x.metro) || undefined,
      website: str(x.website) || undefined,
      desc: str(x.desc),
      highlights: strList(x.highlights),
      tip: str(x.tip) || undefined,
      duration: Number.isFinite(duration) && duration >= 10 && duration <= 600 ? Math.round(duration) : undefined,
      added: {
        pinId: pin.id,
        nameCn: nameCn || undefined,
        why: str(x.why) || undefined,
        price: str(x.price) || undefined,
        source: str(x.source) || undefined,
        hoursText: str(x.hours) || undefined,
        note: pin.note || undefined,
        enrichedAt: Number(x.enrichedAt) || undefined,
      },
    };
  });
  if (!changed && !added.length) return base;
  return { ...base, places: [...programme, ...added], hours };
}

/** The same trip object as long as nothing that shapes the trip changed (notes, statuses… don't) */
let last: { base: Trip; key: string; trip: Trip; places: unknown; pins: unknown } | null = null;
export function liveTripCached(base: Trip, data: Pick<Data, "places" | "pins">): Trip {
  // same data objects (re-render for another reason, e.g. a position update): nothing to rebuild
  if (last && last.base === base && last.places === data.places && last.pins === data.pins) return last.trip;
  const t = liveTrip(base, data);
  const key = t === base ? "" : JSON.stringify([t.places, t.hours]);
  if (last && last.base === base && last.key === key) {
    last = { ...last, places: data.places, pins: data.pins };
    return last.trip;
  }
  last = { base, key, trip: t, places: data.places, pins: data.pins };
  return t;
}
