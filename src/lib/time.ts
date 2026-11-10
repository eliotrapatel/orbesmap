import type { Trip } from "../data/types";

const tz = (d: Date, timeZone: string, opts: Intl.DateTimeFormatOptions) => d.toLocaleString("fr-FR", { timeZone, ...opts });

export const clock = (timeZone: string, d = new Date()) => tz(d, timeZone, { hour: "2-digit", minute: "2-digit" });

/** "2026-11-21" in the trip timezone for a given instant */
export function localDate(timeZone: string, d = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return p;
}

export const tripStartMs = (t: Trip) => {
  const arr = t.flights.find((f) => f.kind === "arrival");
  return new Date(arr?.arriveAt || arr?.at || t.start + "T00:00:00+08:00").getTime();
};
export const tripEndMs = (t: Trip) => {
  const dep = t.flights.find((f) => f.kind === "departure");
  return new Date(dep?.departAt || dep?.at || t.end + "T23:59:00+08:00").getTime();
};

export type Phase = "before" | "during" | "after";
export function phase(t: Trip, now = Date.now()): Phase {
  if (now < tripStartMs(t)) return "before";
  if (now <= tripEndMs(t)) return "during";
  return "after";
}

export function countdownParts(target: number, now = Date.now()) {
  const s = Math.max(0, Math.floor((target - now) / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

export const fmtDay = (iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions) => new Date(iso + "T12:00:00+08:00").toLocaleDateString("fr-FR", { timeZone, ...opts });

/** "10h30", "10:30", "9h" → minutes since midnight */
export function parseTime(s?: string): number | null {
  const m = s?.match(/(\d{1,2})\s*[h:]\s*(\d{2})?/i);
  if (!m) return null;
  const h = +m[1];
  if (h > 23) return null;
  return h * 60 + (m[2] ? +m[2] : 0);
}
export const fmtMin = (t: number) => `${Math.floor(t / 60)}h${String(t % 60).padStart(2, "0")}`;
