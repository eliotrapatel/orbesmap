import type { Trip } from "../data/types";
import { getLang, locale } from "./i18n";

const tz = (d: Date, timeZone: string, opts: Intl.DateTimeFormatOptions) => d.toLocaleString(locale(), { timeZone, ...opts });

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

export const fmtDay = (iso: string, timeZone: string, opts: Intl.DateTimeFormatOptions) => new Date(iso + "T12:00:00+08:00").toLocaleDateString(locale(), { timeZone, ...opts });

/** "10h30", "10:30", "9h" → minutes since midnight */
export function parseTime(s?: string): number | null {
  const m = s?.match(/(\d{1,2})\s*[h:]\s*(\d{2})?/i);
  if (!m) return null;
  const h = +m[1];
  if (h > 23) return null;
  return h * 60 + (m[2] ? +m[2] : 0);
}
/** 690 → "11h30" in French, "11:30" in English */
export const fmtMin = (t: number) => `${Math.floor(t / 60)}${getLang() === "en" ? ":" : "h"}${String(t % 60).padStart(2, "0")}`;

/** Whole days left before the arrival: the one "J–" figure, the same as the countdown's days, everywhere */
export const daysLeft = (t: Trip, now = Date.now()) => countdownParts(tripStartMs(t), now).d;

/** During the trip: today is day `i` of `n` (calendar days in the trip's timezone) */
export function dayOfTrip(t: Trip, now = Date.now()): { i: number; n: number } {
  const day = (iso: string) => Date.parse(iso + "T00:00:00Z") / 864e5;
  const n = Math.max(1, Math.round(day(t.end) - day(t.start)) + 1);
  const i = Math.round(day(localDate(t.timezone, new Date(now))) - day(t.start)) + 1;
  return { i: Math.min(Math.max(i, 1), n), n };
}

/** This device's own timezone and a short city name for it ("Europe/Paris" → "Paris") */
export function homeZone(): { zone: string; city: string } {
  let zone = "Europe/Paris";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || zone;
  } catch {
    /* ignore */
  }
  return { zone, city: (zone.split("/").pop() || zone).replace(/_/g, " ") };
}

/** Are two timezones on the same hour right now? */
export const sameHour = (a: string, b: string, d = new Date()) => clock(a, d) === clock(b, d);
