// Turns research/sha2026/program.json (written by the research workflow) into src/data/trips/sha2026.ts
// Usage: node research/sha2026/to-trip.mjs
import fs from "node:fs";
const P = JSON.parse(fs.readFileSync(new URL("./program.json", import.meta.url), "utf8"));
const PALETTE = ["#8CB4E8", "#B7A3E6", "#E8B07A", "#7FD1B9", "#EE8F8F", "#D8C47E", "#7DC4E4", "#C9A2C9", "#A6C98A", "#E6A3B7"];
const TYPES = new Set(["bijoux","mode","fabricant","salon","lifestyle","bar","hotel","packaging","textile","landmark","restaurant","mall","cashmere","concept","luxe","montres","cuir","musee","galerie","jardin","design","tech","cafe","club","transport"]);
let k = 0;
const days = P.days.map((d) => ({
  key: d.key, short: d.short, title: d.title, theme: d.theme, dates: d.dates, glyph: d.glyph, scheduled: !!d.scheduled,
  color: d.key === "lifestyle" ? "#D8C47E" : d.key === "ideas" ? "#9A958D" : d.key === "base" ? "#f6f2ea" : PALETTE[k++ % PALETTE.length],
}));
if (!days.some((d) => d.key === "base")) days.unshift({ key: "base", short: "Hôtel", title: "Hôtel", theme: "Base du séjour", color: "#f6f2ea", glyph: "H", scheduled: false });
const dayKeys = new Set(days.map((d) => d.key));
const seen = new Set();
const places = P.places
  .filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
  .map((p) => {
    const o = { id: p.id, name: p.name, day: dayKeys.has(p.day) ? p.day : "ideas", type: TYPES.has(p.type) ? p.type : "lifestyle", lat: +(+p.lat).toFixed(5), lng: +(+p.lng).toFixed(5), time: p.time || "", address: p.address || "", cn: p.cn || "" };
    if (p.metro) o.metro = p.metro;
    if (p.website) o.website = p.website;
    o.desc = p.desc || "";
    o.highlights = p.highlights || [];
    if (p.tip) o.tip = p.tip;
    return o;
  });
const hotel = places.find((p) => p.type === "hotel" && p.day === "base") || places.find((p) => p.type === "hotel");
if (hotel) hotel.day = "base";
const trip = {
  id: "sha-2026", code: "SHA 2026", title: P.trip.title || "Shanghai", subtitle: P.trip.subtitle || "Voyage",
  dateLabel: "24 – 29 novembre 2026", start: P.trip.start, end: P.trip.end, timezone: "Asia/Shanghai",
  hotel: { name: P.trip.hotel.name, lat: hotel?.lat ?? P.trip.hotel.lat, lng: hotel?.lng ?? P.trip.hotel.lng, placeId: hotel?.id },
  center: P.trip.center, days, flights: P.flights.map((f) => ({ airline: "Air France", ...f })),
  zones: P.zones, practical: P.practical,
};
const ts = `// Generated from the deep research of 10 Nov 2026 (research/sha2026/program.json). Edit freely.
import type { Trip } from "../types";
import { PHRASES_GZ } from "../phrases-gz";

const BASE = ${JSON.stringify(trip, null, 2)} as const;

export const SHA2026: Trip = {
  ...(BASE as unknown as Omit<Trip, "places" | "phrases">),
  places: ${JSON.stringify(places, null, 2)},
  // trip-specific phrases first, then the general ones written for Guangzhou
  phrases: [...${JSON.stringify(P.phrases || [], null, 2)}, ...PHRASES_GZ.filter((g) => /G[ée]n[ée]ral|Taxi/i.test(g.title))],
};
`;
fs.writeFileSync(new URL("../../src/data/trips/sha2026.ts", import.meta.url), ts);
console.log(`places ${places.length}, days ${days.length}, hotel ${hotel?.id}`);
