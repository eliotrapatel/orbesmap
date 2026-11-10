import type { Trip } from "../types";
import { PHRASES_GZ } from "../phrases-gz";
import { PLACES } from "./gz2026-places";

export const GZ2026: Trip = {
  id: "gz-2026",
  code: "GZ 2026",
  title: "Guangzhou",
  subtitle: "Voyage de sourcing",
  dateLabel: "7 – 13 juin 2026",
  start: "2026-06-07",
  end: "2026-06-13",
  timezone: "Asia/Shanghai",
  hotel: { name: "Sofitel Guangzhou Sunrich", lat: 23.1393, lng: 113.3163, placeId: "hotel" },
  center: [113.28, 23.125],
  flights: [
    { code: "CX950", airline: "Cathay Pacific", from: "HKG", to: "CAN", fromCity: "Hong Kong", toCity: "Guangzhou", at: "2026-06-07T02:20:00+08:00", arriveAt: "2026-06-07T02:20:00+08:00", kind: "arrival" },
    { code: "CX953", airline: "Cathay Pacific", from: "CAN", to: "HKG", fromCity: "Guangzhou", toCity: "Hong Kong", at: "2026-06-13T05:00:00+08:00", departAt: "2026-06-13T05:00:00+08:00", kind: "departure" },
  ],
  // Colours: muted metal and stone tones that stay readable on the light map.
  days: [
    { key: "base", short: "Hôtel", title: "Hôtel", theme: "Base du séjour", color: "#9C7A3C", glyph: "H", scheduled: false },
    { key: "d1", short: "Jour 1", title: "Jour 1", theme: "Zhanqian, marchés de gros", dates: ["2026-06-07"], color: "#2F5A86", glyph: "1", scheduled: true },
    { key: "d2", short: "Jour 2", title: "Jour 2", theme: "Liwan, fabricants et pierres", dates: ["2026-06-08"], color: "#6A4A8A", glyph: "2", scheduled: true },
    { key: "d3", short: "Dongguan", title: "Jour 3", theme: "Dongguan Chang'an, usines", dates: ["2026-06-09"], color: "#A65F27", glyph: "3", scheduled: true },
    { key: "d45", short: "Style GZ", title: "Jours 4 et 5", theme: "Salon Style GZ, Canton Fair", dates: ["2026-06-10", "2026-06-11"], color: "#2B7363", glyph: "4", scheduled: true },
    { key: "d6", short: "Jour 6", title: "Jour 6", theme: "Hongmian et Dongshankou", dates: ["2026-06-12"], color: "#A3434F", glyph: "6", scheduled: true },
    { key: "lifestyle", short: "Sorties", title: "Sorties", theme: "Bars, restaurants, inspiration", color: "#4A4F57", glyph: "♦", scheduled: false },
    { key: "ideas", short: "Pistes", title: "Pistes", theme: "À voir si le temps le permet", color: "#7D8288", glyph: "+", scheduled: false },
  ],
  places: PLACES,
  phrases: PHRASES_GZ,
  zones: [
    { label: "Guangzhou", center: [113.27, 23.125], zoom: 11.5 },
    { label: "Dongguan", center: [113.734, 22.817], zoom: 13 },
    { label: "Shenzhen", center: [113.93, 22.534], zoom: 11.5 },
  ],
};
