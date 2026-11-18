// Where a visit comes from (R11): every link that leaves the app says its channel (?src=email_day, invite, public…)
// and, for a link someone shares, an opaque code of that person (?by=…, supabase/saas-12.sql ref_codes). Never an
// e-mail or a name in an address. Pure functions (no Supabase): checked offline by scripts/mesure-sim.mjs.

/** The app's own address, as written in the messages it prepares */
export const APP_HOST = "https://orbesmap.vercel.app";

/** A channel: lowercase letters, digits and "_", 2 to 24 characters, starting with a letter (same rule as the server) */
export function cleanSrc(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[a-z][a-z0-9_]{1,23}$/.test(s) ? s : null;
}
/** A sharer's code: 8 to 16 lowercase letters or digits, at least one digit (so a plain name never passes) */
export function cleanBy(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[a-z0-9]{8,16}$/.test(s) && /[0-9]/.test(s) ? s : null;
}

/** The channel and the sharer of the address this page was opened with */
export function readLanding(search: string): { src: string | null; by: string | null } {
  try {
    const q = new URLSearchParams(search || "");
    const src = cleanSrc(q.get("src"));
    // a sharer without a channel is not kept (it would say nothing about the link)
    return { src, by: src ? cleanBy(q.get("by")) : null };
  } catch {
    return { src: null, by: null };
  }
}

/** The same address without its channel and sharer (the rest of the query and the #trip stay) */
export function withoutSource(search: string): string {
  try {
    const q = new URLSearchParams(search || "");
    if (!q.has("src") && !q.has("by")) return search;
    q.delete("src");
    q.delete("by");
    const s = q.toString();
    return s ? `?${s}` : "";
  } catch {
    return search;
  }
}

/** Adds the channel (and the sharer) to a link, before its #; a link that already says its channel is left as it is */
export function tagUrl(url: string, src: string, by?: string | null): string {
  const s = cleanSrc(src);
  if (!s) return url;
  const at = url.indexOf("#");
  const base = at >= 0 ? url.slice(0, at) : url;
  const hash = at >= 0 ? url.slice(at) : "";
  if (/[?&]src=/.test(base)) return url;
  const b = cleanBy(by);
  const add = `src=${s}${b ? `&by=${b}` : ""}`;
  if (base.includes("?")) return `${base}${/[?&]$/.test(base) ? "" : "&"}${add}${hash}`;
  // a bare domain gets its "/" first (https://orbesmap.vercel.app/?src=…)
  return `${/^https?:\/\/[^/]+$/.test(base) ? `${base}/` : base}?${add}${hash}`;
}

/** Tags every link to the app inside a message already in its language (the words themselves are unchanged) */
export function tagAppLinks(text: string, src: string, by?: string | null): string {
  return text.replace(/https:\/\/orbesmap\.vercel\.app(\/[^\s]*)?/g, (m) => tagUrl(m, src, by));
}

/** The channels, in words, for the admin (an unknown one is shown as it is) */
export const CHANNELS: Record<string, string> = {
  email_day: "E-mail du jour",
  email_back: "E-mail de retour",
  email_ready: "E-mail « prêt »",
  push_ready: "Notification « prêt »",
  invite: "Invitation",
  public: "Lien public",
  whatsapp: "WhatsApp",
  email_quota: "E-mail du quota",
  email_first: "E-mail du premier voyage",
  email_j2: "E-mail J-2",
  push_booking: "Réservation (notification)",
  email_booking: "Réservation (e-mail)",
  push_offline: "Rappel hors ligne",
};
