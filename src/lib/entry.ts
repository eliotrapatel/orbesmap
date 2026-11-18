// The entry keys of an address (see entryKeys.ts), read once when the app loads and kept in memory until the screen
// they open has used them, so they survive the sign-in and the onboarding. Only the cycle's own keys leave the
// address bar (src / by, t, p, copy, Supabase's code and the #trip stay).
import { useEffect, useRef } from "react";
import { ENTRY_KEYS, readEntry, withoutKeys, type Entry, type EntryKey } from "./entryKeys";
import { detectedTrip, type InboundItem } from "./alerts";

const JOIN_KEY = "orbes.join";
const JOIN_DAYS = 7;

const entry: Entry = typeof location !== "undefined" ? readEntry(location.search) : { new: false, booking: null, offline: false, join: null };

/** An invitation link opened on this device: remembered for 7 days (the person may sign up and confirm later) */
export function rememberJoin(token: string) {
  try {
    localStorage.setItem(JOIN_KEY, JSON.stringify({ token, at: Date.now() }));
  } catch {
    /* ignore: the link works for this opening only */
  }
}
export function forgetJoin() {
  entry.join = null;
  try {
    localStorage.removeItem(JOIN_KEY);
  } catch {
    /* ignore */
  }
}
/** The invitation waiting on this device, if any */
export function joinToken(): string | null {
  if (entry.join) return entry.join;
  try {
    const v = JSON.parse(localStorage.getItem(JOIN_KEY) || "null") as { token?: string; at?: number } | null;
    if (v?.token && /^[A-Za-z0-9_-]{20,64}$/.test(v.token) && Date.now() - (Number(v.at) || 0) < JOIN_DAYS * 864e5) return v.token;
  } catch {
    /* ignore */
  }
  return null;
}

if (typeof location !== "undefined") {
  if (entry.join) rememberJoin(entry.join);
  const present = [...ENTRY_KEYS.filter((k) => new URLSearchParams(location.search).has(k)), ...(new URLSearchParams(location.search).has("join") ? ["join"] : [])];
  if (present.length) {
    try {
      history.replaceState(history.state, "", location.pathname + withoutKeys(location.search, present) + location.hash);
    } catch {
      /* ignore */
    }
  }
}

/** The address asked for this (not used yet) */
export const entryHas = (k: EntryKey) => (k === "booking" ? entry.booking != null : entry[k]);
export const entryBooking = () => entry.booking;
/** Uses it: true once, then false */
export function takeEntry(k: EntryKey): boolean {
  const had = entryHas(k);
  if (k === "booking") entry.booking = null;
  else entry[k] = false;
  return had;
}

/**
 * "Préparer ce voyage" from a booking e-mail or notification: once the bookings are read, the one it names opens its
 * creation form (the same as touching "Créer ce voyage"). Called by InboundInbox.
 */
export function useBookingEntry(items: InboundItem[] | null, flow: { start: (it: InboundItem) => void }) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !items || entry.booking == null) return;
    const it = items.find((x) => x.id === entry.booking);
    done.current = true;
    takeEntry("booking");
    if (it && detectedTrip(it)) flow.start(it);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
}
