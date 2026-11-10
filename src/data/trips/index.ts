import type { Trip } from "../types";
import { GZ2026 } from "./gz2026";

/** All trips, newest first. */
export const TRIPS: Trip[] = [GZ2026];

export const TRIP_BY_ID: Record<string, Trip> = Object.fromEntries(TRIPS.map((t) => [t.id, t]));

/** The trip to open by default: the one in progress, else the next one, else the most recent. */
export function defaultTrip(now = Date.now()): Trip {
  const t = (iso: string, end = false) => new Date(iso + (end ? "T23:59:00+08:00" : "T00:00:00+08:00")).getTime();
  const current = TRIPS.find((x) => now >= t(x.start) && now <= t(x.end, true));
  if (current) return current;
  const next = TRIPS.filter((x) => t(x.start) > now).sort((a, b) => t(a.start) - t(b.start))[0];
  return next || TRIPS[0];
}
