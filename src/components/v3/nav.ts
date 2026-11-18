import { useSyncExternalStore } from "react";

// "Mes voyages" opened from inside the app (trip menu)
let homeOpen = false;
const subs = new Set<() => void>();
export function openHome(open = true) {
  homeOpen = open;
  subs.forEach((f) => f());
}
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
