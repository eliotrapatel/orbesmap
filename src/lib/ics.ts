// Calendar export (.ics) of the day-by-day programme, readable by Apple/Google Calendar.
import type { Trip } from "../data/types";
import type { PlaceState } from "./model";
import { dayStops, stopTime } from "./plan";

const pad = (n: number) => String(n).padStart(2, "0");
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);

export function exportIcs(trip: Trip, states: Record<string, PlaceState>) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ORBES//Trip//FR", "CALSCALE:GREGORIAN", `X-WR-CALNAME:ORBES — ${trip.title}`, `X-WR-TIMEZONE:${trip.timezone}`];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  for (const day of trip.days.filter((d) => d.scheduled)) {
    const date = day.dates?.[0];
    if (!date) continue;
    const ymd = date.replace(/-/g, "");
    for (const p of dayStops(trip, day.key, states)) {
      const t = stopTime(p, states);
      const s = states[p.id] || {};
      const desc = [p.cn, p.address, p.metro, s.appt ? `RDV : ${s.appt}` : "", p.tip || "", s.note || ""].filter(Boolean).join("\n");
      lines.push("BEGIN:VEVENT", `UID:${trip.id}-${p.id}@orbes`, `DTSTAMP:${stamp}`);
      if (t != null) {
        const end = t + 90;
        lines.push(`DTSTART;TZID=${trip.timezone}:${ymd}T${pad(Math.floor(t / 60))}${pad(t % 60)}00`, `DTEND;TZID=${trip.timezone}:${ymd}T${pad(Math.min(23, Math.floor(end / 60)))}${pad(end % 60)}00`);
      } else {
        lines.push(`DTSTART;VALUE=DATE:${ymd}`);
      }
      lines.push(`SUMMARY:${esc(p.name)}`, `LOCATION:${esc(p.cn || p.address)}`, `GEO:${p.lat};${p.lng}`, `DESCRIPTION:${esc(desc)}`, "END:VEVENT");
    }
  }
  for (const f of trip.flights) {
    const dep = f.departAt || f.at;
    const arr = f.arriveAt || f.at;
    const z = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    lines.push("BEGIN:VEVENT", `UID:${trip.id}-${f.code}@orbes`, `DTSTAMP:${stamp}`, `DTSTART:${z(dep)}`, `DTEND:${z(arr)}`, `SUMMARY:${esc(`${f.code} ${f.from} → ${f.to}`)}`, `LOCATION:${esc(f.terminal ? `${f.from} ${f.terminal}` : f.from)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `orbes-${trip.id}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
