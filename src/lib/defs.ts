// Places as data. Every place of a trip — the first programme AND the places added in the app — is one record
// of the "places" table, with the same sheet format. That record is the source of truth: the programme written
// in the code is only the seed it was created from.
//
// Migration (runs on every phone, at start and after each sync, and does nothing once done):
// - a programme place with no record gets one from the code, every field stamped at 1 ms: older than any real
//   change, so it can never overwrite what a phone already saved, whichever phone migrates first;
// - a place added on the map before (pins + their "_pin:<id>" record) gets its record, with its real timestamps;
// - what the previous versions changed (a programme place moved or removed, an added place's fields, a pin
//   renamed, moved or deleted on a phone not updated yet) is copied in when it is newer than the record.
// Notes, statuses, photos and contacts stay in place states / their tables, on the same ids.
import type { Place, PlaceType, Trip } from "../data/types";
import { TYPE_LABEL } from "../data/trip";
import type { Hours } from "./hours";
import type { Data, PlaceDef } from "./model";
import { normHours } from "./live";

/** Record saying the trip's places are data (written last by the migration) */
export const META = "__meta";
const SEED_AT = 1;

type Patch = Record<string, PlaceDef>;
type Rec = Record<string, unknown> & { fieldsAt?: Record<string, number>; updatedAt?: number };

const has = (r: Rec | undefined, k: string) => !!r && Object.prototype.hasOwnProperty.call(r, k);
/** When a field was last changed; -1 when the record does not have it (then anything is newer) */
const at = (r: Rec | undefined, k: string) => (has(r, k) ? (r!.fieldsAt?.[k] ?? r!.updatedAt ?? 0) : -1);

/** Collects field changes per record, each with its own timestamp */
function collector() {
  const out: Patch = {};
  const put = (id: string, k: string, v: unknown, t: number) => {
    const p = (out[id] ||= { fieldsAt: {}, updatedAt: 0 });
    p[k] = v;
    p.fieldsAt![k] = t;
    p.updatedAt = Math.max(p.updatedAt || 0, t);
  };
  return { out, put };
}

/** Fields of an added place's "_pin:" record copied into its sheet (record key → sheet key) */
const PIN_FIELDS: [string, string][] = [
  ["nameCn", "nameCn"], ["address", "address"], ["addressCn", "addressCn"], ["desc", "desc"], ["why", "why"],
  ["price", "price"], ["source", "source"], ["day", "day"], ["slot", "slot"], ["type", "type"], ["metro", "metro"],
  ["website", "website"], ["highlights", "highlights"], ["tip", "tip"], ["duration", "duration"], ["hours", "hoursText"],
  ["hoursData", "hours"], ["enrichedAt", "enrichedAt"], ["enrichConfidence", "enrichConfidence"], ["removed", "removed"],
];

/**
 * What to merge into the trip's place records so they hold everything (see the header).
 * `pinsSynced`: the pin list was just fetched from the server, so a pin missing from it was deleted on a phone.
 */
export function migrationPatches(base: Trip, data: Pick<Data, "places" | "pins" | "defs">, pinsSynced: boolean): Patch {
  const defs = data.defs as Record<string, Rec | undefined>;
  const st = data.places as Record<string, Rec | undefined>;
  const { out, put } = collector();

  // the first programme
  base.places.forEach((p, i) => {
    const d = defs[p.id];
    if (d?.deleted !== true) {
      // every field the record does not have yet (a whole new record, or one started by an early change)
      const h = base.hours?.[p.id];
      const seed: [string, unknown][] = [
        ["name", p.name], ["lat", p.lat], ["lng", p.lng], ["day", p.day], ["slot", p.time], ["type", p.type],
        ["address", p.address], ["addressCn", p.cn], ["metro", p.metro || ""], ["website", p.website || ""], ["desc", p.desc],
        ["highlights", p.highlights], ["tip", p.tip || ""], ["origin", "programme"], ["orig", { day: p.day, time: p.time }], ["order", i * 10],
      ];
      if (h) seed.push(["hours", h]);
      for (const [k, v] of seed) if (!has(d, k)) put(p.id, k, v, SEED_AT);
    }
    // moved / removed with the previous version (null = back to the programme)
    const s = st[p.id];
    for (const k of ["day", "slot", "removed"]) {
      if (!has(s, k)) continue;
      const t = at(s, k);
      if (t <= at(d, k) || t <= (out[p.id]?.fieldsAt?.[k] ?? -1)) continue;
      const v = s![k];
      // a day that does not exist (or the hotel's) meant "the programme's day" in the previous version
      const okDay = typeof v === "string" && v !== "base" && base.days.some((x) => x.key === v);
      put(p.id, k, k === "day" ? (okDay ? v : p.day) : k === "slot" ? (typeof v === "string" ? v : p.time) : v === true, t);
    }
  });

  // places added on the map before places were data
  for (const pin of data.pins) {
    const id = `_pin:${pin.id}`;
    const d = defs[id];
    if (d?.deleted === true) continue;
    const x = st[id];
    if (!has(d, "origin")) put(id, "origin", "added", SEED_AT);
    if (!has(d, "pinId")) put(id, "pinId", pin.id, SEED_AT);
    if (!has(d, "order")) put(id, "order", 1e12 + (pin.updatedAt || 0), SEED_AT);
    // name / position: taken from the pin only when the pin itself changed (renamed or moved on a phone still on
    // the previous version) — "pin_*" keeps the last value taken, so a note written on the pin changes nothing
    for (const k of ["name", "lat", "lng"] as const) {
      const snap = `pin_${k}`;
      if (has(d, snap) && d![snap] === pin[k]) continue;
      const t = Math.max(pin.updatedAt || SEED_AT, SEED_AT);
      if (t > at(d, k) || !has(d, k)) put(id, k, pin[k], t);
      put(id, snap, pin[k], t);
    }
    for (const [from, to] of PIN_FIELDS) {
      if (!has(x, from)) continue;
      const t = at(x, from);
      if (t > at(d, to)) put(id, to, x![from], t);
    }
  }

  // a pin deleted on a phone still on the previous version: its place is removed from the programme (it stays in
  // "Lieux retirés", so nothing is lost if the pin list was wrong). An empty list is never trusted for this.
  if (pinsSynced && data.pins.length) {
    const now = Date.now();
    for (const [id, d] of Object.entries(defs)) {
      if (d && typeof d.pinId === "string" && has(d, "pin_name") && d.deleted !== true && d.removed !== true && !data.pins.some((p) => p.id === d.pinId)) put(id, "removed", true, now);
    }
  }

  // last: the trip's places are data from now on
  if (!defs[META]) put(META, "seeded", true, SEED_AT);
  return out;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);

/** The trip built from its place records, or null when they are not there yet (first start, storage full) */
export function tripFromDefs(base: Trip, data: Pick<Data, "places" | "pins" | "defs">): Trip | null {
  const defs = data.defs as Record<string, Rec>;
  if (!defs?.[META]) return null;
  const days = new Set(base.days.map((d) => d.key));
  const fallback = days.has("ideas") ? "ideas" : base.days[base.days.length - 1].key;
  const hours: Record<string, Hours> = {};
  const all: { p: Place; order: number }[] = [];
  for (const [id, d] of Object.entries(defs)) {
    if (id === META || !d || d.deleted === true) continue;
    if (typeof d.lat !== "number" || typeof d.lng !== "number") continue;
    const lat = d.lat;
    const lng = d.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const day = typeof d.day === "string" && days.has(d.day) && (d.day !== "base" || d.type === "hotel") ? d.day : fallback;
    // only the programme's hotel is a hotel (an added place typed "hotel" would become impossible to move or remove)
    const type = (typeof d.type === "string" && d.type in TYPE_LABEL && (d.type !== "hotel" || d.origin === "programme") ? d.type : "ajout") as PlaceType;
    const time = str(d.slot);
    const h = normHours(d.hours);
    if (h) hours[id] = h;
    const orig = d.orig && typeof d.orig === "object" ? (d.orig as { day?: unknown; time?: unknown }) : null;
    const duration = Number(d.duration);
    const pinId = str(d.pinId);
    const pin = pinId ? data.pins.find((x) => x.id === pinId) : undefined;
    const nameCn = str(d.nameCn);
    all.push({
      order: Number(d.order) || 0,
      p: {
        id,
        name: str(d.name) || nameCn || "Lieu",
        day,
        type,
        lat,
        lng,
        time,
        address: str(d.address),
        cn: str(d.addressCn) || nameCn,
        metro: str(d.metro) || undefined,
        website: str(d.website) || undefined,
        desc: str(d.desc),
        highlights: strList(d.highlights),
        tip: str(d.tip) || undefined,
        duration: Number.isFinite(duration) && duration >= 10 && duration <= 600 ? Math.round(duration) : undefined,
        orig: orig && typeof orig.day === "string" && (orig.day !== day || str(orig.time) !== time) ? { day: orig.day, time: str(orig.time) } : undefined,
        nameCn: nameCn || undefined,
        why: str(d.why) || undefined,
        price: str(d.price) || undefined,
        source: str(d.source) || undefined,
        hoursText: str(d.hoursText) || undefined,
        enrichedAt: Number(d.enrichedAt) || undefined,
        hasPrev: !!d.prevSheet,
        added: d.origin === "added" ? { pinId: pinId || undefined, note: pin?.note || undefined } : undefined,
      },
    });
  }
  all.sort((a, b) => a.order - b.order || a.p.id.localeCompare(b.p.id));
  const isHotel = (p: Place) => p.type === "hotel" || p.id === base.hotel.placeId;
  const removed = all.filter(({ p }) => defs[p.id]?.removed === true && !isHotel(p)).map((x) => x.p);
  const places = all.map((x) => x.p).filter((p) => !removed.includes(p));
  return { ...base, places, removed, hours };
}
