// Single source of truth for everything the user adds in the app.
// - Saved on this device first (localStorage for text, IndexedDB for photo files): works offline.
// - When signed in with an authorised account (Eliot + his father share one space), every change
//   is queued in an outbox and sent to Supabase with automatic retries; other devices get live updates.
// - Place states merge field by field (two people editing different fields never overwrite each other).
// - Data is kept per trip; settings (EUR rate) are shared.
import { useSyncExternalStore } from "react";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { TRIP_BY_ID, defaultTrip } from "../data/trip";
import type { Trip } from "../data/types";
import { dataUrlToBlob, deletePhotoFile, getPhoto, putPhoto } from "./idb";
import { LEGACY_MARKER, LEGACY_TRIP, hasLegacyData, importLegacy, legacyPhotoList, readLegacyPhoto } from "./legacy";
import { emptyData, mergePlaceState, uid, type Contact, type Data, type Photo, type Pin, type PlaceState, type Settings } from "./model";
import { PHOTO_BUCKET, supabase } from "./supabase";

const dataKey = (tripId: string) => "orbes.v2." + tripId;
const SETTINGS_KEY = "orbes.settings";
const OUTBOX_KEY = "orbes.outbox.v2";
const TRIP_KEY = "orbes.trip";
const PHOTOS_MARKER = LEGACY_MARKER + ".photos";

type Op =
  | { t: "place"; trip: string; id: string }
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

function initialTrip(): string {
  const fromHash = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (TRIP_BY_ID[fromHash]) return fromHash;
  try {
    const saved = localStorage.getItem(TRIP_KEY);
    if (saved && TRIP_BY_ID[saved]) return saved;
  } catch {
    /* ignore */
  }
  return defaultTrip().id;
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

let state: State = {
  tripId: startTrip,
  data: startTrip === LEGACY_TRIP && legacyUnsaved ? legacyUnsaved : loadTrip(startTrip),
  settings: initialSettings,
  session: null,
  member: null,
  sync: supabase ? "idle" : "local",
  photoUrls: {},
  pending: 0,
};
let outbox: Op[] = readJSON<Op[]>(OUTBOX_KEY) || [];
state.pending = outbox.length;
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
export const useTrip = (): Trip => TRIP_BY_ID[useStore((s) => s.tripId)];
export const currentTrip = (): Trip => TRIP_BY_ID[state.tripId];

export function switchTrip(tripId: string) {
  if (!TRIP_BY_ID[tripId] || tripId === state.tripId) return;
  try {
    localStorage.setItem(TRIP_KEY, tripId);
  } catch {
    /* ignore */
  }
  try {
    history.replaceState(null, "", "#" + tripId);
  } catch {
    /* ignore */
  }
  set({ tripId, data: tripId === LEGACY_TRIP && legacyUnsaved ? legacyUnsaved : loadTrip(tripId) });
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
      if (state.sync !== "idle") set({ sync: "idle" });
      return;
    }
    set({ sync: "syncing" });
    try {
      while (outbox.length && canSync()) {
        const op = outbox[0];
        await run(op);
        outbox = outbox.filter((o) => o !== op);
        doneDuringPull?.add(opKey(op) + (op.t.endsWith("-del") ? ":del" : ""));
        persistOutbox();
      }
      set({ sync: "idle" });
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

const photoPath = (trip: string, placeId: string, id: string) => `${trip}/${placeId}/${id}.jpg`;

async function run(op: Op) {
  const sb = supabase!;
  const check = ({ error }: { error: unknown }) => {
    if (error) throw error;
  };
  if (op.t === "settings") {
    check(await sb.from("settings").upsert({ id: 1, eur_rate: state.settings.eurRate }));
    return;
  }
  const trip_id = op.trip;
  const d = dataOf(trip_id);
  switch (op.t) {
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
    const [ps, cs, pins, phs, st] = await Promise.all([
      sb.from("place_states").select("place_id,data,updated_at").eq("trip_id", trip),
      sb.from("contacts").select("*").eq("trip_id", trip),
      sb.from("pins").select("*").eq("trip_id", trip),
      sb.from("photos").select("*").eq("trip_id", trip),
      sb.from("settings").select("eur_rate").eq("id", 1).maybeSingle(),
    ]);
    for (const r of [ps, cs, pins, phs, st]) if (r.error) throw r.error;
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
      return { places, contacts, pins: pinList, photos };
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

    toPush.forEach(enqueue);
    await loadPhotoUrls();
    if (!outbox.length) set({ sync: "idle" });
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
