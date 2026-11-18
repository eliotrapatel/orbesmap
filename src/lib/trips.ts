// Trips as data (table "trips"): a trip's content — title, dates, time zone, hotel, days, flights, phrases,
// zones, practical info, emergency info, checklist — is one record, merged field by field like places.
// The two trips written in the code (Shanghai, Guangzhou): their record holds only what was changed in the app,
// every other field comes from the code (so the code can still be corrected). New trips are records only.
// Their places come from the places table (defs.ts).
import type { Trip } from "../data/types";
import type { PlaceDef } from "./model";
import { t as tr } from "./i18n";

export type TripRec = PlaceDef;

/** The fields of a trip kept in its record (places are records of their own) */
export const TRIP_FIELDS = [
  "code", "title", "subtitle", "dateLabel", "start", "end", "timezone", "country", "lang", "hotel", "center",
  "days", "flights", "phrases", "zones", "practical", "emergency", "checklist", "mode", "travellers",
] as const;

const SEED_AT = 1;

/** A label in the language shown (the store reads the trips at start, before the language can be known: French then) */
const t = (fr: string) => {
  try {
    return tr(fr);
  } catch {
    return fr;
  }
};

/** Seed patch for a trip of the code: every field its record does not have yet, stamped at 1 ms */
export function tripSeedPatch(code: Trip, rec: TripRec | undefined): TripRec | null {
  const out: TripRec = { fieldsAt: {}, updatedAt: SEED_AT };
  let n = 0;
  for (const k of TRIP_FIELDS) {
    if (rec && Object.prototype.hasOwnProperty.call(rec, k)) continue;
    const v = (code as unknown as Record<string, unknown>)[k];
    if (v === undefined) continue;
    out[k] = v;
    out.fieldsAt![k] = SEED_AT;
    n++;
  }
  return n ? out : null;
}

const str = (v: unknown, d = "") => (typeof v === "string" && v ? v : d);
const arr = <T,>(v: unknown, d: T[]): T[] => (Array.isArray(v) ? (v as T[]) : d);

/** Days every trip has, so a new trip always has somewhere to put places (labels in the language shown) */
const baseDays = (): Trip["days"] => [
  { key: "base", short: t("Hôtel"), title: t("Hôtel"), theme: t("Base du séjour"), color: "#f6f2ea", glyph: "H", scheduled: false },
  { key: "ideas", short: t("Pistes"), title: t("Pistes"), theme: t("À voir si le temps le permet"), color: "#9A958D", glyph: "+", scheduled: false },
];

/**
 * The trip's base (everything but its places): its record, over the trip of the code when there is one.
 * Places stay those of the code here: they only seed the places table (see defs.ts).
 */
export function tripFromRecord(id: string, rec: TripRec | undefined, code: Trip | undefined): Trip {
  const r = (rec || {}) as Record<string, unknown>;
  const c = code;
  const pick = <T,>(k: (typeof TRIP_FIELDS)[number], d: T): T => (r[k] !== undefined && r[k] !== null ? (r[k] as T) : c ? ((c as unknown as Record<string, unknown>)[k] as T) ?? d : d);
  const start = str(pick("start", ""), new Date().toISOString().slice(0, 10));
  const days = arr<Trip["days"][number]>(pick<unknown>("days", null), []);
  const hotel = pick<Trip["hotel"] | null>("hotel", null);
  const center = pick<[number, number] | null>("center", null);
  return {
    id,
    code: str(pick("code", "")) || t("VOYAGE"),
    title: str(pick("title", "")) || t("Nouveau voyage"),
    subtitle: str(pick("subtitle", "")) || t("Voyage"),
    dateLabel: str(pick("dateLabel", "")),
    start,
    end: str(pick("end", ""), start),
    timezone: str(pick("timezone", ""), "Europe/Paris"),
    country: str(pick("country", "")) || (c ? "cn" : undefined),
    lang: pick<Trip["lang"] | undefined>("lang", undefined),
    mode: pick<Trip["mode"] | undefined>("mode", undefined) === "business" ? "business" : undefined,
    travellers: arr<string>(pick("travellers", []), []).filter((x) => typeof x === "string" && x.trim()).slice(0, 20),
    hotel: hotel && typeof hotel.lat === "number" ? hotel : { name: t("Hôtel à préciser"), lat: center?.[1] ?? 48.8566, lng: center?.[0] ?? 2.3522 },
    center: Array.isArray(center) && center.length === 2 ? center : hotel ? [hotel.lng, hotel.lat] : [2.3522, 48.8566],
    days: days.length ? days : baseDays(),
    places: c?.places || [],
    flights: arr(pick("flights", []), []),
    phrases: arr(pick("phrases", []), []),
    zones: arr(pick("zones", []), []),
    practical: arr(pick("practical", []), []),
    hours: c?.hours,
    emergency: pick("emergency", undefined),
    checklist: arr(pick("checklist", []), []),
  };
}
