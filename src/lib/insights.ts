// Traveller profiles for the admin (supabase/saas-8.sql, admin_people): spending per category, destinations,
// flights, hotels, devices, and personas (rules on the profile and the behaviour). Also the CSV for partners,
// without the people who switched off partner offers.
import { EXPENSE_CATEGORIES } from "./business";
import { supabase } from "./supabase";
import { t } from "./i18n";

export type Person = {
  user_id: string; email: string; created_at: string; last_seen: string | null; profile: Record<string, unknown>;
  trips: { id: string; title: string | null; country: string | null; start: string; end: string; mode: string; days: number; travellers: number }[];
  spend: Record<string, number>; expenses: number;
  flights: { code?: string; airline?: string; from?: string; to?: string; cabin?: string; price?: number; currency?: string; trip: string }[];
  hotels: { name?: string; nights?: number; price?: number; currency?: string; trip: string; country?: string }[];
  places: Record<string, number>;
  seen: { cities: { city: string; country: string; n: number }[]; os: Record<string, number>; browsers: Record<string, number>; firstRef: string | null; steps: number };
  pro: boolean;
};

export async function people(userId?: string): Promise<Person[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_people", userId ? { p_user: userId } : {});
  if (error) {
    if (["PGRST202", "42883"].includes(error.code || "")) throw new Error(t("Lancez supabase/saas-8.sql pour voir les profils."));
    throw new Error(error.code === "42501" ? t("Réservé à l'administrateur.") : t("La lecture n'a pas pu se faire."));
  }
  return (data || []) as Person[];
}

const ASIA = new Set(["cn", "hk", "mo", "tw", "jp", "kr", "th", "vn", "sg", "my", "id", "ph", "in", "kh", "la", "mm", "lk", "np", "mv"]);
const EUROPE = new Set(["fr", "es", "pt", "it", "de", "gb", "ie", "nl", "be", "lu", "ch", "at", "gr", "hr", "cz", "pl", "hu", "dk", "se", "no", "fi", "is", "mt", "cy", "ee", "lv", "lt", "si", "sk", "ro", "bg", "rs", "me", "al", "mc"]);
const AMERICAS = new Set(["us", "ca", "mx", "br", "ar", "cl", "pe", "co", "cu", "do", "cr", "pa", "uy", "ec", "bo"]);
const ME_AF = new Set(["ae", "qa", "sa", "om", "jo", "il", "tr", "eg", "ma", "tn", "za", "ke", "tz", "mu", "sc"]);

export const totalSpend = (p: Person) => Object.values(p.spend || {}).reduce((s, v) => s + (Number(v) || 0), 0);
const share = (p: Person, k: string) => {
  const t = totalSpend(p);
  return t > 0 ? (Number(p.spend?.[k]) || 0) / t : 0;
};

/** The personas a person belongs to (French labels, translated where shown) */
export function personasOf(p: Person): string[] {
  const pr = p.profile || {};
  const tastes = (Array.isArray(pr.interests) ? (pr.interests as string[]) : []).join(" ").toLowerCase();
  const out: string[] = [];
  if (pr.travel === "business" || p.trips.some((t) => t.mode === "business")) out.push("Affaires / sourcing");
  const travel: Record<string, string> = { family: "Famille", duo: "À deux", friends: "Entre amis", solo: "Solo" };
  if (typeof pr.travel === "string" && travel[pr.travel]) out.push(travel[pr.travel]);
  const b = Number(pr.budget);
  if (b === 4) out.push("Luxe");
  else if (b === 3) out.push("Confort");
  else if (b === 1) out.push("Petit budget");
  if (share(p, "food") >= 0.35 || /cuisine|cafés|marchés/.test(tastes)) out.push("Gastronome");
  if (share(p, "shopping") >= 0.25 || /shopping|mode|design|artisanat/.test(tastes)) out.push("Shopping et mode");
  if (share(p, "activities") >= 0.3 || /musées|art|histoire|architecture/.test(tastes)) out.push("Culture et visites");
  if (/vie nocturne|musique/.test(tastes)) out.push("Sorties et vie nocturne");
  if (/nature|bien-être/.test(tastes)) out.push("Nature et bien-être");
  if (p.trips.length >= 3 || pr.tripsPerYear === "4-6" || pr.tripsPerYear === "7+") out.push("Grand voyageur");
  if (p.flights.some((f) => /business|first|affaires|première/i.test(f.cabin || ""))) out.push("Classe affaires");
  const countries = new Set(p.trips.map((t) => (t.country || "").toLowerCase()).filter(Boolean));
  if ([...countries].some((c) => ASIA.has(c))) out.push("Asie");
  if ([...countries].some((c) => EUROPE.has(c))) out.push("Europe");
  if ([...countries].some((c) => AMERICAS.has(c))) out.push("Amériques");
  if ([...countries].some((c) => ME_AF.has(c))) out.push("Moyen-Orient et Afrique");
  if (totalSpend(p) >= 3000) out.push("Gros dépensier");
  return out;
}

/** Everyone's figures: spending per category, destinations, airlines, cabins, cities, devices, personas */
export function overview(list: Person[]) {
  const cat: Record<string, number> = {};
  const dest = new Map<string, number>();
  const air = new Map<string, number>();
  const cabin = new Map<string, number>();
  const city = new Map<string, number>();
  const os = new Map<string, number>();
  const pers = new Map<string, number>();
  let trips = 0;
  let days = 0;
  for (const p of list) {
    for (const [k, v] of Object.entries(p.spend || {})) cat[k] = (cat[k] || 0) + (Number(v) || 0);
    for (const t of p.trips) {
      trips++;
      days += t.days || 0;
      const k = `${t.title || "?"}${t.country ? ` (${t.country.toUpperCase()})` : ""}`;
      dest.set(k, (dest.get(k) || 0) + 1);
    }
    for (const f of p.flights) {
      if (f.airline || f.code) air.set(f.airline || (f.code || "").slice(0, 2), (air.get(f.airline || (f.code || "").slice(0, 2)) || 0) + 1);
      if (f.cabin) cabin.set(f.cabin, (cabin.get(f.cabin) || 0) + 1);
    }
    const c = p.seen?.cities?.[0];
    if (c) city.set(`${c.city}${c.country ? ` (${c.country})` : ""}`, (city.get(`${c.city}${c.country ? ` (${c.country})` : ""}`) || 0) + 1);
    for (const [k, v] of Object.entries(p.seen?.os || {})) os.set(k, (os.get(k) || 0) + Number(v));
    for (const x of personasOf(p)) pers.set(x, (pers.get(x) || 0) + 1);
  }
  const top = (m: Map<string, number>, n = 8) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  const total = Object.values(cat).reduce((s, v) => s + v, 0);
  return { cat, total, trips, days, perTrip: trips ? total / trips : 0, perDay: days ? total / days : 0, dest: top(dest), air: top(air), cabin: top(cabin), city: top(city), os: top(os), personas: top(pers, 30) };
}

/** The partners' CSV: one line per person who did not switch off partner offers (`persona` given: that persona only) */
export function partnerCsv(list: Person[], persona?: string): { csv: string; rows: number } {
  const head = [
    "email", "prenom", "langue", "ville_frequente", "pays_frequent", "ville_depart", "age", "voyages_par_an", "connu_par", "facon_de_voyager", "budget", "rythme", "gouts",
    "nb_voyages", "destinations", "jours_de_voyage", "depenses_total_eur", ...EXPENSE_CATEGORIES.map((c) => `depenses_${c.key}_eur`),
    "nb_vols", "compagnies", "classes", "hotels", "pro", "personas", "inscrit_le", "derniere_connexion", "systeme", "navigateur",
  ];
  const rows = list.filter((p) => p.profile?.partnerOptOut !== true).filter((p) => !persona || personasOf(p).includes(persona));
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = rows.map((p) => {
    const pr = p.profile || {};
    const c = p.seen?.cities?.[0];
    const topOf = (o: Record<string, number>) => Object.entries(o || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    return [
      p.email, pr.name, pr.lang, c?.city, c?.country, pr.home, pr.age, pr.tripsPerYear, pr.heard, pr.travel, pr.budget, pr.pace,
      Array.isArray(pr.interests) ? (pr.interests as string[]).join(" | ") : "",
      p.trips.length, p.trips.map((t) => `${t.title || ""}${t.country ? ` (${t.country.toUpperCase()})` : ""}`).join(" | "), p.trips.reduce((s, t) => s + (t.days || 0), 0),
      totalSpend(p).toFixed(2), ...EXPENSE_CATEGORIES.map((k) => (Number(p.spend?.[k.key]) || 0).toFixed(2)),
      p.flights.length, [...new Set(p.flights.map((f) => f.airline).filter(Boolean))].join(" | "), [...new Set(p.flights.map((f) => f.cabin).filter(Boolean))].join(" | "),
      p.hotels.map((h) => h.name).filter((n) => n && !/à préciser|to be confirmed/i.test(n)).join(" | "),
      p.pro ? "oui" : "non", personasOf(p).join(" | "), p.created_at.slice(0, 10), (p.last_seen || "").slice(0, 10), topOf(p.seen?.os), topOf(p.seen?.browsers),
    ].map(cell).join(",");
  });
  return { csv: [head.join(","), ...lines].join("\n"), rows: rows.length };
}
