// ORBES Trips Pro (supabase/saas-4.sql): codes, waiting list, the admin's screens, an account's data (export, deletion).
// Online only: these are read from and written to the server.
import { supabase } from "./supabase";
import { track } from "./track";
import { discardPending, getState, listTrips, pullPlan, signOut } from "./store";

const sb = () => {
  if (!supabase) throw new Error("Indisponible hors connexion.");
  return supabase;
};
const missing = (e: { code?: string } | null) => !!e && ["PGRST202", "PGRST205", "42883", "42P01"].includes(e.code || "");
const fail = (e: { code?: string; message?: string } | null, what: string): void => {
  if (!e) return;
  if (missing(e)) throw new Error("Pro n'est pas encore activé sur le serveur.");
  if (e.code === "42501") throw new Error("Réservé à l'administrateur.");
  throw new Error(`${what} n'a pas pu se faire. Vérifiez le réseau et réessayez.`);
};

const CODE_ERRORS: Record<string, string> = {
  invalid: "Ce code n'existe pas ou n'est plus actif.",
  used_up: "Ce code a déjà été utilisé autant de fois que prévu.",
  already: "Ce code est déjà activé sur votre compte.",
  too_many: "Trop d'essais : réessayez dans une heure.",
  auth: "Connectez-vous pour activer un code.",
};
/** Activates a Pro code on this account; returns the end date (null = for life) */
export async function redeemCode(code: string): Promise<string | null> {
  const { data, error } = await sb().rpc("redeem_code", { p_code: code });
  fail(error, "L'activation");
  const r = (data || {}) as { ok?: boolean; error?: string; until?: string | null };
  if (!r.ok) throw new Error(CODE_ERRORS[r.error || ""] || "Ce code n'a pas pu être activé.");
  track("code_redeemed");
  await pullPlan();
  return r.until ?? null;
}

/** "Prévenez-moi": this account is told when Pro goes on sale */
export async function joinWaitlist() {
  const s = getState().session;
  if (!s?.user.email) throw new Error("Connectez-vous d'abord.");
  const { error } = await sb().from("waitlist").upsert({ user_id: s.user.id, email: s.user.email.toLowerCase(), lang: (getState().profile.lang as string) || "fr" }, { onConflict: "user_id", ignoreDuplicates: true });
  fail(error, "L'inscription");
  track("waitlist_join");
  await pullPlan();
}

export const proDate = (until: string | null) =>
  until ? new Date(until).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" }) : "";

// ---------- admin ----------
export type Overview = {
  accounts: number; accounts7: number; trips: number; trips7: number; prepared30: number; pro: number; waitlist: number;
  aiToday: number; usdToday: number; usd30: number; days: { day: string; calls: number; usd: number }[];
};
export type AccountRow = {
  user_id: string; email: string; name: string; created_at: string; last_seen: string | null;
  pro: boolean; until: string | null; granted: boolean; admin: boolean; trips: number; ai30: number; waitlisted: boolean;
  last_active?: string | null; steps30?: number;
};
export type UserSheet = {
  email: string; created_at: string; last_seen: string | null; confirmed: boolean; profile: Record<string, unknown>;
  pro: boolean; grant: { until: string | null; source: string | null } | null; admin: boolean; waitlisted: boolean;
  trips: { id: string; title: string | null; dates: string | null; role: string; status: string; created_at: string; places: number }[];
  ai: { calls30: number; usd30: number; calls: number; usd: number; tasks: Record<string, number> };
  firstSeen: string | null; firstRef: string | null; visitsBefore: number; counts: Record<string, number>;
  events: { at: string; name: string; detail: string | null; device: string | null; trip: string | null; ref: string | null }[];
};
/** One account's sheet (supabase/saas-5.sql) */
export async function adminUser(userId: string): Promise<UserSheet> {
  const { data, error } = await sb().rpc("admin_user", { p_user: userId });
  fail(error, "La lecture du compte");
  return data as UserSheet;
}
export type CodeRow = { code: string; days: number | null; max_uses: number; uses: number; active: boolean; note: string | null; created_at: string };
export type WaitRow = { email: string; lang: string | null; created_at: string };

export async function adminOverview(): Promise<Overview> {
  const { data, error } = await sb().rpc("admin_overview");
  fail(error, "La lecture");
  return data as Overview;
}
export type Funnel = {
  steps: Record<string, { now: number; before: number; people: number }>; active: number; active7: number; phones: number; computers: number;
  refs: { ref: string; n: number }[]; pro: Record<string, number>;
};
/** The anonymous path figures (supabase/saas-5.sql); null while that file has not run */
export async function adminFunnel(): Promise<Funnel | null> {
  const { data, error } = await sb().rpc("admin_funnel");
  if (missing(error)) return null;
  fail(error, "La lecture");
  return data as Funnel;
}
export async function adminAccounts(search = ""): Promise<AccountRow[]> {
  const { data, error } = await sb().rpc("admin_accounts", { p_search: search || null });
  fail(error, "La lecture des comptes");
  return (data || []) as AccountRow[];
}
/** days: number of days from now, null = for life, 0 = Pro removed */
export async function adminSetPro(userId: string, days: number | null) {
  const { error } = await sb().rpc("admin_set_pro", { p_user: userId, p_days: days });
  fail(error, "Le changement");
}
export async function adminCodes(): Promise<CodeRow[]> {
  const { data, error } = await sb().from("pro_codes").select("code,days,max_uses,uses,active,note,created_at").order("created_at", { ascending: false });
  fail(error, "La lecture des codes");
  return (data || []) as CodeRow[];
}
export async function adminCreateCode(days: number | null, maxUses: number, note: string): Promise<string> {
  const { data, error } = await sb().rpc("admin_create_code", { p_days: days, p_max_uses: maxUses, p_note: note });
  fail(error, "La création du code");
  return String(data);
}
export async function adminSetCodeActive(code: string, active: boolean) {
  const { error } = await sb().from("pro_codes").update({ active }).eq("code", code);
  fail(error, "Le changement");
}
export async function adminWaitlist(): Promise<WaitRow[]> {
  const { data, error } = await sb().from("waitlist").select("email,lang,created_at").order("created_at");
  fail(error, "La lecture de la liste");
  return (data || []) as WaitRow[];
}

// ---------- the account's data ----------
/** Everything this account holds on this phone (profile, trips, places, notes, contacts, pins), as a JSON file */
export function exportMyData() {
  const st = getState();
  track("export", "data");
  const trips = listTrips().map((t) => {
    let data: unknown = null;
    try {
      data = JSON.parse(localStorage.getItem(`orbes.v2.${t.id}`) || "null");
    } catch {
      /* ignore */
    }
    return { id: t.id, title: t.title, dates: t.dateLabel, record: st.trips[t.id] || null, data };
  });
  const file = { exportedAt: new Date().toISOString(), account: st.session?.user.email || null, profile: st.profile, trips };
  const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `orbes-trips-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Deletes the account: the photo files of the trips it created, then the trips and the account (server), then this phone's copy */
export async function deleteMyAccount() {
  const s = sb();
  const files = await s.rpc("my_account_files");
  fail(files.error, "La suppression");
  const paths = ((files.data || []) as string[]).filter(Boolean);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await s.storage.from("photos").remove(paths.slice(i, i + 100));
    if (error) throw new Error("Les photos n'ont pas pu être supprimées. Réessayez.");
  }
  const { error } = await s.rpc("delete_my_account");
  if (error) {
    if (missing(error)) throw new Error("La suppression n'est pas encore activée sur le serveur.");
    throw new Error("Le compte n'a pas pu être supprimé. Réessayez, ou écrivez-nous.");
  }
  discardPending();
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("orbes.")) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  await signOut().catch(() => undefined);
  location.replace(location.pathname);
}
