// Single source of truth for everything the user types in the app.
// - Always saved in this browser first (works offline, e.g. in a market with no signal).
// - When signed in, every change is also sent to Supabase through a small outbox
//   that retries until it succeeds.
import { useSyncExternalStore } from "react";
import type { Session } from "@supabase/supabase-js";
import { TRIP } from "../data/trip";
import { hasLegacyData, importLegacy } from "./legacy";
import { emptyData, uid, type Contact, type Data, type Photo, type Pin, type PlaceState, type Settings } from "./model";
import { PHOTO_BUCKET, supabase } from "./supabase";

const KEY = "orbes.v2." + TRIP.id;
const OUTBOX_KEY = KEY + ".outbox";

type Op =
  | { t: "place"; id: string }
  | { t: "contact"; id: string }
  | { t: "contact-del"; id: string }
  | { t: "pin"; id: string }
  | { t: "pin-del"; id: string }
  | { t: "photo"; id: string }
  | { t: "photo-del"; id: string; path?: string }
  | { t: "settings" };

export type SyncState = "local" | "idle" | "syncing" | "pending" | "error";

interface State {
  data: Data;
  session: Session | null;
  sync: SyncState;
  /** signed URLs for photos stored in Supabase, by photo id */
  photoUrls: Record<string, string>;
}

// ---------- persistence ----------
function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...emptyData(), ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  if (hasLegacyData()) {
    const imported = importLegacy();
    save(imported);
    return imported;
  }
  return emptyData();
}

function save(d: Data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Storage full: drop local copies of photos that are already safe in Supabase, then retry.
    const slim = { ...d, photos: d.photos.map((p) => (p.path ? { ...p, dataUrl: undefined } : p)) };
    try {
      localStorage.setItem(KEY, JSON.stringify(slim));
    } catch {
      toast("Mémoire du téléphone pleine : certaines photos ne sont pas enregistrées");
    }
  }
}

function loadOutbox(): Op[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]");
  } catch {
    return [];
  }
}

// ---------- tiny external store ----------
let state: State = { data: load(), session: null, sync: supabase ? "idle" : "local", photoUrls: {} };
let outbox: Op[] = loadOutbox();
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function setData(fn: (d: Data) => Data) {
  const data = fn(state.data);
  save(data);
  set({ data });
}
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

// ---------- toasts ----------
type ToastListener = (msg: string) => void;
const toastListeners = new Set<ToastListener>();
export function toast(msg: string) {
  toastListeners.forEach((l) => l(msg));
}
export function onToast(l: ToastListener) {
  toastListeners.add(l);
  return () => {
    toastListeners.delete(l);
  };
}

// ---------- outbox ----------
function enqueue(op: Op) {
  if (!supabase || !state.session) return;
  // keep only the latest op for the same row
  outbox = outbox.filter((o) => !(o.t === op.t && "id" in o && "id" in op && o.id === op.id) && !(o.t === "settings" && op.t === "settings"));
  outbox.push(op);
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  scheduleFlush();
}

let flushTimer: number | undefined;
function scheduleFlush(delay = 600) {
  window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(flush, delay);
}

let flushing = false;
async function flush() {
  if (!supabase || !state.session || flushing) return;
  if (!outbox.length) {
    if (state.sync !== "idle") set({ sync: "idle" });
    return;
  }
  flushing = true;
  set({ sync: "syncing" });
  try {
    while (outbox.length) {
      await run(outbox[0]);
      outbox = outbox.slice(1);
      localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
    }
    set({ sync: "idle" });
  } catch (e) {
    console.warn("[orbes] sync failed, will retry", e);
    set({ sync: navigator.onLine ? "error" : "pending" });
    scheduleFlush(20_000);
  } finally {
    flushing = false;
  }
}

async function run(op: Op) {
  const sb = supabase!;
  const user_id = state.session!.user.id;
  const trip_id = TRIP.id;
  const d = state.data;
  const check = ({ error }: { error: unknown }) => {
    if (error) throw error;
  };
  switch (op.t) {
    case "place": {
      const s = d.places[op.id] || {};
      check(await sb.from("place_states").upsert({ user_id, trip_id, place_id: op.id, data: s, updated_at: new Date(s.updatedAt || Date.now()).toISOString() }));
      return;
    }
    case "contact": {
      const c = d.contacts.find((x) => x.id === op.id);
      if (!c) return;
      check(await sb.from("contacts").upsert({ id: c.id, user_id, trip_id, place_id: c.placeId, name: c.name, kind: c.kind, value: c.value, message: c.message ?? null, created_at: new Date(c.createdAt).toISOString() }));
      markSynced("contacts", c.id);
      return;
    }
    case "contact-del":
      check(await sb.from("contacts").delete().eq("id", op.id));
      return;
    case "pin": {
      const p = d.pins.find((x) => x.id === op.id);
      if (!p) return;
      check(await sb.from("pins").upsert({ id: p.id, user_id, trip_id, name: p.name, lat: p.lat, lng: p.lng, note: p.note ?? null, updated_at: new Date(p.updatedAt).toISOString() }));
      markSynced("pins", p.id);
      return;
    }
    case "pin-del":
      check(await sb.from("pins").delete().eq("id", op.id));
      return;
    case "photo": {
      const ph = d.photos.find((x) => x.id === op.id);
      if (!ph) return;
      let path = ph.path;
      if (!path && ph.dataUrl) {
        path = `${user_id}/${trip_id}/${ph.placeId}/${ph.id}.jpg`;
        const blob = await (await fetch(ph.dataUrl)).blob();
        check(await sb.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true }));
      }
      if (!path) return;
      check(await sb.from("photos").upsert({ id: ph.id, user_id, trip_id, place_id: ph.placeId, path, created_at: new Date(ph.createdAt).toISOString() }));
      setData((dd) => ({ ...dd, photos: dd.photos.map((x) => (x.id === ph.id ? { ...x, path, synced: true } : x)) }));
      return;
    }
    case "photo-del":
      if (op.path) check(await sb.storage.from(PHOTO_BUCKET).remove([op.path]));
      check(await sb.from("photos").delete().eq("id", op.id));
      return;
    case "settings":
      check(await sb.from("settings").upsert({ user_id, eur_rate: d.settings.eurRate }));
      return;
  }
}

function markSynced(kind: "contacts" | "pins", id: string) {
  setData((d) => ({ ...d, [kind]: (d[kind] as (Contact | Pin)[]).map((x) => (x.id === id ? { ...x, synced: true } : x)) }));
}

// ---------- pull & merge (on sign-in and when the app comes back to the foreground) ----------
export async function pull() {
  if (!supabase || !state.session) return;
  const sb = supabase;
  set({ sync: "syncing" });
  try {
    await flush();
    const [ps, cs, pins, phs, st] = await Promise.all([
      sb.from("place_states").select("place_id,data,updated_at").eq("trip_id", TRIP.id),
      sb.from("contacts").select("*").eq("trip_id", TRIP.id),
      sb.from("pins").select("*").eq("trip_id", TRIP.id),
      sb.from("photos").select("*").eq("trip_id", TRIP.id),
      sb.from("settings").select("eur_rate").maybeSingle(),
    ]);
    for (const r of [ps, cs, pins, phs, st]) if (r.error) throw r.error;

    const local = state.data;
    const toPush: Op[] = [];

    // places: newest wins
    const places: Record<string, PlaceState> = { ...local.places };
    const remoteIds = new Set<string>();
    for (const r of ps.data!) {
      remoteIds.add(r.place_id);
      const remoteAt = new Date(r.updated_at).getTime();
      const l = local.places[r.place_id];
      if (!l || (l.updatedAt || 0) <= remoteAt) places[r.place_id] = { ...(r.data as PlaceState), updatedAt: remoteAt };
      else toPush.push({ t: "place", id: r.place_id });
    }
    for (const id of Object.keys(local.places)) if (!remoteIds.has(id)) toPush.push({ t: "place", id });

    // lists: remote rows + local rows never sent. A local row marked synced but missing remotely was deleted elsewhere.
    const contacts: Contact[] = cs.data!.map((r) => ({ id: r.id, placeId: r.place_id, name: r.name, kind: r.kind, value: r.value, message: r.message ?? undefined, createdAt: new Date(r.created_at).getTime(), synced: true }));
    for (const c of local.contacts) if (!c.synced && !contacts.some((x) => x.id === c.id)) { contacts.push(c); toPush.push({ t: "contact", id: c.id }); }

    const pinList: Pin[] = pins.data!.map((r) => ({ id: r.id, name: r.name, lat: r.lat, lng: r.lng, note: r.note ?? undefined, updatedAt: new Date(r.updated_at).getTime(), synced: true }));
    for (const p of local.pins) if (!p.synced && !pinList.some((x) => x.id === p.id)) { pinList.push(p); toPush.push({ t: "pin", id: p.id }); }

    const photos: Photo[] = phs.data!.map((r) => ({ id: r.id, placeId: r.place_id, path: r.path, createdAt: new Date(r.created_at).getTime(), synced: true, dataUrl: local.photos.find((x) => x.id === r.id)?.dataUrl }));
    for (const p of local.photos) if (!p.synced && !photos.some((x) => x.id === p.id)) { photos.push(p); toPush.push({ t: "photo", id: p.id }); }

    const settings: Settings = st.data ? { eurRate: Number(st.data.eur_rate) || local.settings.eurRate } : local.settings;
    if (!st.data) toPush.push({ t: "settings" });

    setData(() => ({ places, contacts, pins: pinList, photos, settings }));
    toPush.forEach(enqueue);
    await refreshPhotoUrls();
    if (!toPush.length) set({ sync: "idle" });
  } catch (e) {
    console.warn("[orbes] pull failed", e);
    set({ sync: navigator.onLine ? "error" : "pending" });
  }
}

async function refreshPhotoUrls() {
  if (!supabase) return;
  const need = state.data.photos.filter((p) => p.path && !p.dataUrl);
  if (!need.length) return;
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(need.map((p) => p.path!), 60 * 60 * 24);
  if (error || !data) return;
  const urls = { ...state.photoUrls };
  data.forEach((r, i) => {
    if (r.signedUrl) urls[need[i].id] = r.signedUrl;
  });
  set({ photoUrls: urls });
}

// ---------- auth ----------
export async function initAuth() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  set({ session: data.session });
  if (data.session) pull();
  supabase.auth.onAuthStateChange((event, session) => {
    const wasSignedIn = Boolean(state.session);
    set({ session, sync: session ? state.sync : "idle" });
    if (event === "SIGNED_IN" && !wasSignedIn) pull();
  });
  window.addEventListener("online", () => scheduleFlush(0));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.session) pull();
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

export async function signOut() {
  if (!supabase) return;
  await flush();
  await supabase.auth.signOut();
  outbox = [];
  localStorage.removeItem(OUTBOX_KEY);
  set({ session: null, sync: "idle", photoUrls: {} });
}

// ---------- actions ----------
export function updatePlace(id: string, patch: Partial<PlaceState>) {
  setData((d) => ({ ...d, places: { ...d.places, [id]: { ...d.places[id], ...patch, updatedAt: Date.now() } } }));
  enqueue({ t: "place", id });
}

export function addContact(c: Omit<Contact, "id" | "createdAt">) {
  const contact: Contact = { ...c, id: uid(), createdAt: Date.now() };
  setData((d) => ({ ...d, contacts: [...d.contacts, contact] }));
  enqueue({ t: "contact", id: contact.id });
}
export function deleteContact(id: string) {
  setData((d) => ({ ...d, contacts: d.contacts.filter((c) => c.id !== id) }));
  enqueue({ t: "contact-del", id });
}

export function addPin(p: Omit<Pin, "id" | "updatedAt">) {
  const pin: Pin = { ...p, id: uid(), updatedAt: Date.now() };
  setData((d) => ({ ...d, pins: [...d.pins, pin] }));
  enqueue({ t: "pin", id: pin.id });
  return pin;
}
export function updatePin(id: string, patch: Partial<Pin>) {
  setData((d) => ({ ...d, pins: d.pins.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)) }));
  enqueue({ t: "pin", id });
}
export function deletePin(id: string) {
  setData((d) => ({ ...d, pins: d.pins.filter((p) => p.id !== id) }));
  enqueue({ t: "pin-del", id });
}

export function addPhoto(placeId: string, dataUrl: string) {
  const photo: Photo = { id: uid(), placeId, dataUrl, createdAt: Date.now() };
  setData((d) => ({ ...d, photos: [...d.photos, photo] }));
  enqueue({ t: "photo", id: photo.id });
}
export function deletePhoto(id: string) {
  const ph = state.data.photos.find((p) => p.id === id);
  setData((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== id) }));
  enqueue({ t: "photo-del", id, path: ph?.path });
}

export function setEurRate(eurRate: number) {
  if (!(eurRate > 0)) return;
  setData((d) => ({ ...d, settings: { ...d.settings, eurRate } }));
  enqueue({ t: "settings" });
}

export function photoSrc(p: Photo): string | undefined {
  return p.dataUrl || state.photoUrls[p.id];
}
