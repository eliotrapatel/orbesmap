import { useSyncExternalStore } from "react";

// "Mes voyages": the home, shown when the app is opened (once per session, not on every reload) and from the logo / trip menu
const firstOpen = (() => {
  try {
    return !sessionStorage.getItem("orbes.entered");
  } catch {
    return true;
  }
})();
let homeOpen = firstOpen;
// opened from inside a trip (logo, menu): "✕" goes back to it
let homeFromTrip = false;
const subs = new Set<() => void>();
export function openHome(open = true) {
  homeOpen = open;
  homeFromTrip = open;
  if (!open) {
    try {
      sessionStorage.setItem("orbes.entered", "1");
    } catch {
      /* ignore */
    }
  }
  subs.forEach((f) => f());
}
export const homeOpenedFromTrip = () => homeFromTrip;
export const useHome = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => homeOpen,
  );

// "Partager ce voyage" opened from the trip menu
let shareOpen = false;
const shareSubs = new Set<() => void>();
export function openShare(open = true) {
  shareOpen = open;
  shareSubs.forEach((f) => f());
}
export const useShare = () =>
  useSyncExternalStore(
    (f) => {
      shareSubs.add(f);
      return () => {
        shareSubs.delete(f);
      };
    },
    () => shareOpen,
  );

// the admin's screen (accounts, Pro codes, AI cost), opened from the account
let adminOpen = false;
const adminSubs = new Set<() => void>();
export function openAdmin(open = true) {
  adminOpen = open;
  adminSubs.forEach((f) => f());
}
export const useAdmin = () =>
  useSyncExternalStore(
    (f) => {
      adminSubs.add(f);
      return () => {
        adminSubs.delete(f);
      };
    },
    () => adminOpen,
  );

// From the home, a way straight into the trip at the right place: today's day on the map, or the next stop with the
// route started. Set just before opening the trip, read once by the map screen (App) when it opens on that trip.
export type HomeIntent = { tripId: string; kind: "day"; day: string } | { tripId: string; kind: "go"; placeId: string };
let intent: (HomeIntent & { at: number }) | null = null;
export function setIntent(i: HomeIntent) {
  intent = { ...i, at: Date.now() };
}
/** The intent for this trip, once (an old one, over 20 seconds, is dropped) */
export function takeIntent(tripId: string): HomeIntent | null {
  const i = intent;
  if (!i) return null;
  if (Date.now() - i.at > 20000) {
    intent = null;
    return null;
  }
  if (i.tripId !== tripId) return null;
  intent = null;
  return i;
}
