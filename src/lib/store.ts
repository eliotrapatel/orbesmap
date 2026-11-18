// Single source of truth for everything the user adds in the app.
// - Saved on this device first (localStorage for text, IndexedDB for photo files): works offline.
// - When signed in with an authorised account (Eliot + his father share one space), every change
//   is queued in an outbox and sent to Supabase with automatic retries; other devices get live updates.
// - Place states merge field by field (two people editing different fields never overwrite each other).
// - Data is kept per trip; settings (EUR rate) are shared.
import { useSyncExternalStore } from "react";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { TRIP_BY_ID } from "../data/trip";
import { tripFromRecord, tripSeedPatch, type TripRec } from "./trips";
import type { Trip } from "../data/types";
import { dataUrlToBlob, deletePhotoFile, getPhoto, putPhoto } from "./idb";
import { LEGACY_MARKER, LEGACY_TRIP, hasLegacyData, importLegacy, legacyPhotoList, readLegacyPhoto } from "./legacy";
import { liveTripCached } from "./live";
import { migrationPatches } from "./defs";
import { emptyData, mergePlaceState, uid, type Contact, type Data, type Photo, type Pin, type PlaceDef, type PlaceState, type Settings } from "./model";
import { PHOTO_BUCKET, supabase } from "./supabase";

const dataKey = (tripId: string) => "orbes.v2." + tripId;
const SETTINGS_KEY = "orbes.settings";
const OUTBOX_KEY = "orbes.outbox.v2";
const TRIP_KEY = "orbes.trip";
const TRIPS_KEY = "orbes.trips.v1";
const PHOTOS_MARKER = LEGACY_MARKER + ".photos";

type Op =
  | { t: "place"; trip: string; id: string }
  | { t: "def"; trip: string; id: string }
  | { t: "trip"; trip: string; id: string }
  | { t: "contact"; trip: string; id: string }
  | { t: "contact-del"; trip: string; id: string }
  | { t: "pin"; trip: string; id: string }
  | { t: "pin-del"; trip: string; id: string }
  | { t: "photo"; trip: string; id: string }
  | { t: "photo-del"; trip: string; id: string; path: string }
  | { t: "settings" };

export type SyncState = "local" | "idle" | "syncing" | "pending" | "error" | "denied";

interface State {
  tripId: string;
  /** every trip's record (table "trips"), whatever the current trip */
  trips: Record<string, TripRec>;
  data: Data;
  settings: Settings;
  session: Session | null;
  /** null = not checked yet */
  member: boolean | null;
  sync: SyncState;
  /** displayable URL per photo id (object URL from this device, or a signed URL) */
  photoUrls: Record<string, string>;
  /** number of changes waiting to be sent */
  pending: number;
  /** last time everything was sent and received (ms) */
  syncedAt: number | null;
}

// ---------- toasts (queued until the UI subscribes) ----------
type ToastListener = (msg: string) => void;
const toastListeners = new Set<ToastListener>();
const toastQueue: string[] = [];
export function toast(msg: string) {
  if (!toastListeners.size) toastQueue.push(msg);
  else toastListeners.forEach((l) => l(msg));
}
export function onToast(l: ToastListener) {
  toastListeners.add(l);
  toastQueue.splice(0).forEach((m) => l(m));
  return () => {
    toastListeners.delete(l);
  };
}

// ---------- persistence ----------
function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function normalize(d: Partial<Data> | null): Data {
  const e = emptyData();
  if (!d) return e;
  return {
    places: d.places || {},
    defs: d.defs || {},
    contacts: d.contacts || [],
    pins: d.pins || [],
    // keep metadata only (an early build stored photos inline)
    photos: (d.photos || []).map((p) => ({ id: p.id, placeId: p.placeId, path: p.path, local: p.local, createdAt: p.createdAt, synced: p.synced })),
  };
}

const loadTrip = (tripId: string): Data => normalize(readJSON<Data>(dataKey(tripId)));

/** The old version's inline photos (gz_p_*) can be freed once their copies are referenced in the Guangzhou data */
function freeLegacyPhotoKeys(): boolean {
  try {
    if (!localStorage.getItem(PHOTOS_MARKER)) return false;
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("gz_p_"));
    keys.forEach((k) => localStorage.removeItem(k));
    return keys.length > 0;
  } catch {
    return false;
  }
}

let warnedFull = false;
function saveTrip(tripId: string, d: Data): boolean {
  if (writeJSON(dataKey(tripId), d)) {
    warnedFull = false;
    return true;
  }
  if (freeLegacyPhotoKeys() && writeJSON(dataKey(tripId), d)) return true;
  if (!warnedFull) {
    warnedFull = true;
    toast("Mémoire du navigateur pleine : les dernières modifications ne sont pas enregistrées sur cet appareil");
  }
  return false;
}

// ---------- trips (table "trips", see trips.ts) ----------
const savedTrips = readJSON<Record<string, TripRec>>(TRIPS_KEY) || {};
const known = (id: string) => !!TRIP_BY_ID[id] || (!!savedTrips[id] && savedTrips[id].deleted !== true);

function initialTrip(): string {
  const fromHash = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (known(fromHash)) return fromHash;
  try {
    const saved = localStorage.getItem(TRIP_KEY);
    if (saved && known(saved)) return saved;
  } catch {
    /* ignore */
  }
  return defaultTripId(Object.keys(TRIP_BY_ID).map((id) => tripFromRecord(id, savedTrips[id], TRIP_BY_ID[id])));
}

/** The trip to open by default: the one in progress, else the next one, else the most recent */
function defaultTripId(list: Trip[], now = Date.now()): string {
  const t = (iso: string, end = false) => new Date(iso + (end ? "T23:59:00+08:00" : "T00:00:00+08:00")).getTime();
  const current = list.find((x) => now >= t(x.start) && now <= t(x.end, true));
  if (current) return current.id;
  const next = list.filter((x) => t(x.start) > now).sort((a, b) => t(a.start) - t(b.start))[0];
  return (next || [...list].sort((a, b) => b.start.localeCompare(a.start))[0] || { id: Object.keys(TRIP_BY_ID)[0] }).id;
}

// ---------- one-time import of the June 2026 version ----------
let legacyRate: number | undefined;
let legacyUnsaved: Data | null = null; // kept in memory if storage was too full to save it
(function migrateLegacy() {
  if (!hasLegacyData()) return;
  const base = normalize(readJSON<Data>(dataKey(LEGACY_TRIP)));
  const imported = importLegacy();
  legacyRate = imported.eurRate;
  const places: Record<string, PlaceState> = {};
  for (const id of new Set([...Object.keys(imported.data.places), ...Object.keys(base.places)])) {
    places[id] = mergePlaceState(imported.data.places[id], base.places[id]).merged;
  }
  const merged: Data = {
    places,
    defs: base.defs,
    contacts: [...base.contacts, ...imported.data.contacts.filter((c) => !base.contacts.some((x) => x.id === c.id))],
    pins: [...base.pins, ...imported.data.pins.filter((p) => !base.pins.some((x) => x.id === p.id))],
    photos: base.photos,
  };
  if (saveTrip(LEGACY_TRIP, merged)) {
    try {
      localStorage.setItem(LEGACY_MARKER, "1");
    } catch {
      /* ignore */
    }
  } else legacyUnsaved = merged;
})();

const savedSettings = readJSON<Settings>(SETTINGS_KEY);
const initialSettings: Settings = { eurRate: savedSettings?.eurRate || legacyRate || 7.7 };
const startTrip = initialTrip();
let migrateAtStart = true;

let state: State = {
  tripId: startTrip,
  trips: savedTrips,
  data: startTrip === LEGACY_TRIP && legacyUnsaved ? legacyUnsaved : loadTrip(startTrip),
  settings: initialSettings,
  session: null,
  member: null,
  sync: supabase ? "idle" : "local",
  photoUrls: {},
  pending: 0,
  syncedAt: null,
};
let outbox: Op[] = readJSON<Op[]>(OUTBOX_KEY) || [];
state.pending = outbox.length;
// the current trip's places become data at the first start of this version (and catch up at each start)
if (migrateAtStart) {
  migrateAtStart = false;
  queueMicrotask(() => migrate(state.tripId, false));
}
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** Change the data of a trip (current or not) and save it. Returns false if it could not be saved on the device. */
function updateTripData(tripId: string, fn: (d: Data) => Data): boolean {
  if (tripId === state.tripId) {
    const data = fn(state.data);
    const ok = saveTrip(tripId, data);
    set({ data });
    return ok;
  }
  return saveTrip(tripId, fn(loadTrip(tripId)));
}
const dataOf = (tripId: string) => (tripId === state.tripId ? state.data : loadTrip(tripId));
const setData = (fn: (d: Data) => Data) => updateTripData(state.tripId, fn);

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => sel(state),
  );
}
export const getState = () => state;

/** The trips written in the code belong to the first shared space: shown signed out (this phone only) or to its members */
const codeTripsVisible = () => !state.session || state.member !== false;

const baseCache = new Map<string, { rec: TripRec | undefined; trip: Trip }>();
/** A trip without its places (they come from the places table): its record over the trip of the code */
export function baseTrip(id: string): Trip {
  const rec = state.trips[id];
  const hit = baseCache.get(id);
  if (hit && hit.rec === rec) return hit.trip;
  const trip = tripFromRecord(id, rec, TRIP_BY_ID[id]);
  baseCache.set(id, { rec, trip });
  return trip;
}
/** Trips this person can open */
export function tripIds(): string[] {
  const ids = new Set(Object.keys(state.trips).filter((id) => state.trips[id]?.deleted !== true));
  if (codeTripsVisible()) for (const id of Object.keys(TRIP_BY_ID)) ids.add(id);
  return [...ids];
}
let listCache: { key: string; list: Trip[] } | null = null;
/** Trips this person can open (without their places), the most recent first */
export function listTrips(): Trip[] {
  const list = tripIds().map(baseTrip).sort((a, b) => b.start.localeCompare(a.start));
  const key = list.map((t) => t.id + ":" + (state.trips[t.id]?.updatedAt ?? 0)).join("|");
  if (listCache?.key === key) return listCache.list;
  listCache = { key, list };
  return list;
}
export function useTrips(): Trip[] {
  useStore((s) => s.trips);
  useStore((s) => s.session);
  useStore((s) => s.member);
  return listTrips();
}
/** The current trip as used in the app: the programme plus the places added and moved in the app (see live.ts) */
export function useTrip(): Trip {
  const id = useStore((s) => s.tripId);
  const places = useStore((s) => s.data.places);
  const pins = useStore((s) => s.data.pins);
  const defs = useStore((s) => s.data.defs);
  useStore((s) => s.trips[id]);
  return liveTripCached(baseTrip(id), { places, pins, defs });
}
export const currentTrip = (): Trip => liveTripCached(baseTrip(state.tripId), state.data);

export function switchTrip(tripId: string) {
  if (!tripIds().includes(tripId) || tripId === state.tripId) return;
  try {
    localStorage.setItem(TRIP_KEY, tripId);
  } catch {
    /* ignore */
  }
  try {
    history.replaceState(history.state, "", "#" + tripId);
  } catch {
    /* ignore */
  }
  set({ tripId, data: tripId === LEGACY_TRIP && legacyUnsaved ? legacyUnsaved : loadTrip(tripId) });
  migrate(tripId, false);
  void loadPhotoUrls();
  subscribeRealtime();
  if (canSync()) void pull();
}

// ---------- photos ----------
const objectUrls = new Map<string, string>();
const signedAt = new Map<string, number>();
const SIGNED_TTL = 12 * 3600;

async function loadPhotoUrls() {
  const urls: Record<string, string> = {};
  for (const p of state.data.photos) {
    if (state.photoUrls[p.id] || !p.local) continue;
    try {
      const blob = await getPhoto(p.id);
      if (blob) {
        const u = URL.createObjectURL(blob);
        objectUrls.set(p.id, u);
        urls[p.id] = u;
      }
    } catch {
      /* ignore */
    }
  }
  if (Object.keys(urls).length) set({ photoUrls: { ...state.photoUrls, ...urls } });
  await refreshSignedUrls();
}

/** Moves the old version's photos to IndexedDB. Runs at every start until it fully succeeded. */
async function importLegacyPhotos() {
  const list = legacyPhotoList();
  if (!list.length) return;
  const added: Photo[] = [];
  for (const lp of list) {
    const dataUrl = readLegacyPhoto(lp);
    if (!dataUrl) continue;
    try {
      await putPhoto(lp.id, await dataUrlToBlob(dataUrl));
      added.push({ id: lp.id, placeId: lp.placeId, local: true, createdAt: Date.parse("2026-06-13T00:00:00+08:00") });
    } catch {
      /* keep the old copy, retried next start */
    }
  }
  if (!added.length) return;
  const saved = updateTripData(LEGACY_TRIP, (d) => ({ ...d, photos: [...d.photos, ...added.filter((a) => !d.photos.some((x) => x.id === a.id))] }));
  // the marker (which allows freeing gz_p_* keys) is set only when every photo is referenced in saved data
  const stored = loadTrip(LEGACY_TRIP);
  if (saved && added.length === list.length && list.every((lp) => stored.photos.some((p) => p.id === lp.id))) {
    try {
      localStorage.setItem(PHOTOS_MARKER, "1");
    } catch {
      /* ignore */
    }
  }
  if (saved) added.forEach((p) => enqueue({ t: "photo", trip: LEGACY_TRIP, id: p.id }));
  if (state.tripId === LEGACY_TRIP) void loadPhotoUrls();
}

// ---------- outbox ----------
const sameRow = (a: Op, b: Op) => a.t === b.t && (a.t === "settings" || ("id" in a && "id" in b && a.id === b.id && a.trip === b.trip));

function persistOutbox() {
  writeJSON(OUTBOX_KEY, outbox); // the in-memory outbox stays the source of truth if this fails
  if (state.pending !== outbox.length) set({ pending: outbox.length });
}

/** Changes are always recorded, even signed out, and sent as soon as an authorised session exists */
function enqueue(op: Op) {
  outbox = outbox.filter((o) => !sameRow(o, op));
  if (op.t === "contact-del" || op.t === "pin-del" || op.t === "photo-del") {
    const up = op.t.replace("-del", "");
    outbox = outbox.filter((o) => !(o.t === up && "id" in o && o.trip === op.trip && o.id === op.id));
  }
  outbox.push(op);
  persistOutbox();
  scheduleFlush();
}

const canSync = () => Boolean(supabase && state.session && state.member);

let flushTimer: number | undefined;
function scheduleFlush(delay = 500) {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(() => void flush(), delay);
}

let flushing: Promise<void> | null = null;
let pulling = false;
let flushAfterPull = false;
/** completed op keys during a pull's fetch: the merge must not undo them */
let doneDuringPull: Set<string> | null = null;
const opKey = (o: Op) => ("id" in o ? `${o.t.replace("-del", "")}:${o.id}` : "settings");

function flush(fromPull = false): Promise<void> {
  if (!canSync()) return Promise.resolve();
  if (pulling && !fromPull) {
    flushAfterPull = true;
    return Promise.resolve();
  }
  if (flushing) return flushing;
  flushing = (async () => {
    if (!outbox.length) {
      if (state.sync !== "idle") set({ sync: "idle", syncedAt: Date.now() });
      return;
    }
    set({ sync: "syncing" });
    try {
      while (canSync()) {
        // place records wait (in the outbox) while the "places" table does not exist on the server yet
        const op = outbox.find((o) => !(o.t === "def" && defsMissing) && !(o.t === "trip" && tripsMissing));
        if (!op) break;
        try {
          await run(op);
        } catch (e) {
          // the op stays in the outbox; the other changes keep going
          if (e instanceof DefsMissing) continue;
          throw e;
        }
        outbox = outbox.filter((o) => o !== op);
        doneDuringPull?.add(opKey(op) + (op.t.endsWith("-del") ? ":del" : ""));
        persistOutbox();
      }
      // place changes still waiting for the "places" table: not "synced"
      if (outbox.some((o) => o.t === "def" || o.t === "trip")) set({ sync: "pending" });
      else set({ sync: "idle", syncedAt: Date.now() });
    } catch (e) {
      console.warn("[orbes] sync failed, will retry", e);
      set({ sync: navigator.onLine ? "error" : "pending" });
      scheduleFlush(20_000);
    }
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

// storage keys stay plain: an added place's id ("_pin:…") has a colon (programme ids are unchanged by this)
const photoPath = (trip: string, placeId: string, id: string) => `${trip}/${placeId.replace(/[^A-Za-z0-9._-]/g, "_")}/${id}.jpg`;

async function run(op: Op) {
  const sb = supabase!;
  const check = ({ error }: { error: unknown }) => {
    if (error) throw error;
  };
  if (op.t === "settings") {
    check(await sb.from("settings").upsert({ id: 1, eur_rate: state.settings.eurRate }));
    return;
  }
  if (op.t === "trip") {
    const { data: merged, error } = await sb.rpc("upsert_trip", { p_trip: op.id, p_data: state.trips[op.id] || {} });
    if (error) {
      if (isMissing(error, "trip")) {
        tripsMissing = true;
        throw new DefsMissing();
      }
      throw error;
    }
    if (merged) setTrips({ ...state.trips, [op.id]: mergePlaceState(state.trips[op.id] as PlaceState, merged as PlaceState).merged as TripRec });
    return;
  }
  const trip_id = op.trip;
  const d = dataOf(trip_id);
  switch (op.t) {
    case "def": {
      const s = d.defs[op.id] || {};
      const { data: merged, error } = await sb.rpc("upsert_place", { p_trip: trip_id, p_place: op.id, p_data: s });
      if (error) {
        if (isMissing(error, "place")) {
          defsMissing = true;
          throw new DefsMissing();
        }
        throw error;
      }
      if (merged) updateTripData(trip_id, (dd) => ({ ...dd, defs: { ...dd.defs, [op.id]: mergePlaceState(dd.defs[op.id] as PlaceState, merged as PlaceState).merged as PlaceDef } }));
      return;
    }
    case "place": {
      const s = d.places[op.id] || {};
      // server-side field-by-field merge (see supabase/schema.sql → upsert_place_state)
      const { data: merged, error } = await sb.rpc("upsert_place_state", { p_trip: trip_id, p_place: op.id, p_data: s });
      if (error) throw error;
      if (merged) {
        updateTripData(trip_id, (dd) => ({ ...dd, places: { ...dd.places, [op.id]: mergePlaceState(dd.places[op.id], merged as PlaceState).merged } }));
      }
      return;
    }
    case "contact": {
      const c = d.contacts.find((x) => x.id === op.id);
      if (!c) return;
      check(await sb.from("contacts").upsert({ id: c.id, trip_id, place_id: c.placeId, name: c.name, kind: c.kind, value: c.value, message: c.message ?? null, created_at: new Date(c.createdAt).toISOString() }));
      updateTripData(trip_id, (dd) => ({ ...dd, contacts: dd.contacts.map((x) => (x.id === c.id ? { ...x, synced: true } : x)) }));
      return;
    }
    case "contact-del":
      check(await sb.from("contacts").delete().eq("id", op.id));
      return;
    case "pin": {
      const p = d.pins.find((x) => x.id === op.id);
      if (!p) return;
      check(await sb.from("pins").upsert({ id: p.id, trip_id, name: p.name, lat: p.lat, lng: p.lng, note: p.note ?? null, updated_at: new Date(p.updatedAt).toISOString() }));
      updateTripData(trip_id, (dd) => ({ ...dd, pins: dd.pins.map((x) => (x.id === p.id ? { ...x, synced: true } : x)) }));
      return;
    }
    case "pin-del":
      check(await sb.from("pins").delete().eq("id", op.id));
      return;
    case "photo": {
      const ph = d.photos.find((x) => x.id === op.id);
      if (!ph) return;
      const path = ph.path || photoPath(trip_id, ph.placeId, ph.id);
      if (!ph.path) {
        const blob = await getPhoto(ph.id).catch(() => undefined);
        if (!blob) return; // file not on this device: nothing to send
        check(await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: true }));
      }
      check(await sb.from("photos").upsert({ id: ph.id, trip_id, place_id: ph.placeId, path, created_at: new Date(ph.createdAt).toISOString() }));
      updateTripData(trip_id, (dd) => ({ ...dd, photos: dd.photos.map((x) => (x.id === ph.id ? { ...x, path, synced: true } : x)) }));
      return;
    }
    case "photo-del":
      check(await sb.storage.from(PHOTO_BUCKET).remove([op.path]));
      check(await sb.from("photos").delete().eq("id", op.id));
      return;
  }
}

// ---------- pull & merge ----------
let pullAgain = false;
export async function pull() {
  if (!canSync()) return;
  if (pulling) {
    pullAgain = true;
    return;
  }
  pulling = true;
  const sb = supabase!;
  const trip = state.tripId;
  set({ sync: "syncing" });
  try {
    await flush(true);
    doneDuringPull = new Set();
    const [ps, cs, pins, phs, st, pl, tr] = await Promise.all([
      sb.from("place_states").select("place_id,data,updated_at").eq("trip_id", trip),
      sb.from("contacts").select("*").eq("trip_id", trip),
      sb.from("pins").select("*").eq("trip_id", trip),
      sb.from("photos").select("*").eq("trip_id", trip),
      sb.from("settings").select("eur_rate").eq("id", 1).maybeSingle(),
      sb.from("places").select("place_id,data,updated_at").eq("trip_id", trip),
      sb.from("trips").select("id,data,updated_at"),
    ]);
    for (const r of [ps, cs, pins, phs, st]) if (r.error) throw r.error;
    // the "places" table not created yet on the server: places stay on this phone and wait
    if (pl.error) {
      if (!isMissing(pl.error, "place")) throw pl.error;
      defsMissing = true;
    } else {
      defsMissing = false;
      placesKnown = true;
    }
    if (state.tripId !== trip) return; // the trip changed meanwhile; the new one pulls on its own

    // changes still waiting in the outbox, or sent while we were fetching, win over the fetched copy
    const tripOps = outbox.filter((o) => "trip" in o && o.trip === trip);
    const pendingUp = new Set(tripOps.filter((o) => !o.t.endsWith("-del")).map(opKey));
    const pendingDel = new Set(tripOps.filter((o) => o.t.endsWith("-del")).map(opKey));
    for (const k of doneDuringPull) {
      if (k.endsWith(":del")) pendingDel.add(k.slice(0, -4));
      else pendingUp.add(k);
    }
    const settingsPending = outbox.some((o) => o.t === "settings") || doneDuringPull.has("settings");
    const toPush: Op[] = [];
    const before = state.data.photos.map((p) => p.id);

    setData((local) => {
      const places: Record<string, PlaceState> = { ...local.places };
      const remoteIds = new Set<string>();
      for (const r of ps.data!) {
        remoteIds.add(r.place_id);
        if (pendingUp.has(`place:${r.place_id}`)) continue;
        const remote = { updatedAt: new Date(r.updated_at).getTime(), ...(r.data as PlaceState) };
        const { merged, localNewer } = mergePlaceState(local.places[r.place_id], remote);
        places[r.place_id] = merged;
        if (localNewer) toPush.push({ t: "place", trip, id: r.place_id });
      }
      for (const id of Object.keys(local.places)) if (!remoteIds.has(id) && !pendingUp.has(`place:${id}`)) toPush.push({ t: "place", trip, id });

      function mergeList<T extends { id: string; synced?: boolean }>(kind: "contact" | "pin" | "photo", remote: T[], localList: T[], localNewer?: (l: T, r: T) => boolean): T[] {
        const out: T[] = [];
        for (const r of remote) {
          if (pendingDel.has(`${kind}:${r.id}`)) continue;
          const l = localList.find((x) => x.id === r.id);
          if (l && pendingUp.has(`${kind}:${r.id}`)) out.push(l);
          else if (l && localNewer?.(l, r)) {
            out.push(l);
            toPush.push({ t: kind, trip, id: r.id });
          } else out.push(l ? ({ ...l, ...r, synced: true } as T) : r);
        }
        for (const l of localList) {
          if (out.some((x) => x.id === l.id) || pendingDel.has(`${kind}:${l.id}`)) continue;
          // never sent (or sent during this fetch) → keep; sent before but gone from the server → deleted elsewhere
          if (!l.synced || pendingUp.has(`${kind}:${l.id}`)) {
            out.push(l);
            if (!l.synced && !pendingUp.has(`${kind}:${l.id}`)) toPush.push({ t: kind, trip, id: l.id });
          }
        }
        return out;
      }

      const contacts = mergeList<Contact>(
        "contact",
        cs.data!.map((r) => ({ id: r.id, placeId: r.place_id, name: r.name, kind: r.kind, value: r.value, message: r.message ?? undefined, createdAt: new Date(r.created_at).getTime(), synced: true })),
        local.contacts,
      );
      const pinList = mergeList<Pin>(
        "pin",
        pins.data!.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng, note: r.note ?? undefined, updatedAt: new Date(r.updated_at).getTime(), synced: true })),
        local.pins,
        (l, r) => l.updatedAt > r.updatedAt,
      );
      const photos = mergeList<Photo>(
        "photo",
        phs.data!.map((r) => ({ id: r.id, placeId: r.place_id, path: r.path, createdAt: new Date(r.created_at).getTime(), synced: true })),
        local.photos,
      );
      // place records (the trip's places), merged field by field like place states
      const defs: Record<string, PlaceDef> = { ...local.defs };
      if (!pl.error) {
        const remoteDefs = new Set<string>();
        for (const r of pl.data!) {
          remoteDefs.add(r.place_id);
          if (pendingUp.has(`def:${r.place_id}`)) continue;
          const remote = { updatedAt: new Date(r.updated_at).getTime(), ...(r.data as PlaceState) };
          const { merged, localNewer } = mergePlaceState(local.defs[r.place_id] as PlaceState, remote);
          defs[r.place_id] = merged as PlaceDef;
          if (localNewer) toPush.push({ t: "def", trip, id: r.place_id });
        }
        for (const id of Object.keys(local.defs)) if (!remoteDefs.has(id) && !pendingUp.has(`def:${id}`)) toPush.push({ t: "def", trip, id });
      }
      return { places, defs, contacts, pins: pinList, photos };
    });

    // photos deleted on another device: free their file and URL here
    const now = new Set(state.data.photos.map((p) => p.id));
    for (const id of before) {
      if (now.has(id)) continue;
      void deletePhotoFile(id).catch(() => undefined);
      const u = objectUrls.get(id);
      if (u) URL.revokeObjectURL(u);
      objectUrls.delete(id);
      signedAt.delete(id);
    }

    if (st.data && !settingsPending) setSettingsLocal({ eurRate: Number(st.data.eur_rate) || state.settings.eurRate });
    else if (!st.data && !settingsPending) toPush.push({ t: "settings" });

    // every trip this person can open (records merged field by field)
    if (tr.error) {
      if (!isMissing(tr.error, "trip")) throw tr.error;
      tripsMissing = true;
    } else {
      tripsMissing = false;
      tripsKnown = true;
      const merged: Record<string, TripRec> = { ...state.trips };
      for (const r of tr.data!) {
        if (pendingUp.has(`trip:${r.id}`) || outbox.some((o) => o.t === "trip" && o.id === r.id)) continue;
        const remote = { updatedAt: new Date(r.updated_at).getTime(), ...(r.data as PlaceState) };
        const { merged: m, localNewer } = mergePlaceState(state.trips[r.id] as PlaceState, remote);
        merged[r.id] = m as TripRec;
        if (localNewer) toPush.push({ t: "trip", trip: r.id, id: r.id });
      }
      setTrips(merged);
    }
    toPush.forEach(enqueue);
    seedTrips();
    // what the other phone (maybe still on the previous version) changed, copied into the place records
    migrate(trip, true);
    subscribePlaces();
    await loadPhotoUrls();
    if (!outbox.length) set({ sync: "idle", syncedAt: Date.now() });
  } catch (e) {
    console.warn("[orbes] pull failed", e);
    set({ sync: navigator.onLine ? "error" : "pending" });
  } finally {
    pulling = false;
    doneDuringPull = null;
    if (flushAfterPull) {
      flushAfterPull = false;
      scheduleFlush(0);
    }
    if (pullAgain) {
      pullAgain = false;
      void pull();
    }
  }
}

async function refreshSignedUrls() {
  if (!canSync()) return;
  const nowS = Date.now() / 1000;
  // drop signed URLs that expire within the hour
  const urls = { ...state.photoUrls };
  for (const [id, t] of signedAt) {
    if (nowS - t > SIGNED_TTL - 3600) {
      delete urls[id];
      signedAt.delete(id);
    }
  }
  const need = state.data.photos.filter((p) => p.path && !urls[p.id]);
  if (!need.length) {
    if (Object.keys(urls).length !== Object.keys(state.photoUrls).length) set({ photoUrls: urls });
    return;
  }
  const { data, error } = await supabase!.storage.from(PHOTO_BUCKET).createSignedUrls(need.map((p) => p.path!), SIGNED_TTL);
  if (error || !data) return;
  data.forEach((r, i) => {
    if (r.signedUrl) {
      urls[need[i].id] = r.signedUrl;
      signedAt.set(need[i].id, nowS);
    }
  });
  set({ photoUrls: urls });
}

// ---------- live updates between devices (Eliot + his father) ----------
let channel: RealtimeChannel | null = null;
let liveTimer: number | undefined;
function subscribeRealtime() {
  if (channel) {
    void supabase?.removeChannel(channel);
    channel = null;
  }
  if (!canSync()) return;
  const trip = state.tripId;
  const onChange = () => {
    window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => void pull(), 1200);
  };
  const ch = supabase!.channel("orbes-" + trip);
  for (const table of ["place_states", "contacts", "pins", "photos"]) {
    ch.on("postgres_changes", { event: "INSERT", schema: "public", table, filter: `trip_id=eq.${trip}` }, onChange);
    ch.on("postgres_changes", { event: "UPDATE", schema: "public", table, filter: `trip_id=eq.${trip}` }, onChange);
    // DELETE events cannot be filtered (the old row only carries its primary key)
    ch.on("postgres_changes", { event: "DELETE", schema: "public", table }, onChange);
  }
  ch.on("postgres_changes", { event: "*", schema: "public", table: "settings" }, onChange);
  ch.subscribe();
  channel = ch;
  subscribePlaces();
}

// the "places" table has its own channel, opened only once it exists on the server: a table missing from
// a channel could stop the live updates of everything else
let placesChannel: RealtimeChannel | null = null;
let placesChannelTrip = "";
function subscribePlaces() {
  if (placesChannel && (placesChannelTrip !== state.tripId || !canSync() || defsMissing)) {
    void supabase?.removeChannel(placesChannel);
    placesChannel = null;
  }
  if (placesChannel || !canSync() || defsMissing || !placesKnown) return;
  const trip = state.tripId;
  const ch = supabase!.channel("orbes-places-" + trip);
  const onChange = () => {
    window.clearTimeout(liveTimer);
    liveTimer = window.setTimeout(() => void pull(), 1200);
  };
  ch.on("postgres_changes", { event: "*", schema: "public", table: "places", filter: `trip_id=eq.${trip}` }, onChange);
  // trips this person can open (a trip renamed or re-dated on the other phone)
  if (tripsKnown && !tripsMissing) ch.on("postgres_changes", { event: "*", schema: "public", table: "trips" }, onChange);
  ch.subscribe();
  placesChannel = ch;
  placesChannelTrip = trip;
}

// ---------- auth ----------
let memberRetry: number | undefined;
let memberDelay = 15_000;
let checking = false;
async function checkMembership() {
  if (!supabase || !state.session || checking) return;
  checking = true;
  window.clearTimeout(memberRetry);
  set({ sync: "syncing" });
  try {
    const { data, error } = await supabase.rpc("is_member");
    if (error) throw error;
    memberDelay = 15_000;
    set({ member: Boolean(data), sync: data ? "idle" : "denied" });
    if (data) {
      subscribeRealtime();
      void pull();
    }
  } catch (e) {
    console.warn("[orbes] membership check failed, will retry", e);
    set({ member: null, sync: navigator.onLine ? "error" : "pending" });
    memberRetry = window.setTimeout(() => void checkMembership(), memberDelay);
    memberDelay = Math.min(memberDelay * 2, 5 * 60_000);
  } finally {
    checking = false;
  }
}
const retryMembership = () => {
  if (state.session && state.member === null) void checkMembership();
};

export async function initAuth() {
  void loadPhotoUrls();
  void importLegacyPhotos();
  window.addEventListener("storage", onStorage);
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  set({ session: data.session });
  if (data.session) await checkMembership();
  supabase.auth.onAuthStateChange((_event, session) => {
    const before = state.session?.user.id;
    set({ session });
    if (!session) {
      window.clearTimeout(memberRetry);
      set({ member: null, sync: "idle" });
      subscribeRealtime();
      return;
    }
    if (before !== session.user.id) {
      set({ member: null });
      void checkMembership();
    } else retryMembership();
  });
  window.addEventListener("online", () => {
    retryMembership();
    scheduleFlush(0);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    retryMembership();
    if (canSync()) void pull();
  });
}

/** Another tab changed the same data: reload it and merge its pending changes */
function onStorage(e: StorageEvent) {
  if (e.key === dataKey(state.tripId)) set({ data: loadTrip(state.tripId) });
  else if (e.key === OUTBOX_KEY && e.newValue) {
    try {
      const theirs = JSON.parse(e.newValue) as Op[];
      const add = theirs.filter((o) => !outbox.some((x) => sameRow(x, o)));
      if (add.length) {
        outbox = [...outbox, ...add];
        set({ pending: outbox.length });
        scheduleFlush();
      }
    } catch {
      /* ignore */
    }
  } else if (e.key === SETTINGS_KEY) {
    const s = readJSON<Settings>(SETTINGS_KEY);
    if (s) set({ settings: s });
  }
}

// coming back to an earlier history entry (closing an overlay with "back") must keep the current trip in the URL
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    const h = "#" + state.tripId;
    if (location.hash !== h) {
      try {
        history.replaceState(history.state, "", h);
      } catch {
        /* ignore */
      }
    }
  });
}

export async function sendLoginEmail(email: string) {
  if (!supabase) throw new Error("not configured");
  const redirect = window.location.origin + window.location.pathname;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
  if (error) throw error;
}

/** Sign in with the e-mail + password created for each member in Supabase (no e-mail is sent). */
export async function signInWithPassword(email: string, password: string) {
  if (!supabase) throw new Error("not configured");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function verifyLoginCode(email: string, token: string) {
  if (!supabase) throw new Error("not configured");
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}

/** Signs out on this device. Unsent changes stay in the outbox and are sent at the next sign-in. */
export async function signOut() {
  if (!supabase) return;
  await flush().catch(() => undefined);
  await supabase.auth.signOut({ scope: "local" });
  set({ session: null, member: null, sync: "idle" });
}

// ---------- places as data (see defs.ts) ----------
/** true while the server has no "places" table yet (the SQL of supabase/places.sql not run) */
let defsMissing = false;
class DefsMissing extends Error {}
/** the table answered at least once (its live channel can be opened) */
let placesKnown = false;
/** The table / function of `what` ("place": places + upsert_place, "trip": trips + upsert_trip) is not on the server yet */
const isMissing = (e: { code?: string; message?: string }, what: "place" | "trip") => {
  const m = e.message || "";
  const names = what === "place" ? /\b(public\.)?(places|upsert_place)\b/i : /\b(public\.)?(trips|upsert_trip)\b/i;
  return (["PGRST202", "PGRST205", "42P01", "42883"].includes(e.code || "") && (names.test(m) || !m)) || (/could not find|does not exist/i.test(m) && names.test(m));
};
/** true while the server has no "trips" table yet (supabase/saas.sql not run) */
let tripsMissing = false;
let tripsKnown = false;

function setTrips(trips: Record<string, TripRec>) {
  writeJSON(TRIPS_KEY, trips);
  set({ trips });
}

/** Changes fields of a trip's record (title, dates, hotel, days, flights…), shared with its members */
export function updateTrip(id: string, patch: Record<string, unknown>) {
  const now = Date.now();
  const cur = state.trips[id] || {};
  const fieldsAt = { ...(cur.fieldsAt || {}) };
  for (const k of Object.keys(patch)) fieldsAt[k] = now;
  setTrips({ ...state.trips, [id]: { ...cur, ...patch, fieldsAt, updatedAt: now } });
  enqueue({ t: "trip", trip: id, id });
}

/** The trips of the code get their record (members of the first shared space only, once signed in) */
function seedTrips() {
  if (!canSync() || tripsMissing || !codeTripsVisible()) return;
  const next = { ...state.trips };
  const ids: string[] = [];
  for (const [id, code] of Object.entries(TRIP_BY_ID)) {
    const p = tripSeedPatch(code, next[id]);
    if (!p) continue;
    next[id] = mergePlaceState(next[id] as PlaceState, p as PlaceState).merged as TripRec;
    ids.push(id);
  }
  if (!ids.length) return;
  setTrips(next);
  ids.forEach((id) => enqueue({ t: "trip", trip: id, id }));
}

/** Brings the trip's place records up to date (first programme, places added before, previous version's changes) */
function migrate(tripId: string, pinsSynced: boolean) {
  if (!tripIds().includes(tripId)) return;
  const base = baseTrip(tripId);
  const patches = migrationPatches(base, dataOf(tripId), pinsSynced);
  const ids = Object.keys(patches);
  if (!ids.length) return;
  updateTripData(tripId, (d) => {
    const defs = { ...d.defs };
    for (const id of ids) defs[id] = mergePlaceState(defs[id] as PlaceState, patches[id] as PlaceState).merged as PlaceDef;
    return { ...d, defs };
  });
  ids.forEach((id) => enqueue({ t: "def", trip: tripId, id }));
}

/** Changes fields of a place's sheet (day, slot, removed, deleted, texts, hours, position…), shared with the other phone */
export function updateDef(id: string, patch: Record<string, unknown>) {
  const trip = state.tripId;
  const now = Date.now();
  setData((d) => {
    const cur = d.defs[id] || {};
    const fieldsAt = { ...(cur.fieldsAt || {}) };
    for (const k of Object.keys(patch)) fieldsAt[k] = now;
    return { ...d, defs: { ...d.defs, [id]: { ...cur, ...patch, fieldsAt, updatedAt: now } } };
  });
  enqueue({ t: "def", trip, id });
}

/** A new place of the trip (added from a search, a link or on the map); returns its id */
export function createPlace(fields: Record<string, unknown>): string {
  const id = uid();
  updateDef(id, { ...fields, origin: "added", order: 1e12 + Date.now() });
  return id;
}

// ---------- actions ----------
export function updatePlace(id: string, patch: Partial<PlaceState>) {
  const trip = state.tripId;
  const now = Date.now();
  setData((d) => {
    const cur = d.places[id] || {};
    const fieldsAt = { ...(cur.fieldsAt || {}) };
    for (const k of Object.keys(patch)) fieldsAt[k] = now;
    return { ...d, places: { ...d.places, [id]: { ...cur, ...patch, fieldsAt, updatedAt: now } } };
  });
  enqueue({ t: "place", trip, id });
}

/** Who is writing (first part of the signed-in e-mail), saved next to notes so the assistant can tell them apart */
export function currentAuthor(): string | undefined {
  const e = state.session?.user?.email;
  return e ? e.split("@")[0] : undefined;
}

/** Free-form shared records (checklist items, insurance, extra info on my places), stored like place states:
 * same offline queue, same field-by-field merge, same live sync. Ids use a prefix ("_check:", "_info:", "_pin:"). */
export function updateRecord(id: string, patch: Record<string, unknown>) {
  updatePlace(id, patch as Partial<PlaceState>);
}

export function addContact(c: Omit<Contact, "id" | "createdAt">) {
  const contact: Contact = { ...c, id: uid(), createdAt: Date.now() };
  setData((d) => ({ ...d, contacts: [...d.contacts, contact] }));
  enqueue({ t: "contact", trip: state.tripId, id: contact.id });
}
export function deleteContact(id: string) {
  setData((d) => ({ ...d, contacts: d.contacts.filter((c) => c.id !== id) }));
  enqueue({ t: "contact-del", trip: state.tripId, id });
}

export function addPin(p: Omit<Pin, "id" | "updatedAt">) {
  const pin: Pin = { ...p, id: uid(), updatedAt: Date.now() };
  setData((d) => ({ ...d, pins: [...d.pins, pin] }));
  enqueue({ t: "pin", trip: state.tripId, id: pin.id });
  return pin;
}
export function updatePin(id: string, patch: Partial<Pin>) {
  setData((d) => ({ ...d, pins: d.pins.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)) }));
  enqueue({ t: "pin", trip: state.tripId, id });
}
export function deletePin(id: string) {
  setData((d) => ({ ...d, pins: d.pins.filter((p) => p.id !== id) }));
  enqueue({ t: "pin-del", trip: state.tripId, id });
}

export async function addPhoto(placeId: string, blob: Blob): Promise<boolean> {
  const trip = state.tripId;
  const photo: Photo = { id: uid(), placeId, local: true, createdAt: Date.now() };
  try {
    await putPhoto(photo.id, blob);
  } catch {
    toast("Stockage plein : la photo n'a pas été enregistrée");
    return false;
  }
  const u = URL.createObjectURL(blob);
  objectUrls.set(photo.id, u);
  set({ photoUrls: { ...state.photoUrls, [photo.id]: u } });
  updateTripData(trip, (d) => ({ ...d, photos: [...d.photos, photo] }));
  enqueue({ t: "photo", trip, id: photo.id });
  return true;
}
export function deletePhoto(id: string) {
  const trip = state.tripId;
  const ph = state.data.photos.find((p) => p.id === id);
  setData((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== id) }));
  void deletePhotoFile(id).catch(() => undefined);
  const u = objectUrls.get(id);
  if (u) URL.revokeObjectURL(u);
  objectUrls.delete(id);
  if (ph) enqueue({ t: "photo-del", trip, id, path: ph.path || photoPath(trip, ph.placeId, id) });
}

function setSettingsLocal(s: Settings) {
  writeJSON(SETTINGS_KEY, s);
  set({ settings: s });
}
export function setEurRate(eurRate: number) {
  if (!(eurRate > 0)) return;
  setSettingsLocal({ ...state.settings, eurRate });
  enqueue({ t: "settings" });
}

export function photoSrc(p: Photo): string | undefined {
  return state.photoUrls[p.id];
}
