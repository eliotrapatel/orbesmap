export type DayKey = "base" | "d1" | "d2" | "d3" | "d45" | "d6" | "lifestyle" | "ideas";

export type PlaceType =
  | "bijoux" | "mode" | "fabricant" | "salon" | "lifestyle" | "bar" | "hotel"
  | "packaging" | "textile" | "landmark" | "restaurant" | "mall" | "cashmere";

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
  /** ISO dates (local Guangzhou date) covered by the day */
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
  /** ISO datetime with offset */
  at: string;
  kind: "arrival" | "departure";
}

export interface PhraseGroup {
  title: string;
  items: { zh: string; pinyin: string; fr: string }[];
}

export type Status = "todo" | "scheduled" | "visited" | "sample";
