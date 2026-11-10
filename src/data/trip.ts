import type { Day, Flight, PlaceType, Status } from "./types";
export { PLACES } from "./places";
export { PHRASES } from "./phrases";

export const TRIP = {
  id: "gz-2026",
  title: "Guangzhou",
  subtitle: "Voyage de sourcing",
  start: "2026-06-07",
  end: "2026-06-13",
  hotel: { name: "Sofitel Guangzhou Sunrich", lat: 23.1393, lng: 113.3163 },
  center: [113.28, 23.125] as [number, number],
  timezone: "Asia/Shanghai",
};

export const FLIGHTS: Flight[] = [
  { code: "CX950", from: "HKG", to: "CAN", fromCity: "Hong Kong", toCity: "Guangzhou", at: "2026-06-07T02:20:00+08:00", kind: "arrival" },
  { code: "CX953", from: "CAN", to: "HKG", fromCity: "Guangzhou", toCity: "Hong Kong", at: "2026-06-13T05:00:00+08:00", kind: "departure" },
];

// Colours: muted metal and stone tones that stay readable on the light map.
export const DAYS: Day[] = [
  { key: "base", short: "Hôtel", title: "Hôtel", theme: "Base du séjour", color: "#9C7A3C", glyph: "H", scheduled: false },
  { key: "d1", short: "Jour 1", title: "Jour 1", theme: "Zhanqian, marchés de gros", dates: ["2026-06-07"], color: "#2F5A86", glyph: "1", scheduled: true },
  { key: "d2", short: "Jour 2", title: "Jour 2", theme: "Liwan, fabricants et pierres", dates: ["2026-06-08"], color: "#6A4A8A", glyph: "2", scheduled: true },
  { key: "d3", short: "Dongguan", title: "Jour 3", theme: "Dongguan Chang'an, usines", dates: ["2026-06-09"], color: "#A65F27", glyph: "3", scheduled: true },
  { key: "d45", short: "Style GZ", title: "Jours 4 et 5", theme: "Salon Style GZ, Canton Fair", dates: ["2026-06-10", "2026-06-11"], color: "#2B7363", glyph: "4", scheduled: true },
  { key: "d6", short: "Jour 6", title: "Jour 6", theme: "Hongmian et Dongshankou", dates: ["2026-06-12"], color: "#A3434F", glyph: "6", scheduled: true },
  { key: "lifestyle", short: "Sorties", title: "Sorties", theme: "Bars, restaurants, inspiration", color: "#4A4F57", glyph: "♦", scheduled: false },
  { key: "ideas", short: "Pistes", title: "Pistes", theme: "À voir si le temps le permet", color: "#7D8288", glyph: "+", scheduled: false },
];

export const DAY_BY_KEY = Object.fromEntries(DAYS.map((d) => [d.key, d])) as Record<Day["key"], Day>;

export const TYPE_LABEL: Record<PlaceType, string> = {
  bijoux: "Bijoux", mode: "Mode", fabricant: "Fabricant", salon: "Salon", lifestyle: "Lifestyle",
  bar: "Bar", hotel: "Hôtel", packaging: "Packaging", textile: "Textile", landmark: "Repère",
  restaurant: "Restaurant", mall: "Shopping", cashmere: "Cachemire",
};

export const STATUSES: { key: Status; label: string; color: string }[] = [
  { key: "todo", label: "À contacter", color: "#7D8288" },
  { key: "scheduled", label: "RDV pris", color: "#B7791F" },
  { key: "visited", label: "Visité", color: "#2F5A86" },
  { key: "sample", label: "Échantillon reçu", color: "#2B7363" },
];

export const QUICK_ZONES = [
  { label: "Guangzhou", center: [113.27, 23.125] as [number, number], zoom: 11.5 },
  { label: "Dongguan", center: [113.734, 22.817] as [number, number], zoom: 13 },
  { label: "Shenzhen", center: [113.93, 22.534] as [number, number], zoom: 11.5 },
];
