// Preparing a new trip with the AI, day by day: the trame (outline), the essentials of the destination, then
// one research per day (real places, checked, with their time slots). Each step is saved in the trip's record
// ("draft"), so a closed app picks up where it stopped. One request at a time (the AI is capped per account).
// The preparation runs on the server (api/prepare.ts): it goes on when the screen closes or the app is closed, and the
// app only shows its progress (the trip's record and places, synced as usual). When the server cannot be reached, the
// app prepares the trip itself as before: then it only writes into its own trip, stops as soon as another trip is
// opened or the screen closes, and only one phone (or tab) prepares a trip at a time.
import { track } from "./track";
import { useSyncExternalStore } from "react";
import type { Trip } from "../data/types";
import { TYPE_LABEL } from "../data/trip";
import { ai, aiContext, AiError, apiUrl, type AdjustResult, type DayResult, type EssentialsResult, type FixedItem, type OutlineResult, type PlacesResult } from "./ai";
import { km, toWgs } from "./geo";
import { geocode } from "./placeSearch";
import { slotText } from "./slots";
import { createPlace, currentTrip, getState, pull, requestPro, updateDef, updateTrip } from "./store";
import { supabase } from "./supabase";
import { t } from "./i18n";

/** What the creation wizard collected, kept in the trip's record */
export type Draft = {
  status: "preparing" | "review" | "done";
  cities: { name: string; lat: number; lng: number; country?: string }[];
  hotelText?: string;
  flightsText?: string;
  pace: string;
  interests: string[];
  wishes: string[];
  dayWishes: Record<string, string>;
  places: { name: string; city: string; why: string; mustSee: boolean; source: string }[];
  fixed: FixedItem[];
  outline?: OutlineResult["days"];
  essentials?: boolean;
  days?: Record<string, "done" | "error">;
  error?: string;
  /** which phone is preparing ("server": api/prepare.ts), and when it last showed signs of life (only one at a time);
   *  the server also says its step ("outline", "essentials", "day:<date>", "place:<date>") */
  lease?: { by: string; at: number; hold?: string | null; step?: string };
  /** when the trip was validated (ms): later changes to its programme need Pro on a free account */
  doneAt?: number;
};

/** busy / step / found / placed: the app's own run; mode: who prepares this trip ("server", "local", "" not known yet) */
type Run = { tripId: string; busy: boolean; step: string; found: number; placed: number; err: string | null; mode: "" | "server" | "local" };
let run: Run = { tripId: "", busy: false, step: "", found: 0, placed: 0, err: null, mode: "" };
const subs = new Set<() => void>();
const setRun = (p: Partial<Run>) => {
  run = { ...run, ...p };
  subs.forEach((f) => f());
};
/** The run of this trip (another trip's progress and errors are never shown here) */
export function useDraftRun(tripId: string): Run {
  const r = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => run,
  );
  return r.tripId === tripId ? { ...r, mode: modes.get(tripId) || "" } : { tripId, busy: false, step: "", found: 0, placed: 0, err: null, mode: modes.get(tripId) || "" };
}

export const draftOf = (tripId: string): Draft | undefined => getState().trips[tripId]?.draft as Draft | undefined;
const saveDraft = (tripId: string, patch: Partial<Draft>) => {
  const cur = draftOf(tripId);
  if (cur) updateTrip(tripId, { draft: { ...cur, ...patch } });
};

// one device id per phone/tab, to hold the preparation lease
const DEVICE = (() => {
  try {
    let id = sessionStorage.getItem("orbes.device");
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem("orbes.device", id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
})();
const LEASE_MS = 3 * 60_000;
/** Another phone or tab is preparing this trip right now */
export const preparedElsewhere = (tripId: string) => {
  const l = draftOf(tripId)?.lease;
  return !!l && l.by !== DEVICE && Date.now() - l.at < LEASE_MS;
};

const PACE: Record<string, string> = { relaxed: "tranquille", balanced: "équilibré", packed: "dense" };
/** "09:30", "9:30", "09h30", "9h" → minutes */
const hm = (s: string) => {
  const m = (s || "").trim().match(/^(\d{1,2})\s*[:h]\s*(\d{2})?$/i);
  return m && +m[1] < 30 ? +m[1] * 60 + (m[2] ? +m[2] : 0) : null;
};
const fixedLine = (f: FixedItem) => [f.name, f.date, f.time && `${f.time}${f.endTime ? `–${f.endTime}` : ""}`, f.address, f.notes].filter(Boolean).join(" · ");

/** The plan the creation tasks read (who, where, when, what was said) */
function planOf(trip: Trip, d: Draft) {
  return {
    cities: d.cities.map((c) => c.name).join(", "),
    hotel: d.hotelText || trip.hotel.name,
    flights: d.flightsText || trip.flights.map((f) => `${f.code} ${f.from}→${f.to} départ ${f.departAt || f.at} arrivée ${f.arriveAt || f.at}`).join(" ; "),
    pace: PACE[d.pace] || d.pace,
    interests: d.interests.join(", "),
    wishes: d.wishes.join(" ; "),
    dayWishes: Object.entries(d.dayWishes).filter(([, v]) => v.trim()).map(([k, v]) => `${k} : ${v}`).join(" ; "),
  };
}

/** The language of a country, when the essentials could not say it */
const LANG: Record<string, { code: string; name: string; speech: string }> = {
  cn: { code: "zh-CN", name: "chinois", speech: "zh-CN" }, tw: { code: "zh-TW", name: "chinois", speech: "zh-TW" }, hk: { code: "zh-HK", name: "cantonais", speech: "zh-HK" },
  jp: { code: "ja", name: "japonais", speech: "ja-JP" }, kr: { code: "ko", name: "coréen", speech: "ko-KR" }, th: { code: "th", name: "thaï", speech: "th-TH" },
  vn: { code: "vi", name: "vietnamien", speech: "vi-VN" }, it: { code: "it", name: "italien", speech: "it-IT" }, es: { code: "es", name: "espagnol", speech: "es-ES" },
  pt: { code: "pt-PT", name: "portugais", speech: "pt-PT" }, br: { code: "pt-BR", name: "portugais", speech: "pt-BR" }, de: { code: "de", name: "allemand", speech: "de-DE" },
  gb: { code: "en-GB", name: "anglais", speech: "en-GB" }, us: { code: "en-US", name: "anglais", speech: "en-US" }, gr: { code: "el", name: "grec", speech: "el-GR" },
  tr: { code: "tr", name: "turc", speech: "tr-TR" }, ma: { code: "ar", name: "arabe", speech: "ar-MA" }, mx: { code: "es-MX", name: "espagnol", speech: "es-MX" },
  nl: { code: "nl", name: "néerlandais", speech: "nl-NL" }, ru: { code: "ru", name: "russe", speech: "ru-RU" }, in: { code: "hi", name: "hindi", speech: "hi-IN" },
};
export const langForCountry = (c?: string) => LANG[(c || "").toLowerCase()];

/** The trip's city nearest to a day (its area from the outline, else the base city) */
function cityFor(d: Draft, area: string | undefined): { lat: number; lng: number; name: string } {
  const a = (area || "").toLowerCase();
  return d.cities.find((c) => a.includes(c.name.toLowerCase())) || d.cities[0];
}

/** Where a found place is: its coordinates if credible (near the day's city), else its address; null if unknown */
async function position(p: { name: string; nameCn?: string; address?: string; addressCn?: string; lat: number; lng: number; coordSystem: string }, city: { lat: number; lng: number; name: string }, country: string, signal: AbortSignal): Promise<[number, number] | null> {
  const near = (ll: { lat: number; lng: number }) => km(ll, city) < 150;
  if (p.coordSystem !== "none" && p.lat && p.lng) {
    // the Chinese map offset only exists in mainland China
    const w = toWgs(p.lat, p.lng, country === "cn" || !country ? p.coordSystem : "WGS84");
    if (near(w)) return [w.lng, w.lat];
  }
  const box: [number, number, number, number] = [city.lng - 1.2, city.lat - 1.2, city.lng + 1.2, city.lat + 1.2];
  for (const q of [p.addressCn, p.address, p.nameCn, `${p.name} ${city.name}`]) {
    if (!q || signal.aborted) continue;
    const g = await geocode(q, box, signal, country);
    if (g) return g.ll;
  }
  return null;
}

/** A day's limits that stop the whole run (the next steps would fail the same way and burn requests) */
const stopsAll = (e: unknown) => e instanceof AiError && /Limite du jour|Trop de demandes|réseau|injoignable|Connectez|Session expirée|ne répond pas|Daily limit|Too many requests|network|can't be reached|Sign in|Session expired|isn't responding/i.test(e.message);

let ctl: AbortController | null = null;
/** Stops the preparation (the screen closed, or another trip opened); it resumes where it stopped */
export function stopPrepare() {
  ctl?.abort();
}

// ---------- the server's preparation (api/prepare.ts) ----------
const modes = new Map<string, "server" | "local">();
const setMode = (tripId: string, m: "server" | "local") => {
  if (modes.get(tripId) === m) return;
  modes.set(tripId, m);
  setRun({});
};
/** A server lease older than this: its call is gone (the server restarts it, the app can too) */
const SERVER_STALE = 6 * 60_000;
/** The server's clock minus this phone's (each answer of api/prepare.ts says its time): a lease's age is measured on
 *  the server's clock, so a phone set a few minutes ahead never takes a running preparation for a stopped one */
let skew = 0;
const serverNow = (now = Date.now()) => now + skew;
/** The server is working on this trip right now */
export const serverBusy = (tripId: string, now = Date.now()) => {
  const d = draftOf(tripId);
  const l = d?.lease;
  return d?.status === "preparing" && !!l && l.by === "server" && serverNow(now) - l.at < SERVER_STALE;
};
const starting = new Set<string>();

type Answer =
  | { kind: "ok"; body: Record<string, unknown> }
  | { kind: "refused"; message: string; pro: boolean }
  | { kind: "notready" | "busy" | "elsewhere" | "down" };
/** One request to the server's preparation; "down" = not reachable (the app prepares the trip itself) */
async function askServer(action: string, tripId: string, extra: Record<string, unknown> = {}): Promise<Answer> {
  if (!navigator.onLine) return { kind: "down" };
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
  if (!token) return { kind: "refused", message: t("Connectez-vous dans l'onglet Compte pour utiliser cette fonction."), pro: false };
  const ctl = new AbortController();
  const tm = window.setTimeout(() => ctl.abort(), 25_000);
  try {
    const res = await fetch(apiUrl("prepare"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      // who the AI helps (the preparation screen only shows the open trip)
      body: JSON.stringify({ action, trip: tripId, ...(currentTrip().id === tripId ? { ctx: aiContext() } : {}), ...extra }),
      signal: ctl.signal,
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.now === "number" && Number.isFinite(body.now)) skew = body.now - Date.now();
    if (res.ok) return { kind: "ok", body };
    if (res.status === 409) return { kind: body.error === "notready" ? "notready" : body.error === "elsewhere" ? "elsewhere" : "busy" };
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return { kind: "refused", message: body.message ? t(String(body.message)) : t("Le service ne répond pas, réessayez."), pro: body.error === "pro" };
    }
    return { kind: "down" };
  } catch {
    return { kind: "down" };
  } finally {
    window.clearTimeout(tm);
  }
}

/** Asks the server to prepare the trip: "server" (it does), "stop" (refused, said on the screen), "local" (not reachable) */
async function startServer(tripId: string): Promise<"server" | "stop" | "local"> {
  if (starting.has(tripId)) return "stop";
  starting.add(tripId);
  setRun({});
  try {
    for (let i = 0; i < 6; i++) {
      const a = await askServer("start", tripId);
      if (a.kind === "ok") {
        setMode(tripId, "server");
        setRun({ tripId, err: null, mode: "server" });
        void refreshUntil(tripId, Number(a.body.at) || 0);
        return "server";
      }
      if (a.kind === "refused") {
        setMode(tripId, "server");
        setRun({ tripId, err: a.message, mode: "server" });
        // the free trip of the month already used, or a validated trip: the Pro screen opens (as with the app's own run)
        if (a.pro) requestPro(/voyage offert|free trip/i.test(a.message) ? "prep" : "edit");
        void pull();
        return "stop";
      }
      if (a.kind === "elsewhere" || a.kind === "busy") return "stop";
      if (a.kind === "down") break;
      // a trip just created here may not have reached the server yet: asked again in a moment
      await new Promise((r) => window.setTimeout(r, 1500 + i * 500));
    }
  } finally {
    starting.delete(tripId);
    setRun({});
  }
  setMode(tripId, "local");
  return "local";
}
/** The server is being asked to start (the screen shows the preparation as starting) */
export const serverStarting = (tripId: string) => starting.has(tripId);

/** Brings the server's writes here quickly (the live channel also does, this is in case it is late) */
async function refreshUntil(tripId: string, at: number) {
  for (let i = 0; i < 5; i++) {
    await pull();
    const rec = getState().trips[tripId] as { fieldsAt?: Record<string, number> } | undefined;
    if (!at || (rec?.fieldsAt?.draft || 0) >= at) return;
    await new Promise((r) => window.setTimeout(r, 1200));
  }
}

/** Waits until the server's run that began at `at` is over (a day prepared again from the review) */
async function waitServer(tripId: string, at: number) {
  const until = Date.now() + 9 * 60_000;
  await refreshUntil(tripId, at);
  while (Date.now() < until && modes.get(tripId) === "server") {
    const rec = getState().trips[tripId] as { fieldsAt?: Record<string, number> } | undefined;
    const d = draftOf(tripId);
    if (!d || ((rec?.fieldsAt?.draft || 0) >= at && d.status !== "preparing")) return;
    await new Promise((r) => window.setTimeout(r, 1000));
  }
}

/**
 * While the preparation screen shows: the server's progress is fetched every few seconds (the live channel may be
 * late or closed), and a server run that stopped showing signs of life is started again (twice at most, then the
 * app prepares the trip itself). Returns the stop function.
 */
export function watchServer(tripId: string): () => void {
  let kicks = 0;
  let lastKick = 0;
  const step = () => {
    if (document.visibilityState !== "visible" || modes.get(tripId) !== "server") return;
    const d = draftOf(tripId);
    if (!d) return;
    const now = serverNow();
    if (d.status === "preparing") void pull();
    if (d.status !== "preparing" || d.error || run.busy || starting.has(tripId)) return;
    const l = d.lease;
    const stale = !l || (l.by === "server" && now - l.at > SERVER_STALE);
    if (!stale) {
      kicks = 0;
      return;
    }
    if (now - lastKick < 60_000) return;
    lastKick = now;
    // the server could not be reached twice: the app prepares the trip itself
    if (kicks >= 2) {
      setMode(tripId, "local");
      void prepareHere(tripId);
      return;
    }
    // only an unreachable server counts as a failed restart (an answer, even « already running », is a sign of life)
    void askServer("start", tripId).then((a) => {
      if (a.kind === "down") kicks++;
      else if (a.kind === "ok") kicks = 0;
    });
  };
  const timer = window.setInterval(step, 7000);
  const onVis = () => step();
  document.addEventListener("visibilitychange", onVis);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onVis);
  };
}

/** Prepares (or resumes) the trip: on the server when it answers, else here (outline, essentials, each day not done) */
export async function prepare(tripId: string): Promise<void> {
  if (run.busy || starting.has(tripId)) return;
  const d0 = draftOf(tripId);
  if (!d0 || d0.status !== "preparing") return;
  if (modes.get(tripId) !== "local") {
    const r = await startServer(tripId);
    if (r !== "local") return;
  }
  await prepareHere(tripId);
}

/** The app's own run (the server could not be reached): it stops when the screen closes */
async function prepareHere(tripId: string): Promise<void> {
  if (run.busy) return;
  const d0 = draftOf(tripId);
  if (!d0 || d0.status !== "preparing" || preparedElsewhere(tripId)) return;
  ctl = new AbortController();
  const signal = ctl.signal;
  // everything written must go into this trip, which must stay the open one
  const mine = () => !signal.aborted && currentTrip().id === tripId && getState().tripId === tripId;
  const beat = () => saveDraft(tripId, { lease: { by: DEVICE, at: Date.now() } });
  setRun({ tripId, busy: true, step: t("Trame du voyage"), err: null, found: 0, placed: 0, mode: "local" });
  try {
    if (!mine()) throw new AiError(t("Ouvrez ce voyage pour continuer sa préparation."));
    beat();
    let trip = currentTrip();
    const days = trip.days.filter((x) => x.scheduled && x.dates?.length);
    // 1. the trame: themes, areas, which of the traveller's places on which day
    let d = draftOf(tripId)!;
    if (!d.outline) {
      const r = await ai<OutlineResult>("outline", {
        plan: planOf(trip, d),
        days: days.map((x) => `${x.dates![0]} (${x.short})`).join(", "),
        places: d.places.map((p) => `${p.name}${p.city ? ` (${p.city})` : ""}${p.mustSee ? " [incontournable]" : ""}${p.why ? ` : ${p.why}` : ""}`).join(" ; "),
        fixed: d.fixed.map(fixedLine).join(" ; "),
      }, 100_000, signal);
      if (!mine()) return;
      saveDraft(tripId, { outline: r.days || [] });
      const themes = new Map((r.days || []).map((x) => [x.date, x.theme]));
      updateTrip(tripId, { days: trip.days.map((x) => (x.dates?.[0] && themes.get(x.dates[0]) ? { ...x, theme: themes.get(x.dates[0]) } : x)) });
    }
    // 2. the essentials of the destination (language, checklist, phrases, emergency, practical)
    d = draftOf(tripId)!;
    if (!d.essentials) {
      setRun({ step: t("L'essentiel pratique") });
      beat();
      const fallback = langForCountry(trip.country);
      try {
        const e = await ai<EssentialsResult>("essentials", { plan: planOf(trip, d), country: d.cities[0]?.country || trip.country || "" }, 290_000, signal);
        if (!mine()) return;
        const lang = e.lang?.code && e.lang.name ? { ...e.lang, speech: e.lang.speech || fallback?.speech || e.lang.code } : fallback;
        const numbers = (e.emergency || []).filter((n) => n.number);
        updateTrip(tripId, {
          lang,
          checklist: (e.checklist || []).filter((c) => c.text).map((c, i) => ({ id: `c${i + 1}`, text: c.text, due: c.due || undefined, group: c.group || undefined })),
          phrases: (e.phrases || []).map((g) => ({ title: g.title, items: (g.items || []).map((x) => ({ zh: x.local, pinyin: x.romanized, fr: x.fr })) })),
          practical: (e.practical || []).filter((x) => x.title && x.text),
          emergency: numbers.length || e.consulate?.name
            ? { numbers, consulate: { name: e.consulate?.name || "", address: e.consulate?.address || "", cn: "", lat: NaN, lng: NaN, phone: e.consulate?.phone || "", emergency: e.consulate?.emergency || "", hours: "", website: e.consulate?.website || "" }, hospitals: [] }
            : undefined,
        });
        saveDraft(tripId, { essentials: true });
      } catch (err) {
        if (signal.aborted) return;
        // not blocking (the programme matters more): the language comes from the country; retried at the next run
        if (fallback && !currentTrip().lang) updateTrip(tripId, { lang: fallback });
        if (stopsAll(err)) throw err;
      }
    }
    // 3. day by day
    trip = currentTrip();
    for (const day of days) {
      if (!mine()) return;
      d = draftOf(tripId)!;
      const date = day.dates![0];
      if (d.days?.[date] === "done") continue;
      const o = d.outline?.find((x) => x.date === date);
      // the day itself is shown by the counter and the list: the step says its theme only
      setRun({ step: o?.theme || day.theme || day.title });
      beat();
      const fixedToday = d.fixed.filter((f) => f.date === date);
      const lines = [
        `Date : ${date} (${day.short})`,
        o?.theme && `Thème : ${o.theme}`,
        o?.area && `Quartiers : ${o.area}`,
        o?.include?.length ? `Lieux à placer : ${o.include.join(" ; ")}` : "",
        fixedToday.length ? `Fixe ce jour : ${fixedToday.map(fixedLine).join(" ; ")}` : "",
        d.dayWishes[date] ? `Souhait du voyageur pour ce jour : ${d.dayWishes[date]}` : "",
        days[0] === day ? "Jour d'arrivée : journée légère, après l'arrivée du vol et le passage à l'hôtel." : "",
        days[days.length - 1] === day ? "Jour du départ : terminer à temps pour l'aéroport." : "",
      ].filter(Boolean).join("\n");
      let r: DayResult;
      try {
        r = await ai<DayResult>("day", { plan: planOf(trip, d), day: lines, used: currentTrip().places.filter((p) => getState().data.defs[p.id]?.fromDraft !== date).map((p) => p.name).join(", ") }, 290_000, signal);
      } catch (err) {
        if (signal.aborted) return;
        saveDraft(tripId, { days: { ...(draftOf(tripId)?.days || {}), [date]: "error" } });
        if (stopsAll(err)) throw err;
        continue;
      }
      if (!mine()) return;
      // a day prepared again (or interrupted while placing) starts clean: no duplicate
      for (const p of currentTrip().places) if (getState().data.defs[p.id]?.fromDraft === date) updateDef(p.id, { deleted: true });
      setRun({ found: run.found + (r.places || []).length });
      const city = cityFor(d, o?.area);
      const country = (d.cities.find((c) => c.name === city.name)?.country || trip.country || "").toLowerCase();
      for (const p of r.places || []) {
        if (!mine()) return;
        if (!p.name) continue;
        const ll = await position(p, city, country, signal);
        const s = hm(p.start);
        const e = hm(p.end);
        const slot = s != null && e != null && e > s ? slotText(s, e) : s != null ? slotText(s, s + 60) : "";
        createPlace({
          name: p.name, nameCn: p.nameCn, address: p.address, addressCn: p.addressCn,
          // without a position: kept, at the city, in "Pistes" with its slot noted, to be placed by hand
          lng: ll ? ll[0] : city.lng, lat: ll ? ll[1] : city.lat,
          day: ll ? day.key : "ideas", slot: ll ? slot : "", toPlace: ll ? undefined : `${day.short}${slot ? ` · ${slot}` : ""}`,
          type: p.type in TYPE_LABEL ? p.type : "lifestyle",
          duration: s != null && e != null && e > s ? e - s : undefined,
          desc: p.desc, why: p.why, tip: p.tip, metro: p.metro, website: /^https?:\/\//.test(p.website) ? p.website : "", source: /^https?:\/\//.test(p.source) ? p.source : "",
          fromDraft: date, enrichConfidence: p.confidence,
        });
        setRun({ placed: run.placed + 1 });
      }
      if (r.theme && !currentTrip().days.find((x) => x.key === day.key)?.theme) updateTrip(tripId, { days: currentTrip().days.map((x) => (x.key === day.key ? { ...x, theme: r.theme } : x)) });
      saveDraft(tripId, { days: { ...(draftOf(tripId)?.days || {}), [date]: "done" } });
    }
    const left = days.filter((x) => draftOf(tripId)?.days?.[x.dates![0]] !== "done");
    saveDraft(tripId, { status: left.length ? "preparing" : "review", error: left.length ? (left.length > 1 ? t("{n} jours n'ont pas pu être préparés.", { n: left.length }) : t("{n} jour n'a pas pu être préparé.", { n: left.length })) : undefined, lease: undefined });
    setRun({ busy: false, step: "" });
  } catch (e) {
    const msg = e instanceof AiError ? e.message : t("La préparation s'est arrêtée. Elle reprendra à la prochaine ouverture.");
    if (!signal.aborted) saveDraft(tripId, { error: msg, lease: undefined });
    setRun({ busy: false, step: "", err: signal.aborted ? null : msg });
  } finally {
    if (signal.aborted) {
      saveDraft(tripId, { lease: undefined });
      setRun({ busy: false, step: "" });
    }
    ctl = null;
  }
}

/** Stops waiting: the review opens with the days that are ready (the others can be prepared from there). Returns why
 *  it could not, when the server did not take it (the app never writes the draft while the server prepares) */
export async function reviewNow(tripId: string): Promise<string | void> {
  if (modes.get(tripId) === "server") {
    const a = await askServer("review", tripId);
    if (a.kind === "ok") return refreshUntil(tripId, Number(a.body.at) || 0);
    if (a.kind === "refused") return a.message;
    if (a.kind === "elsewhere") return t("Ce voyage est en cours de préparation sur un autre appareil.");
    return t("Le service ne répond pas, réessayez.");
  }
  stopPrepare();
  saveDraft(tripId, { status: "review", error: undefined, lease: undefined });
}

/** The missing days prepared from the review (the review comes back after) */
export async function prepareAgain(tripId: string): Promise<void> {
  const d = draftOf(tripId);
  if (!d || run.busy) return;
  if (modes.get(tripId) !== "local") {
    const r = await startServer(tripId);
    if (r !== "local") return;
  }
  const cur = draftOf(tripId);
  if (cur) updateTrip(tripId, { draft: { ...cur, status: "preparing", error: undefined } });
}

/** "Une envie à ajouter ?": read by each day not prepared yet. Returns why it was not added (the server did not
 *  answer): the app never writes the draft while the server prepares, the wish stays to be sent again */
export async function addWish(tripId: string, text: string): Promise<string | void> {
  const s = text.trim().slice(0, 300);
  if (!s) return;
  if (modes.get(tripId) === "server") {
    // the server merges it into its run
    const a = await askServer("wish", tripId, { text: s });
    if (a.kind === "ok") {
      void pull();
      return;
    }
    return a.kind === "refused" ? a.message : t("Le service ne répond pas, réessayez.");
  }
  const d = draftOf(tripId);
  if (d) updateTrip(tripId, { draft: { ...d, wishes: [...d.wishes, s] } });
}

/** Prepares one day again; the day's current places stay until the new research has succeeded. Returns why it
 *  could not start, when the server refused it */
export async function regenerateDay(tripId: string, date: string): Promise<string | void> {
  track("day_redone", date, tripId);
  const d = draftOf(tripId);
  if (!d || run.busy) return;
  if (modes.get(tripId) !== "local") {
    const a = await askServer("day", tripId, { date });
    if (a.kind === "ok") {
      setMode(tripId, "server");
      // back to the review when the server has finished that day (or stopped)
      await waitServer(tripId, Number(a.body.at) || 0);
      return;
    }
    if (a.kind === "refused") {
      if (a.pro) requestPro("edit");
      return a.message;
    }
    // busy: the server is already preparing this trip (the missing days, another day): nothing is queued
    if (a.kind === "busy") return t("Une préparation est déjà en cours : réessayez dans un instant.");
    if (a.kind === "elsewhere") return t("Ce voyage est en cours de préparation sur un autre appareil.");
    setMode(tripId, "local");
  }
  const days = { ...(d.days || {}) };
  delete days[date];
  updateTrip(tripId, { draft: { ...d, days, status: "preparing", error: undefined } });
  await prepare(tripId);
  // back to the review, whatever happened (a failure keeps the day as it was)
  const after = draftOf(tripId);
  if (after && after.status === "preparing") saveDraft(tripId, { status: "review" });
}

/** The trip is confirmed: the preparation screens close, the trip opens */
export function confirmTrip(tripId: string) {
  // the moment of the validation: after it, a free account's changes to the programme need Pro (saas-4.sql)
  saveDraft(tripId, { status: "done", doneAt: Date.now(), lease: undefined });
  track("trip_validated", null, tripId);
}

const MAX_ADDS = 3;
/** "Ajuster en une phrase": the AI says what to change, the app applies it; returns what changed */
export async function adjustProgramme(request: string): Promise<string> {
  track("adjust_asked", null, getState().tripId);
  const trip = currentTrip();
  const days = trip.days.filter((x) => x.scheduled && x.dates?.length);
  const programme = days
    .map((x) => `${x.dates![0]} (${x.short}${x.theme ? ` · ${x.theme}` : ""}) : ${trip.places.filter((p) => p.day === x.key).map((p) => `${p.time ? `${p.time} ` : ""}${p.name}`).join(" ; ") || "rien"}`)
    .join("\n");
  const r = await ai<AdjustResult>("adjust", { programme, request }, 100_000);
  if (currentTrip().id !== trip.id) return t("Le voyage a changé entre-temps : rien n'a été modifié.");
  const keyOf = (date: string) => days.find((x) => x.dates![0] === date)?.key;
  // a place named exactly (else the only one that starts with that name) on the given day; never a guess
  const find = (date: string, name: string) => {
    const k = keyOf(date);
    const n = name.trim().toLowerCase();
    if (!k || n.length < 2) return undefined;
    const today = trip.places.filter((p) => p.day === k);
    const exact = today.find((p) => p.name.toLowerCase() === n);
    if (exact) return exact;
    const starts = today.filter((p) => p.name.toLowerCase().startsWith(n) || n.startsWith(p.name.toLowerCase()));
    return starts.length === 1 ? starts[0] : undefined;
  };
  const slot = (s: string, e: string) => {
    const a = hm(s);
    const b = hm(e);
    return a != null && b != null && b > a ? slotText(a, b) : a != null ? slotText(a, a + 60) : null;
  };
  let applied = 0;
  let adds = 0;
  for (const c of r.changes || []) {
    if (c.action === "add") {
      const k = keyOf(c.day);
      if (!k || !c.query || adds >= MAX_ADDS) continue;
      adds++;
      try {
        const f = await ai<PlacesResult>("place", { text: c.query, known: trip.places.map((p) => p.name) }, 290_000);
        const p = f.places?.[0];
        if (!p || currentTrip().id !== trip.id) continue;
        const d = draftOf(trip.id);
        const city = d ? cityFor(d, c.query) : { lat: trip.center[1], lng: trip.center[0], name: trip.title };
        const ll = await position(p, city, (trip.country || "").toLowerCase(), new AbortController().signal);
        if (!ll) continue;
        createPlace({ name: p.name, nameCn: p.nameCn, address: p.address, addressCn: p.addressCn, lng: ll[0], lat: ll[1], type: p.type in TYPE_LABEL ? p.type : "lifestyle", day: k, slot: slot(c.start, c.end) || "", desc: p.desc, why: c.why || p.why, source: /^https?:\/\//.test(p.source) ? p.source : "" });
        applied++;
      } catch (e) {
        if (stopsAll(e)) break;
      }
      continue;
    }
    const p = find(c.day, c.name);
    if (!p || p.type === "hotel") continue;
    if (c.action === "remove") updateDef(p.id, { removed: true });
    else if (c.action === "move") {
      const k = keyOf(c.toDay);
      if (!k) continue;
      updateDef(p.id, { day: k, slot: slot(c.start, c.end) ?? "", fromDraft: null });
    } else if (c.action === "retime") {
      const s = slot(c.start, c.end);
      if (!s) continue;
      updateDef(p.id, { slot: s });
    }
    applied++;
  }
  return applied ? r.message || t("Programme ajusté.") : t("Rien n'a changé : précisez la demande (jour, lieu, heure).");
}
