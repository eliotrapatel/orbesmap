// A trip's public link (supabase/saas-6.sql): its owner opens it, anyone with it reads the programme without an
// account, and a signed-in person can copy it into their own trips with their own dates.
import type { Trip } from "../data/types";
import { META, tripFromDefs } from "./defs";
import { addDays, dateLabel, newTripRecord } from "./newTrip";
import { createPlace, createTrip, switchTrip, updateTrip } from "./store";
import { supabase } from "./supabase";
import { tripFromRecord, type TripRec } from "./trips";
import { refCode, track } from "./track";
import { tagUrl } from "./source";
import { t } from "./i18n";

const sb = () => {
  if (!supabase) throw new Error(t("Indisponible hors connexion."));
  return supabase;
};
const missing = (e: { code?: string } | null) => !!e && ["PGRST202", "PGRST205", "42883", "42P01"].includes(e.code || "");

/** The address to give: always the main site's */
export const linkUrl = (slug: string) => `https://theorbes.com/maps?t=${slug}`;
/** The same address as shared or copied: it says its channel and who shares it (?src=public&by=<opaque code>) */
export const shareUrl = (slug: string) => tagUrl(linkUrl(slug), "public", refCode());

/** The trip's public link: its slug and whether it is open; null = never opened (or not available yet) */
export async function linkOf(tripId: string): Promise<{ slug: string; active: boolean } | null> {
  const { data, error } = await sb().from("trip_links").select("slug,active").eq("trip_id", tripId).maybeSingle();
  if (error) {
    if (missing(error)) throw new Error(t("Le lien public n'est pas encore activé sur le serveur."));
    return null;
  }
  return (data as { slug: string; active: boolean } | null) || null;
}
export async function openLink(tripId: string): Promise<string> {
  const { data, error } = await sb().rpc("open_trip_link", { p_trip: tripId });
  if (error) throw new Error(missing(error) ? t("Le lien public n'est pas encore activé sur le serveur.") : error.code === "42501" ? t("Seul le propriétaire du voyage peut créer son lien.") : t("Le lien n'a pas pu être créé. Réessayez."));
  track("public_link_created", null, tripId);
  return String(data);
}
export async function closeLink(tripId: string) {
  const { error } = await sb().rpc("close_trip_link", { p_trip: tripId });
  if (error) throw new Error(t("Le lien n'a pas pu être désactivé. Réessayez."));
}

export type PublicTrip = { slug: string; trip: Trip; rec: TripRec; defs: Record<string, Record<string, unknown>> };
/** The programme behind a public link, as a trip the app can show; null = no such link, or closed */
export async function fetchPublic(slug: string): Promise<PublicTrip | null> {
  const { data, error } = await sb().rpc("public_trip", { p_slug: slug });
  if (error) throw new Error(missing(error) ? t("Les liens publics ne sont pas encore activés.") : t("Le programme n'a pas pu être chargé. Vérifiez le réseau."));
  if (!data) return null;
  const d = data as { trip: TripRec; places: Record<string, unknown>[] };
  const defs: Record<string, Record<string, unknown>> = { [META]: { seeded: true } };
  for (const p of d.places || []) if (typeof p.id === "string") defs[p.id] = { ...p, origin: "added" };
  const base = tripFromRecord(`pub-${slug}`, d.trip, undefined);
  const trip = tripFromDefs(base, { places: {}, pins: [], defs: defs as never }) || base;
  return { slug, trip, rec: d.trip, defs };
}

/** Copies a public programme into this account's trips, starting on `start` (same number of days); returns the new trip */
export function copyTrip(pub: PublicTrip, start: string): string {
  const src = pub.trip;
  const days = src.days.filter((d) => d.scheduled && d.dates?.length);
  const n = Math.max(1, days.length);
  const end = addDays(start, n - 1);
  const center = src.center || [0, 0];
  const rec = newTripRecord({ dest: { name: src.title, lat: center[1], lng: center[0], country: src.country || "" }, start, end }) as Record<string, unknown>;
  // the new days keep the programme's titles and themes, in the same order
  const newDays = (rec.days as Trip["days"]).map((d) => {
    const i = Number(/^d(\d+)$/.exec(d.key)?.[1]) - 1;
    const from = i >= 0 ? days[i] : undefined;
    return from ? { ...d, title: from.title || d.title, theme: from.theme || d.theme } : d;
  });
  const dayKey = new Map<string, string>(days.map((d, i) => [d.key, `d${i + 1}`]));
  const id = createTrip({ ...rec, days: newDays, subtitle: src.subtitle || t("Voyage"), timezone: src.timezone || rec.timezone, lang: src.lang, dateLabel: dateLabel(start, end) });
  switchTrip(id);
  for (const [pid, d] of Object.entries(pub.defs)) {
    if (pid === META) continue;
    const { id: _ignored, origin: _o, order: _r, ...fields } = d as Record<string, unknown>;
    const day = typeof d.day === "string" ? dayKey.get(d.day) || "ideas" : "ideas";
    createPlace({ ...fields, day });
  }
  // a copied programme is a ready trip: validated now (after its places, so they all reach the server)
  updateTrip(id, { draft: { status: "done", doneAt: Date.now() + 5, copiedFrom: pub.slug } });
  track("trip_copied", pub.slug, id);
  return id;
}

/** The copy asked before signing in: done once signed in */
const COPY_KEY = "orbes.copy";
export const rememberCopy = (slug: string) => {
  try {
    localStorage.setItem(COPY_KEY, slug);
  } catch {
    /* ignore */
  }
};
export const takeRememberedCopy = (): string | null => {
  try {
    const s = localStorage.getItem(COPY_KEY);
    if (s) localStorage.removeItem(COPY_KEY);
    return s;
  } catch {
    return null;
  }
};
