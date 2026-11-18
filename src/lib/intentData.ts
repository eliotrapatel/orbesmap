// What a visitor asked for before having an account (lot acquisition, R10 + R14): a destination with its dates
// ("Où et quand ?" on the welcome page) or a shared programme to copy (its public link). Kept on the device and in
// the account's metadata (Supabase Auth), so it survives a confirmation link opened on another phone or browser.
// Pure functions only (no import that runs anything): the offline simulation reads this file under Node.
// The metadata can be edited by its account: everything read back is checked again here.

export type IntentDest = { name: string; country?: string; countryName?: string; lat: number; lng: number };
export type Intent = {
  v: 1;
  kind: "dest" | "copy";
  /** when it was made (ms) */
  at: number;
  /** when it was used (ms): the form was opened with it, or the copy sheet */
  used?: number;
  /** "copy": the public link's slug */
  copy?: string;
  /** "dest": the city */
  dest?: IntentDest;
  start?: string;
  end?: string;
};

export const SLUG_RE = /^[a-z0-9]{10,24}$/;
/** The longest trip the form accepts (CreateWizard MAX_DAYS) */
export const INTENT_MAX_DAYS = 60;
/** How long an intent waits: on the account (a confirmation link can take a while), on a device */
export const ACCOUNT_DAYS = 14;
export const DEVICE_HOURS = 24;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const day = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const validIso = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && Number.isFinite(day(s)) && new Date(day(s)).toISOString().slice(0, 10) === s;
const cleanText = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max) : "");

/** Reads an intent defensively (null when it is not one); a wrong date pair is dropped, never the city */
export function parseIntent(v: unknown, now = Date.now()): Intent | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || (o.kind !== "dest" && o.kind !== "copy")) return null;
  const at = Number(o.at);
  // made in the last 60 days, never in the future (a minute of clock drift allowed)
  if (!Number.isFinite(at) || at <= 0 || at > now + 60_000 || at < now - 60 * 864e5) return null;
  const out: Intent = { v: 1, kind: o.kind, at };
  const used = Number(o.used);
  if (o.used != null && Number.isFinite(used) && used > 0) out.used = used;
  if (o.kind === "copy") {
    const s = typeof o.copy === "string" ? o.copy.toLowerCase() : "";
    if (!SLUG_RE.test(s)) return null;
    out.copy = s;
    return out;
  }
  const d = o.dest as Record<string, unknown> | undefined;
  if (!d || typeof d !== "object") return null;
  const name = cleanText(d.name, 80);
  const lat = Number(d.lat);
  const lng = Number(d.lng);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const dest: IntentDest = { name, lat, lng };
  const country = cleanText(d.country, 8);
  const countryName = cleanText(d.countryName, 80);
  if (country) dest.country = country;
  if (countryName) dest.countryName = countryName;
  out.dest = dest;
  if (validIso(o.start) && validIso(o.end) && o.end >= o.start && (day(o.end) - day(o.start)) / 864e5 + 1 <= INTENT_MAX_DAYS) {
    out.start = o.start;
    out.end = o.end;
  }
  return out;
}

/**
 * The intent still worth acting on: not used, fresh enough (14 days on the account, 24 h on a device). Dates already
 * past are dropped (the form then opens at « Quand »).
 */
export function usableIntent(i: Intent | null, now: number, today: string, from: "account" | "device"): Intent | null {
  if (!i || i.used) return null;
  const maxAge = from === "account" ? ACCOUNT_DAYS * 864e5 : DEVICE_HOURS * 3600e3;
  if (now - i.at > maxAge) return null;
  if (i.kind === "dest" && i.start && i.start < today) {
    const { start: _s, end: _e, ...rest } = i;
    return rest;
  }
  return i;
}

/** The key that marks an intent used on this device (survives a reload and a cut metadata update) */
export const intentKey = (i: Intent) => `${i.kind}:${i.copy || i.dest?.name || ""}:${i.at}`;

const MONTHS: Record<"fr" | "en", string[]> = {
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
/** "12–18 mars", "28 févr. – 3 mars" (en: "12–18 Mar") */
export function datesLabel(start: string, end: string, lang: "fr" | "en"): string {
  if (!validIso(start) || !validIso(end)) return "";
  const a = new Date(day(start));
  const b = new Date(day(end));
  const m = MONTHS[lang];
  const da = a.getUTCDate();
  const db = b.getUTCDate();
  if (start === end) return `${da} ${m[a.getUTCMonth()]}`;
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()) return `${da}–${db} ${m[b.getUTCMonth()]}`;
  return `${da} ${m[a.getUTCMonth()]} – ${db} ${m[b.getUTCMonth()]}`;
}

/** "Shanghai · 12–18 mars", "Shanghai" without dates */
export function intentLabel(i: { dest?: { name: string }; start?: string; end?: string }, lang: "fr" | "en"): string {
  const name = i.dest?.name || "";
  const d = i.start && i.end ? datesLabel(i.start, i.end, lang) : "";
  return d ? `${name} · ${d}` : name;
}
