// Alerts on this phone and by e-mail (lot 6g, supabase/saas-7.sql + api/cron.ts), and bookings forwarded by e-mail
// to the account's own address (api/inbound.ts), waiting in the app until they are added to the trip.
import type { Flight, Trip } from "../data/types";
import type { ExtractResult } from "./ai";
import { t } from "./i18n";
import { geocode } from "./placeSearch";
import { createPlace, getState, updateProfile, updateTrip } from "./store";
import { addExpense, travellersOf } from "./business";
import { supabase } from "./supabase";
import { track } from "./track";

const VAPID_PUBLIC = "BK5AQrfBJZC_DtZYyUGPrOeegzY8JzepoT5t6ia_5m1tF8sFZXySh39SlbBCQcfO6Ozc2lqdnQRCyID5f8O5ow4";
export const INBOUND_DOMAIN = "in.theorbes.com";

// ---------- preferences ----------
export type AlertPrefs = { email: boolean; push: boolean };
export const alertPrefs = (): AlertPrefs => {
  const a = (getState().profile.alerts || {}) as Partial<AlertPrefs>;
  return { email: a.email !== false, push: a.push !== false };
};
export const setAlertPrefs = (patch: Partial<AlertPrefs>) => {
  updateProfile({ alerts: { ...alertPrefs(), ...patch } });
  for (const [k, v] of Object.entries(patch)) track("alerts_changed", `${k}_${v ? "on" : "off"}`);
};

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
/** A booking whose dates fall outside all the account's trips (api/inbound.ts): the trip it announces */
export type DetectedTrip = { city: string; country: string; start: string; end: string };
export type InboundItem = { id: number; trip_id: string | null; received_at: string; from_addr: string | null; subject: string | null; extracted: Partial<ExtractResult> & { detected?: DetectedTrip }; status: string };
// a flight often leaves the day before the trip starts, or lands the day after it ends (same rule as api/inbound.ts)
const NEAR_DAYS = 2;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const shiftDay = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/**
 * The new trip a forwarded booking announces: none once it was added to a trip, and none once one of the account's
 * trips covers its dates (created from another booking of the same stay, or by hand), so the same trip is never
 * offered twice; the booking then waits in the inbox like any other, to add to that trip.
 */
export const detectedTrip = (it: InboundItem): DetectedTrip | null => {
  const d = it.extracted?.detected;
  if (it.trip_id || !d || !ISO_DAY.test(d.start || "")) return null;
  const end = d.end && ISO_DAY.test(d.end) && d.end >= d.start ? d.end : d.start;
  const covered = Object.values(getState().trips).some((r) => {
    const rec = (r || {}) as { start?: unknown; end?: unknown; deleted?: unknown };
    const s = String(rec.start || "").slice(0, 10);
    const e = String(rec.end || "").slice(0, 10);
    return rec.deleted !== true && ISO_DAY.test(s) && ISO_DAY.test(e) && shiftDay(s, -NEAR_DAYS) <= end && shiftDay(e, NEAR_DAYS) >= d.start;
  });
  return covered ? null : d;
};
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
  const r = await applyBookings(item.extracted || {}, trip, item.subject || "");
  await supabase?.from("inbound_items").update({ status: "added", trip_id: trip.id }).eq("id", item.id);
  return r;
}

/**
 * A booking that announced a new trip, once that trip was created from it (lot retention): its flights, hotel and
 * bookings went into the trip through the creation form; here its prices become the trip's expenses (only for what
 * was kept in the form), and the booking leaves the inbox.
 */
export async function attachToNewTrip(item: InboundItem, trip: Trip): Promise<void> {
  const x = item.extracted || {};
  const draft = (getState().trips[trip.id]?.draft as { flightsText?: string; fixed?: { name?: string }[] } | undefined) || {};
  const flightsText = draft.flightsText || "";
  let kept = false;
  for (const f of x.flights || []) {
    if (!f.code || !(flightsText.includes(f.code) || trip.flights.some((c) => c.code === f.code))) continue;
    kept = true;
    if (f.price && f.price > 0) await spend(trip, f.price, f.currency, `${f.code} ${f.from}→${f.to}`, "flights", (f.departAt || "").slice(0, 10));
  }
  const h = x.hotel;
  if (h?.name && trip.hotel.name.trim() === h.name.trim()) {
    kept = true;
    if (h.price && h.price > 0) await spend(trip, h.price, h.currency, h.name, "lodging", h.checkIn);
  }
  for (const f of x.fixed || []) {
    if (!f.name || !(draft.fixed || []).some((k) => k.name === f.name)) continue;
    kept = true;
    if (f.price && f.price > 0) await spend(trip, f.price, f.currency, f.name, /restaurant|dîner|déjeuner|dinner|lunch/i.test(`${f.name} ${f.notes}`) ? "food" : "activities", f.date);
  }
  if (kept && x.bookingPrice && x.bookingPrice > 0 && !(x.flights || []).some((f) => f.price) && !x.hotel?.price) {
    await spend(trip, x.bookingPrice, x.bookingCurrency, item.subject || t("Réservation"), (x.flights || []).length ? "flights" : x.hotel?.name ? "lodging" : "activities", "");
  }
  // nothing of it kept in the form: it stays in the inbox, to add to the new trip by hand
  await supabase?.from("inbound_items").update(kept ? { status: "added", trip_id: trip.id } : { trip_id: trip.id }).eq("id", item.id);
}

/** Adds what a booking holds (read from an e-mail, a pasted text or a screenshot) to a trip: flights, hotel, bookings, prices */
export async function applyBookings(x: Partial<ExtractResult>, trip: Trip, subject = ""): Promise<{ added: number; manual: string[] }> {
  let added = 0;
  const manual: string[] = [];
  // flights: kept as arrival (around the start) or departure (around the end), never twice
  const fl = (x.flights || []).filter((f) => f.code && (f.departAt || f.arriveAt));
  if (fl.length) {
    const cur = [...trip.flights];
    for (const f of fl) {
      if (cur.some((c) => c.code === f.code && (c.departAt || "").slice(0, 10) === (f.departAt || "").slice(0, 10))) continue;
      const kind: Flight["kind"] = (f.arriveAt || "").slice(0, 10) <= trip.start ? "arrival" : "departure";
      cur.push({ code: f.code, airline: f.airline || undefined, from: f.from, to: f.to, fromCity: f.fromCity, toCity: f.toCity, terminal: f.terminal || undefined, departAt: f.departAt || undefined, arriveAt: f.arriveAt || undefined, kind, at: kind === "arrival" ? f.arriveAt || f.departAt : f.departAt || f.arriveAt, cabin: f.cabin || undefined, price: f.price || undefined, currency: f.currency || undefined });
      added++;
      if (f.price && f.price > 0) await spend(trip, f.price, f.currency, `${f.code} ${f.from}→${f.to}`, "flights", (f.departAt || "").slice(0, 10));
    }
    updateTrip(trip.id, { flights: cur });
  }
  // the hotel, when the trip does not have one yet
  const h = x.hotel;
  if (h?.name && (!trip.hotel.name || /à préciser|to be confirmed/i.test(trip.hotel.name))) {
    const box: [number, number, number, number] = [trip.center[0] - 0.6, trip.center[1] - 0.6, trip.center[0] + 0.6, trip.center[1] + 0.6];
    const g = await geocode(h.address || `${h.name} ${trip.title}`, box, new AbortController().signal, trip.country || "").catch(() => null);
    updateTrip(trip.id, { hotel: { name: h.name, lat: g ? g.ll[1] : trip.hotel.lat, lng: g ? g.ll[0] : trip.hotel.lng, nights: h.nights || undefined, price: h.price || undefined, currency: h.currency || undefined } });
    added++;
  }
  if (h?.name && h.price && h.price > 0) await spend(trip, h.price, h.currency, h.name, "lodging", h.checkIn);
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
    if (f.price && f.price > 0) await spend(trip, f.price, f.currency, f.name, /restaurant|dîner|déjeuner|dinner|lunch/i.test(`${f.name} ${f.notes}`) ? "food" : "activities", f.date);
  }
  // one total for the whole booking
  if (x.bookingPrice && x.bookingPrice > 0 && !(x.flights || []).some((f) => f.price) && !x.hotel?.price) {
    await spend(trip, x.bookingPrice, x.bookingCurrency, subject || t("Réservation"), (x.flights || []).length ? "flights" : x.hotel?.name ? "lodging" : "activities", "");
  }
  return { added, manual };
}

/** A price read in a forwarded booking becomes an expense of the trip (category, euros at today's rate) */
async function spend(trip: Trip, amount: number, currency: string | undefined, label: string, category: string, date: string) {
  const cur = (currency || "EUR").toUpperCase().slice(0, 3);
  let eur: number | null = cur === "EUR" ? amount : null;
  if (eur == null) {
    try {
      const j = await fetch(`https://api.frankfurter.dev/v2/rates?base=EUR&quotes=${cur}`).then((r) => (r.ok ? r.json() : null));
      const r = Number(Array.isArray(j) ? j[0]?.rate : j?.rates?.[cur]);
      if (r) eur = amount / r;
    } catch {
      /* rate unknown: the amount stays in its currency */
    }
  }
  const people = travellersOf(trip);
  addExpense({ amount: Math.round(amount * 100) / 100, currency: cur, label: label.slice(0, 80), date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10), paidBy: people[0] || "", split: [], category, eur }, trip.id);
}
