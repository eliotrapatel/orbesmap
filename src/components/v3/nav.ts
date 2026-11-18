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
