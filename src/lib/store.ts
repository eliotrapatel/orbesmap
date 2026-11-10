// Single source of truth for everything the user adds in the app.
// - Saved on this device first (localStorage for text, IndexedDB for photo files): works offline.
// - When signed in with an authorised account (Eliot + his father share one space), every change
//   is also queued in an outbox and sent to Supabase, with automatic retries.
// - Data is kept per trip; settings (EUR rate) are shared.
import { useSyncExternalStore } from "react";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { TRIP_BY_ID, defaultTrip } from "../data/trip";
import type { Trip } from "../data/types";
import { deletePhotoFile, getPhoto, putPhoto, dataUrlToBlob } from "./idb";
import { LEGACY_MARKER, LEGACY_TRIP, hasLegacyData, importLegacy, readLegacyPhoto } from "./legacy";
import { emptyData, uid, type Contact, type Data, type Photo, type Pin, type PlaceState, type Settings } from "./model";
import { PHOTO_BUCKET, supabase } from "./supabase";

const dataKey = (tripId: string) => "orbes.v2." + tripId;
const SETTINGS_KEY = "orbes.settings";
const OUTBOX_KEY = "orbes.outbox.v2";
const TRIP_KEY = "orbes.trip";

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

function loadTrip(tripId: string): Data {
  return normalize(readJSON<Data>(dataKey(tripId)));
}

let warnedFull = false;
function saveTrip(tripId: string, d: Data) {
  if (writeJSON(dataKey(tripId), d)) {
    warnedFull = false;
    return;
  }
  // Storage full: the old version's inline photos (gz_p_*) are the usual culprit. Free them only
  // once they have been copied to IndexedDB (marker set by importLegacyPhotos).
  try {
    if (localStorage.getItem(LEGACY_MARKER + ".photos")) {
      Object.keys(localStorage).filter((k) => k.startsWith("gz_p_")).forEach((k) => localStorage.removeItem(k));
      if (writeJSON(dataKey(tripId), d)) return;
    }
  } catch {
    /* ignore */
  }
  if (!warnedFull) {
    warnedFull = true;
    toast("Mémoire du navigateur pleine : les dernières modifications ne sont pas enregistrées sur cet appareil");
  }
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

// One-time import of the June 2026 version's data
let legacyPhotos: ReturnType<typeof importLegacy>["photos"] = [];
let legacyRate: number | undefined;
(function migrateLegacy() {
  if (!hasLegacyData()) return;
  const existing = readJSON<Data>(dataKey(LEGACY_TRIP));
  const imported = importLegacy();
  legacyPhotos = imported.photos;
  legacyRate = imported.eurRate;
  // keep anything already typed in the new app, add the old data underneath
  const base = normalize(existing);
  const merged: Data = {
    places: { ...imported.data.places, ...base.places },
    contacts: [...base.contacts, ...imported.data.contacts.filter((c) => !base.contacts.some((x) => x.id === c.id))],
    pins: [...base.pins, ...imported.data.pins.filter((p) => !base.pins.some((x) => x.id === p.id))],
    photos: base.photos,
  };
  if (writeJSON(dataKey(LEGACY_TRIP), merged)) {
    try {
      localStorage.setItem(LEGACY_MARKER, "1");
    } catch {
      /* ignore */
    }
  }
})();

const savedSettings = readJSON<Settings>(SETTINGS_KEY);
const initialSettings: Settings = { eurRate: savedSettings?.eurRate || legacyRate || 7.7 };
const startTrip = initialTrip();

let state: State = {
  tripId: startTrip,
  data: loadTrip(startTrip),
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

/** Change the data of a trip (current or not) and save it */
function updateTripData(tripId: string, fn: (d: Data) => Data) {
  if (tripId === state.tripId) {
    const data = fn(state.data);
    saveTrip(tripId, data);
    set({ data });
  } else {
    saveTrip(tripId, fn(loadTrip(tripId)));
  }
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
  set({ tripId, data: loadTrip(tripId) });
  void loadPhotoUrls();
  subscribeRealtime();
  if (canSync()) void pull();
}

// ---------- photos: device files → object URLs ----------
const objectUrls = new Map<string, string>();
async function loadPhotoUrls() {
  const urls: Record<string, string> = { ...state.photoUrls };
  let changed = false;
  for (const p of state.data.photos) {
    if (urls[p.id] || !p.local) continue;
    try {
      const blob = await getPhoto(p.id);
      if (blob) {
        const u = URL.createObjectURL(blob);
        objectUrls.set(p.id, u);
        urls[p.id] = u;
        changed = true;
      }
    } catch {
      /* ignore */
    }
  }
  if (changed) set({ photoUrls: { ...state.photoUrls, ...urls } });
  await refreshSignedUrls();
}

async function importLegacyPhotos() {
  if (!legacyPhotos.length) return;
  let ok = 0;
  const added: Photo[] = [];
  for (const lp of legacyPhotos) {
    const dataUrl = readLegacyPhoto(lp);
    if (!dataUrl) continue;
    try {
      await putPhoto(lp.id, await dataUrlToBlob(dataUrl));
      added.push({ id: lp.id, placeId: lp.placeId, local: true, createdAt: Date.parse("2026-06-13T00:00:00+08:00") });
      ok++;
    } catch {
      /* keep the old copy */
    }
  }
  if (added.length) {
    updateTripData(LEGACY_TRIP, (d) => ({ ...d, photos: [...d.photos, ...added.filter((a) => !d.photos.some((x) => x.id === a.id))] }));
    added.forEach((p) => enqueue({ t: "photo", trip: LEGACY_TRIP, id: p.id }));
  }
  if (ok === legacyPhotos.length) {
    try {
      localStorage.setItem(LEGACY_MARKER + ".photos", "1");
    } catch {
      /* ignore */
    }
  }
  legacyPhotos = [];
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
  // an upsert followed by a delete of the same row only needs the delete
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
function flush(): Promise<void> {
  if (!canSync()) return Promise.resolve();
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
      check(await sb.from("place_states").upsert({ trip_id, place_id: op.id, data: s, updated_at: new Date(s.updatedAt || Date.now()).toISOString() }));
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
let pulling = false;
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
    await flush();
    const [ps, cs, pins, phs, st] = await Promise.all([
      sb.from("place_states").select("place_id,data,updated_at").eq("trip_id", trip),
      sb.from("contacts").select("*").eq("trip_id", trip),
      sb.from("pins").select("*").eq("trip_id", trip),
      sb.from("photos").select("*").eq("trip_id", trip),
      sb.from("settings").select("eur_rate").eq("id", 1).maybeSingle(),
    ]);
    for (const r of [ps, cs, pins, phs, st]) if (r.error) throw r.error;
    if (state.tripId !== trip) return; // the trip changed meanwhile; the new one pulls on its own

    // changes still waiting in the outbox win over the server copy
    const key = (o: Op) => ("id" in o ? `${o.t.replace("-del", "")}:${o.id}` : "settings");
    const tripOps = outbox.filter((o) => "trip" in o && o.trip === trip);
    const pendingUp = new Set(tripOps.filter((o) => !o.t.endsWith("-del")).map(key));
    const pendingDel = new Set(tripOps.filter((o) => o.t.endsWith("-del")).map(key));
    const settingsPending = outbox.some((o) => o.t === "settings");
    const toPush: Op[] = [];

    setData((local) => {
      const places: Record<string, PlaceState> = { ...local.places };
      const remoteIds = new Set<string>();
      for (const r of ps.data!) {
        remoteIds.add(r.place_id);
        if (pendingUp.has(`place:${r.place_id}`)) continue;
        const remoteAt = new Date(r.updated_at).getTime();
        const l = local.places[r.place_id];
        if (!l || (l.updatedAt || 0) <= remoteAt) places[r.place_id] = { ...(r.data as PlaceState), updatedAt: remoteAt };
        else toPush.push({ t: "place", trip, id: r.place_id });
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
          // never sent → keep it and send it; sent before but gone from the server → deleted elsewhere
          if (!l.synced) {
            out.push(l);
            if (!pendingUp.has(`${kind}:${l.id}`)) toPush.push({ t: kind, trip, id: l.id });
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
    if (pullAgain) {
      pullAgain = false;
      void pull();
    }
  }
}

async function refreshSignedUrls() {
  if (!canSync()) return;
  const need = state.data.photos.filter((p) => p.path && !state.photoUrls[p.id]);
  if (!need.length) return;
  const { data, error } = await supabase!.storage.from(PHOTO_BUCKET).createSignedUrls(need.map((p) => p.path!), 60 * 60 * 12);
  if (error || !data) return;
  const urls = { ...state.photoUrls };
  data.forEach((r, i) => {
    if (r.signedUrl) urls[need[i].id] = r.signedUrl;
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
    ch.on("postgres_changes", { event: "*", schema: "public", table, filter: `trip_id=eq.${trip}` }, onChange);
  }
  ch.on("postgres_changes", { event: "*", schema: "public", table: "settings" }, onChange);
  ch.subscribe();
  channel = ch;
}

// ---------- auth ----------
async function checkMembership() {
  if (!supabase || !state.session) return;
  const { data, error } = await supabase.rpc("is_member");
  if (error) {
    console.warn("[orbes] membership check failed", error);
    set({ member: null, sync: navigator.onLine ? "error" : "pending" });
    return;
  }
  set({ member: Boolean(data), sync: data ? state.sync : "denied" });
  if (data) {
    subscribeRealtime();
    void pull();
  }
}

export async function initAuth() {
  void loadPhotoUrls();
  void importLegacyPhotos();
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  set({ session: data.session });
  if (data.session) await checkMembership();
  supabase.auth.onAuthStateChange((event, session) => {
    const before = state.session?.user.id;
    set({ session });
    if (!session) {
      set({ member: null, sync: "idle" });
      subscribeRealtime();
      return;
    }
    if (event === "SIGNED_IN" && before !== session.user.id) void checkMembership();
  });
  window.addEventListener("online", () => {
    if (state.member === null && state.session) void checkMembership();
    else scheduleFlush(0);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && canSync()) void pull();
  });
}

export async function sendLoginEmail(email: string) {
  if (!supabase) throw new Error("not configured");
  const redirect = window.location.origin + window.location.pathname;
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: true } });
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
  setData((d) => ({ ...d, places: { ...d.places, [id]: { ...d.places[id], ...patch, updatedAt: Date.now() } } }));
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
