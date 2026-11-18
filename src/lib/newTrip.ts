// A new trip's record from where and when: code, title, dates, time zone, days, map centre and zone.
// The time zone comes from the country of the destination (OpenStreetMap), with the longitude for the
// countries that have several; the phone's own time zone when it is unknown.

const TZ: Record<string, string> = {
  cn: "Asia/Shanghai", hk: "Asia/Hong_Kong", mo: "Asia/Macau", tw: "Asia/Taipei", jp: "Asia/Tokyo", kr: "Asia/Seoul",
  sg: "Asia/Singapore", th: "Asia/Bangkok", vn: "Asia/Ho_Chi_Minh", my: "Asia/Kuala_Lumpur", ph: "Asia/Manila",
  in: "Asia/Kolkata", ae: "Asia/Dubai", qa: "Asia/Qatar", sa: "Asia/Riyadh", il: "Asia/Jerusalem", tr: "Europe/Istanbul",
  fr: "Europe/Paris", be: "Europe/Brussels", nl: "Europe/Amsterdam", de: "Europe/Berlin", ch: "Europe/Zurich",
  at: "Europe/Vienna", it: "Europe/Rome", es: "Europe/Madrid", pt: "Europe/Lisbon", gb: "Europe/London", ie: "Europe/Dublin",
  dk: "Europe/Copenhagen", se: "Europe/Stockholm", no: "Europe/Oslo", fi: "Europe/Helsinki", pl: "Europe/Warsaw",
  cz: "Europe/Prague", hu: "Europe/Budapest", gr: "Europe/Athens", hr: "Europe/Zagreb", is: "Atlantic/Reykjavik",
  ma: "Africa/Casablanca", eg: "Africa/Cairo", za: "Africa/Johannesburg", ke: "Africa/Nairobi", tn: "Africa/Tunis",
  mx: "America/Mexico_City", br: "America/Sao_Paulo", ar: "America/Argentina/Buenos_Aires", cl: "America/Santiago",
  pe: "America/Lima", co: "America/Bogota", cu: "America/Havana", nz: "Pacific/Auckland",
};

/** Time zone of a place from its country code and longitude */
export function timezoneFor(country: string | undefined, lng: number): string {
  const c = (country || "").toLowerCase();
  if (c === "us") return lng < -115 ? "America/Los_Angeles" : lng < -102 ? "America/Denver" : lng < -87 ? "America/Chicago" : "America/New_York";
  if (c === "ca") return lng < -115 ? "America/Vancouver" : lng < -90 ? "America/Winnipeg" : lng < -70 ? "America/Toronto" : "America/Halifax";
  if (c === "au") return lng < 129 ? "Australia/Perth" : lng < 141 ? "Australia/Adelaide" : "Australia/Sydney";
  if (c === "id") return lng < 115 ? "Asia/Jakarta" : lng < 125 ? "Asia/Makassar" : "Asia/Jayapura";
  if (c === "ru") return lng < 45 ? "Europe/Moscow" : "Asia/Yekaterinburg";
  return TZ[c] || Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Paris";
}

const COLORS = ["#8CB4E8", "#B7A3E6", "#E8B07A", "#7FD1B9", "#EE8F8F", "#D8C47E", "#9FC6A4", "#E0A3C4"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const WD = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

const parts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() };
};
const addDays = (iso: string, n: number) => {
  const { y, m, d } = parts(iso);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};

/** "24 – 29 novembre 2026", "30 mars – 2 avril 2027" */
export function dateLabel(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) return `${a.d} ${MONTHS[a.m - 1]} ${a.y}`;
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `${a.d} ${MONTHS[a.m - 1]} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  return `${a.d} – ${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
}

/** Number of days from start to end, both included */
export const dayCount = (start: string, end: string) => Math.round((Date.parse(end + "T12:00:00Z") - Date.parse(start + "T12:00:00Z")) / 864e5) + 1;

export type Destination = { name: string; country?: string; countryName?: string; lat: number; lng: number };

/** The record of a new trip */
export function newTripRecord(o: { dest: Destination; start: string; end: string; hotel?: string }): Record<string, unknown> {
  const n = Math.max(1, Math.min(60, dayCount(o.start, o.end)));
  const days = Array.from({ length: n }, (_, i) => {
    const iso = addDays(o.start, i);
    const p = parts(iso);
    return {
      key: `d${i + 1}`, short: `${WD[p.dow]} ${p.d}`, title: `Jour ${i + 1}`, theme: i === 0 ? "Arrivée" : i === n - 1 ? "Départ" : "",
      dates: [iso], color: COLORS[i % COLORS.length], glyph: String(i + 1), scheduled: true,
    };
  });
  const center: [number, number] = [o.dest.lng, o.dest.lat];
  const city = o.dest.name.trim();
  return {
    code: `${city.replace(/[^A-Za-zÀ-ÿ]/g, "").slice(0, 3).toUpperCase() || "VOY"} ${parts(o.start).y}`,
    title: city,
    subtitle: "Voyage",
    dateLabel: dateLabel(o.start, o.end),
    start: o.start,
    end: o.end,
    timezone: timezoneFor(o.dest.country, o.dest.lng),
    country: (o.dest.country || "").toLowerCase(),
    hotel: { name: o.hotel?.trim() || "Hôtel à préciser", lat: o.dest.lat, lng: o.dest.lng },
    center,
    days: [
      { key: "base", short: "Hôtel", title: "Hôtel", theme: "Base du séjour", color: "#f6f2ea", glyph: "H", scheduled: false },
      ...days,
      { key: "ideas", short: "Pistes", title: "Pistes", theme: "À voir si le temps le permet", color: "#9A958D", glyph: "+", scheduled: false },
    ],
    zones: [{ label: city, center, zoom: 12 }],
    flights: [],
    phrases: [],
    practical: [],
    checklist: [],
  };
}

let lastGeo = 0;
/** Cities matching what is typed (OpenStreetMap, one request per second at most) */
export async function searchCities(q: string, signal?: AbortSignal): Promise<Destination[]> {
  if (q.trim().length < 2) return [];
  const wait = lastGeo + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  if (signal?.aborted) return [];
  lastGeo = Date.now();
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&accept-language=fr&featureType=settlement&q=${encodeURIComponent(q.trim())}`, { signal });
    const list = (await r.json()) as { name?: string; display_name: string; lat: string; lon: string; address?: Record<string, string> }[];
    const seen = new Set<string>();
    return list
      .map((x) => ({
        name: x.name || x.address?.city || x.address?.town || x.display_name.split(",")[0],
        country: x.address?.country_code,
        countryName: x.address?.country,
        lat: +x.lat,
        lng: +x.lon,
      }))
      .filter((d) => {
        const k = `${d.name}|${d.country}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  } catch {
    return [];
  }
}
