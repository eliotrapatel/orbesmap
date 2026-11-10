// Read-only snapshot of the whole notebook, sent with each question to the "Demander" assistant.
// Everything the app knows: programme, places, hours, notes and statuses (both travellers), supplier sheets,
// contacts, added places, checklist, insurance, flights, practical info, weather, current time and position.
import { TRIPS } from "../data/trip";
import type { Trip } from "../data/types";
import { hoursLine, liveStatus } from "./hours";
import type { Data, Settings } from "./model";
import type { Wx } from "./weather";
import { km } from "./geo";

const clip = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const drop = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length)),
  ) as Partial<T>;

function readOther(t: Trip): Data | null {
  try {
    return JSON.parse(localStorage.getItem("orbes.v2." + t.id) || "null");
  } catch {
    return null;
  }
}

function tripBlock(trip: Trip, data: Data, detailed: boolean, fix: { lat: number; lng: number } | null) {
  const st = data.places as Record<string, Record<string, unknown>>;
  const contacts = data.contacts || [];
  const photos = data.photos || [];
  const places = trip.places.map((p) => {
    const s = st[p.id] || {};
    const h = trip.hours?.[p.id];
    const base = drop({
      id: p.id,
      nom: p.name,
      jour: p.day,
      type: p.type,
      horaire_prevu: p.time,
      rdv: s.appt,
      statut: s.status,
      note_sur_5: s.rating || undefined,
      favori: s.favorite || undefined,
      visite: s.visited || undefined,
      notes: s.note ? clip(s.note, 600) : undefined,
      fournisseur: drop({ moq: s.moq, prix: s.price, delai: s.lead, echantillon: s.sample }),
      contacts: contacts.filter((c) => c.placeId === p.id).map((c) => `${c.name} (${c.kind === "wc" ? "WeChat" : "WhatsApp"} ${c.value})`),
      photos: photos.filter((x) => x.placeId === p.id).length || undefined,
    });
    if (!detailed) return base;
    return drop({
      ...base,
      adresse: clip(p.address, 120),
      adresse_cn: p.cn,
      metro: p.metro ? clip(p.metro, 90) : undefined,
      horaires: h ? hoursLine(h) : undefined,
      ouvert_maintenant: h ? liveStatus(h, trip.timezone)?.label : undefined,
      reservation: h?.reservation ? clip(h.reservation, 220) : undefined,
      description: clip(p.desc, 260),
      points_forts: (p.highlights || []).slice(0, 3).map((x) => clip(x, 120)),
      conseil: p.tip ? clip(p.tip, 200) : undefined,
      distance_km_vol_oiseau: fix ? Math.round(km(fix, p) * 10) / 10 : undefined,
    });
  });
  const pins = (data.pins || []).map((p) => {
    const x = st[`_pin:${p.id}`] || {};
    return drop({
      id: p.id,
      nom: p.name,
      jour: x.day,
      nom_cn: x.nameCn,
      adresse: x.address,
      adresse_cn: x.addressCn,
      description: x.desc ? clip(x.desc, 260) : undefined,
      horaires: x.hours,
      prix: x.price,
      notes: p.note ? clip(p.note, 400) : undefined,
      distance_km_vol_oiseau: fix ? Math.round(km(fix, p) * 10) / 10 : undefined,
    });
  });
  const checklist = Object.entries(st)
    .filter(([k, v]) => k.startsWith("_check:") && !v.deleted)
    .map(([k, v]) => ({ k: k.slice(7), v }));
  const seeds = (trip.checklist || []).map((c) => {
    const v = st[`_check:${c.id}`] || {};
    return v.deleted ? null : drop({ tache: c.text, avant_le: c.due, qui: v.owner, faite: v.done || false });
  });
  const custom = checklist.filter((c) => c.v.custom).map((c) => drop({ tache: c.v.text, qui: c.v.owner, faite: c.v.done || false }));
  return drop({
    voyage: `${trip.code} · ${trip.title} · ${trip.dateLabel}`,
    sous_titre: trip.subtitle,
    hotel: trip.hotel.name,
    fuseau: trip.timezone,
    jours: trip.days.map((d) => drop({ cle: d.key, nom: d.short, titre: d.title, theme: d.theme, dates: d.dates })),
    vols: trip.flights.map((f) => drop({ vol: f.code, de: `${f.fromCity} ${f.from}`, vers: `${f.toCity} ${f.to}`, depart: f.departAt, arrivee: f.arriveAt, terminal: f.terminal })),
    lieux: places,
    mes_lieux_ajoutes: pins,
    check_list: detailed ? [...seeds.filter(Boolean), ...custom] : undefined,
    infos_pratiques: detailed ? (trip.practical || []).map((c) => ({ titre: c.title, texte: clip(c.text, 900) })) : undefined,
    urgence: detailed && trip.emergency
      ? {
          numeros: trip.emergency.numbers.map((n) => `${n.number} ${n.label}`),
          consulat: `${trip.emergency.consulate.name}, ${trip.emergency.consulate.address}, tél. ${trip.emergency.consulate.phone}, urgence ${trip.emergency.consulate.emergency}`,
          hopitaux: trip.emergency.hospitals.map((h) => `${h.name} (${h.address}, tél. ${h.phone}${h.er24 ? ", urgences 24h/24" : ""})`),
        }
      : undefined,
  });
}

export function buildCarnet(trip: Trip, data: Data, settings: Settings, fix: { lat: number; lng: number; acc: number } | null, wx: Wx | null): string {
  const now = new Date();
  const local = new Intl.DateTimeFormat("fr-FR", { timeZone: trip.timezone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(now);
  const paris = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", weekday: "long", hour: "2-digit", minute: "2-digit" }).format(now);
  const ins = (data.places["_info:insurance"] || {}) as Record<string, unknown>;
  const others = TRIPS.filter((t) => t.id !== trip.id)
    .map((t) => {
      const d = readOther(t);
      return d ? tripBlock(t, { places: d.places || {}, contacts: d.contacts || [], pins: d.pins || [], photos: d.photos || [] }, false, null) : drop({ voyage: `${t.code} · ${t.title} · ${t.dateLabel}`, lieux: t.places.map((p) => ({ id: p.id, nom: p.name, jour: p.day, type: p.type })) });
    });
  const snapshot = drop({
    maintenant: { heure_locale_voyage: local, heure_paris: paris },
    ma_position: fix ? { lat: Math.round(fix.lat * 1e5) / 1e5, lng: Math.round(fix.lng * 1e5) / 1e5, precision_m: Math.round(fix.acc) } : "inconnue (localisation coupée)",
    taux_eur_cny: settings.eurRate,
    meteo: wx ? drop({ maintenant: wx.now ? `${wx.now.temp}°` : undefined, jours: wx.days.slice(0, 16).map((d) => `${d.date} ${d.min}–${d.max}° pluie ${d.rain}%`) }) : undefined,
    assurance: drop({ assureur: ins.insurer, contrat: ins.policy, assistance: ins.phone, a_savoir: ins.note }),
    voyage_actuel: tripBlock(trip, data, true, fix),
    autres_voyages: others,
  });
  return JSON.stringify(snapshot);
}
