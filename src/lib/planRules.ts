// The free plan's and the Pro trip's rules, as plain functions (no imports): used by the app and by
// scripts/gratuit-pro-sim.mjs. Mirrors supabase/saas-13.sql where the server decides.

/** What these rules read of the account's plan (store.ts Plan) */
export type PlanLike = { pro: boolean; prepLeft: number; proTrips: string[] } | null | undefined;

const DAY = 864e5;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The trip has Pro for this account: its own Pro, a code trip, or the trip's Pro (owner Pro or a Pass). Plan
 *  unknown = treated as Pro, so nothing is ever blocked by mistake (same rule as hasPro / businessOn). */
export function tripPro(plan: PlanLike, tripId: string, isCodeTrip: boolean): boolean {
  return !plan || plan.pro || isCodeTrip || plan.proTrips.includes(tripId);
}

/** The day the free AI trip comes back: the 1st of next month (the server counts by UTC month) */
export function nextMonthStart(nowMs: number): string {
  const d = new Date(nowMs);
  return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** The last day of a Pass given now (same rule as admin_grant_trip_pass): the trip's end + 30 days, at least
 *  60 days from now, at most 365 days from now; no valid end date: 60 days from now. */
export function passUntil(tripEnd: string | null | undefined, nowMs: number): string {
  const min = isoDay(nowMs + 60 * DAY);
  const max = isoDay(nowMs + 365 * DAY);
  const ok = typeof tripEnd === "string" && /^\d{4}-\d{2}-\d{2}/.test(tripEnd) && !Number.isNaN(Date.parse(`${tripEnd.slice(0, 10)}T12:00:00Z`));
  if (!ok) return min;
  const e30 = isoDay(Date.parse(`${(tripEnd as string).slice(0, 10)}T12:00:00Z`) + 30 * DAY);
  const v = e30 > min ? e30 : min;
  return v < max ? v : max;
}

const SLUG = /^[a-z0-9]{10,24}$/;
const HOSTS = /^(www\.)?theorbes\.com$|^orbesmap(-[a-z0-9-]+)?\.vercel\.app$|^localhost$|^127\.0\.0\.1$/;
/** A public trip's slug from what was pasted: its link (theorbes.com/maps?t=… or orbesmap.vercel.app/?t=…) or
 *  the slug alone; null when it is not one */
export function parsePublicSlug(text: string): string | null {
  const s = String(text || "").trim();
  if (!s) return null;
  if (SLUG.test(s.toLowerCase())) return s.toLowerCase();
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
    if (!HOSTS.test(u.hostname.toLowerCase())) return null;
    const t = (u.searchParams.get("t") || "").toLowerCase();
    return SLUG.test(t) ? t : null;
  } catch {
    return null;
  }
}

/** The free AI trip of the month: null for Pro (or unknown); else whether it is left and when it comes back */
export function quota(plan: PlanLike, nowMs: number): null | { left: boolean; back: string } {
  if (!plan || plan.pro) return null;
  return { left: plan.prepLeft > 0, back: nextMonthStart(nowMs) };
}

/** Why the AI relay refused (api/ai.ts): the account's free limit, a Pro account's limit, the whole service's limit,
 *  a trip created by hand, an older server's answer (no scope: handled as before), or anything else */
export type Refusal = { kind: "free-cap" | "pro-cap" | "global" | "old" | "manual" | "other"; limit: number; pro: number; slowed: boolean };
export function refusal(body: unknown): Refusal {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  const out = (kind: Refusal["kind"]): Refusal => ({ kind, limit: num(b.limit), pro: num(b.pro), slowed: b.slowed === true });
  if (b.reason === "manual") return out("manual");
  if (b.error === "busy" && b.reason === "cap" && typeof b.scope === "string") {
    if (b.scope === "global") return out("global");
    return out(b.plan === "pro" ? "pro-cap" : "free-cap");
  }
  if (b.error === "busy") return out("old");
  return out("other");
}
