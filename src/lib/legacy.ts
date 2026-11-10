// One-time import of what the June 2026 version kept in this browser (localStorage keys "gz_*"),
// so nothing typed during the trip is lost. The old keys are left untouched.
import { PLACES } from "../data/trip";
import type { Status } from "../data/types";
import { emptyData, uid, type Data } from "./model";

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
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("gz_") && k !== "gz_ok") return true;
    }
  } catch {
    /* storage blocked */
  }
  return false;
}

export function importLegacy(): Data {
  const d = emptyData();
  const now = Date.now();
  const favs = new Set(read<string[]>("gz_fv", []));
  const vis = new Set(read<string[]>("gz_vs", []));

  for (const p of PLACES) {
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
      visited: vis.has(p.id) || undefined,
    };
    const clean = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    if (Object.keys(clean).length) d.places[p.id] = { ...clean, updatedAt: now };

    for (const c of read<{ name: string; type: string; contact: string; msg?: string }[]>("gz_c_" + p.id, [])) {
      if (!c?.name || !c?.contact) continue;
      d.contacts.push({
        id: uid(),
        placeId: p.id,
        name: c.name,
        kind: c.type === "wc" ? "wc" : "wa",
        value: c.contact,
        message: c.msg || undefined,
        createdAt: now,
      });
    }
    for (const dataUrl of read<string[]>("gz_p_" + p.id, [])) {
      if (typeof dataUrl === "string" && dataUrl.startsWith("data:image")) {
        d.photos.push({ id: uid(), placeId: p.id, dataUrl, createdAt: now });
      }
    }
  }

  for (const pin of read<{ id: string; name: string; lat: number; lng: number; note?: string }[]>("gz_pins", [])) {
    if (!pin?.name || typeof pin.lat !== "number") continue;
    d.pins.push({ id: uid(), name: pin.name, lat: pin.lat, lng: pin.lng, note: pin.note || undefined, updatedAt: now });
  }

  const rate = parseFloat(localStorage.getItem("gz_rate") || "");
  if (rate > 0) d.settings.eurRate = rate;
  return d;
}
