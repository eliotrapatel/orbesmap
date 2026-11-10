// Live position (GPS) + compass. The GPS itself uses no mobile data: only the map tiles and the
// occasional route request (a few KB) go over the network.
import { useSyncExternalStore } from "react";

export type Fix = { lat: number; lng: number; acc: number; heading: number | null; speed: number | null; t: number };
export type LocStatus = "off" | "searching" | "on" | "denied" | "unavailable";
type LocState = { status: LocStatus; fix: Fix | null; follow: boolean; followSince: number; compass: number | null; stale: boolean };

const PREF = "orbes.locate";
const STALE_MS = 30_000;
let state: LocState = { status: "off", fix: null, follow: false, followSince: 0, compass: null, stale: false };
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
const IOS = typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);
export const DENIED_HELP = IOS
  ? "Localisation refusée. Sur iPhone : Réglages › Confidentialité › Service de localisation › Sites Safari › « Lorsque l'app est active », puis aA › Réglages du site web › Position › Autoriser."
  : "Localisation refusée : autorisez la position pour ce site (icône à gauche de l'adresse, ou réglages du navigateur).";

let watchId: number | null = null;
let staleTimer: number | undefined;
let onError: ((msg: string) => void) | null = null;
export function onLocateError(f: (msg: string) => void) {
  onError = f;
}

const checkStale = () => {
  const s = !!state.fix && Date.now() - state.fix.t > STALE_MS;
  if (s !== state.stale) set({ stale: s });
};

/** fromGesture: true when called from a tap (iOS only allows the compass prompt then). */
export function startLocate(follow = true, fromGesture = true) {
  if (fromGesture) ensureCompass(true);
  if (!("geolocation" in navigator)) {
    set({ status: "unavailable" });
    onError?.("La localisation n'est pas disponible sur cet appareil");
    return;
  }
  setFollow(follow);
  if (watchId != null) return;
  set({ status: state.fix ? "on" : "searching" });
  remember(true);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      const prev = state.fix;
      const heading = c.heading != null && !Number.isNaN(c.heading) ? c.heading : null;
      // identical fix (phone standing still): only refresh its age, no re-render of the map
      if (prev && prev.lat === c.latitude && prev.lng === c.longitude && prev.acc === c.accuracy && state.status === "on") {
        prev.t = pos.timestamp;
        checkStale();
        return;
      }
      set({ status: "on", stale: false, fix: { lat: c.latitude, lng: c.longitude, acc: c.accuracy, heading, speed: c.speed, t: pos.timestamp } });
    },
    (err) => {
      if (err.code === 1) {
        stopLocate();
        set({ status: "denied" });
        onError?.(DENIED_HELP);
      } else if (!state.fix) {
        // no fix yet (indoors, tunnel): keep trying, the watch stays active
        onError?.("Position pas encore trouvée, ça peut prendre quelques secondes dehors");
      }
    },
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
  );
  window.clearInterval(staleTimer);
  staleTimer = window.setInterval(checkStale, 5_000);
  document.addEventListener("visibilitychange", checkStale);
  if (!fromGesture) ensureCompass(false);
}

export function stopLocate() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  window.clearInterval(staleTimer);
  document.removeEventListener("visibilitychange", checkStale);
  stopCompass();
  remember(false);
  set({ status: "off", fix: null, follow: false, compass: null, stale: false });
}

export function setFollow(follow: boolean) {
  if (state.follow !== follow) set({ follow, followSince: follow ? Date.now() : 0 });
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
    if (p?.state === "granted") startLocate(false, false);
  } catch {
    /* ignore */
  }
}

// ---------- compass (direction the phone points to) ----------
type OrientEvt = DeviceOrientationEvent & { webkitCompassHeading?: number };
let compassOn = false;
let asking = false;
let compassGen = 0;
let lastCompass = 0;
const angDiff = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const onOrient = (e: Event) => {
  const o = e as OrientEvt;
  let h: number | null = null;
  if (typeof o.webkitCompassHeading === "number") h = o.webkitCompassHeading; // iOS
  else if (o.absolute && o.alpha != null) h = (360 - o.alpha) % 360; // Android (absolute)
  if (h == null) return;
  h = (h + (screen.orientation?.angle ?? 0)) % 360; // landscape
  const now = performance.now();
  if (now - lastCompass < 200) return;
  if (state.compass != null && angDiff(h, state.compass) < 3) return;
  lastCompass = now;
  set({ compass: Math.round(h) });
};
const D = () => (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
function listen() {
  if (compassOn) return;
  compassOn = true;
  window.addEventListener("deviceorientationabsolute", onOrient);
  window.addEventListener("deviceorientation", onOrient);
}
/** Starts the compass. On iOS the permission prompt only works from a tap (prompt = true). */
export function ensureCompass(prompt: boolean) {
  if (compassOn || asking) return;
  const d = D();
  if (!d) return;
  if (!d.requestPermission) return listen();
  if (!prompt) return;
  asking = true;
  const gen = ++compassGen;
  d.requestPermission()
    .then((r) => {
      if (r === "granted" && gen === compassGen && watchId != null) listen();
    })
    .catch(() => {})
    .finally(() => {
      asking = false;
    });
}
function stopCompass() {
  compassGen++;
  compassOn = false;
  window.removeEventListener("deviceorientationabsolute", onOrient);
  window.removeEventListener("deviceorientation", onOrient);
}
