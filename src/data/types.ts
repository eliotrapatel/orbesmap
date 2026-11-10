/** Day keys are per trip: "base" (hotel), "d1".."d9", "lifestyle", "ideas"… */
export type DayKey = string;

export type PlaceType =
  | "bijoux" | "mode" | "fabricant" | "salon" | "lifestyle" | "bar" | "hotel"
  | "packaging" | "textile" | "landmark" | "restaurant" | "mall" | "cashmere"
  | "concept" | "luxe" | "montres" | "cuir" | "musee" | "galerie" | "jardin"
  | "design" | "tech" | "cafe" | "club" | "transport";

export interface Place {
  id: string;
  name: string;
  day: DayKey;
  type: PlaceType;
  lat: number;
  lng: number;
  time: string;
  address: string;
  cn: string;
  metro?: string;
  website?: string;
  desc: string;
  highlights: string[];
  tip?: string;
}

export interface Day {
  key: DayKey;
  /** Short label for chips */
  short: string;
  /** Full title */
  title: string;
  /** Neighbourhood / theme of the day */
  theme?: string;
  /** ISO dates (local date at destination) covered by the day */
  dates?: string[];
  color: string;
  /** Glyph shown inside the map marker */
  glyph: string;
  /** Part of the day-by-day programme (shown in the agenda) */
  scheduled: boolean;
}

export interface Flight {
  code: string;
  from: string;
  to: string;
  fromCity: string;
  toCity: string;
  /** ISO datetime with offset: arrival time for an arrival flight, departure time for a departure flight */
  at: string;
  departAt?: string;
  arriveAt?: string;
  terminal?: string;
  airline?: string;
  kind: "arrival" | "departure";
}

export interface PhraseGroup {
  title: string;
  items: { zh: string; pinyin: string; fr: string }[];
}

export interface Zone {
  label: string;
  center: [number, number];
  zoom: number;
}

export interface Trip {
  id: string;
  /** Short code shown in the switcher, e.g. "GZ 2026" */
  code: string;
  title: string;
  subtitle: string;
  /** e.g. "7 – 13 juin 2026" */
  dateLabel: string;
  start: string;
  end: string;
  timezone: string;
  hotel: { name: string; lat: number; lng: number; placeId?: string };
  center: [number, number];
  days: Day[];
  places: Place[];
  flights: Flight[];
  phrases: PhraseGroup[];
  zones: Zone[];
  practical?: { title: string; text: string }[];
}

export type Status = "todo" | "scheduled" | "visited" | "sample";
