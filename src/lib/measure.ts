// The admin's measure of the path (supabase/saas-12.sql): by sign-up period, by source, one account's first source.
// Before that file runs, each read gives null (the admin screen says to run it); nothing else is affected.
import { supabase } from "./supabase";
import { locale, t } from "./i18n";

export type CohortPeriod = {
  start: string; visits: number; signups: number; confirmed: number; onboarded: number; started: number; ready: number;
  validated: number; second: number; activated: number; readyN: number; medianS: number | null;
  back7: number; back7Of: number; back30: number; back30Of: number;
};
export type Cohorts = { unit: "month" | "week"; suggest: "month" | "week"; since: Record<string, string>; periods: CohortPeriod[] };
export type ChannelRow = { src: string; visits: number; signups: number; activations: number; returns: number };
export type Sharer = { name: string; email: string; visits: number; signups: number };
export type Channels = { days: number; channels: ChannelRow[]; sharers: Sharer[] };
export type UserSources = { firstSrc: string | null; firstSrcAt: string | null; referredBy: { email: string; name: string } | null; srcs: Record<string, number> };

const missing = (e: { code?: string } | null) => !!e && ["PGRST202", "PGRST205", "42883", "42P01"].includes(e.code || "");
async function call<T>(fn: string, args: Record<string, unknown>): Promise<T | null> {
  if (!supabase) throw new Error(t("Indisponible hors connexion."));
  const { data, error } = await supabase.rpc(fn, args);
  if (missing(error)) return null;
  if (error) throw new Error(error.code === "42501" ? t("Réservé à l'administrateur.") : t("La lecture n'a pas pu se faire. Vérifiez le réseau et réessayez."));
  return (data ?? null) as T | null;
}

export const adminCohorts = (unit: "month" | "week", periods = 12) => call<Cohorts>("admin_cohorts", { p_unit: unit, p_periods: periods });
export const adminChannels = (days: number) => call<Channels>("admin_channels", { p_days: days });
export const adminUserSources = (userId: string) => call<UserSources>("admin_user_sources", { p_user: userId });

/** "{p} %" of the step before (empty when there was nobody before) */
export const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : null);
/** A duration in seconds, in hours under two days, else in days */
export function span(seconds: number | null): string {
  if (seconds == null) return "—";
  const h = seconds / 3600;
  const nf = (v: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(v);
  return h < 48 ? t("{n} h", { n: nf(h < 10 ? Math.round(h * 10) / 10 : Math.round(h)) }) : t("{n} j", { n: nf(Math.round(h / 24)) });
}
