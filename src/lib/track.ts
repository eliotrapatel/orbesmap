// Usage, account by account (supabase/saas-5.sql): each step is recorded under the signed-in account, and before
// signing up under a random identifier kept on this device, attached to the account once signed in.
// Fire and forget: a step that cannot be sent is simply not recorded.
// Where the visit came from (supabase/saas-12.sql): the link's ?src= (its channel) and ?by= (who shared it) are read
// once, taken out of the address, and sent with this opening's first steps (visit, app_open, public_view).
import { supabase } from "./supabase";
import { readLanding, withoutSource } from "./source";

export type Step =
  | "visit" | "signup_email" | "signup_done" | "sign_in" | "app_open" | "trip_created" | "trip_opened" | "trip_validated"
  | "place_added" | "invite_sent" | "export" | "pro_screen" | "code_redeemed" | "waitlist_join"
  | "link_opened" | "public_view" | "trip_copied" | "expense_added"
  | "place_opened" | "tool_opened" | "status_set" | "note_written" | "photo_added" | "vote" | "comment_added"
  | "checklist_done" | "language_changed" | "alerts_changed" | "search" | "adjust_asked" | "day_redone"
  // the measured path (R03, supabase/saas-12.sql) and the steps of the other lots of 18 Nov 2026
  | "create_started" | "first_day_opened" | "paywall_closed" | "landing_cta" | "public_link_created" | "public_cta_clicked"
  | "trip_shared_whatsapp" | "onboarding_done" | "signup_submitted" | "email_confirmed" | "prep_started" | "prep_ready" | "prep_failed"
  | "invite_accepted" | "check_email_shown" | "confirm_resent" | "quota_seen" | "manual_trip_created" | "validate_explained"
  | "trip_pass_granted" | "ai_budget_hit" | "landing_destination" | "invite_email_sent" | "reminder_sent" | "offline_ready"
  | "offline_reminder_sent" | "offline_used" | "confirm_screen" | "landing_intent" | "intent_applied" | "public_copy_click" | "app_redirect";

const VISITOR_KEY = "orbes.vid";
/** This device's random identifier (made once) */
function visitor(): string | null {
  try {
    let v = localStorage.getItem(VISITOR_KEY);
    if (!v) {
      v = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(VISITOR_KEY, v);
    }
    return v;
  } catch {
    return null;
  }
}
const device = () => (window.matchMedia?.("(min-width: 900px)").matches ? "computer" : "phone");
/** The site a visitor came from (its domain only), never this one */
const referrer = () => {
  try {
    const h = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : "";
    return h && h !== location.hostname && !h.endsWith("theorbes.com") && !h.endsWith("orbesmap.vercel.app") ? h : null;
  } catch {
    return null;
  }
};
const once = new Set<string>();

/** This opening's channel and sharer, read from the address before anything else (then removed from it, the rest kept) */
const landing = (() => {
  try {
    const l = readLanding(location.search);
    const rest = withoutSource(location.search);
    if (rest !== location.search) history.replaceState(history.state, "", location.pathname + rest + location.hash);
    return l;
  } catch {
    return { src: null, by: null };
  }
})();
const SOURCED = new Set<Step>(["visit", "app_open", "public_view"]);

const ENDPOINT = location.hostname.endsWith(".vercel.app") ? "/api/track" : "https://orbesmap.vercel.app/api/track";

/** Records one step (`trip`: the trip it concerns). "visit" and "app_open" count once per opening of the app. */
export function track(name: Step, detail?: string | null, trip?: string | null) {
  if (!supabase) return;
  if (name === "visit" || name === "app_open") {
    if (once.has(name)) return;
    once.add(name);
  }
  const src = SOURCED.has(name) ? landing.src : null;
  const body = { name, detail: detail ?? null, device: device(), ref: name === "visit" ? referrer() : null, visitor: visitor(), trip: trip ?? null, ...(src ? { src, by: landing.by } : {}) };
  // through api/track, which adds the city and the device of the connection; straight to the database if it fails
  void supabase.auth
    .getSession()
    .then(({ data }) => {
      const tok = data.session?.access_token;
      return fetch(ENDPOINT, { method: "POST", keepalive: true, headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body) });
    })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
    })
    .catch(() => direct(body));
}

/** The steps renamed by supabase/saas-12.sql, under their name before it (see api/track.ts): never lost in between */
const OLD_NAMES: Partial<Record<Step, Step>> = { signup_submitted: "signup_done", onboarding_done: "signup_done", public_link_created: "link_opened", public_cta_clicked: "link_opened" };
type Body = { name: Step; detail: string | null; device: string; ref: string | null; visitor: string | null; trip: string | null };
/** Straight to the database (api/track unreachable): the first version, as before; a renamed step asks saas-12's first */
function direct(body: Body) {
  const old = OLD_NAMES[body.name];
  const first = (name: Step) =>
    supabase!.rpc("track_event", { p_name: name, p_detail: body.detail, p_device: body.device, p_ref: body.ref, p_visitor: body.visitor, p_trip: body.trip }).then(() => undefined, () => undefined);
  if (!old) return void first(body.name);
  const none = null as string | null;
  void supabase!
    .rpc("track_event", { p_name: body.name, p_detail: body.detail, p_device: body.device, p_ref: body.ref, p_visitor: body.visitor, p_trip: body.trip, p_city: none, p_country: none, p_region: none, p_os: none, p_browser: none, p_src: none, p_by: none })
    .then(({ error }) => (error && ["PGRST202", "42883"].includes(String(error.code)) ? first(old) : error ? first(body.name) : undefined), () => first(body.name));
}

/** A step counted once per `key` on this device (e.g. the first day opened of each trip) */
export function trackOnce(name: Step, key: string, detail?: string | null, trip?: string | null) {
  const k = `orbes.once.${name}.${key}`;
  if (once.has(k)) return;
  once.add(k);
  try {
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, "1");
  } catch {
    /* no storage: once per opening */
  }
  track(name, detail, trip);
}

let linkedFor = "";
const REF_KEY = "orbes.by";
/** This account's opaque sharer code (supabase/saas-12.sql my_ref_code), kept on the device; null until known */
export function refCode(): string | null {
  try {
    const c = JSON.parse(localStorage.getItem(REF_KEY) || "null") as { uid?: string; code?: string } | null;
    return c && linkedFor && c.uid === linkedFor && typeof c.code === "string" ? c.code : null;
  } catch {
    return null;
  }
}
/** Signed in: this device's earlier steps become the account's (once per account and opening) */
export function linkVisitor(uid: string) {
  if (!supabase || linkedFor === uid) return;
  linkedFor = uid;
  const v = visitor();
  if (v) void supabase.rpc("link_visitor", { p_visitor: v }).then(() => undefined, () => undefined);
  // the code put on the links this account shares (before supabase/saas-12.sql: none, the links go without it)
  if (refCode()) return;
  void supabase.rpc("my_ref_code").then(
    ({ data, error }) => {
      if (error || typeof data !== "string" || !data) return;
      try {
        localStorage.setItem(REF_KEY, JSON.stringify({ uid, code: data }));
      } catch {
        /* ignore */
      }
    },
    () => undefined,
  );
}
