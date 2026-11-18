// The AI preparation of a new trip, run on the server (Vercel function): it keeps going when the traveller leaves the
// screen or closes the app. Same steps as the app's own run (src/lib/draft.ts): the trame (outline), the essentials of
// the destination, then each day (research by the AI, then the places put on the map), and the review.
// One step per call (a call lives at most 300 s): after a step, the function calls itself for the next one. Only one
// call works on a trip at a time (a lease in the trip's draft, taken with an optimistic check on the row's updated_at).
// The cron (every 10 minutes) restarts a preparation whose last sign of life is older than 6 minutes.
// The AI requests are booked at the start with the traveller's own session (same daily caps and Pro rules as
// api/ai.ts); what only the server needs (who started it, its bookings, a day's raw answer) is kept apart from the trip
// (place_states, trip "_prep"), so the other travellers of the trip never see it.
// When everything is ready: a notification to the person who started it (Web Push, else a short e-mail).
// Needs on Vercel: SUPABASE_SERVICE_ROLE_KEY, DEEPSEEK_API_KEY (or ANTHROPIC_API_KEY); VAPID_PRIVATE_KEY and
// RESEND_API_KEY for the notice at the end (MAIL_FROM optional). Nothing new: the same keys as api/ai.ts and api/cron.ts.
// The photo of each place and of the trip is found here too, after the places are placed and when the app asks for a
// trip that lacks some (runPhotos, api/_photos.ts): it needs nothing new (the service key creates its public bucket).
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { waitUntil } from "@vercel/functions";
import { reserve, runTask, TaskFailure, type TaskRun } from "./ai.js";
import { Busy, copyToBucket, ensureBucket, lookupCity, lookupPlaces, needsLookup as photoNeeded, NONE_V as PHOTO_NONE_V, type Found, type Io, type PhotoRef, type Target } from "./_photos.js";

type Json = Record<string, unknown>;
const SUPA_URL = process.env.SUPABASE_URL || "https://ifugaqjneprbtigvegeb.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_0qPu_8XZTLk-l68k2kPUvQ_7UXk-fCu";
const APP_URL = "https://orbesmap.vercel.app";
export const PREP_URL = `${APP_URL}/api/prepare`;
const VAPID_PUBLIC = "BK5AQrfBJZC_DtZYyUGPrOeegzY8JzepoT5t6ia_5m1tF8sFZXySh39SlbBCQcfO6Ozc2lqdnQRCyID5f8O5ow4";
const UA = "ORBES Trips (https://orbesmap.vercel.app)";
const ORIGINS = [/^https:\/\/(www\.)?theorbes\.com$/, /^https:\/\/orbesmap(-[a-z0-9-]+)?\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
/** A lease older than this: the call holding it is gone (a call lives 300 s at most) */
export const LEASE_STALE = 6 * 60_000;
/** A local run's lease on a phone (src/lib/draft.ts): another phone is preparing the trip itself */
const DEVICE_LEASE = 3 * 60_000;
/** Time for one AI request (the call must answer before Vercel cuts it at 300 s) */
const AI_DEADLINE = 250_000;
/** Placing a day's places: once a call is this old, the rest goes to the next call (one place can take ~30 s: four
 *  OpenStreetMap queries with their spacing and timeout, and the writes; Vercel cuts a call at 300 s) */
const CALL_BUDGET = 255_000;
/** A step that fails this many times in a row (the database refusing a write…) stops the preparation */
const UNIT_TRIES = 3;
/** Where the scratch of a preparation lives (place_states, trip "_prep", place = the trip's id) */
const SCRATCH_TRIP = "_prep";
/** Where the photo pass keeps its lease (place_states, trip "_photos", place = the trip's id) */
const PHOTO_TRIP = "_photos";
/** The photo pass: lookups stop after this, no copy starts after PHOTO_COPY_END (a call lives 300 s) */
const PHOTO_BUDGET = 170_000;
const PHOTO_COPY_END = 270_000;
/** the trip's cover is looked up only when the call started less than this ago, and its requests stop at PHOTO_CITY_END */
const PHOTO_COVER_START = 240_000;
const PHOTO_CITY_END = 275_000;
/** a pass asked by the app: not again within this time of the last one that ended (the server's own calls are not held) */
const PHOTO_COOLDOWN = 10 * 60_000;
/** found places are written by tens as their copies end (a cut call keeps what it copied) */
const PHOTO_WRITE_BATCH = 10;
/** places looked up per call; the rest in the next call (a pass chains PHOTO_HOPS more calls at most) */
const PHOTO_CAP = 60;
const PHOTO_HOPS = 5;
/** the kinds of place whose photo can stand for the trip when its city has none */
const COVER_TYPES = new Set(["landmark", "musee", "jardin", "galerie"]);
/** the two trips written in the code (same list as the SQL's legacy_access) */
const CODE_TRIPS = new Set(["sha-2026", "gz-2026"]);

// the same messages as api/ai.ts (the app translates them)
const MSG = {
  pro: "Ce voyage est validé : modifier son programme est réservé à ORBES Trips Pro.",
  prep: "Votre voyage offert de ce mois a déjà été préparé. Passez à Pro pour en préparer d'autres.",
  cap: "Limite du jour atteinte pour les demandes à l'IA. Elle repart dans les 24 heures.",
  error: "Le service ne répond pas, réessayez dans un instant.",
  busy: "Trop de demandes en même temps, réessayez dans une minute.",
  refusal: "Cette demande n'a pas pu être traitée.",
  badOutput: "Réponse illisible, réessayez.",
  upstream: "Le service IA ne répond pas, réessayez.",
  stopped: "La préparation s'est arrêtée. Elle reprendra à la prochaine ouverture.",
  days: (n: number) => (n > 1 ? `${n} jours n'ont pas pu être préparés.` : `${n} jour n'a pas pu être préparé.`),
};

// ---------- what the preparation reads and writes ----------
type Day = { key: string; short?: string; title?: string; theme?: string; dates?: string[]; scheduled?: boolean };
type FixedItem = { kind?: string; name?: string; date?: string; time?: string; endTime?: string; address?: string; notes?: string };
type Lease = { by: string; at: number; hold?: string | null; step?: string };
export type Draft = Json & {
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
  outline?: { date: string; theme: string; area: string; include: string[]; fixed: string[] }[];
  essentials?: boolean;
  days?: Record<string, "done" | "error">;
  error?: string;
  lease?: Lease;
};
type DayPlace = {
  name: string; nameCn: string; address: string; addressCn: string; lat: number; lng: number; coordSystem: string;
  type: string; start: string; end: string; desc: string; why: string; tip: string; metro: string; website: string; source: string; fixed: boolean; confidence: string;
};
type DayResult = { theme: string; places: DayPlace[] };
type Booking = { id: number; task: string };
/** What only the server keeps for a preparation (never in the trip's record) */
export type Scratch = {
  run: string;
  user: string;
  ctx: Json;
  bookings: Booking[];
  /** USD already spent per booking on failed tries of the same step */
  spent: Record<string, number>;
  attempts: Record<string, number>;
  /** days that failed during this run (tried again at the next start) */
  errored: string[];
  essTried?: boolean;
  /** one day prepared again from the review (the review comes back after) */
  only: string | null;
  /** the daily cap was reached while booking: the run stops with this message when the bookings run out */
  capHit: string | null;
  /** a day's answer between its research and its placing; `ids` are the places' ids, fixed with the answer (a step
   *  replayed after a cut writes the same rows again, which the database ignores) */
  pending: { date: string; result: DayResult; next: number; ids: string[]; cleaned: boolean } | null;
  /** the booking of the AI request in progress (a « stop » during it leaves it to the call that settles it) */
  inflight: number | null;
  notified: string | null;
  done: boolean;
  at: number;
  /** when this run was first started (for the time to a ready programme; absent on a run started before) */
  started?: number;
  /** version: each write expects the one it read (a call whose run was stopped or replaced meanwhile writes nothing) */
  v: number;
};

export type Row = { data: Json; updatedAt: string };
export type PlaceRow = { id: string; data: Json; updatedAt: string };
/** The database, as the preparation sees it (PostgREST with the service key; an in-memory copy in the tests) */
export type Db = {
  getTrip(id: string): Promise<Row | null>;
  /** writes the record only if the row was not changed since `updatedAt` (false = changed meanwhile) */
  patchTrip(id: string, data: Json, updatedAt: string): Promise<boolean>;
  role(tripId: string, userId: string): Promise<string | null>;
  listPlaces(tripId: string): Promise<PlaceRow[]>;
  /** adds a place; a place already there with this id is left as it is */
  insertPlace(tripId: string, id: string, data: Json, by: string): Promise<void>;
  patchPlace(tripId: string, id: string, data: Json, updatedAt: string): Promise<boolean>;
  getScratch(tripId: string): Promise<Scratch | null>;
  /** writes the scratch only if the stored one is still `expect` (same run, same version); null = whatever is there
   *  (a new run). false = changed meanwhile */
  writeScratch(tripId: string, s: Scratch, expect: { run: string; v: number } | null): Promise<boolean>;
  updateUsage(id: number, detail: Json): Promise<void>;
  deleteUsage(ids: number[]): Promise<void>;
  profile(userId: string): Promise<Json>;
  pushSubs(userId: string): Promise<{ endpoint: string; p256dh: string; auth: string }[]>;
  dropPushSub(endpoint: string): Promise<void>;
  email(userId: string): Promise<string | null>;
  /** the photo pass's lease (place_states row trip "_photos", place = the trip): true when this call got it;
   *  `cooldown`: also refused while the last pass that ended (its `done`) is more recent than this */
  claimPhotos?(tripId: string, hold: string, now: number, cooldown?: number): Promise<boolean>;
  touchPhotos?(tripId: string, hold: string, now: number): Promise<void>;
  releasePhotos?(tripId: string, hold: string, now: number, note: Json): Promise<void>;
  /** one step of the account's path (supabase/saas-5.sql events: prep_started, prep_ready, prep_failed) */
  event?(userId: string, name: string, detail: string | null, tripId: string): Promise<void>;
};
export type BookResult = { id: number } | { refused: "cap" | "pro" | "prep" | "auth" | "error" };
export type Deps = {
  db: Db;
  /** the AI (runTask of api/ai.ts) */
  ai: (task: "outline" | "essentials" | "day", body: Json) => Promise<TaskRun>;
  /** books one AI request with the traveller's own session (rpc reserve_ai) */
  reserve: (token: string, task: string, tripId: string) => Promise<BookResult>;
  /** the account of a session, null when it is not valid */
  verify: (token: string) => Promise<string | null>;
  /** an address or a name → [lng, lat] (OpenStreetMap, one request per 1.1 s) */
  geocode: (q: string, box: [number, number, number, number], country: string) => Promise<[number, number] | null>;
  push?: (sub: { endpoint: string; p256dh: string; auth: string }, payload: Json) => Promise<void>;
  mail?: (to: string, subject: string, html: string, text: string) => Promise<boolean>;
  /** starts the next step in a new call (false when it could not be sent) */
  kick: (tripId: string) => Promise<boolean>;
  /** keeps the call alive for work done after the answer */
  schedule: (p: Promise<unknown>) => void;
  /** the secret of the internal calls ("" = not configured) */
  secret: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  /** the photo pass's services (Wikimedia, Openverse, Storage); absent = no photo pass */
  photoIo?: Io;
  /** starts the photo pass in a new call */
  kickPhotos?: (tripId: string, hop: number) => Promise<boolean>;
  /** a member of the first shared space (rpc is_member with the user's session): may write the two code trips */
  isMember?: (token: string) => Promise<boolean>;
};

// ---------- small helpers ----------
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
/** records a step of the account's path; never fails, never holds the preparation (kept alive by `schedule`) */
const ev = (deps: Deps, userId: string, name: "prep_started" | "prep_ready" | "prep_failed", detail: string | null, tripId: string) => {
  if (!deps.db.event || !userId) return;
  try {
    deps.schedule(deps.db.event(userId, name, detail, tripId).catch(() => undefined));
  } catch {
    /* ignore */
  }
};
/** a copy without the undefined fields (JSON drops them: the record never keeps them) */
const clean = <T extends Json>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const tripDays = (data: Json) => arr<Day>(data.days).filter((x) => x && x.scheduled && Array.isArray(x.dates) && x.dates.length);
const draftOf = (data: Json) => (data.draft && typeof data.draft === "object" ? (data.draft as Draft) : null);
const fresh = (l: Lease | undefined, now: number, ms = LEASE_STALE) => !!l && now - Number(l.at || 0) < ms;
/** the secret of the calls between the server's own functions, derived from the service key (never the key itself) */
export const deriveSecret = (key: string) => (key ? createHmac("sha256", key).update("orbes-prepare").digest("hex") : "");
function sameSecret(a: string, b: string) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const PACE: Record<string, string> = { relaxed: "tranquille", balanced: "équilibré", packed: "dense" };
/** "09:30", "9:30", "09h30", "9h" → minutes */
const hm = (s: string) => {
  const m = (s || "").trim().match(/^(\d{1,2})\s*[:h]\s*(\d{2})?$/i);
  return m && +m[1] < 30 ? +m[1] * 60 + (m[2] ? +m[2] : 0) : null;
};
const fmtH = (min: number) => {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
};
const slotText = (s: number, e: number) => `${fmtH(s)}–${fmtH(e)}`;
const fixedLine = (f: FixedItem) => [f.name, f.date, f.time && `${f.time}${f.endTime ? `–${f.endTime}` : ""}`, f.address, f.notes].filter(Boolean).join(" · ");
// the kinds of place the app knows (src/data/trip.ts TYPE_LABEL); another kind becomes "lifestyle"
const TYPES = new Set(["bijoux", "mode", "fabricant", "salon", "lifestyle", "bar", "hotel", "packaging", "textile", "landmark", "restaurant", "mall", "cashmere", "concept", "luxe", "montres", "cuir", "musee", "galerie", "jardin", "design", "tech", "cafe", "club", "transport", "ajout"]);

/** The language of a country, when the essentials could not say it (same table as src/lib/draft.ts) */
const LANG: Record<string, { code: string; name: string; speech: string }> = {
  cn: { code: "zh-CN", name: "chinois", speech: "zh-CN" }, tw: { code: "zh-TW", name: "chinois", speech: "zh-TW" }, hk: { code: "zh-HK", name: "cantonais", speech: "zh-HK" },
  jp: { code: "ja", name: "japonais", speech: "ja-JP" }, kr: { code: "ko", name: "coréen", speech: "ko-KR" }, th: { code: "th", name: "thaï", speech: "th-TH" },
  vn: { code: "vi", name: "vietnamien", speech: "vi-VN" }, it: { code: "it", name: "italien", speech: "it-IT" }, es: { code: "es", name: "espagnol", speech: "es-ES" },
  pt: { code: "pt-PT", name: "portugais", speech: "pt-PT" }, br: { code: "pt-BR", name: "portugais", speech: "pt-BR" }, de: { code: "de", name: "allemand", speech: "de-DE" },
  gb: { code: "en-GB", name: "anglais", speech: "en-GB" }, us: { code: "en-US", name: "anglais", speech: "en-US" }, gr: { code: "el", name: "grec", speech: "el-GR" },
  tr: { code: "tr", name: "turc", speech: "tr-TR" }, ma: { code: "ar", name: "arabe", speech: "ar-MA" }, mx: { code: "es-MX", name: "espagnol", speech: "es-MX" },
  nl: { code: "nl", name: "néerlandais", speech: "nl-NL" }, ru: { code: "ru", name: "russe", speech: "ru-RU" }, in: { code: "hi", name: "hindi", speech: "hi-IN" },
};
const langForCountry = (c?: unknown) => LANG[String(c || "").toLowerCase()];

/** The plan the creation tasks read (same as planOf in src/lib/draft.ts) */
function planOf(data: Json, d: Draft) {
  const hotel = (data.hotel || {}) as { name?: string };
  const flights = arr<{ code?: string; from?: string; to?: string; departAt?: string; arriveAt?: string; at?: string }>(data.flights);
  return {
    cities: arr<{ name: string }>(d.cities).map((c) => c.name).join(", "),
    hotel: d.hotelText || hotel.name || "",
    flights: d.flightsText || flights.map((f) => `${f.code} ${f.from}→${f.to} départ ${f.departAt || f.at} arrivée ${f.arriveAt || f.at}`).join(" ; "),
    pace: PACE[d.pace] || d.pace || "",
    interests: arr<string>(d.interests).join(", "),
    wishes: arr<string>(d.wishes).join(" ; "),
    dayWishes: Object.entries(d.dayWishes || {}).filter(([, v]) => String(v || "").trim()).map(([k, v]) => `${k} : ${v}`).join(" ; "),
  };
}

// ---------- positions (same rules as position() in src/lib/draft.ts) ----------
type LL = { lat: number; lng: number };
function km(a: LL, b: LL): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function wgsToGcj(lat: number, lng: number): LL {
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  const tLat = (x: number, y: number) => {
    let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
    r += ((20 * Math.sin(y * Math.PI) + 40 * Math.sin((y / 3) * Math.PI)) * 2) / 3;
    r += ((160 * Math.sin((y / 12) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30)) * 2) / 3;
    return r;
  };
  const tLng = (x: number, y: number) => {
    let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    r += ((20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2) / 3;
    r += ((20 * Math.sin(x * Math.PI) + 40 * Math.sin((x / 3) * Math.PI)) * 2) / 3;
    r += ((150 * Math.sin((x / 12) * Math.PI) + 300 * Math.sin((x / 30) * Math.PI)) * 2) / 3;
    return r;
  };
  let dLat = tLat(lng - 105, lat - 35);
  let dLng = tLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sq = Math.sqrt(magic);
  dLat = (dLat * 180) / (((a * (1 - ee)) / (magic * sq)) * Math.PI);
  dLng = (dLng * 180) / ((a / sq) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
function gcjToWgs(lat: number, lng: number): LL {
  let wLat = lat;
  let wLng = lng;
  for (let i = 0; i < 6; i++) {
    const g = wgsToGcj(wLat, wLng);
    wLat -= g.lat - lat;
    wLng -= g.lng - lng;
  }
  return { lat: wLat, lng: wLng };
}
function toWgs(lat: number, lng: number, system: string): LL {
  if (system === "GCJ02") return gcjToWgs(lat, lng);
  if (system === "BD09") {
    const xPi = (Math.PI * 3000) / 180;
    const x = lng - 0.0065;
    const y = lat - 0.006;
    const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * xPi);
    const t = Math.atan2(y, x) - 0.000003 * Math.cos(x * xPi);
    return gcjToWgs(z * Math.sin(t), z * Math.cos(t));
  }
  return { lat, lng };
}
/** The trip's city nearest to a day (its area from the outline, else the base city) */
function cityFor(d: Draft, area: string | undefined): { lat: number; lng: number; name: string; country?: string } {
  const a = (area || "").toLowerCase();
  const cities = arr<{ name: string; lat: number; lng: number; country?: string }>(d.cities);
  return cities.find((c) => a.includes(String(c.name || "").toLowerCase())) || cities[0];
}
/** Where a found place is: its coordinates if credible (near the day's city), else its address; null if unknown */
async function position(p: DayPlace, city: { lat: number; lng: number; name: string }, country: string, deps: Deps): Promise<[number, number] | null> {
  const near = (ll: LL) => km(ll, city) < 150;
  if (p.coordSystem !== "none" && p.lat && p.lng) {
    // the Chinese map offset only exists in mainland China
    const w = toWgs(p.lat, p.lng, country === "cn" || !country ? p.coordSystem : "WGS84");
    if (near(w)) return [w.lng, w.lat];
  }
  const box: [number, number, number, number] = [city.lng - 1.2, city.lat - 1.2, city.lng + 1.2, city.lat + 1.2];
  for (const q of [p.addressCn, p.address, p.nameCn, `${p.name} ${city.name}`]) {
    if (!q) continue;
    const g = await deps.geocode(q, box, country).catch(() => null);
    if (g) return g;
  }
  return null;
}

// ---------- writing the trip's record (field-by-field merge rules of upsert_trip) ----------
/**
 * Changes some fields of the trip's record, only if nobody wrote the row meanwhile (else read again and retry).
 * `fn` returns the fields to change from the current record, or null to change nothing. Each changed field gets its
 * own time (fieldsAt), later than the one it had, so the apps' merge keeps the server's version.
 */
async function commit(deps: Deps, tripId: string, fn: (data: Json) => Json | null): Promise<{ data: Json; changed: boolean; at: number } | null> {
  for (let i = 0; i < 8; i++) {
    const row = await deps.db.getTrip(tripId);
    if (!row) return null;
    const patch = fn(row.data);
    if (!patch) return { data: row.data, changed: false, at: 0 };
    const now = deps.now();
    const fa = { ...((row.data.fieldsAt as Record<string, number>) || {}) };
    const data: Json = { ...row.data };
    let at = now;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      data[k] = v;
      fa[k] = Math.max(now, (Number(fa[k]) || 0) + 1);
      at = Math.max(at, fa[k]);
    }
    data.fieldsAt = fa;
    data.updatedAt = Math.max(Number(row.data.updatedAt) || 0, at);
    if (await deps.db.patchTrip(tripId, data, row.updatedAt)) return { data, changed: true, at };
    await deps.sleep(60 + 90 * i);
  }
  throw new Error("trip row busy");
}
/** The draft with some fields changed (an undefined field is removed, like the app's saveDraft) */
const draftWith = (data: Json, p: Partial<Draft>): Json => ({ draft: clean({ ...(draftOf(data) || {}), ...p } as Json) });

// ---------- the steps ----------
type Step = { kind: "outline" } | { kind: "essentials" } | { kind: "research"; date: string } | { kind: "place"; date: string } | { kind: "finish" };
/** What comes next, from the trip's draft and the scratch */
export function nextStep(data: Json, s: Scratch): Step {
  const d = draftOf(data)!;
  if (!s.only && !d.outline) return { kind: "outline" };
  if (!s.only && !d.essentials && !s.essTried) return { kind: "essentials" };
  for (const day of tripDays(data)) {
    const date = day.dates![0];
    if (s.only && date !== s.only) continue;
    if (d.days?.[date] === "done" || s.errored.includes(date)) continue;
    return s.pending?.date === date ? { kind: "place", date } : { kind: "research", date };
  }
  return { kind: "finish" };
}
const stepCode = (s: Step) => (s.kind === "research" || s.kind === "place" ? `${s.kind === "research" ? "day" : "place"}:${s.date}` : s.kind);

/** One booking for a task (the same task first), taken out of the scratch */
function takeBooking(s: Scratch, task: string): Booking | null {
  const i = s.bookings.findIndex((b) => b.task === task);
  const j = i >= 0 ? i : task === "outline" ? -1 : s.bookings.findIndex((b) => b.task !== "outline");
  return j >= 0 ? s.bookings[j] : null;
}
const dropBooking = (s: Scratch, b: Booking) => {
  s.bookings = s.bookings.filter((x) => x.id !== b.id);
  delete s.spent[String(b.id)];
};
/** The booked request gets its cost and its detail (same fields as finish_ai_call2) */
async function settle(deps: Deps, s: Scratch, b: Booking, tripId: string, r: { usage: TaskRun["usage"]; provider: string; model: string; ms: number }, ok: boolean, err?: string) {
  const usd = Math.round(((s.spent[String(b.id)] || 0) + r.usage.usd) * 1e6) / 1e6;
  await deps.db.updateUsage(b.id, {
    usd: Math.max(0, Math.min(usd, 10)), ok, trip_id: tripId.slice(0, 64), provider: r.provider || null, model: r.model || null,
    tokens_cached: r.usage.hit, tokens_in: r.usage.miss, tokens_out: r.usage.out, searches: r.usage.search, fetches: r.usage.fetch, ms: Math.round(r.ms), error: ok ? null : (err || "error").slice(0, 200),
  }).catch(() => undefined);
}
const failMsg = (k: string) => (k === "busy" ? MSG.busy : k === "refusal" ? MSG.refusal : k === "bad_output" ? MSG.badOutput : MSG.upstream);

/** A call whose run was stopped or replaced meanwhile (someone else wrote its scratch): it stops there */
class Lost extends Error {
  constructor() {
    super("run taken over");
  }
}
/** Writes the scratch over the version this call read; false when it changed meanwhile (stopped, replaced) */
async function save(deps: Deps, tripId: string, s: Scratch): Promise<boolean> {
  const v = Number(s.v) || 0;
  const next: Scratch = { ...s, v: v + 1, at: deps.now() };
  if (!(await deps.db.writeScratch(tripId, next, { run: s.run, v }))) return false;
  s.v = next.v;
  s.at = next.at;
  return true;
}
const mustSave = async (deps: Deps, tripId: string, s: Scratch) => {
  if (!(await save(deps, tripId, s))) throw new Lost();
};

type Claim = { hold: string; data: Json; step: Step };
/** Takes the trip for one step: "over" when the preparation no longer runs, "busy" when another call works on it */
async function claim(deps: Deps, tripId: string, s: Scratch): Promise<Claim | "over" | "busy"> {
  const hold = randomUUID();
  let step: Step = { kind: "finish" };
  let why: "over" | "busy" = "busy";
  const res = await commit(deps, tripId, (data) => {
    const d = draftOf(data);
    if (!d || d.status !== "preparing") {
      why = "over";
      return null;
    }
    const l = d.lease;
    const now = deps.now();
    // a phone preparing it itself, or another call of the server at work
    if (l && fresh(l, now, l.by === "server" ? LEASE_STALE : DEVICE_LEASE) && (l.by !== "server" || l.hold)) {
      why = "busy";
      return null;
    }
    step = nextStep(data, s);
    return draftWith(data, { lease: { by: "server", at: now, hold, step: stepCode(step) } });
  });
  if (!res) return "over";
  if (!res.changed) return why;
  return { hold, data: res.data, step };
}
/** Still ours: preparing, and the lease is this call's */
const holds = (data: Json, hold: string) => {
  const d = draftOf(data);
  return !!d && d.status === "preparing" && d.lease?.hold === hold;
};
/** The lease goes back to "between two steps" (fresh, so the app shows the preparation as running) */
const released = (deps: Deps, data: Json, step = "") => ({ by: "server", at: deps.now(), hold: null, step: step || draftOf(data)?.lease?.step || "" });

/** Ends the run: the message on the draft, the unused bookings given back */
async function stopRun(deps: Deps, tripId: string, s: Scratch, hold: string | null, error: string) {
  const res = await commit(deps, tripId, (data) => (hold && !holds(data, hold) ? null : draftWith(data, { error, lease: undefined })));
  // the run ended without its programme (a day prepared again is not a preparation of its own)
  if (res?.changed && !s.only) ev(deps, s.user, "prep_failed", s.capHit && error === s.capHit ? "cap" : error === MSG.stopped ? "stopped" : "ai", tripId);
  await giveBack(deps, tripId, s);
}
/**
 * Closes the scratch and deletes the bookings left unused (they no longer count in the daily cap). `spare`: from the
 * app's « stop » or a new start, the request in progress stays booked (the call that sent it settles it). `retry`: the
 * scratch changed meanwhile (a call noting its request) → read again and close that; else whoever changed it is in
 * charge and nothing is done.
 */
async function giveBack(deps: Deps, tripId: string, s: Scratch, opts: { spare?: boolean; retry?: boolean } = {}): Promise<boolean> {
  let cur: Scratch | null = s;
  for (let i = 0; i < 5 && cur && !cur.done; i++) {
    const keep = opts.spare ? cur.inflight : null;
    const ids = cur.bookings.map((b) => b.id).filter((id) => id !== keep);
    const closed: Scratch = { ...cur, bookings: [], spent: {}, pending: null, inflight: null, done: true };
    if (await save(deps, tripId, closed)) {
      Object.assign(s, closed);
      if (ids.length) await deps.db.deleteUsage(ids).catch(() => undefined);
      return true;
    }
    if (!opts.retry) return false;
    const again = await deps.db.getScratch(tripId);
    cur = again && again.run === s.run ? again : null;
  }
  return false;
}
/** A scratch still open while the preparation no longer runs (validated, or stopped from a phone): its unused bookings
 *  are given back, unless a start is at work (it holds a fresh lease while it books) */
async function orphan(deps: Deps, tripId: string, s: Scratch, data?: Json) {
  const cur = data || (await deps.db.getTrip(tripId))?.data;
  const d = cur ? draftOf(cur) : null;
  if (d?.status === "preparing" || (d?.lease?.hold && fresh(d.lease, deps.now()))) return;
  await giveBack(deps, tripId, s, { spare: true }).catch(() => false);
}

type UnitResult = "next" | "again" | "stop";

/** Runs the next step of a trip (and the quick ones after it); starts the next call when there is more to do */
export async function runUnit(tripId: string, deps: Deps): Promise<string> {
  const t0 = deps.now();
  let ran = 0;
  for (;;) {
    const s0 = await deps.db.getScratch(tripId);
    if (!s0 || s0.done) {
      // nothing to run with (no session booked the requests): the app starts it again when it is opened
      if (ran === 0) {
        await commit(deps, tripId, (data) => {
          const d = draftOf(data);
          if (!d || d.status !== "preparing" || d.lease?.by !== "server") return null;
          // another call at work (a start booking its requests): left alone
          if (d.lease.hold && fresh(d.lease, deps.now())) return null;
          return draftWith(data, { error: MSG.stopped, lease: undefined });
        }).catch(() => null);
      }
      return ran ? "done" : "no-scratch";
    }
    const c = await claim(deps, tripId, s0);
    if (c === "over") {
      await orphan(deps, tripId, s0);
      return ran ? "done" : "over";
    }
    if (c === "busy") return ran ? "done" : "busy";
    ran++;
    // read again now that the trip is ours: the call before may have written its scratch after the read above
    const s = await deps.db.getScratch(tripId);
    if (!s || s.done) {
      await commit(deps, tripId, (data) => (holds(data, c.hold) ? draftWith(data, { error: draftOf(data)!.error || MSG.stopped, lease: undefined }) : null)).catch(() => null);
      return "done";
    }
    const step = nextStep(c.data, s);
    if (stepCode(step) !== stepCode(c.step)) {
      const ok = await commit(deps, tripId, (data) => (holds(data, c.hold) ? draftWith(data, { lease: { by: "server", at: deps.now(), hold: c.hold, step: stepCode(step) } }) : null)).catch(() => null);
      if (!ok?.changed) return "done";
    }
    let r: UnitResult;
    try {
      r = await unit(deps, tripId, s, { ...c, step }, t0);
    } catch (e) {
      if (e instanceof Lost) {
        // stopped or replaced meanwhile: whoever did it has the bookings; the lease goes if it is still this call's
        await commit(deps, tripId, (data) => (holds(data, c.hold) ? draftWith(data, { lease: released(deps, data) }) : null)).catch(() => null);
        return "lost";
      }
      // an unexpected failure (database): the lease is let go, the cron or the app tries again later; the same step
      // failing again and again stops the preparation (it never blocks the cron's restarts)
      deps.log?.(`prepare ${tripId}: ${String((e as Error)?.message || e).slice(0, 200)}`);
      const key = `unit:${stepCode(step)}`;
      s.attempts[key] = (s.attempts[key] || 0) + 1;
      if (s.attempts[key] >= UNIT_TRIES) {
        await stopRun(deps, tripId, s, c.hold, MSG.stopped).catch(() => undefined);
        return "error";
      }
      await save(deps, tripId, s).catch(() => false);
      await commit(deps, tripId, (data) => (holds(data, c.hold) ? draftWith(data, { lease: { ...released(deps, data), at: deps.now() - LEASE_STALE + 60_000 } }) : null)).catch(() => null);
      return "error";
    }
    if (r === "stop") return "done";
    // the next step: right here when it needs no AI request and the call is young, else in a new call
    const peek = await deps.db.getTrip(tripId);
    const s2 = await deps.db.getScratch(tripId);
    if (!peek || !s2 || s2.done) return "done";
    if (draftOf(peek.data)?.status !== "preparing") {
      await orphan(deps, tripId, s2, peek.data);
      return "done";
    }
    const nx = nextStep(peek.data, s2);
    const quick = (nx.kind === "place" || nx.kind === "finish") && deps.now() - t0 < 60_000;
    if (quick && r === "next") continue;
    const sent = await deps.kick(tripId).catch(() => false);
    if (!sent) deps.log?.(`prepare ${tripId}: next step not sent (the cron will restart it)`);
    return "kicked";
  }
}

async function unit(deps: Deps, tripId: string, s: Scratch, c: Claim, t0: number): Promise<UnitResult> {
  const { hold, step } = c;
  const data = c.data;
  const d = draftOf(data)!;
  const days = tripDays(data);
  const body = (task: string, extra: Json) => ({ ...s.ctx, task, ...extra });

  if (step.kind === "finish") {
    const target = s.only ? days.filter((x) => x.dates![0] === s.only) : days;
    let notify = false;
    let missed = 0;
    const res = await commit(deps, tripId, (cur) => {
      if (!holds(cur, hold)) return null;
      const dd = draftOf(cur)!;
      const left = target.filter((x) => dd.days?.[x.dates![0]] !== "done").length;
      missed = left;
      // one day prepared again: back to the review whatever happened; the whole trip: the review when all is ready
      const status = s.only || !left ? "review" : "preparing";
      notify = !s.only && status === "review";
      return draftWith(cur, { status, error: left ? (s.capHit && !s.only ? s.capHit : MSG.days(left)) : undefined, lease: undefined });
    });
    if (res?.changed && notify && s.notified !== s.run) {
      // said once per run (written first: two calls never send it twice)
      s.notified = s.run;
      if (await save(deps, tripId, s)) {
        ev(deps, s.user, "prep_ready", s.started ? String(Math.max(0, Math.round((deps.now() - s.started) / 1000))) : null, tripId);
        await sendReady(deps, tripId, res.data, s.user).catch((e) => deps.log?.(`prepare notify: ${String(e)}`));
      }
    }
    // the whole trip asked, some days could not be prepared
    if (res?.changed && !s.only && missed > 0) ev(deps, s.user, "prep_failed", "days", tripId);
    await giveBack(deps, tripId, s);
    // the photos of the places, in a call of their own: the trip is already ready (never slowed by them)
    if (res?.changed) await deps.kickPhotos?.(tripId, 0).catch(() => false);
    return "stop";
  }

  if (step.kind === "outline" || step.kind === "essentials" || step.kind === "research") {
    const task = step.kind === "research" ? "day" : step.kind;
    const b = takeBooking(s, task);
    if (!b) {
      // no request booked for this step: the daily cap was reached at the start, or the app must book again
      await stopRun(deps, tripId, s, hold, s.capHit || MSG.stopped);
      return "stop";
    }
    const key = step.kind === "research" ? `day:${step.date}` : step.kind;
    let out: TaskRun;
    let payload: Json;
    if (step.kind === "outline") {
      payload = body("outline", {
        plan: planOf(data, d),
        days: days.map((x) => `${x.dates![0]} (${x.short})`).join(", "),
        places: arr<Draft["places"][number]>(d.places).map((p) => `${p.name}${p.city ? ` (${p.city})` : ""}${p.mustSee ? " [incontournable]" : ""}${p.why ? ` : ${p.why}` : ""}`).join(" ; "),
        fixed: arr<FixedItem>(d.fixed).map(fixedLine).join(" ; "),
      });
    } else if (step.kind === "essentials") {
      payload = body("essentials", { plan: planOf(data, d), country: arr<{ country?: string }>(d.cities)[0]?.country || data.country || "" });
    } else {
      const date = step.date;
      const i = days.findIndex((x) => x.dates![0] === date);
      const day = days[i];
      const o = d.outline?.find((x) => x.date === date);
      const fixedToday = arr<FixedItem>(d.fixed).filter((f) => f.date === date);
      const lines = [
        `Date : ${date} (${day.short})`,
        o?.theme && `Thème : ${o.theme}`,
        o?.area && `Quartiers : ${o.area}`,
        o?.include?.length ? `Lieux à placer : ${o.include.join(" ; ")}` : "",
        fixedToday.length ? `Fixe ce jour : ${fixedToday.map(fixedLine).join(" ; ")}` : "",
        d.dayWishes?.[date] ? `Souhait du voyageur pour ce jour : ${d.dayWishes[date]}` : "",
        i === 0 ? "Jour d'arrivée : journée légère, après l'arrivée du vol et le passage à l'hôtel." : "",
        i === days.length - 1 ? "Jour du départ : terminer à temps pour l'aéroport." : "",
      ].filter(Boolean).join("\n");
      const used = (await deps.db.listPlaces(tripId))
        .filter((p) => p.data.deleted !== true && p.data.removed !== true && p.data.fromDraft !== date)
        .map((p) => String(p.data.name || ""))
        .filter(Boolean)
        .join(", ");
      payload = body("day", { plan: planOf(data, d), day: lines, used });
    }
    // the request in progress is noted first: a « stop » meanwhile leaves its booking to this call, which settles it
    // (and a run stopped or replaced before this point sends nothing)
    s.inflight = b.id;
    await mustSave(deps, tripId, s);
    try {
      out = await deps.ai(task as "outline", payload);
    } catch (e) {
      const f = e instanceof TaskFailure ? e : new TaskFailure("upstream", { hit: 0, miss: 0, out: 0, search: 0, fetch: 0, usd: 0 }, "", "", 0);
      s.inflight = null;
      s.attempts[key] = (s.attempts[key] || 0) + 1;
      const again = s.attempts[key] < 2 && f.kind !== "refusal" && f.kind !== "bad" && f.kind !== "config";
      await settle(deps, s, b, tripId, f, false, f.kind);
      if (again) {
        // tried once more in the next call, on the same booking
        s.spent[String(b.id)] = (s.spent[String(b.id)] || 0) + f.usage.usd;
        await mustSave(deps, tripId, s);
        await commit(deps, tripId, (cur) => (holds(cur, hold) ? draftWith(cur, { lease: released(deps, cur) }) : null));
        return "again";
      }
      dropBooking(s, b);
      if (step.kind === "outline") {
        await stopRun(deps, tripId, s, hold, f.kind === "config" ? MSG.error : failMsg(f.kind));
        return "stop";
      }
      if (step.kind === "essentials") {
        // not blocking (the programme matters more): the language comes from the country; tried again at the next start
        s.essTried = true;
        await mustSave(deps, tripId, s);
        const fb = langForCountry(data.country);
        await commit(deps, tripId, (cur) => (holds(cur, hold) ? { ...(fb && !cur.lang ? { lang: fb } : {}), ...draftWith(cur, { lease: released(deps, cur) }) } : null));
        return "next";
      }
      s.errored.push(step.date);
      await mustSave(deps, tripId, s);
      await commit(deps, tripId, (cur) => (holds(cur, hold) ? draftWith(cur, { days: { ...(draftOf(cur)!.days || {}), [step.date]: "error" }, lease: released(deps, cur) }) : null));
      return "next";
    }
    await settle(deps, s, b, tripId, out, true);
    dropBooking(s, b);
    s.inflight = null;
    const r = out.out;
    if (step.kind === "outline") {
      const outline = arr<NonNullable<Draft["outline"]>[number]>(r.days);
      await mustSave(deps, tripId, s);
      const themes = new Map(outline.map((x) => [x.date, x.theme]));
      await commit(deps, tripId, (cur) => {
        if (!holds(cur, hold)) return null;
        return {
          days: arr<Day>(cur.days).map((x) => (x.dates?.[0] && themes.get(x.dates[0]) ? { ...x, theme: themes.get(x.dates[0]) } : x)),
          ...draftWith(cur, { outline, lease: released(deps, cur) }),
        };
      });
      return "next";
    }
    if (step.kind === "essentials") {
      await mustSave(deps, tripId, s);
      const e = r as {
        lang?: { code: string; name: string; speech: string }; checklist?: { text: string; due: string; group: string }[]; phrases?: { title: string; items: { local: string; romanized: string; fr: string }[] }[];
        practical?: { title: string; text: string }[]; emergency?: { label: string; number: string; note: string }[]; consulate?: { name: string; address: string; phone: string; emergency: string; website: string };
      };
      const fallback = langForCountry(data.country);
      const lang = e.lang?.code && e.lang.name ? { ...e.lang, speech: e.lang.speech || fallback?.speech || e.lang.code } : fallback;
      const numbers = (e.emergency || []).filter((n) => n.number);
      const patch: Json = clean({
        lang,
        checklist: (e.checklist || []).filter((c) => c.text).map((c, i) => clean({ id: `c${i + 1}`, text: c.text, due: c.due || undefined, group: c.group || undefined })),
        phrases: (e.phrases || []).map((g) => ({ title: g.title, items: (g.items || []).map((x) => ({ zh: x.local, pinyin: x.romanized, fr: x.fr })) })),
        practical: (e.practical || []).filter((x) => x.title && x.text),
        emergency: numbers.length || e.consulate?.name
          ? { numbers, consulate: { name: e.consulate?.name || "", address: e.consulate?.address || "", cn: "", lat: null, lng: null, phone: e.consulate?.phone || "", emergency: e.consulate?.emergency || "", hours: "", website: e.consulate?.website || "" }, hospitals: [] }
          : undefined,
      });
      await commit(deps, tripId, (cur) => (holds(cur, hold) ? { ...patch, ...draftWith(cur, { essentials: true, lease: released(deps, cur) }) } : null));
      return "next";
    }
    // the day's answer waits in the scratch for its placing (never in the trip's record), with its places' ids fixed now
    const found = arr<DayPlace>(r.places);
    s.pending = { date: step.date, result: { theme: String(r.theme || ""), places: found }, next: 0, ids: found.map(() => randomUUID()), cleaned: false };
    await mustSave(deps, tripId, s);
    await commit(deps, tripId, (cur) => (holds(cur, hold) ? draftWith(cur, { lease: released(deps, cur, `place:${step.date}`) }) : null));
    return "next";
  }

  // placing a day's places: its earlier places from the preparation go first (a day prepared again starts clean)
  const p = s.pending!;
  const date = step.date;
  const day = days.find((x) => x.dates![0] === date)!;
  const list = p.result.places || [];
  const ids = list.map((_, i) => p.ids?.[i] || "");
  if (!p.cleaned) {
    for (const row of await deps.db.listPlaces(tripId)) {
      if (row.data.fromDraft !== date || row.data.deleted === true || ids.includes(row.id)) continue;
      const now = deps.now();
      const fa = { ...((row.data.fieldsAt as Record<string, number>) || {}) };
      fa.deleted = Math.max(now, (Number(fa.deleted) || 0) + 1);
      const ok = await deps.db.patchPlace(tripId, row.id, { ...row.data, deleted: true, fieldsAt: fa, updatedAt: Math.max(Number(row.data.updatedAt) || 0, fa.deleted) }, row.updatedAt);
      if (!ok) {
        // changed meanwhile on a phone: read again once
        const again = (await deps.db.listPlaces(tripId)).find((x) => x.id === row.id);
        if (again && again.data.deleted !== true) {
          const fb = { ...((again.data.fieldsAt as Record<string, number>) || {}) };
          fb.deleted = Math.max(deps.now(), (Number(fb.deleted) || 0) + 1);
          await deps.db.patchPlace(tripId, row.id, { ...again.data, deleted: true, fieldsAt: fb, updatedAt: Math.max(Number(again.data.updatedAt) || 0, fb.deleted) }, again.updatedAt);
        }
      }
    }
    p.cleaned = true;
    await mustSave(deps, tripId, s);
  }
  const o = d.outline?.find((x) => x.date === date);
  const city = cityFor(d, o?.area);
  const country = String(arr<{ name: string; country?: string }>(d.cities).find((c) => c.name === city.name)?.country || data.country || "").toLowerCase();
  /** stopped meanwhile (« Arrêter et voir les jours prêts », validated): the places written so far stay */
  const stillOurs = async () => {
    const cur = await deps.db.getTrip(tripId);
    if (cur && holds(cur.data, hold)) return true;
    if (cur) await orphan(deps, tripId, s, cur.data);
    return false;
  };
  for (let i = p.next; i < list.length; i++) {
    if (deps.now() - t0 > CALL_BUDGET) {
      // the rest in the next call (measured from the call's start: Vercel cuts it at 300 s)
      await commit(deps, tripId, (cur) => (holds(cur, hold) ? draftWith(cur, { lease: released(deps, cur) }) : null));
      return "again";
    }
    if (!(await stillOurs())) return "stop";
    const x = list[i];
    if (!x?.name) {
      p.next = i + 1;
      await mustSave(deps, tripId, s);
      continue;
    }
    const ll = await position(x, city, country, deps);
    if (!(await stillOurs())) return "stop";
    const st = hm(x.start);
    const en = hm(x.end);
    const slot = st != null && en != null && en > st ? slotText(st, en) : st != null ? slotText(st, st + 60) : "";
    const now = deps.now();
    // the same record as createPlace → updateDef in the app (src/lib/store.ts)
    const fields: Json = clean({
      name: x.name, nameCn: x.nameCn, address: x.address, addressCn: x.addressCn,
      // without a position: kept, at the city, in « Pistes » with its slot noted, to be placed by hand
      lng: ll ? ll[0] : city.lng, lat: ll ? ll[1] : city.lat,
      day: ll ? day.key : "ideas", slot: ll ? slot : "", toPlace: ll ? undefined : `${day.short}${slot ? ` · ${slot}` : ""}`,
      type: TYPES.has(x.type) ? x.type : "lifestyle",
      duration: st != null && en != null && en > st ? en - st : undefined,
      desc: x.desc, why: x.why, tip: x.tip, metro: x.metro, website: /^https?:\/\//.test(x.website || "") ? x.website : "", source: /^https?:\/\//.test(x.source || "") ? x.source : "",
      fromDraft: date, enrichConfidence: x.confidence,
      origin: "added", order: 1e12 + now + i,
    });
    const fieldsAt = Object.fromEntries(Object.keys(fields).map((k) => [k, now]));
    // its id was fixed with the day's answer: written again after a cut, the row already there is kept as it is
    await deps.db.insertPlace(tripId, ids[i] || randomUUID(), { ...fields, fieldsAt, updatedAt: now }, s.user);
    p.next = i + 1;
    await mustSave(deps, tripId, s);
  }
  const theme = p.result.theme;
  await commit(deps, tripId, (cur) => {
    // the day is marked ready even if the preparation was stopped meanwhile (its places are all there)
    const dd = draftOf(cur);
    if (!dd || dd.status === "done" || (dd.lease?.hold && dd.lease.hold !== hold)) return null;
    const curDay = arr<Day>(cur.days).find((x) => x.key === day.key);
    const mine = dd.lease?.hold === hold;
    return {
      ...(theme && curDay && !curDay.theme ? { days: arr<Day>(cur.days).map((x) => (x.key === day.key ? { ...x, theme } : x)) } : {}),
      ...draftWith(cur, { days: { ...(dd.days || {}), [date]: "done" }, ...(mine ? { lease: released(deps, cur) } : {}) }),
    };
  });
  s.pending = null;
  await mustSave(deps, tripId, s);
  return "next";
}

// ---------- the photos of the places and of the trip ----------
/** a place's Chinese address (« cn » in the code trips, « addressCn » in prepared ones): its end is often its Chinese name */
const cnText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined);
const isPhotoRef = (v: unknown): v is PhotoRef => !!v && typeof v === "object" && typeof (v as PhotoRef).path === "string" && typeof (v as PhotoRef).thumb === "string";
/** a cover « none » to look up again: older than 30 days, or written before the name variants (any version but
 *  PHOTO_NONE_V: the city's own photo was always refused then) */
const staleNone = (v: unknown, now: number) => !!v && typeof v === "object" && (v as { none?: boolean }).none === true && ((v as { v?: unknown }).v !== PHOTO_NONE_V || now - (Number((v as { at?: number }).at) || 0) > 30 * 86_400_000);
const sameSpot = (row: PlaceRow, t: Target) => String(row.data.name || "").trim() === t.name && Number(row.data.lat) === t.lat && Number(row.data.lng) === t.lng;

/**
 * One photo pass on a trip: the places without a photo (or renamed, moved, or "none" for 30 days) are looked up,
 * their files copied into the public bucket and written by tens as the copies end (the open phones pull a few times);
 * then the trip's cover. Only one pass per trip at a time (a lease in place_states). Never touches the draft.
 */
export async function runPhotos(tripId: string, deps: Deps, opts: { hop?: number; asked?: boolean } = {}): Promise<string> {
  const io = deps.photoIo;
  const db = deps.db;
  if (!io || !db.claimPhotos) return "off";
  const hop = Math.max(0, Math.floor(Number(opts.hop) || 0));
  const hold = randomUUID();
  const t0 = deps.now();
  // asked by the app: never within PHOTO_COOLDOWN of the last pass that ended
  if (!(await db.claimPhotos(tripId, hold, t0, opts.asked ? PHOTO_COOLDOWN : undefined))) return "busy";
  const alive = setInterval(() => void db.touchPhotos?.(tripId, hold, deps.now()).catch(() => undefined), 60_000);
  (alive as { unref?: () => void }).unref?.();
  const release = (note: Json) => db.releasePhotos?.(tripId, hold, deps.now(), note).catch(() => undefined);
  try {
    try {
      await ensureBucket(io);
    } catch (e) {
      deps.log?.(`photos ${tripId}: ${String((e as Error)?.message || e)}`);
      await release({ error: "bucket" });
      return "error";
    }
    const row = await db.getTrip(tripId);
    if (!row) {
      await release({ done: deps.now() });
      return "done";
    }
    const now = deps.now();
    const order = (r: PlaceRow) => Number(r.data.order) || 0;
    const live = (await db.listPlaces(tripId)).filter((r) => r.id !== "__meta" && r.data.deleted !== true && r.data.removed !== true && typeof r.data.name === "string" && r.data.name.trim() && typeof r.data.lat === "number" && typeof r.data.lng === "number" && Number.isFinite(r.data.lat) && Number.isFinite(r.data.lng));
    const todo = live.filter((r) => photoNeeded(r.data.photo, r.data.fieldsAt, now)).sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
    const targets: Target[] = todo.slice(0, PHOTO_CAP).map((r) => ({ id: r.id, name: String(r.data.name).trim(), nameCn: typeof r.data.nameCn === "string" && r.data.nameCn.trim() ? r.data.nameCn.trim() : undefined, addressCn: cnText(r.data.cn) || cnText(r.data.addressCn), lat: r.data.lat as number, lng: r.data.lng as number, type: String(r.data.type || "") }));
    const leftOver = todo.length > targets.length;
    // the trip's city: the preparation's first city, else the trip's own title and centre (never the app's input)
    const d = draftOf(row.data);
    const c0 = d ? arr<{ name?: string; lat?: number; lng?: number; country?: string }>(d.cities)[0] : undefined;
    const center = Array.isArray(row.data.center) ? (row.data.center as number[]) : null;
    const country = String(c0?.country || row.data.country || (CODE_TRIPS.has(tripId) ? "cn" : "")).toLowerCase();
    const title = typeof row.data.title === "string" ? row.data.title.trim() : "";
    const city = c0?.name ? { name: c0.name, country, lat: c0.lat, lng: c0.lng } : title ? { name: title, country, lat: center?.[1], lng: center?.[0] } : null;
    const lang = (row.data.lang && typeof row.data.lang === "object" ? String((row.data.lang as { code?: unknown }).code || "") : "").slice(0, 2).toLowerCase();
    const langs = [...new Set(["en", lang, "fr"].filter(Boolean))];

    const results = targets.length ? await lookupPlaces(targets, { city: city?.name || "", country, langs }, io, t0 + PHOTO_BUDGET) : new Map<string, Found | "none" | "retry">();
    const budgetHit = deps.now() > t0 + PHOTO_BUDGET;

    // the copies (3 at a time, none started late; upload.wikimedia.org busy stops them all), each found place written
    // by tens as its copy ends, on fresh rows (the open phones pull a few times, and a cut call keeps what it copied)
    const refs = new Map<string, PhotoRef>();
    const queue = [...results].filter((x): x is [string, Found] => typeof x[1] === "object");
    let cut = false;
    let copyFailed = false;
    let fresh = await db.listPlaces(tripId);
    const write = async (id: string, photo: Json): Promise<boolean | "skip"> => {
      const r = fresh.find((x) => x.id === id);
      const t = targets.find((x) => x.id === id)!;
      // deleted, renamed or moved meanwhile: left for the next pass
      if (!r || r.data.deleted === true || !sameSpot(r, t)) return "skip";
      const n = deps.now();
      const fa = { ...((r.data.fieldsAt as Record<string, number>) || {}) };
      fa.photo = Math.max(n, (Number(fa.photo) || 0) + 1);
      const data: Json = { ...r.data, photo: { ...photo, at: fa.photo }, fieldsAt: fa, updatedAt: Math.max(Number(r.data.updatedAt) || 0, fa.photo) };
      return db.patchPlace(tripId, id, data, r.updatedAt);
    };
    let written = 0;
    let writeError: unknown = null;
    const writeOne = async (id: string) => {
      const res = results.get(id);
      const photo: Json | null = res === "none" ? { v: PHOTO_NONE_V, none: true } : res && res !== "retry" && refs.has(id) ? { ...refs.get(id)! } : null;
      if (!photo) return;
      let ok = await write(id, photo);
      if (ok === false) {
        // changed on a phone meanwhile: read again, once
        fresh = await db.listPlaces(tripId);
        ok = await write(id, photo);
      }
      if (ok === true) written++;
    };
    const ready: string[] = [];
    let writing: Promise<void> = Promise.resolve();
    const flush = () => {
      const ids = ready.splice(0);
      if (ids.length)
        writing = writing.then(async () => {
          if (writeError) return;
          try {
            for (const id of ids) await writeOne(id);
          } catch (e) {
            writeError = e;
          }
        });
      return writing;
    };
    const copier = async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        if (cut || deps.now() > t0 + PHOTO_COPY_END) {
          cut = true;
          continue;
        }
        try {
          refs.set(item[0], await copyToBucket(item[1], io));
          ready.push(item[0]);
          if (ready.length >= PHOTO_WRITE_BATCH) void flush();
        } catch (e) {
          copyFailed = true;
          // a 429 from the file host: no more downloads in this call (the next call, or the app's next ask, retries)
          if (e instanceof Busy) cut = true;
          else deps.log?.(`photos copy ${tripId}: ${String((e as Error)?.message || e).slice(0, 120)}`);
        }
      }
    };
    await Promise.all([copier(), copier(), copier()]);
    // then the places with nothing acceptable, and the rest of the found ones
    for (const t of targets) if (results.get(t.id) === "none") ready.push(t.id);
    await flush();
    if (writeError) throw writeError;
    // a photo found but not copied (failed, busy, late) counts as still to find
    const pending = leftOver || cut || copyFailed || [...results.values()].some((x) => x === "retry");

    // the trip's cover: its city's photo, else one of its landmarks' (wide enough for the band), else none
    const cur = (await db.getTrip(tripId))?.data.cover;
    if ((!cur || staleNone(cur, deps.now())) && city && deps.now() < t0 + PHOTO_COVER_START) {
      let cover: Json | null = null;
      const r = await lookupCity(city, io, t0 + PHOTO_CITY_END);
      if (typeof r === "object") {
        try {
          cover = { ...(await copyToBucket(r, io)), from: "city" };
        } catch (e) {
          deps.log?.(`photos cover ${tripId}: ${String((e as Error)?.message || e).slice(0, 120)}`);
        }
      } else if (r === "none") {
        const rows = (await db.listPlaces(tripId)).filter((x) => x.data.deleted !== true && x.data.removed !== true && COVER_TYPES.has(String(x.data.type)) && isPhotoRef(x.data.photo) && /-(960|1280)\.\w+$/.test((x.data.photo as PhotoRef).path)).sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
        if (rows[0]) cover = { ...(rows[0].data.photo as Json), from: "place", placeId: rows[0].id };
        // nothing at all, no place still to look up and no photo found left uncopied: said once (tried again in 30 days)
        else if (!pending) cover = { v: PHOTO_NONE_V, none: true, at: deps.now() };
      }
      if (cover) {
        const c = cover;
        await commit(deps, tripId, (data) => (data.cover && !staleNone(data.cover, deps.now()) ? null : { cover: c })).catch((e) => deps.log?.(`photos cover ${tripId}: ${String(e)}`));
      }
    }

    deps.log?.(`photos ${tripId}: ${targets.length} looked up, ${refs.size} copied, ${written} written`);
    if ((leftOver || cut || budgetHit) && hop < PHOTO_HOPS && deps.kickPhotos) {
      await release({ at: deps.now() });
      clearInterval(alive);
      const sent = await deps.kickPhotos(tripId, hop + 1).catch(() => false);
      return sent ? "kicked" : "done";
    }
    await release({ done: deps.now() });
    return "done";
  } catch (e) {
    deps.log?.(`photos ${tripId}: ${String((e as Error)?.message || e).slice(0, 200)}`);
    await release({ error: "failed" });
    return "error";
  } finally {
    clearInterval(alive);
  }
}

// ---------- the notice at the end ----------
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const FOOTER = `<p style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#a8a39b;margin:22px 0 0">ORBES Trips</p>`;
const READY = {
  fr: { title: "Votre voyage est prêt", body: (t: string) => `${t} : le programme vous attend.`, subject: (t: string) => `${t} · votre voyage est prêt`, hello: (n: string) => (n ? `Bonjour ${n},` : "Bonjour,"), open: "Voir le programme" },
  en: { title: "Your trip is ready", body: (t: string) => `${t}: your itinerary is waiting.`, subject: (t: string) => `${t} · your trip is ready`, hello: (n: string) => (n ? `Hello ${n},` : "Hello,"), open: "See the itinerary" },
};
/** "Votre voyage est prêt": a notification on the phones of who started it, else a short e-mail */
export async function sendReady(deps: Deps, tripId: string, data: Json, userId: string): Promise<"push" | "mail" | "none"> {
  const prof = await deps.db.profile(userId).catch(() => ({}) as Json);
  const T = READY[prof.lang === "en" ? "en" : "fr"];
  const alerts = (prof.alerts || {}) as { email?: boolean; push?: boolean };
  const title = String(data.title || "ORBES Trips");
  // the app opens on this trip; the link says where it came from (?src=, read once by the app)
  const url = `${APP_URL}/?src=push_ready#${tripId}`;
  const mailUrl = `${APP_URL}/?src=email_ready#${tripId}`;
  let pushed = 0;
  if (deps.push && alerts.push !== false) {
    for (const ph of await deps.db.pushSubs(userId).catch(() => [])) {
      try {
        await deps.push(ph, { title: T.title, body: T.body(title), url, tag: `ready-${tripId}` });
        pushed++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        // the phone unsubscribed or the app was removed: forget it
        if (code === 404 || code === 410) await deps.db.dropPushSub(ph.endpoint).catch(() => undefined);
      }
    }
  }
  if (pushed) return "push";
  if (!deps.mail || alerts.email === false) return "none";
  const to = await deps.db.email(userId).catch(() => null);
  if (!to) return "none";
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 22px;color:#0a0a0a">
<p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 22px">ORBES Trips</p>
<p style="font-size:16px;margin:0 0 6px">${esc(T.hello(String(prof.name || "")))}</p>
<p style="font-size:20px;font-weight:600;margin:10px 0 2px">${esc(T.title)}</p>
<p style="color:#6f6b65;margin:0 0 14px">${esc(T.body(title))}</p>
<p style="margin:24px 0"><a href="${mailUrl}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:12px 20px;border-radius:12px">${esc(T.open)}</a></p>
${FOOTER}</div>`;
  const ok = await deps.mail(to, T.subject(title), html, [T.hello(String(prof.name || "")), T.title, T.body(title), mailUrl, "", "ORBES Trips"].join("\n")).catch(() => false);
  return ok ? "mail" : "none";
}

// ---------- what the app asks ----------
const CORS = (origin: string | null): Record<string, string> => {
  const ok = origin && ORIGINS.some((r) => r.test(origin));
  return { "Access-Control-Allow-Origin": ok ? origin! : "https://theorbes.com", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Max-Age": "86400", Vary: "Origin" };
};
/** Every answer carries the server's clock (the app compares the lease's time with it, not with its own clock) */
const reply = (body: Json, status: number, origin: string | null) => new Response(JSON.stringify({ ...body, now: Date.now() }), { status, headers: { "content-type": "application/json", ...CORS(origin) } });
/** Who the AI helps and for which trip (src/lib/ai.ts aiContext), kept small */
function ctxOf(v: unknown): Json {
  const c = v && typeof v === "object" ? (v as Json) : {};
  const out: Json = { who: c.who && typeof c.who === "object" ? c.who : {}, trip: c.trip && typeof c.trip === "object" ? c.trip : {}, lang: c.lang ?? null };
  return JSON.stringify(out).length > 8000 ? { who: {}, trip: out.trip, lang: out.lang } : out;
}
const refusalOf = (r: Exclude<BookResult, { id: number }>["refused"]) => (r === "pro" ? { error: "pro", message: MSG.pro, status: 403 } : r === "prep" ? { error: "pro", message: MSG.prep, status: 403 } : r === "cap" ? { error: "busy", message: MSG.cap, status: 429 } : { error: "unavailable", message: MSG.error, status: 503 });
const newScratch = (deps: Deps, user: string, ctx: Json): Scratch => ({ run: randomUUID(), user, ctx, bookings: [], spent: {}, attempts: {}, errored: [], only: null, capHit: null, pending: null, inflight: null, notified: null, done: false, at: deps.now(), started: deps.now(), v: 0 });

/**
 * "start": prepares (or goes on preparing) the trip's missing steps; "day": one day again; "review": stop and show
 * what is ready; "wish": a wish added for the days still to prepare; "status". Internal: "run" (one step).
 */
export async function handle(req: Request, depsIn?: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS(origin) });
  if (req.method !== "POST") return reply({ error: "method" }, 405, origin);
  const deps = depsIn || realDeps();
  if (!deps) return reply({ error: "config" }, 503, origin);
  let body: Json;
  try {
    body = (await req.json()) as Json;
  } catch {
    return reply({ error: "bad" }, 400, origin);
  }
  const tripId = typeof body.trip === "string" ? body.trip.slice(0, 64) : "";
  const action = String(body.action || "");
  if (!tripId) return reply({ error: "bad" }, 400, origin);

  // the server's own calls (the next step, the cron's restart)
  const internal = req.headers.get("x-prep-key") || "";
  if (internal) {
    if (!sameSecret(internal, deps.secret)) return reply({ error: "forbidden" }, 403, origin);
    if (action === "photos-run") deps.schedule(runPhotos(tripId, deps, { hop: Number(body.hop) || 0 }).catch((e) => deps.log?.(`photos run: ${String(e)}`)));
    else deps.schedule(runUnit(tripId, deps).catch((e) => deps.log?.(`prepare run: ${String(e)}`)));
    return reply({ ok: true }, 202, origin);
  }

  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply({ error: "auth", message: "Connectez-vous dans l'onglet Compte pour utiliser cette fonction." }, 401, origin);
  const user = await deps.verify(token).catch(() => null);
  if (!user) return reply({ error: "auth", message: "Session expirée : reconnectez-vous dans l'onglet Compte." }, 401, origin);
  const role = await deps.db.role(tripId, user).catch(() => null);
  const row = await deps.db.getTrip(tripId);
  // the photos of a trip's places (asked once by the app when it opens a trip lacking some): any trip, with or
  // without a draft, by who may write it (owner, editor; the code trips: the first shared space's members)
  if (action === "photos") {
    if (!row) return reply({ error: "notready" }, 409, origin);
    const ok = role === "owner" || role === "editor" || (CODE_TRIPS.has(tripId) && (await (deps.isMember?.(token) ?? Promise.resolve(false)).catch(() => false)));
    if (!ok) return reply({ error: "forbidden" }, 403, origin);
    deps.schedule(runPhotos(tripId, deps, { asked: true }).catch((e) => deps.log?.(`photos ${tripId}: ${String(e)}`)));
    return reply({ ok: true, queued: true }, 202, origin);
  }
  // a trip just created on the phone may not have reached the server yet: the app asks again
  if (!row || !draftOf(row.data)) return reply({ error: "notready" }, 409, origin);
  if (role !== "owner" && role !== "editor") return reply({ error: "forbidden" }, 403, origin);
  const d = draftOf(row.data)!;
  const now = deps.now();

  if (action === "status") {
    const l = d.lease;
    return reply({ ok: true, status: d.status, busy: l?.by === "server" && fresh(l, now), step: l?.by === "server" ? l.step || "" : "" }, 200, origin);
  }

  if (action === "wish") {
    const text = String(body.text || "").trim().slice(0, 300);
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "";
    if (!text) return reply({ error: "bad" }, 400, origin);
    const res = await commit(deps, tripId, (data) => {
      const dd = draftOf(data);
      if (!dd) return null;
      if (date) {
        const cur = String(dd.dayWishes?.[date] || "").trim();
        return draftWith(data, { dayWishes: { ...(dd.dayWishes || {}), [date]: cur ? `${cur} ; ${text}` : text } });
      }
      return draftWith(data, { wishes: [...arr<string>(dd.wishes), text] });
    });
    return reply({ ok: true, at: res?.at || 0 }, 200, origin);
  }

  if (action === "review") {
    // stop and show what is ready: the call at work keeps what it already wrote, then stops
    const res = await commit(deps, tripId, (data) => {
      const dd = draftOf(data);
      return dd && dd.status !== "done" ? draftWith(data, { status: "review", error: undefined, lease: undefined }) : null;
    });
    // the unused bookings go back; the request a call is sending right now stays booked (that call settles it, then
    // finds its run closed and stops)
    const s = await deps.db.getScratch(tripId);
    if (s && !s.done) await giveBack(deps, tripId, s, { spare: true, retry: true });
    return reply({ ok: true, at: res?.at || 0 }, 200, origin);
  }

  if (action !== "start" && action !== "day") return reply({ error: "bad" }, 400, origin);
  if (d.status === "done") return reply({ error: "done" }, 409, origin);
  const l = d.lease;
  // a phone preparing the trip itself (the app's own run): left alone
  if (l && l.by !== "server" && fresh(l, now, DEVICE_LEASE)) return reply({ error: "elsewhere" }, 409, origin);
  const running = !!l && l.by === "server" && fresh(l, now);
  const days = tripDays(row.data);
  const only = action === "day" ? String(body.date || "") : "";
  if (action === "day" && !days.some((x) => x.dates![0] === only)) return reply({ error: "bad" }, 400, origin);
  const busyReply = () => (action === "start" ? reply({ ok: true, running: true }, 200, origin) : reply({ error: "busy" }, 409, origin));
  // already at work: nothing to start (a day asked again waits for the end of the run)
  if (running) return busyReply();
  // taken for the start (two taps, two phones: only one books the requests)
  const lock = `start-${randomUUID()}`;
  const got = await commit(deps, tripId, (data) => {
    const dd = draftOf(data);
    if (!dd || dd.status === "done") return null;
    const ll = dd.lease;
    const n = deps.now();
    if (ll && fresh(ll, n, ll.by === "server" ? LEASE_STALE : DEVICE_LEASE)) return null;
    return draftWith(data, { lease: { by: "server", at: n, hold: lock, step: ll?.step || "" } });
  });
  if (!got?.changed) return busyReply();
  const unlock = (extra: Partial<Draft> = {}) => commit(deps, tripId, (data) => (draftOf(data)?.lease?.hold === lock ? draftWith(data, { ...extra, lease: undefined }) : null));
  const ctx = ctxOf(body.ctx);
  const old = await deps.db.getScratch(tripId);
  // a run stopped halfway by the same person goes on with its bookings; anything else starts a new scratch
  const keep = old && !old.done && old.user === user && !only ? old : null;
  if (old && !old.done && !keep) await giveBack(deps, tripId, old, { spare: true, retry: true });
  const s: Scratch = keep
    ? {
        ...keep,
        // a restart sent without the traveller's context (another trip open in the app) keeps the one it had
        ctx: Object.keys((ctx.who as Json) || {}).length ? ctx : keep.ctx,
        // the request a call was sending when it was cut may have been made: its booking is not used again
        bookings: keep.bookings.filter((b) => b.id !== keep.inflight),
        inflight: null, attempts: {}, errored: [], essTried: false, only: null, capHit: null,
      }
    : newScratch(deps, user, ctx);
  if (!keep) s.only = only || null;
  // a day's answer kept for a day that is now ready (or asked again) is dropped
  if (s.pending && (d.days?.[s.pending.date] === "done" || only)) s.pending = null;
  /** the bookings given back before the scratch is written (a kept run's are in its stored scratch) */
  const dropAll = async (list: Booking[]) => {
    if (keep) {
      s.bookings = list;
      await giveBack(deps, tripId, s, { retry: true });
    } else if (list.length) await deps.db.deleteUsage(list.map((b) => b.id)).catch(() => undefined);
  };

  // the requests this run needs, booked now with the traveller's session (the free trip of the month on the outline)
  const missing = days.filter((x) => (only ? x.dates![0] === only : d.days?.[x.dates![0]] !== "done"));
  const needs: string[] = [...(!only && !d.outline ? ["outline"] : []), ...(!only && !d.essentials ? ["essentials"] : []), ...missing.filter((x) => s.pending?.date !== x.dates![0]).map(() => "day")];
  if (!needs.length && !s.pending) {
    // nothing left to prepare: the review
    const res = await unlock({ status: "review", error: undefined });
    await dropAll(s.bookings);
    return reply({ ok: true, at: res?.at || 0 }, 200, origin);
  }
  const have = [...s.bookings];
  const booked: Booking[] = [];
  const newly: Booking[] = [];
  for (const task of needs) {
    const i = have.findIndex((b) => b.task === task);
    if (i >= 0) {
      booked.push(have.splice(i, 1)[0]);
      continue;
    }
    const b = await deps.reserve(token, task, tripId).catch(() => ({ refused: "error" as const }));
    if ("id" in b) {
      booked.push({ id: b.id, task });
      newly.push({ id: b.id, task });
      continue;
    }
    const why = refusalOf(b.refused);
    // the outline refused (the trip of the month, the cap) or nothing booked at all: the run does not start
    if (task === "outline" || !booked.length) {
      await dropAll([...booked, ...have]);
      // the preparation says why it stopped (a day asked again from the review only answers the app)
      await unlock(action === "start" && d.status === "preparing" ? { error: why.message } : {});
      return reply({ error: why.error, message: why.message }, why.status, origin);
    }
    s.capHit = why.message;
    break;
  }
  // bookings of an earlier start that this run does not need any more
  if (have.length) await deps.db.deleteUsage(have.map((b) => b.id)).catch(() => undefined);
  s.bookings = booked;
  s.done = false;
  s.at = now;
  // a kept run is written over the version read above (a new run replaces whatever was there: the calls of the old
  // one find another run and stop)
  const next: Scratch = { ...s, v: (Number(s.v) || 0) + 1 };
  if (!(await deps.db.writeScratch(tripId, next, keep ? { run: keep.run, v: Number(keep.v) || 0 } : null))) {
    if (newly.length) await deps.db.deleteUsage(newly.map((b) => b.id)).catch(() => undefined);
    await unlock();
    return reply({ error: "busy" }, 409, origin);
  }
  s.v = next.v;
  const res = await commit(deps, tripId, (data) => {
    const dd = draftOf(data);
    if (!dd || dd.status === "done" || dd.lease?.hold !== lock) return null;
    const dayMap = { ...(dd.days || {}) };
    if (only) delete dayMap[only];
    return draftWith(data, { status: "preparing", error: undefined, days: dayMap, lease: { by: "server", at: deps.now(), hold: null, step: stepCode(nextStep({ ...data, draft: { ...dd, days: dayMap } }, s)) } });
  });
  if (!res?.changed) {
    // stopped or validated meanwhile: the requests are given back
    await giveBack(deps, tripId, s, { retry: true });
    return reply({ error: "busy" }, 409, origin);
  }
  // the account's path: a preparation started (a day prepared again is « day_redone », recorded by the app)
  if (!only) ev(deps, user, "prep_started", keep ? "resume" : "new", tripId);
  deps.schedule(runUnit(tripId, deps).catch((e) => deps.log?.(`prepare run: ${String(e)}`)));
  return reply({ ok: true, at: res.at }, 200, origin);
}

// ---------- the cron's safety net ----------
/** The trips whose server preparation stopped showing signs of life (lease older than 6 minutes) */
export function staleRuns(trips: { id: string; data: Json }[], now: number, max = 3): string[] {
  return trips
    .filter((t) => {
      const d = draftOf(t.data || {});
      return !!d && d.status === "preparing" && d.lease?.by === "server" && now - Number(d.lease.at || 0) > LEASE_STALE;
    })
    // the oldest first (a trip that keeps failing never takes every slot)
    .sort((a, b) => Number(draftOf(a.data)!.lease!.at || 0) - Number(draftOf(b.data)!.lease!.at || 0))
    .slice(0, max)
    .map((t) => t.id);
}
/** Restarts them (called by api/cron.ts every 10 minutes); returns how many were restarted */
export async function kickStale(trips: { id: string; data: Json }[], serviceKey: string, f: typeof fetch = fetch, now = Date.now()): Promise<number> {
  const secret = deriveSecret(serviceKey);
  if (!secret) return 0;
  let n = 0;
  for (const id of staleRuns(trips, now)) if (await kickOnce(id, secret, f)) n++;
  return n;
}
async function kickOnce(tripId: string, secret: string, f: typeof fetch, action = "run", extra: Json = {}): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await f(PREP_URL, { method: "POST", headers: { "content-type": "application/json", "x-prep-key": secret }, body: JSON.stringify({ action, trip: tripId, ...extra }), signal: ctl.signal });
    return r.status === 202;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

// ---------- the real services ----------
/**
 * The scratch is stored sealed (AES-256-GCM, key derived from the service key): it holds the traveller's profile and
 * the AI's raw answers, and no account other than the server's may read them. Its run and version stay in clear (the
 * conditional writes filter on them).
 */
export function scratchBox(serviceKey: string) {
  const k = createHmac("sha256", serviceKey).update("orbes-prep-scratch").digest();
  return {
    seal(s: Scratch): Json {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", k, iv);
      const body = Buffer.concat([c.update(JSON.stringify(s), "utf8"), c.final()]);
      return { run: s.run, v: s.v, enc: Buffer.concat([iv, c.getAuthTag(), body]).toString("base64") };
    },
    open(d: unknown): Scratch | null {
      if (!d || typeof d !== "object") return null;
      const o = d as Json;
      if (typeof o.enc !== "string") return o.run ? (o as unknown as Scratch) : null;
      try {
        const buf = Buffer.from(o.enc, "base64");
        const dc = createDecipheriv("aes-256-gcm", k, buf.subarray(0, 12));
        dc.setAuthTag(buf.subarray(12, 28));
        const s = JSON.parse(Buffer.concat([dc.update(buf.subarray(28)), dc.final()]).toString("utf8")) as Scratch;
        return s && s.run === o.run ? { ...s, v: Number(o.v) || 0 } : null;
      } catch {
        return null;
      }
    },
  };
}

export function restDb(key: string, f: typeof fetch): Db {
  const box = scratchBox(key);
  const enc = encodeURIComponent;
  const call = async (path: string, init: RequestInit = {}): Promise<unknown> => {
    const r = await f(`${SUPA_URL}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...((init.headers as Record<string, string>) || {}) } });
    if (!r.ok) throw Object.assign(new Error(`db ${r.status} ${path.split("?")[0]}`), { status: r.status });
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  };
  return {
    async getTrip(id) {
      const rows = (await call(`/rest/v1/trips?id=eq.${enc(id)}&select=data,updated_at`)) as { data: Json; updated_at: string }[];
      return rows?.[0] ? { data: rows[0].data || {}, updatedAt: rows[0].updated_at } : null;
    },
    async patchTrip(id, data, updatedAt) {
      const rows = (await call(`/rest/v1/trips?id=eq.${enc(id)}&updated_at=eq.${enc(updatedAt)}&select=updated_at`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ data, updated_at: new Date().toISOString() }) })) as unknown[];
      return Array.isArray(rows) && rows.length > 0;
    },
    async role(tripId, userId) {
      const rows = (await call(`/rest/v1/trip_members?trip_id=eq.${enc(tripId)}&user_id=eq.${enc(userId)}&select=role`)) as { role: string }[];
      return rows?.[0]?.role || null;
    },
    async listPlaces(tripId) {
      const rows = (await call(`/rest/v1/places?trip_id=eq.${enc(tripId)}&select=place_id,data,updated_at`)) as { place_id: string; data: Json; updated_at: string }[];
      return (rows || []).map((r) => ({ id: r.place_id, data: r.data || {}, updatedAt: r.updated_at }));
    },
    async insertPlace(tripId, id, data, by) {
      // the same id written twice (a step replayed after a cut): the row already there is kept
      await call("/rest/v1/places?on_conflict=trip_id,place_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ trip_id: tripId, place_id: id, data, updated_at: new Date().toISOString(), updated_by: by || null }) });
    },
    async patchPlace(tripId, id, data, updatedAt) {
      const rows = (await call(`/rest/v1/places?trip_id=eq.${enc(tripId)}&place_id=eq.${enc(id)}&updated_at=eq.${enc(updatedAt)}&select=place_id`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ data, updated_at: new Date().toISOString() }) })) as unknown[];
      return Array.isArray(rows) && rows.length > 0;
    },
    async getScratch(tripId) {
      const rows = (await call(`/rest/v1/place_states?trip_id=eq.${SCRATCH_TRIP}&place_id=eq.${enc(tripId)}&select=data`)) as { data: unknown }[];
      return box.open(rows?.[0]?.data);
    },
    async writeScratch(tripId, s, expect) {
      const row = { data: box.seal(s), updated_at: new Date().toISOString() };
      if (!expect) {
        await call("/rest/v1/place_states?on_conflict=trip_id,place_id", { method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ trip_id: SCRATCH_TRIP, place_id: tripId, ...row }) });
        return true;
      }
      // only over the run and the version this call read
      const rows = (await call(`/rest/v1/place_states?trip_id=eq.${SCRATCH_TRIP}&place_id=eq.${enc(tripId)}&data->>run=eq.${enc(expect.run)}&data->>v=eq.${Number(expect.v) || 0}&select=place_id`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify(row) })) as unknown[];
      return Array.isArray(rows) && rows.length > 0;
    },
    async updateUsage(id, detail) {
      try {
        await call(`/rest/v1/ai_usage?id=eq.${id}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify(detail) });
      } catch {
        // before supabase/saas-11.sql: the cost alone
        await call(`/rest/v1/ai_usage?id=eq.${id}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ usd: detail.usd, ok: detail.ok }) });
      }
    },
    async deleteUsage(ids) {
      if (ids.length) await call(`/rest/v1/ai_usage?id=in.(${ids.map(Number).filter(Number.isFinite).join(",")})`, { method: "DELETE" });
    },
    async profile(userId) {
      const rows = (await call(`/rest/v1/profiles?id=eq.${enc(userId)}&select=data`)) as { data: Json }[];
      return rows?.[0]?.data || {};
    },
    async pushSubs(userId) {
      return ((await call(`/rest/v1/push_subscriptions?user_id=eq.${enc(userId)}&select=endpoint,p256dh,auth`)) as { endpoint: string; p256dh: string; auth: string }[]) || [];
    },
    async dropPushSub(endpoint) {
      await call(`/rest/v1/push_subscriptions?endpoint=eq.${enc(endpoint)}`, { method: "DELETE" });
    },
    async email(userId) {
      const u = (await call(`/auth/v1/admin/users/${enc(userId)}`)) as { email?: string };
      return u?.email || null;
    },
    // the photo pass's lease: the row is made once, then taken only when free or stale (one row back = taken).
    // `at` is always written as a 13-digit ms number (or 0), so comparing it as text is right.
    // `done` (the end of the last finished pass) is a 13-digit ms number too: the cooldown compares it the same way.
    async claimPhotos(tripId, hold, now, cooldown) {
      const iso = new Date().toISOString();
      await call("/rest/v1/place_states?on_conflict=trip_id,place_id", { method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ trip_id: PHOTO_TRIP, place_id: tripId, data: { hold: null, at: 0 }, updated_at: iso }) });
      const free = `or(data->>hold.is.null,data->>at.lt.${Math.floor(now - LEASE_STALE)})`;
      const cond = cooldown ? `and=(${free},or(data->>done.is.null,data->>done.lt.${Math.floor(now - cooldown)}))` : `or=(data->>hold.is.null,data->>at.lt.${Math.floor(now - LEASE_STALE)})`;
      const rows = (await call(`/rest/v1/place_states?trip_id=eq.${PHOTO_TRIP}&place_id=eq.${enc(tripId)}&${cond}&select=place_id`, { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify({ data: { hold, at: Math.floor(now) }, updated_at: iso }) })) as unknown[];
      return Array.isArray(rows) && rows.length > 0;
    },
    async touchPhotos(tripId, hold, now) {
      await call(`/rest/v1/place_states?trip_id=eq.${PHOTO_TRIP}&place_id=eq.${enc(tripId)}&data->>hold=eq.${enc(hold)}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ data: { hold, at: Math.floor(now) }, updated_at: new Date().toISOString() }) });
    },
    async event(userId, name, detail, tripId) {
      // straight into the steps table (service key); a slow or failed write is dropped after 3 s
      await f(`${SUPA_URL}/rest/v1/events`, {
        method: "POST",
        headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify({ user_id: userId, name, detail: detail ? detail.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || null : null, trip_id: tripId.slice(0, 64) }),
        signal: AbortSignal.timeout(3000),
      }).then(() => undefined, () => undefined);
    },
    async releasePhotos(tripId, hold, now, note) {
      await call(`/rest/v1/place_states?trip_id=eq.${PHOTO_TRIP}&place_id=eq.${enc(tripId)}&data->>hold=eq.${enc(hold)}`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ data: { ...note, hold: null, at: Math.floor(now) }, updated_at: new Date().toISOString() }) });
    },
  };
}

let lastGeo = 0;
/** The same 1.1 s spacing, for the photo pass's OpenStreetMap requests (one counter: never more than 1 per 1.1 s) */
async function nomGate(): Promise<void> {
  const slot = Math.max(Date.now(), lastGeo + 1100);
  lastGeo = slot;
  const wait = slot - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
/** OpenStreetMap search: a place (never a city or an area), inside the box; one request per 1.1 s */
async function nominatim(q: string, box: [number, number, number, number], country: string, f: typeof fetch): Promise<[number, number] | null> {
  if (q.trim().length < 2) return null;
  const wait = lastGeo + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastGeo = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const [w, s, e, n] = box;
    const r = await f(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh,en${country ? `&countrycodes=${country}` : ""}&viewbox=${w},${n},${e},${s}&bounded=1&q=${encodeURIComponent(q)}`, { headers: { "user-agent": UA, referer: `${APP_URL}/` }, signal: ctl.signal });
    if (!r.ok) return null;
    const hit = ((await r.json()) as { lat: string; lon: string; place_rank?: number }[])[0];
    if (!hit || (Number(hit.place_rank) || 0) < 26) return null;
    return [+hit.lon, +hit.lat];
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function realDeps(): Deps | null {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) return null;
  const f = fetch;
  const secret = deriveSecret(key);
  let vapid = (process.env.VAPID_PRIVATE_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (vapid) {
    try {
      webpush.setVapidDetails("mailto:hello@joinentity.com", VAPID_PUBLIC, vapid);
    } catch {
      vapid = "";
    }
  }
  const resend = (process.env.RESEND_API_KEY || "").trim();
  const from = process.env.MAIL_FROM || "ORBES Trips <trips@auth.theorbes.com>";
  return {
    db: restDb(key, f),
    ai: (task, body) => runTask(task, body, { deadlineMs: AI_DEADLINE }),
    reserve: (token, task, tripId) => reserve(token, task, tripId, f),
    async verify(token) {
      const r = await f(`${SUPA_URL}/auth/v1/user`, { headers: { apikey: SUPA_KEY, authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      const u = (await r.json()) as { id?: string };
      return u?.id || null;
    },
    geocode: (q, box, country) => nominatim(q, box, country, f),
    push: vapid ? async (ph, payload) => void (await webpush.sendNotification({ endpoint: ph.endpoint, keys: { p256dh: ph.p256dh, auth: ph.auth } }, JSON.stringify(payload), { TTL: 6 * 3600 })) : undefined,
    mail: resend
      ? async (to, subject, html, text) => {
          const r = await f("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${resend}`, "content-type": "application/json" }, body: JSON.stringify({ from, to: [to], subject, html, text }) }).catch(() => null);
          return !!r?.ok;
        }
      : undefined,
    kick: (tripId) => kickOnce(tripId, secret, f),
    photoIo: { fetch: f, now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: (m) => console.warn(m), supaUrl: SUPA_URL, key, nomGate },
    kickPhotos: (tripId, hop) => kickOnce(tripId, secret, f, "photos-run", { hop }),
    async isMember(token) {
      const r = await f(`${SUPA_URL}/rest/v1/rpc/is_member`, { method: "POST", headers: { apikey: SUPA_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
      if (!r.ok) return false;
      return (await r.json().catch(() => null)) === true;
    },
    schedule: (p) => {
      try {
        waitUntil(p);
      } catch {
        void p;
      }
    },
    secret,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (m) => console.warn(m),
  };
}

export const OPTIONS = (req: Request) => handle(req);
export const POST = (req: Request) => handle(req);
