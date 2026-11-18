// The photos of the places and of the trips, on the phone: their public URLs (Supabase Storage only, reachable from
// China), the credit lines, the one-time request to the server for a trip lacking some (throttled and remembered), and
// the offline copy of the open trip's photos (the service worker answers from it).
import type { PhotoRef, PlacePhoto, Trip, TripCover } from "../data/types";
import { PLACE_PHOTO_BUCKET, SUPABASE_URL, supabase } from "./supabase";
import { getState } from "./store";
import { TRIP_BY_ID } from "../data/trip";
import { apiUrl } from "./ai";
import { t } from "./i18n";
import { coverMissing, isRef, needsLookup } from "./photoData";
import { phase, tripStartMs } from "./time";

export const PHOTO_CACHE = "orbes-photos-v1";

/** The public URL of a stored photo file */
export const photoUrl = (path: string) => `${SUPABASE_URL}/storage/v1/object/public/${PLACE_PHOTO_BUCKET}/${path}`;

/** « Photo · auteur · licence » */
export function creditLine(p: PhotoRef): string {
  return t("Photo · {author} · {license}", { author: p.author || t("Auteur inconnu"), license: licenseLabel(p.license) });
}
export const licenseLabel = (l: string) => (/^public domain$/i.test(l) ? t("Domaine public") : l);

/** Every photo shown in a trip, once each: the cover first (named after the trip, or after its place when it is one
 *  of the places' photos), then the places in their order */
export function tripCredits(trip: Trip): { name: string; photo: PhotoRef }[] {
  const out: { name: string; photo: PhotoRef }[] = [];
  const seen = new Set<string>();
  const add = (name: string, p: PhotoRef | TripCover | PlacePhoto | undefined) => {
    if (!isRef(p) || seen.has(p.key || p.path)) return;
    seen.add(p.key || p.path);
    out.push({ name, photo: p });
  };
  const cover = trip.cover;
  const from = cover && isRef(cover) && cover.from === "place" ? trip.places.find((p) => p.id === cover.placeId) : undefined;
  add(from ? from.name : trip.title, cover);
  for (const p of trip.places) add(p.name, p.photo);
  return out;
}

/** The places of the open trip still to look up (the place record's field times come from the trip's data) */
function missingOf(trip: Trip, coverOnly: boolean): number {
  const cover = coverMissing(trip.cover) ? 1 : 0;
  if (coverOnly) return cover;
  const st = getState();
  const defs = st.tripId === trip.id ? (st.data.defs as Record<string, { fieldsAt?: Record<string, number> } | undefined>) : {};
  return trip.places.filter((p) => needsLookup(p.photo, defs[p.id]?.fieldsAt)).length + cover;
}

const read = <T,>(k: string): T | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked: asked again next time */
  }
};

/** May this account ask the server for a trip's photos? Owner, editor; the code trips: a member of the first space */
export function canAskPhotos(trip: Pick<Trip, "id">): boolean {
  const st = getState();
  const role = st.roles[trip.id] || "";
  return role === "owner" || role === "editor" || (!!TRIP_BY_ID[trip.id] && st.member === true);
}

const asking = new Set<string>();
/**
 * Asks the server to find the photos a trip lacks (owner / editor, or a member for the two code trips). Throttled:
 * not within 10 minutes of the last ask, then every 6 hours while photos are still missing (sooner only when more
 * places lack one), and a refusal is remembered for a day. `coverOnly`: a listed trip whose places are not loaded.
 */
export async function askPhotos(trip: Trip, coverOnly = false): Promise<void> {
  const st = getState();
  if (!st.session || !supabase || typeof navigator === "undefined" || !navigator.onLine) return;
  if (!canAskPhotos(trip)) return;
  const missing = missingOf(trip, coverOnly);
  if (missing === 0 || asking.has(trip.id)) return;
  const key = `orbes.photos.ask.${trip.id}`;
  const prev = read<{ at: number; n: number; denied?: boolean }>(key);
  const now = Date.now();
  if (prev) {
    const age = now - (Number(prev.at) || 0);
    if (age < 10 * 60_000) return;
    if (prev.denied && age < 24 * 3600_000) return;
    if (age < 6 * 3600_000 && missing <= (Number(prev.n) || 0)) return;
  }
  asking.add(trip.id);
  const ctl = new AbortController();
  const tm = window.setTimeout(() => ctl.abort(), 15_000);
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) return;
    const res = await fetch(apiUrl("prepare"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: "photos", trip: trip.id }),
      signal: ctl.signal,
    });
    write(key, res.status === 403 ? { at: now, n: missing, denied: true } : { at: now, n: missing });
  } catch {
    /* offline or slow: asked again on a later opening */
  } finally {
    window.clearTimeout(tm);
    asking.delete(trip.id);
  }
}

const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};
/**
 * Keeps the open trip's photos for offline use (the service worker answers from this cache): every thumbnail and the
 * cover always; the places' large photos too while the trip is under way or starts within 14 days. Nothing when the
 * phone saves data. Done again when the set of photos changes, else once a day (the browser may empty the cache).
 */
export async function keepTripPhotos(trip: Trip): Promise<void> {
  if (typeof location === "undefined" || !location.hostname.endsWith(".vercel.app")) return;
  if (!navigator.serviceWorker?.controller || typeof caches === "undefined") return;
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
  const soon = phase(trip) === "during" || (phase(trip) === "before" && tripStartMs(trip) - Date.now() < 14 * 86_400_000);
  const urls = new Set<string>();
  if (isRef(trip.cover)) {
    urls.add(photoUrl(trip.cover.path));
    urls.add(photoUrl(trip.cover.thumb));
  }
  for (const p of trip.places) {
    if (!isRef(p.photo)) continue;
    urls.add(photoUrl(p.photo.thumb));
    if (soon) urls.add(photoUrl(p.photo.path));
  }
  if (!urls.size) return;
  const list = [...urls].sort();
  const key = `orbes.photos.kept.${trip.id}`;
  const h = hash(list.join("|"));
  const prev = read<{ hash: string; at: number }>(key);
  if (prev && prev.hash === h && Date.now() - (Number(prev.at) || 0) < 86_400_000) return;
  try {
    const cache = await caches.open(PHOTO_CACHE);
    const todo: string[] = [];
    for (const u of list) if (!(await cache.match(u))) todo.push(u);
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const u = todo[i++];
        try {
          const r = await fetch(u, { mode: "cors", credentials: "omit" });
          if (r.ok) await cache.put(u, r);
        } catch {
          /* one photo missing: fetched again next time */
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    write(key, { hash: h, at: Date.now() });
  } catch {
    /* no cache storage (private window): the photos load online */
  }
}
