// The address keys the cycle's e-mails and notifications open the app with (lot cycle). Pure, no import, so
// scripts/offline-sim.mjs can test it under node.
//   ?new=1          the trip creation opens ("Préparez votre prochain voyage", first trip, trip of the month)
//   ?booking=<id>   the forwarded booking that announces a new trip: its creation form opens, filled in
//   ?offline=1      the trip's offline card opens (J-3 reminder)
//   ?join=<token>   an invitation link (remembered on the device until used)
// Never touched here: src / by (read by the tracking at load), t, p, copy, reset, Supabase's code, the #trip.

export const ENTRY_KEYS = ["new", "booking", "offline"] as const;
export type EntryKey = (typeof ENTRY_KEYS)[number];
export type Entry = { new: boolean; booking: number | null; offline: boolean; join: string | null };

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

/** What an address asks for */
export function readEntry(search: string): Entry {
  const p = new URLSearchParams(search || "");
  const b = p.get("booking") || "";
  const j = p.get("join") || "";
  return {
    new: p.get("new") === "1",
    booking: /^\d{1,12}$/.test(b) ? Number(b) : null,
    offline: p.get("offline") === "1",
    join: TOKEN.test(j) ? j : null,
  };
}

/** The same query without these keys ("" when nothing is left), every other key kept in its order */
export function withoutKeys(search: string, keys: readonly string[]): string {
  const p = new URLSearchParams(search || "");
  for (const k of keys) p.delete(k);
  const s = p.toString();
  return s ? `?${s}` : "";
}
