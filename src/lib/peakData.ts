// The series the signature card draws (lot CARTE SIGNATURE): one value per calendar day. Pure, no imports, so a
// node script can check it (scripts/peak-check.mjs).

export type Series = { days: string[]; values: number[]; activeDays: number; peakIndex: number };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Days since 1970 for a yyyy-mm-dd date (UTC), NaN when it is not one */
function dayNum(iso: string | null | undefined): number {
  const s = String(iso || "").slice(0, 10);
  if (!ISO.test(s)) return NaN;
  const n = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(n) ? Math.round(n / 864e5) : NaN;
}
const isoOf = (n: number) => new Date(n * 864e5).toISOString().slice(0, 10);
/** Most days a series ever holds (a range read from bad data never draws years) */
const MAX_DAYS = 366;
const WIDEN_MAX = 45;

function finish(days: string[], values: number[]): Series {
  let activeDays = 0;
  let peakIndex = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > 0) activeDays++;
    if (values[i] > values[peakIndex]) peakIndex = i;
  }
  return { days, values, activeDays, peakIndex };
}

/** One value per calendar day (yyyy-mm-dd) from `start` to `end`. The range widens to cover the items' own dates
 *  only while the whole span stays ≤ 45 days; past that, items outside start..end are not drawn (totals unchanged).
 *  Items without a valid date are not drawn. When `start` or `end` is not a valid date, the range is the items'
 *  own first to last date. */
export function seriesByDay(items: { date: string; value: number }[], start: string, end: string): Series {
  const pts = items
    .map((i) => ({ d: dayNum(i.date), v: Number(i.value) }))
    .filter((p) => Number.isFinite(p.d) && Number.isFinite(p.v));
  let a = dayNum(start);
  let b = dayNum(end);
  const lo = pts.length ? Math.min(...pts.map((p) => p.d)) : NaN;
  const hi = pts.length ? Math.max(...pts.map((p) => p.d)) : NaN;
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) {
    if (!pts.length) return finish([], []);
    a = lo;
    b = hi;
  } else if (pts.length) {
    const wa = Math.min(a, lo);
    const wb = Math.max(b, hi);
    if (wb - wa + 1 <= WIDEN_MAX) {
      a = wa;
      b = wb;
    }
  }
  if (b - a + 1 > MAX_DAYS) a = b - MAX_DAYS + 1;
  const n = b - a + 1;
  const values = new Array<number>(n).fill(0);
  for (const p of pts) if (p.d >= a && p.d <= b) values[p.d - a] += p.v;
  const days = Array.from({ length: n }, (_, i) => isoOf(a + i));
  return finish(days, values);
}

/** The last `n` calendar days ending `today` (a yyyy-mm-dd UTC date), zeros where `rows` has no entry */
export function lastDays(rows: { day: string; value: number }[], n: number, today: string): Series {
  const end = Number.isFinite(dayNum(today)) ? dayNum(today) : Math.floor(Date.now() / 864e5);
  const count = Math.max(1, Math.floor(n));
  const a = end - count + 1;
  const values = new Array<number>(count).fill(0);
  for (const r of rows) {
    const d = dayNum(r.day);
    const v = Number(r.value);
    if (Number.isFinite(d) && Number.isFinite(v) && d >= a && d <= end) values[d - a] += v;
  }
  return finish(Array.from({ length: count }, (_, i) => isoOf(a + i)), values);
}

/** The line is drawn from two days with a value */
export const lineShown = (s: Series | null | undefined) => !!s && s.activeDays >= 2;

/** Where the currency symbol goes for this locale: {prefix, suffix} from Intl (narrow symbol), spaces kept */
export function currencyAffix(locale: string, currency: string): { prefix: string; suffix: string } {
  let parts: Intl.NumberFormatPart[];
  try {
    parts = new Intl.NumberFormat(locale, { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(1);
  } catch {
    parts = new Intl.NumberFormat(locale, { style: "currency", currency }).formatToParts(1);
  }
  const num = (t: string) => t === "integer" || t === "decimal" || t === "fraction" || t === "group";
  const first = parts.findIndex((p) => num(p.type));
  let last = -1;
  parts.forEach((p, i) => { if (num(p.type)) last = i; });
  const keep = (ps: Intl.NumberFormatPart[]) => ps.filter((p) => p.type !== "minusSign" && p.type !== "plusSign").map((p) => p.value).join("");
  return { prefix: keep(parts.slice(0, Math.max(0, first))), suffix: keep(parts.slice(last + 1)) };
}

/** "sam. 12 sept." — weekday short, day, month short, read in UTC (as the expenses list does); the iso itself
 *  when it is not a date */
export function shortDay(iso: string, locale: string): string {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  return !ISO.test(String(iso).slice(0, 10)) || Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
