// Anonymous usage figures (supabase/saas-5.sql): a few steps of the path, without cookie, identifier or account.
// Fire and forget: a figure that cannot be sent is simply not counted.
import { supabase } from "./supabase";

export type Step = "visit" | "signup_email" | "signup_done" | "trip_created" | "trip_validated" | "pro_screen" | "code_redeemed" | "waitlist_join";

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
let visited = false;

export function track(name: Step, detail?: string) {
  if (!supabase || navigator.doNotTrack === "1") return;
  if (name === "visit") {
    if (visited) return;
    visited = true;
  }
  void supabase
    .rpc("track_event", { p_name: name, p_detail: detail ?? null, p_device: device(), p_ref: name === "visit" ? referrer() : null })
    .then(() => undefined, () => undefined);
}
