import type { Day, Place, Trip } from "../data/types";
import type { PlaceState } from "./model";
import { localDate, parseTime } from "./time";

/** Start time of a stop: the appointment if one was set, otherwise the planned slot ("13h–14h") */
export function stopTime(p: Place, states: Record<string, PlaceState>): number | null {
  return parseTime(states[p.id]?.appt) ?? parseTime(p.time);
}

export function dayStops(trip: Trip, day: string, states: Record<string, PlaceState>): Place[] {
  const items = trip.places.filter((p) => p.day === day);
  const timed = items.filter((p) => stopTime(p, states) != null).sort((a, b) => stopTime(a, states)! - stopTime(b, states)!);
  return [...timed, ...items.filter((p) => !timed.includes(p))];
}

export const isHotel = (trip: Trip, p: Place) => p.type === "hotel" || p.id === trip.hotel.placeId;
export const countable = (trip: Trip) => trip.places.filter((p) => !isHotel(trip, p));

/** The scheduled day for today in the trip timezone */
export function todayDay(trip: Trip, now = new Date()): Day | undefined {
  const today = localDate(trip.timezone, now);
  return trip.days.find((d) => d.scheduled && d.dates?.includes(today));
}

/** Next not-yet-visited stop today (by planned time), else the first unvisited stop of the next day */
export function nextStop(trip: Trip, states: Record<string, PlaceState>, now = new Date()): { place: Place; day: Day; when?: number } | null {
  const today = localDate(trip.timezone, now);
  const minutes = Number(new Intl.DateTimeFormat("en-GB", { timeZone: trip.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now).replace(":", "")) || 0;
  const nowMin = Math.floor(minutes / 100) * 60 + (minutes % 100);
  for (const d of trip.days.filter((x) => x.scheduled)) {
    const date = d.dates?.[d.dates.length - 1];
    if (!date || date < today) continue;
    const stops = dayStops(trip, d.key, states).filter((p) => !states[p.id]?.visited && !isHotel(trip, p));
    const pick = d.dates?.includes(today) ? stops.find((p) => (stopTime(p, states) ?? 0) >= nowMin - 60) || stops[0] : stops[0];
    if (pick) return { place: pick, day: d, when: stopTime(pick, states) ?? undefined };
  }
  return null;
}
