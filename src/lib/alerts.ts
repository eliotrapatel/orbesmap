// Alerts on this phone and by e-mail (lot 6g, supabase/saas-7.sql + api/cron.ts), and bookings forwarded by e-mail
// to the account's own address (api/inbound.ts), waiting in the app until they are added to the trip.
import type { Flight, Trip } from "../data/types";
import type { ExtractResult } from "./ai";
import { t } from "./i18n";
import { geocode } from "./placeSearch";
import { createPlace, getState, updateProfile, updateTrip } from "./store";
import { supabase } from "./supabase";

const VAPID_PUBLIC = "BK5AQrfBJZC_DtZYyUGPrOeegzY8JzepoT5t6ia_5m1tF8sFZXySh39SlbBCQcfO6Ozc2lqdnQRCyID5f8O5ow4";
export const INBOUND_DOMAIN = "in.theorbes.com";

// ---------- preferences ----------
export type AlertPrefs = { email: boolean; push: boolean };
export const alertPrefs = (): AlertPrefs => {
  const a = (getState().profile.alerts || {}) as Partial<AlertPrefs>;
  return { email: a.email !== false, push: a.push !== false };
};
export const setAlertPrefs = (patch: Partial<AlertPrefs>) => updateProfile({ alerts: { ...alertPrefs(), ...patch } });

// ---------- notifications on this phone ----------
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
/** Why notifications cannot be turned on here (null = they can) */
export function pushBlocker(): string | null {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return ios() && !standalone() ? t("Sur iPhone, ajoutez d'abord l'app à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis ouvrez-la depuis l'icône.") : t("Ce navigateur ne reçoit pas de notifications.");
  }
  if (!location.hostname.endsWith(".vercel.app")) return t("Les notifications arrivent dans l'app installée : ouvrez orbesmap.vercel.app et ajoutez-la à l'écran d'accueil.");
  if (Notification.permission === "denied") return t("Les notifications sont bloquées pour cette app dans les réglages du téléphone.");
  return null;
}
const key = (s: string) => {
  const p = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
/** This phone receives notifications */
export async function pushEnabled(): Promise<boolean> {
  if (pushBlocker()) return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription()) && Notification.permission === "granted";
}
export async function enablePush() {
  const why = pushBlocker();
  if (why) throw new Error(why);
  if (!supabase || !getState().session) throw new Error(t("Connectez-vous d'abord."));
  if ((await Notification.requestPermission()) !== "granted") throw new Error(t("Notifications refusées : vous pouvez les autoriser dans les réglages du téléphone."));
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(VAPID_PUBLIC) }));
  const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  if (!j.endpoint || !j.keys?.p256dh || !j.keys.auth) throw new Error(t("Ce téléphone n'a pas pu s'abonner. Réessayez."));
  const { error } = await supabase.from("push_subscriptions").upsert({ endpoint: j.endpoint, user_id: getState().session!.user.id, p256dh: j.keys.p256dh, auth: j.keys.auth });
  if (error) throw new Error(t("Les alertes ne sont pas encore activées sur le serveur."));
  setAlertPrefs({ push: true });
}
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await supabase?.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    await sub.unsubscribe().catch(() => undefined);
  }
}

// ---------- forwarded bookings ----------
export async function inboundAddress(): Promise<string | null> {
  if (!supabase || !getState().session) return null;
  const { data, error } = await supabase.rpc("my_inbound_token");
  if (error || !data) return null;
  return `${data}@${INBOUND_DOMAIN}`;
}
export type InboundItem = { id: number; trip_id: string | null; received_at: string; from_addr: string | null; subject: string | null; extracted: Partial<ExtractResult>; status: string };
export async function inboundItems(): Promise<InboundItem[]> {
  if (!supabase || !getState().session) return [];
  const { data, error } = await supabase.from("inbound_items").select("id,trip_id,received_at,from_addr,subject,extracted,status").eq("status", "new").order("received_at", { ascending: false }).limit(30);
  return error ? [] : ((data || []) as InboundItem[]);
}
export async function dismissInbound(id: number) {
  await supabase?.from("inbound_items").update({ status: "dismissed" }).eq("id", id);
}

/** Adds what a forwarded booking holds to the open trip: flights, the hotel, and bookings as places (located on the map) */
export async function addInbound(item: InboundItem, trip: Trip): Promise<{ added: number; manual: string[] }> {
  const x = item.extracted || {};
  let added = 0;
  const manual: string[] = [];
  // flights: kept as arrival (around the start) or departure (around the end), never twice
  const fl = (x.flights || []).filter((f) => f.code && (f.departAt || f.arriveAt));
  if (fl.length) {
    const cur = [...trip.flights];
    for (const f of fl) {
      if (cur.some((c) => c.code === f.code && (c.departAt || "").slice(0, 10) === (f.departAt || "").slice(0, 10))) continue;
      const kind: Flight["kind"] = (f.arriveAt || "").slice(0, 10) <= trip.start ? "arrival" : "departure";
      cur.push({ code: f.code, airline: f.airline || undefined, from: f.from, to: f.to, fromCity: f.fromCity, toCity: f.toCity, terminal: f.terminal || undefined, departAt: f.departAt || undefined, arriveAt: f.arriveAt || undefined, kind, at: kind === "arrival" ? f.arriveAt || f.departAt : f.departAt || f.arriveAt });
      added++;
    }
    updateTrip(trip.id, { flights: cur });
  }
  // the hotel, when the trip does not have one yet
  const h = x.hotel;
  if (h?.name && (!trip.hotel.name || /à préciser|to be confirmed/i.test(trip.hotel.name))) {
    const box: [number, number, number, number] = [trip.center[0] - 0.6, trip.center[1] - 0.6, trip.center[0] + 0.6, trip.center[1] + 0.6];
    const g = await geocode(h.address || `${h.name} ${trip.title}`, box, new AbortController().signal, trip.country || "").catch(() => null);
    updateTrip(trip.id, { hotel: { name: h.name, lat: g ? g.ll[1] : trip.hotel.lat, lng: g ? g.ll[0] : trip.hotel.lng } });
    added++;
  }
  // bookings (restaurant, museum, meeting…): a place on its day and time
  for (const f of x.fixed || []) {
    if (!f.name) continue;
    const box: [number, number, number, number] = [trip.center[0] - 0.8, trip.center[1] - 0.8, trip.center[0] + 0.8, trip.center[1] + 0.8];
    const g = await geocode(f.address || `${f.name} ${trip.title}`, box, new AbortController().signal, trip.country || "").catch(() => null);
    if (!g) {
      manual.push(f.name);
      continue;
    }
    const day = trip.days.find((d) => d.dates?.includes(f.date))?.key || "ideas";
    const slot = f.time ? `${f.time.replace(":", "h")}${f.endTime ? `–${f.endTime.replace(":", "h")}` : ""}` : "";
    if (createPlace({ name: f.name, lat: g.ll[1], lng: g.ll[0], address: f.address, day, slot, type: "ajout", why: f.notes || "" })) added++;
  }
  await supabase?.from("inbound_items").update({ status: "added", trip_id: trip.id }).eq("id", item.id);
  return { added, manual };
}
