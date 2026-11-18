// Usage, account by account (supabase/saas-5.sql): each step is recorded under the signed-in account, and before
// signing up under a random identifier kept on this device, attached to the account once signed in.
// Fire and forget: a step that cannot be sent is simply not recorded.
import { supabase } from "./supabase";

export type Step =
  | "visit" | "signup_email" | "signup_done" | "sign_in" | "app_open" | "trip_created" | "trip_opened" | "trip_validated"
  | "place_added" | "invite_sent" | "export" | "pro_screen" | "code_redeemed" | "waitlist_join"
  | "link_opened" | "public_view" | "trip_copied" | "expense_added"
  | "place_opened" | "tool_opened" | "status_set" | "note_written" | "photo_added" | "vote" | "comment_added"
  | "checklist_done" | "language_changed" | "alerts_changed" | "search" | "adjust_asked" | "day_redone";

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

const ENDPOINT = location.hostname.endsWith(".vercel.app") ? "/api/track" : "https://orbesmap.vercel.app/api/track";

/** Records one step (`trip`: the trip it concerns). "visit" and "app_open" count once per opening of the app. */
export function track(name: Step, detail?: string | null, trip?: string | null) {
  if (!supabase) return;
  if (name === "visit" || name === "app_open") {
    if (once.has(name)) return;
    once.add(name);
  }
  const body = { name, detail: detail ?? null, device: device(), ref: name === "visit" ? referrer() : null, visitor: visitor(), trip: trip ?? null };
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
    .catch(() =>
      supabase!.rpc("track_event", { p_name: body.name, p_detail: body.detail, p_device: body.device, p_ref: body.ref, p_visitor: body.visitor, p_trip: body.trip }).then(() => undefined, () => undefined),
    );
}

let linkedFor = "";
/** Signed in: this device's earlier steps become the account's (once per account and opening) */
export function linkVisitor(uid: string) {
  if (!supabase || linkedFor === uid) return;
  linkedFor = uid;
  const v = visitor();
  if (v) void supabase.rpc("link_visitor", { p_visitor: v }).then(() => undefined, () => undefined);
}
