// Read-only snapshot of the whole notebook for the "Demander" assistant, in two parts:
// - stable: everything in the notebook (no time, no position) → identical between questions, so DeepSeek caches it
// - live: current time, position (with its age), weather, sync state, what is open now and distances
import { TRIPS } from "../data/trip";
import type { Trip } from "../data/types";
import { km } from "./geo";
import { checkVisit, hoursLine, liveStatus } from "./hours";
import type { Data, Settings } from "./model";
import { stopTime } from "./plan";
import type { Wx } from "./weather";
import { notesOf } from "./notes";

const MAX_STABLE = 350_000; // the relay accepts 400 000 characters; long texts are shortened only beyond this

const txt = (s: unknown, n = Infinity) => {
  const t = String(s ?? "").replace(/[ \t]+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};
const drop = <T extends Record<string, unknown>>(o: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length) && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length)),
  ) as Partial<T>;

function readJSON<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

/** { "Eliot": "…", "Papa": "…", "commune (Papa)": "…" } — one entry per author */
function noteMap(rec: Record<string, unknown>, legacyText: string | undefined, cap: number): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const n of notesOf(rec, null, legacyText)) {
    if (!n.text.trim()) continue;
    out[n.legacy ? (n.name ? `commune (dernière modif. ${n.name})` : "commune (auteur inconnu)") : n.name] = txt(n.text, cap);
  }
  return Object.keys(out).length ? out : undefined;
}

function tripBlock(trip: Trip, data: Data, detailed: boolean, cap: number) {
  const st = data.places as Record<string, Record<string, unknown>>;
  const contacts = data.contacts || [];
  const photos = data.photos || [];
  const places = trip.places.map((p) => {
    const s = st[p.id] || {};
    const h = trip.hours?.[p.id];
    const day = trip.days.find((d) => d.key === p.day);
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
      notes: noteMap(s, undefined, cap),
      fournisseur: drop({ moq: s.moq, prix: s.price, delai: s.lead, echantillon: s.sample }),
      contacts: contacts.filter((c) => c.placeId === p.id).map((c) => drop({ nom: c.name, appli: c.kind === "wc" ? "WeChat" : "WhatsApp", id: c.value, message: c.message })),
      photos: photos.filter((x) => x.placeId === p.id).length || undefined,
    });
    if (!detailed) return base;
    return drop({
      ...base,
      adresse: p.address,
      adresse_cn: p.cn,
      metro: p.metro,
      horaires: h ? hoursLine(h) : undefined,
      horaires_note: h?.note,
      fiabilite_horaires: h?.confidence,
      reservation: h?.reservation,
      alertes_visite: h ? checkVisit(h, day?.dates?.[0], stopTime(p, data.places)).filter((i) => i.tone !== "info").map((i) => i.text) : undefined,
      description: txt(p.desc, cap),
      points_forts: (p.highlights || []).map((x) => txt(x, cap)),
      conseil: p.tip ? txt(p.tip, cap) : undefined,
    });
  });
  const pins = (data.pins || []).map((p) => {
    const x = st[`_pin:${p.id}`] || {};
    return drop({
      id: p.id,
      nom: p.name,
      jour: x.day,
      type: x.type,
      nom_cn: x.nameCn,
      adresse: x.address,
      adresse_cn: x.addressCn,
      description: x.desc ? txt(x.desc, cap) : undefined,
      pourquoi: x.why,
      horaires: x.hours,
      prix: x.price,
      source: x.source,
      notes: noteMap(x, p.note, cap),
      contacts: contacts.filter((c) => c.placeId === p.id).map((c) => drop({ nom: c.name, appli: c.kind === "wc" ? "WeChat" : "WhatsApp", id: c.value })),
    });
  });
  const seeds = (trip.checklist || []).map((c) => {
    const v = st[`_check:${c.id}`] || {};
    return v.deleted ? null : drop({ tache: c.text, groupe: c.group, avant_le: c.due, qui: v.owner, faite: v.done || false });
  });
  const custom = Object.entries(st)
    .filter(([k, v]) => k.startsWith("_check:") && v.custom && !v.deleted)
    .map(([, v]) => drop({ tache: v.text, qui: v.owner, faite: v.done || false }));
  const em = trip.emergency;
  return drop({
    voyage: `${trip.code} · ${trip.title} · ${trip.dateLabel}`,
    sous_titre: trip.subtitle,
    hotel: trip.hotel.name,
    fuseau: trip.timezone,
    jours: trip.days.map((d) => drop({ cle: d.key, nom: d.short, titre: d.title, theme: d.theme, dates: d.dates, au_programme: d.scheduled })),
    vols: trip.flights.map((f) => drop({ vol: f.code, de: `${f.fromCity} ${f.from}`, vers: `${f.toCity} ${f.to}`, depart: f.departAt, arrivee: f.arriveAt, terminal: f.terminal })),
    lieux: places,
    mes_lieux_ajoutes: pins,
    check_list: detailed ? [...seeds.filter(Boolean), ...custom] : undefined,
    infos_pratiques: detailed ? (trip.practical || []).map((c) => ({ titre: c.title, texte: txt(c.text, cap) })) : undefined,
    urgence:
      detailed && em
        ? {
            numeros: em.numbers.map((n) => drop({ numero: n.number, quoi: n.label, note: n.note })),
            consulat: drop({ ...em.consulate }),
            hopitaux: em.hospitals.map((h) => drop({ nom: h.name, nom_cn: h.cn, adresse: h.address, adresse_cn: h.addressCn, tel: h.phone, urgences_24h: h.er24, anglais: h.english, tiers_payant: h.directBilling, note: h.note, lat: h.lat, lng: h.lng })),
          }
        : undefined,
  });
}

function buildStableAt(trip: Trip, data: Data, settings: Settings, cap: number): string {
  const ins = (data.places["_info:insurance"] || {}) as Record<string, unknown>;
  const hist = readJSON<{ at: number; r: { kind: string; title: string; summary: string; material: string; contact: Record<string, string>; lines: { zh: string; fr: string; price: number }[] } }[]>("orbes.photo.history") || [];
  const others = TRIPS.filter((t) => t.id !== trip.id).map((t) => {
    const d = readJSON<Data>("orbes.v2." + t.id);
    return d
      ? tripBlock(t, { places: d.places || {}, contacts: d.contacts || [], pins: d.pins || [], photos: d.photos || [] }, false, cap)
      : drop({ voyage: `${t.code} · ${t.title} · ${t.dateLabel}`, lieux: t.places.map((p) => ({ id: p.id, nom: p.name, jour: p.day, type: p.type })) });
  });
  return JSON.stringify(
    drop({
      taux_eur_cny: settings.eurRate,
      assurance: drop({ assureur: ins.insurer, contrat: ins.policy, assistance: ins.phone, a_savoir: ins.note }),
      voyage_actuel: tripBlock(trip, data, true, cap),
      photos_traduites_sur_ce_telephone: hist.map(({ at, r }) =>
        drop({
          quand: new Date(at).toISOString().slice(0, 16),
          type: r.kind,
          titre: r.title,
          resume: r.summary,
          matiere: r.material,
          carte_de_visite: r.kind === "carte" ? drop(r.contact || {}) : undefined,
          lignes: (r.lines || []).slice(0, 30).map((l) => `${l.zh} = ${l.fr}${l.price ? ` (${l.price} ¥)` : ""}`),
        }),
      ),
      autres_voyages: others,
    }),
  );
}

/** The notebook itself. Long texts are kept whole unless the snapshot gets too big for the relay. */
export function buildStable(trip: Trip, data: Data, settings: Settings): string {
  let out = buildStableAt(trip, data, settings, Infinity);
  for (const cap of [3000, 1200, 500]) {
    if (out.length <= MAX_STABLE) break;
    out = buildStableAt(trip, data, settings, cap);
  }
  return out;
}

/** What changes from one question to the next. */
export function buildLive(
  trip: Trip,
  data: Data,
  fix: { lat: number; lng: number; acc: number; t: number } | null,
  stale: boolean,
  wx: Wx | null,
  sync: { state: string; pending: number },
): string {
  const now = new Date();
  const fmt = (tz: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(now);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: trip.timezone }).format(now);
  const age = fix ? Math.round((Date.now() - fix.t) / 60000) : null;
  const usable = fix && age != null && age <= 30;
  return JSON.stringify(
    drop({
      heure_locale_voyage: fmt(trip.timezone),
      heure_paris: fmt("Europe/Paris"),
      ma_position: fix
        ? drop({ lat: Math.round(fix.lat * 1e5) / 1e5, lng: Math.round(fix.lng * 1e5) / 1e5, precision_m: Math.round(fix.acc), age_minutes: age, etat: stale || (age ?? 0) > 5 ? `ancienne (il y a ${age} min)` : "à jour" })
        : "inconnue (localisation coupée)",
      synchro: { etat: sync.state, envois_en_attente: sync.pending },
      meteo: wx ? drop({ jours: wx.days.filter((d) => d.date >= today).map((d) => `${d.date} ${d.min}–${d.max}° pluie ${d.rain}%`) }) : undefined,
      lieux_maintenant: trip.places
        .map((p) => {
          const ls = liveStatus(trip.hours?.[p.id], trip.timezone, now);
          return drop({ id: p.id, ouvert: ls?.label, distance_km_vol_oiseau: usable ? Math.round(km(fix!, p) * 10) / 10 : undefined });
        })
        .filter((x) => Object.keys(x).length > 1),
      mes_lieux_distance: usable ? data.pins.map((p) => ({ id: p.id, distance_km_vol_oiseau: Math.round(km(fix!, p) * 10) / 10 })) : undefined,
    }),
  );
}
