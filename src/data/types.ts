import type { Hours } from "../lib/hours";
/** Day keys are per trip: "base" (hotel), "d1".."d9", "lifestyle", "ideas"… */
export type DayKey = string;

export type PlaceType =
  | "bijoux" | "mode" | "fabricant" | "salon" | "lifestyle" | "bar" | "hotel"
  | "packaging" | "textile" | "landmark" | "restaurant" | "mall" | "cashmere"
  | "concept" | "luxe" | "montres" | "cuir" | "musee" | "galerie" | "jardin"
  | "design" | "tech" | "cafe" | "club" | "transport"
  /** a place added in the app with no known type */
  | "ajout";

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
  /** Places added in the app (from a link, a search, or by hand on the map): they live in the shared data */
  added?: AddedInfo;
  /** A programme place moved in the app: its original day and slot (from the code) */
  orig?: { day: DayKey; time: string };
  /** Suggested visit length in minutes */
  duration?: number;
  /** Chinese name (shown to a driver with the Chinese address) */
  nameCn?: string;
  /** why it was added (search) */
  why?: string;
  price?: string;
  /** most reliable page about the place */
  source?: string;
  /** opening hours as free text, shown when no structured hours are known */
  hoursText?: string;
  /** when the sheet was last written by the AI (ms) */
  enrichedAt?: number;
  /** the sheet before the last AI update can be brought back */
  hasPrev?: boolean;
}

/** A place added in the app (not in the first programme) */
export interface AddedInfo {
  /** the map pin it was created from, before places became data */
  pinId?: string;
  /** the note stored on that pin row before notes per person */
  note?: string;
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
  /** country code of the destination (OpenStreetMap, e.g. "jp"); the first trips are in China */
  country?: string;
  /** main local language (interpreter, phrases) */
  lang?: { code: string; name: string; speech: string };
  hotel: { name: string; lat: number; lng: number; placeId?: string };
  center: [number, number];
  days: Day[];
  places: Place[];
  /** places removed from the programme in the app (kept here so they can be put back) */
  removed?: Place[];
  flights: Flight[];
  phrases: PhraseGroup[];
  zones: Zone[];
  practical?: { title: string; text: string }[];
  /** structured opening hours by place id */
  hours?: Record<string, Hours>;
  emergency?: Emergency;
  /** starting items of the shared departure checklist */
  checklist?: { id: string; text: string; due?: string; group?: string }[];
}

export interface Emergency {
  numbers: { label: string; number: string; note: string }[];
  consulate: { name: string; address: string; cn: string; lat: number; lng: number; phone: string; emergency: string; hours: string; website: string };
  hospitals: { name: string; cn: string; address: string; addressCn: string; lat: number; lng: number; phone: string; er24: boolean; english: boolean; directBilling: string; note: string }[];
}

export type Status = "todo" | "scheduled" | "visited" | "sample";
