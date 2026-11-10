// Live position (GPS) + compass. The GPS itself uses no mobile data: only the map tiles and the
// occasional route request (a few KB) go over the network.
import { useSyncExternalStore } from "react";

export type Fix = { lat: number; lng: number; acc: number; heading: number | null; speed: number | null; t: number };
export type LocStatus = "off" | "searching" | "on" | "denied" | "unavailable";
type LocState = { status: LocStatus; fix: Fix | null; follow: boolean; compass: number | null };

const PREF = "orbes.locate";
let state: LocState = { status: "off", fix: null, follow: false, compass: null };
const subs = new Set<() => void>();
const set = (patch: Partial<LocState>) => {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
};
const remember = (on: boolean) => {
  try {
    if (on) localStorage.setItem(PREF, "1");
    else localStorage.removeItem(PREF);
  } catch {
    /* ignore */
  }
};

let watchId: number | null = null;
let onError: ((msg: string) => void) | null = null;
export function onLocateError(f: (msg: string) => void) {
  onError = f;
}

export function startLocate(follow = true) {
  if (!("geolocation" in navigator)) {
    set({ status: "unavailable" });
    onError?.("La localisation n'est pas disponible sur cet appareil");
    return;
  }
  set({ follow });
  if (watchId != null) return;
  set({ status: state.fix ? "on" : "searching" });
  remember(true);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      set({
        status: "on",
        fix: { lat: c.latitude, lng: c.longitude, acc: c.accuracy, heading: c.heading != null && !Number.isNaN(c.heading) ? c.heading : null, speed: c.speed, t: pos.timestamp },
      });
    },
    (err) => {
      if (err.code === 1) {
        stopLocate();
        set({ status: "denied" });
        onError?.("Localisation refusée : autorisez-la pour ce site dans les réglages du navigateur");
      } else if (!state.fix) {
        // no fix yet (indoors, tunnel): keep trying, the watch stays active
        onError?.("Position pas encore trouvée, ça peut prendre quelques secondes dehors");
      }
    },
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
  );
  startCompass();
}

export function stopLocate() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  stopCompass();
  remember(false);
  set({ status: "off", fix: null, follow: false, compass: null });
}

export function setFollow(follow: boolean) {
  if (state.follow !== follow) set({ follow });
}

export const getLoc = () => state;
export function useLoc<T>(sel: (s: LocState) => T): T {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => sel(state),
  );
}

/** Turns location back on at launch if it was on last time and permission is already granted (no prompt). */
export async function resumeLocate() {
  try {
    if (localStorage.getItem(PREF) !== "1") return;
    const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (p?.state === "granted") startLocate(false);
  } catch {
    /* ignore */
  }
}

// ---------- compass (direction the phone points to) ----------
type OrientEvt = DeviceOrientationEvent & { webkitCompassHeading?: number };
let compassOn = false;
let lastCompass = 0;
const onOrient = (e: Event) => {
  const o = e as OrientEvt;
  let h: number | null = null;
  if (typeof o.webkitCompassHeading === "number") h = o.webkitCompassHeading; // iOS
  else if (o.absolute && o.alpha != null) h = (360 - o.alpha) % 360; // Android (absolute)
  if (h == null) return;
  const now = performance.now();
  if (now - lastCompass < 120 && state.compass != null && Math.abs(h - state.compass) < 4) return;
  lastCompass = now;
  set({ compass: Math.round(h) });
};
function startCompass() {
  if (compassOn) return;
  const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
  const listen = () => {
    compassOn = true;
    window.addEventListener("deviceorientationabsolute", onOrient);
    window.addEventListener("deviceorientation", onOrient);
  };
  // iOS asks for permission; it must come from a tap, which is the case when the user taps "Ma position"
  if (D?.requestPermission) D.requestPermission().then((r) => r === "granted" && listen()).catch(() => {});
  else if (D) listen();
}
function stopCompass() {
  compassOn = false;
  window.removeEventListener("deviceorientationabsolute", onOrient);
  window.removeEventListener("deviceorientation", onOrient);
}
