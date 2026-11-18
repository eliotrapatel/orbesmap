// The photo of a place (place record field "photo") and of a trip (trip record field "cover"), as the server writes
// them (api/prepare.ts, api/_photos.ts). Read defensively: a record is shared data, so anything unexpected is dropped.
// No runtime import, so defs.ts and trips.ts can use it without a cycle.
import type { PhotoNone, PhotoRef, PlacePhoto, TripCover } from "../data/types";

const PATH = /^[co]\/[A-Za-z0-9._-]{1,140}$/;
const NONE_TTL = 30 * 86_400_000;

const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const https = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s"<>]+$/.test(v) && v.length <= 600 ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function ref(o: Record<string, unknown>): PhotoRef | undefined {
  const path = s(o.path, 160);
  const thumb = s(o.thumb, 160);
  if (!PATH.test(path) || !PATH.test(thumb)) return undefined;
  const source = o.source === "wikidata" || o.source === "wikipedia" || o.source === "openverse" ? o.source : null;
  const sourceUrl = https(o.sourceUrl);
  if (!source || !sourceUrl) return undefined;
  const w = num(o.w);
  const h = num(o.h);
  return {
    v: 1,
    path,
    thumb,
    w: w || 16,
    h: h || 10,
    author: s(o.author, 120),
    license: s(o.license, 40),
    licenseUrl: https(o.licenseUrl),
    source,
    sourceUrl,
    key: s(o.key, 260),
    qid: /^Q\d{1,12}$/.test(String(o.qid || "")) ? String(o.qid) : undefined,
    at: num(o.at),
  };
}

/** A place's photo from its record, or undefined when absent or malformed */
export function asPhoto(v: unknown): PlacePhoto | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (o.none === true) return { v: 1, none: true, at: num(o.at) } satisfies PhotoNone;
  return ref(o);
}

/** A trip's cover from its record */
export function asCover(v: unknown): TripCover | undefined {
  const p = asPhoto(v);
  if (!p || !isRef(p)) return p;
  const o = v as Record<string, unknown>;
  return { ...p, from: o.from === "city" ? "city" : "place", placeId: typeof o.placeId === "string" ? o.placeId.slice(0, 80) : undefined };
}

export const isRef = (p: PlacePhoto | TripCover | undefined | null): p is PhotoRef => !!p && !("none" in p);
export const isNone = (p: PlacePhoto | TripCover | undefined | null): p is PhotoNone => !!p && "none" in p && p.none === true;

/**
 * A place still to look up: no photo yet, a "none" older than 30 days, or a name / position changed after the
 * photo was chosen. `fieldsAt` is the place record's (on the phone: getState().data.defs[id]?.fieldsAt).
 */
export function needsLookup(photo: PlacePhoto | undefined, fieldsAt: Record<string, number> | undefined, now = Date.now()): boolean {
  if (!photo) return true;
  if (isNone(photo) && now - (photo.at || 0) > NONE_TTL) return true;
  const fa = fieldsAt || {};
  const at = photo.at || 0;
  return ["name", "lat", "lng"].some((k) => (Number(fa[k]) || 0) > at);
}
