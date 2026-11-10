// One-time import of what the June 2026 version kept in this browser (localStorage keys "gz_*"),
// so nothing typed during the Guangzhou trip is lost.
// - Text data is imported synchronously into the Guangzhou trip.
// - Photos are moved to IndexedDB afterwards (see store.importLegacyPhotos).
// - Ids are derived from the old data and timestamps set to the end of that trip, so a later
//   sign-in never duplicates rows nor overwrites newer edits made elsewhere.
import { GZ2026 } from "../data/trips/gz2026";
import type { Status } from "../data/types";
import { emptyData, stableId, type Data } from "./model";

export const LEGACY_TRIP = GZ2026.id;
export const LEGACY_MARKER = "orbes.legacy.v1.imported";
const LEGACY_TIME = Date.parse("2026-06-13T00:00:00+08:00");

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function hasLegacyData(): boolean {
  try {
    if (localStorage.getItem(LEGACY_MARKER)) return false;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("gz_") && k !== "gz_ok") return true;
    }
  } catch {
    /* storage blocked */
  }
  return false;
}

export interface LegacyPhoto {
  key: string;
  index: number;
  placeId: string;
  id: string;
}

export function importLegacy(): { data: Data; eurRate?: number; photos: LegacyPhoto[] } {
  const d = emptyData();
  const favs = new Set(read<string[]>("gz_fv", []));
  const vis = new Set(read<string[]>("gz_vs", []));
  const photos: LegacyPhoto[] = [];

  for (const p of GZ2026.places) {
    const m = read<Record<string, unknown>>("gz_m_" + p.id, {});
    let note = "";
    try {
      note = localStorage.getItem("gz_n_" + p.id) || "";
    } catch {
      /* ignore */
    }
    const s = {
      status: (m.status as Status | null) ?? undefined,
      rating: typeof m.rating === "number" && m.rating > 0 ? m.rating : undefined,
      appt: (m.appt as string) || undefined,
      moq: (m.moq as string) || undefined,
      price: (m.price as string) || undefined,
      lead: (m.lead as string) || undefined,
      sample: (m.sample as string) || undefined,
      note: note || undefined,
      favorite: favs.has(p.id) || undefined,
      // the hotel is not a place to "visit"
      visited: (p.id !== GZ2026.hotel.placeId && vis.has(p.id)) || undefined,
    };
    const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    if (Object.keys(clean).length) d.places[p.id] = { ...clean, updatedAt: LEGACY_TIME };

    read<{ name: string; type: string; contact: string; msg?: string }[]>("gz_c_" + p.id, []).forEach((c, i) => {
      if (!c?.name || !c?.contact) return;
      d.contacts.push({
        id: stableId(`gz-contact|${p.id}|${i}|${c.name}|${c.contact}`),
        placeId: p.id,
        name: c.name,
        kind: c.type === "wc" ? "wc" : "wa",
        value: c.contact,
        message: c.msg || undefined,
        createdAt: LEGACY_TIME,
      });
    });

    read<string[]>("gz_p_" + p.id, []).forEach((dataUrl, i) => {
      if (typeof dataUrl === "string" && dataUrl.startsWith("data:image")) {
        photos.push({ key: "gz_p_" + p.id, index: i, placeId: p.id, id: stableId(`gz-photo|${p.id}|${i}|${dataUrl.length}|${dataUrl.slice(-64)}`) });
      }
    });
  }

  read<{ id: string; name: string; lat: number; lng: number; note?: string }[]>("gz_pins", []).forEach((pin, i) => {
    if (!pin?.name || typeof pin.lat !== "number") return;
    d.pins.push({ id: stableId(`gz-pin|${pin.id || i}|${pin.name}|${pin.lat}|${pin.lng}`), name: pin.name, lat: pin.lat, lng: pin.lng, note: pin.note || undefined, updatedAt: LEGACY_TIME });
  });

  const rate = parseFloat(localStorage.getItem("gz_rate") || "");
  return { data: d, eurRate: rate > 0 ? rate : undefined, photos };
}

export function readLegacyPhoto(p: LegacyPhoto): string | null {
  const arr = read<string[]>(p.key, []);
  return typeof arr[p.index] === "string" ? arr[p.index] : null;
}
