import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Day, Flight, Place, Trip } from "../../data/types";
import { TYPE_LABEL } from "../../data/trip";
import { countable, dayStops, isHotel, stopTime } from "../../lib/plan";
import { liveTrip } from "../../lib/live";
import type { PlaceState } from "../../lib/model";
import { getState, toast, useStore } from "../../lib/store";
import { clock, countdownParts, dayOfTrip, fmtDay, fmtMin, homeZone, localDate, phase, sameHour, tripEndMs, tripStartMs } from "../../lib/time";
import { locale, t, useLang } from "../../lib/i18n";
import { dateLabel } from "../../lib/newTrip";
import { coordText, eurText, PLANE_PATH, recapDue, recapImage, recapOf, recapPeak, recapStats, routeOf, shareRecapBlob, type Route } from "../../lib/recap";
import { PeakSlot } from "./ui/PeakCard";
import { track } from "../../lib/track";
import { setIntent } from "./nav";
import "../../styles/home.css";

/** The trip with the places added / moved in the app (the open one from the store, the others from this phone) */
function liveOf(trip: Trip): Trip {
  try {
    const raw = trip.id === getState().tripId ? getState().data : JSON.parse(localStorage.getItem("orbes.v2." + trip.id) || "null");
    return raw ? liveTrip(trip, { places: raw.places || {}, pins: raw.pins || [], defs: raw.defs || {} }) : trip;
  } catch {
    return trip;
  }
}
function visitedOf(trip: Trip): number {
  try {
    const raw = trip.id === getState().tripId ? getState().data : JSON.parse(localStorage.getItem("orbes.v2." + trip.id) || "null");
    const places = raw?.places || {};
    return countable(trip).filter((p) => places[p.id]?.visited).length;
  } catch {
    return 0;
  }
}
/** The trip's place states (visited, appointments, slots moved) on this phone */
function statesOf(trip: Trip): Record<string, PlaceState> {
  try {
    const raw = trip.id === getState().tripId ? getState().data : JSON.parse(localStorage.getItem("orbes.v2." + trip.id) || "null");
    return raw?.places || {};
  } catch {
    return {};
  }
}

/** Minutes since midnight now, in the trip's timezone */
function minutesIn(timeZone: string, now: number): number {
  const v = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(now));
  const [h, m] = v.split(":").map(Number);
  return ((h || 0) % 24) * 60 + (m || 0);
}

type Today = {
  day?: Day;
  /** the next stop of today's programme, not visited yet */
  next?: Place;
  when?: number;
  /** stops left today, the next one included */
  left: number;
  /** today had stops in its programme */
  hadStops: boolean;
  /** nothing left today: the first stop of the next day of the programme */
  later?: { day: Day; date: string; place: Place; when?: number; tomorrow: boolean };
};

/** Today in the programme: the next stop (by planned time, skipping the ones already visited), else the next day's first */
function todayOf(trip: Trip, states: Record<string, PlaceState>, now: number): Today {
  const today = localDate(trip.timezone, new Date(now));
  const nowMin = minutesIn(trip.timezone, now);
  const sched = trip.days.filter((d) => d.scheduled);
  const day = sched.find((d) => d.dates?.includes(today));
  const stops = day ? dayStops(trip, day.key, states).filter((p) => !isHotel(trip, p)) : [];
  const todo = stops.filter((p) => !states[p.id]?.visited);
  // a stop more than an hour behind gives way to the next one; the very last one stays up to three hours
  let i = todo.findIndex((p) => {
    const w = stopTime(p, states);
    return w == null || w >= nowMin - 60;
  });
  if (i < 0 && todo.length) {
    const w = stopTime(todo[todo.length - 1], states);
    if (w != null && w >= nowMin - 180) i = todo.length - 1;
  }
  if (i >= 0) return { day, next: todo[i], when: stopTime(todo[i], states) ?? undefined, left: todo.length - i, hadStops: true };
  const tomorrow = new Date(Date.parse(today + "T12:00:00Z") + 864e5).toISOString().slice(0, 10);
  let later: Today["later"];
  for (const d of sched) {
    const date = (d.dates || []).filter((x) => x > today).sort()[0];
    if (!date || (later && later.date <= date)) continue;
    const first = dayStops(trip, d.key, states).find((p) => !isHotel(trip, p) && !states[p.id]?.visited);
    if (first) later = { day: d, date, place: first, when: stopTime(first, states) ?? undefined, tomorrow: date === tomorrow };
  }
  return { day, left: 0, hadStops: stops.length > 0, later };
}

/** "25 min", "1 h 05", "2 h" */
function span(min: number): string {
  if (min < 60) return t("{n} min", { n: min });
  const h = Math.floor(min / 60), m = min % 60;
  return m ? t("{h} h {m}", { h, m: String(m).padStart(2, "0") }) : t("{h} h", { h });
}
/** How the planned time stands against now: "dans 25 min", "maintenant", "en retard de 10 min" */
function relative(when: number | undefined, nowMin: number): { text: string; late: boolean } | null {
  if (when == null) return null;
  const diff = when - nowMin;
  if (diff > 0) return { text: t("dans {d}", { d: span(diff) }), late: false };
  if (diff >= -5) return { text: t("maintenant"), late: false };
  if (diff >= -180) return { text: t("en retard de {d}", { d: span(-diff) }), late: true };
  return null;
}

/** Home: this phone's timezone; on site (the phone has switched to the trip's time), the last one seen before */
function homeFor(trip: Trip): { zone: string; city: string } | null {
  const here = homeZone();
  try {
    if (here.zone !== trip.timezone) {
      localStorage.setItem("orbes.homeZone", here.zone);
      return here;
    }
    const saved = localStorage.getItem("orbes.homeZone");
    if (saved && saved !== trip.timezone) return { zone: saved, city: (saved.split("/").pop() || saved).replace(/_/g, " ") };
  } catch {
    /* ignore */
  }
  return null;
}

/** Nights between the first and the last day (0 for a trip within a day) */
const nightsOf = (trip: Trip) => Math.max(0, Math.round((Date.parse(trip.end + "T00:00:00Z") - Date.parse(trip.start + "T00:00:00Z")) / 864e5));
/** A flight's time, in the timezone of the place it is read at ("" when unknown) */
const timeIn = (iso: string | undefined, zone: string) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? clock(zone, d) : "";
};
/** The local time written in the ISO string itself (the time at the airport, whatever its timezone): "07:10" */
const ownTime = (iso: string | undefined) => {
  const m = iso?.match(/T(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
};

/** The route, set as on a boarding pass: origin and destination (IATA codes when a flight gives them, else the
 *  cities), one hairline between them, and the plane placed by progress (at home before, along the days during,
 *  arrived after). Under the ends: the cities (under codes) and the outbound flight's times when known. */
function RouteLine({ route, f, flight, timezone }: { route: Route; f: number; flight?: Flight; timezone: string }) {
  const coded = !!route.to.code && (!route.from || !!route.from.code);
  const a = route.from ? route.from.code || route.from.city : "";
  const b = route.to.code || route.to.city;
  const under = (end: Route["from"]) => (end && end.code && end.city && end.city.toUpperCase() !== end.code ? end.city : "");
  // the outbound flight: departure time at its airport, arrival time at the destination, its code and duration
  const out = flight?.kind === "arrival" ? flight : undefined;
  const dep = ownTime(out?.departAt);
  const arr = out ? timeIn(out.arriveAt || out.at, timezone) : "";
  const mins = out?.departAt && (out.arriveAt || out.at) ? Math.round((Date.parse(out.arriveAt || out.at) - Date.parse(out.departAt)) / 60000) : NaN;
  const dur = mins > 0 && mins < 36 * 60 ? span(mins) : "";
  // each end: its city (under a code) over its time; the middle: the flight's code over its length
  const cell = (cls: string, top: string, low: string) =>
    top || low ? (
      <small className={cls}>
        {top && <span>{top}</span>}
        {low && <b>{low}</b>}
      </small>
    ) : null;
  const ca = cell("hx-ca", under(route.from), dep);
  const note = out ? cell("hx-note", out.code, dur) : null;
  const cb = cell("hx-cb", under(route.to), arr);
  const pos = Math.min(1, Math.max(0, f));
  return (
    <span className={"hx-route" + (coded ? " coded" : "")} style={{ "--f": pos } as CSSProperties}>
      <span className="hx-sr">{a ? `${a} → ${b}` : b}</span>
      {a ? <b className="hx-a" aria-hidden="true">{a}</b> : <span className="hx-a" aria-hidden="true" />}
      <span className="hx-line" aria-hidden="true">
        <i className="hx-done" />
        <svg className="hx-plane" viewBox="0 0 24 24" focusable="false">
          <path d={PLANE_PATH} transform="rotate(90 12 12)" />
        </svg>
      </span>
      <b className="hx-b" aria-hidden="true">{b}</b>
      {(ca || note || cb) && (
        <span className="hx-sub">
          {ca}
          {note}
          {cb}
        </span>
      )}
    </span>
  );
}

/** Dates, length and the destination's point on the map, in fine type under the name */
function WhenLine({ trip, today, days }: { trip: Trip; today: { i: number; n: number } | null; days: number }) {
  const nights = nightsOf(trip);
  const coords = coordText(trip.center);
  const length = today ? t("Jour {i} sur {n}", { i: today.i, n: today.n }) : days ? (days > 1 ? t("{n} jours", { n: days }) : t("{n} jour", { n: days })) : "";
  return (
    <>
      {/* each part keeps its words together: a line breaks between parts, never inside "6 nuits" */}
      <small className="v3-hero-when">
        <span className="hx-nw">{dateLabel(trip.start, trip.end)}</span>
        {length && <> · <span className="hx-nw">{length}</span></>}
        {!today && nights > 0 && <> · <span className="hx-nw">{nights > 1 ? t("{n} nuits", { n: nights }) : t("{n} nuit", { n: nights })}</span></>}
      </small>
      {coords && <small className="hx-coord">{coords}</small>}
    </>
  );
}

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(i);
  }, [ms]);
  return now;
}

/** The trip to come (or under way) at the top of "Mes voyages": the destination, its route, clocks, countdown,
 *  what is ready, and the way in */
export default function TripHero({ trip: base, onOpen }: { trip: Trip; onOpen: (id: string) => void }) {
  const now = useNow(1000);
  // the open trip's places added / moved since: the card follows them without a reload
  const defs = useStore((st) => (st.tripId === base.id ? st.data.defs : null));
  const pins = useStore((st) => (st.tripId === base.id ? st.data.pins : null));
  const homeAnswer = useStore((st) => String((st.profile as { home?: unknown }).home || ""));
  const trip = useMemo(() => liveOf(base), [base, defs, pins]); // eslint-disable-line react-hooks/exhaustive-deps
  const draft = (useStore((s) => s.trips[base.id])?.draft as { status?: string } | undefined)?.status;
  const preparing = !!draft && draft !== "done";
  const ph = phase(trip, now);
  const cd = countdownParts(ph === "before" ? tripStartMs(trip) : tripEndMs(trip), now);
  const home = useMemo(() => homeFor(trip), [trip.id, trip.timezone]); // eslint-disable-line react-hooks/exhaustive-deps
  const route = useMemo(() => routeOf(trip, homeAnswer.trim()), [trip, homeAnswer]);
  const days = trip.days.filter((d) => d.scheduled).reduce((n, d) => n + (d.dates?.length || 0), 0);
  const today = ph === "during" ? dayOfTrip(trip, now) : null;
  // where the plane stands on the route: at home before, along the days during, arrived after
  const along = ph === "before" ? 0 : ph === "after" ? 1 : today ? (today.i - 0.5) / today.n : 0.5;
  const total = countable(trip).length;
  const visited = useMemo(() => visitedOf(trip), [trip, now - (now % 15000)]); // eslint-disable-line react-hooks/exhaustive-deps
  // the flight that matters now: the one out before and the way back once there
  const flight = (ph === "before" ? trip.flights.find((f) => f.kind === "arrival") : trip.flights.find((f) => f.kind === "departure")) || trip.flights[0];
  const hotel = trip.hotel?.name && !/à préciser|to be confirmed/i.test(trip.hotel.name) ? trip.hotel.name : "";
  const d = new Date(now);

  // Enter (keyboard, nothing focused): straight into the trip, as the old "Entrer"
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || (e.target as HTMLElement).closest?.("button,input,textarea,a,select,[role=dialog]")) return;
      onOpen(base.id);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [base.id, onOpen]);

  const homeClock = !!home && !sameHour(home.zone, trip.timezone, d);
  const top = (
    <span className="v3-hero-top">
      <span className="v3-tags">
        {preparing ? (
          <span className="v3-tag dim">{draft === "preparing" ? t("En préparation") : t("À valider")}</span>
        ) : (
          <span className={"v3-tag " + (ph === "during" ? "ok" : ph === "before" ? "up" : "dim")}>{ph === "during" ? t("En cours") : ph === "before" ? t("À venir") : t("Passé")}</span>
        )}
      </span>
      <span className="v3-clocks">
        {homeClock && home && <span><small>{home.city}</small><b>{clock(home.zone, d)}</b></span>}
        {/* the destination's name is set large just below: its clock says where it is read, not the name again */}
        <span><small>{homeClock ? t("Sur place") : t("Heure locale")}</small><b>{clock(trip.timezone, d)}</b></span>
      </span>
    </span>
  );
  const progress = total > 0 && (
    <span className="v3-hero-prog">
      <span className="v3-hero-bar"><i style={{ width: `${(visited / total) * 100}%` }} /></span>
      <small>{t("{v}/{n} visités", { v: visited, n: total })}</small>
    </span>
  );
  const routeLine = <RouteLine route={route} f={along} flight={ph === "before" ? flight : undefined} timezone={trip.timezone} />;
  // the outbound flight is already on the route (code and times): only the other one is listed with the facts
  const flightFact = flight?.code && !(ph === "before" && flight.kind === "arrival");

  // on site: today's programme first; just back: the recap (both are cards with their own buttons)
  if (ph === "during" && !preparing)
    return (
      <TodayCard trip={trip} now={now} top={top} route={routeLine} onOpen={() => onOpen(base.id)} progress={progress}
        returnIn={cd.d > 0 ? t("{d} j {h} h", { d: cd.d, h: cd.h }) : t("{h} h {m} min", { h: cd.h, m: String(cd.m).padStart(2, "0") })}
        facts={
          <span className="v3-facts">
            {hotel && <span>{/^h[oô]tel\b/i.test(hotel) ? null : <>{t("Hôtel")} </>}<b>{hotel}</b></span>}
            {flight?.code && <span><b>{flight.code}</b> {flight.from} → {flight.to}</span>}
          </span>
        }
      />
    );
  if (ph === "after" && !preparing && recapDue(trip, now))
    return <RecapCard trip={trip} top={top} route={routeLine} onOpen={() => onOpen(base.id)} />;

  return (
    <button className={"v3-hero" + (ph === "during" ? " live" : "")} onClick={() => onOpen(base.id)}>
      {top}

      <span className="v3-hero-body">
        <b className="v3-d v3-hero-title">{trip.title}</b>
        <WhenLine trip={trip} today={today} days={days} />

        {routeLine}

        {ph !== "after" && (
          <span className="v3-cdn" role="timer" aria-label={ph === "before" ? t("Compte à rebours avant l’arrivée") : t("Temps restant sur place")}>
            {([["d", "Jours"], ["h", "Heures"], ["m", "Min"], ["s", "Sec"]] as const).map(([k, l]) => (
              <span key={k}>
                <b>{String(cd[k]).padStart(2, "0")}</b>
                <small>{t(l)}</small>
              </span>
            ))}
            <em>{ph === "before" ? t("avant l’arrivée") : t("avant le retour")}</em>
          </span>
        )}

        {(total > 0 || hotel || flightFact) && (
          <span className="v3-facts">
            {total > 0 && <span><b>{total}</b> {total > 1 ? t("lieux") : t("lieu")}</span>}
            {hotel && <span>{/^h[oô]tel\b/i.test(hotel) ? null : <>{t("Hôtel")} </>}<b>{hotel}</b></span>}
            {flightFact && <span><b>{flight.code}</b> {flight.from} → {flight.to}</span>}
          </span>
        )}

        {(ph !== "before" || visited > 0) && total > 0 && (
          <span className="v3-hero-prog">
            <span className="v3-hero-bar"><i style={{ width: `${(visited / total) * 100}%` }} /></span>
            <small>{t("{v}/{n} visités", { v: visited, n: total })}</small>
          </span>
        )}

        <span className="v3-hero-go">
          {preparing ? t("Voir la préparation") : t("Ouvrir le voyage")}
          <span aria-hidden="true">→</span>
        </span>
      </span>
    </button>
  );
}

/** A click on the card's ground opens the trip; its buttons do their own thing */
const onGround = (open: () => void) => (e: React.MouseEvent) => {
  if (!(e.target as HTMLElement).closest?.("button,a,.peak-slot")) open();
};

/** On site: "Aujourd’hui", day X of N, the next stop and how its time stands, what is left today, and two ways in */
function TodayCard({ trip, now, top, route, onOpen, progress, returnIn, facts }: {
  trip: Trip; now: number; top: ReactNode; route: ReactNode; onOpen: () => void; progress: ReactNode; returnIn: string; facts: ReactNode;
}) {
  const slot = now - (now % 15000);
  const states = useStore((s) => (s.tripId === trip.id ? s.data.places : null));
  const td = useMemo(() => todayOf(trip, states || statesOf(trip), now), [trip, states, slot]); // eslint-disable-line react-hooks/exhaustive-deps
  const dt = dayOfTrip(trip, now);
  const nowMin = minutesIn(trip.timezone, now);
  const rel = relative(td.when, nowMin);
  const theme = td.day?.theme || "";
  const open = (i?: { kind: "day"; day: string } | { kind: "go"; placeId: string }) => {
    if (i) setIntent({ ...i, tripId: trip.id });
    onOpen();
  };
  const kind = (p: Place) => t(TYPE_LABEL[p.type] || p.type);
  const laterLabel = td.later ? (td.later.tomorrow ? t("Demain") : fmtDay(td.later.date, trip.timezone, { weekday: "long", day: "numeric", month: "long" })) : "";

  return (
    <div className="v3-hero live static" onClick={onGround(onOpen)}>
      {top}
      <span className="v3-hero-body today">
        <b className="v3-d v3-hero-title">{trip.title}</b>
        <span className="v3-lbl v3-today-k">{t("Aujourd’hui")} · {t("Jour {i} sur {n}", { i: dt.i, n: dt.n })}{theme ? ` · ${theme}` : ""}</span>
        {route}

        {td.next ? (
          <span className="v3-today">
            <small className="v3-lbl">{t("Prochain arrêt")}</small>
            <b className="v3-d v3-today-name">{td.next.name}</b>
            <span className="v3-today-meta">
              {td.when != null && <b>{fmtMin(td.when)}</b>}
              <span>{kind(td.next)}</span>
              {rel && <em className={rel.late ? "late" : ""}>{rel.text}</em>}
            </span>
            <small className="v3-today-left">
              {td.left > 1 ? t("Encore {n} arrêts aujourd’hui", { n: td.left }) : t("Dernier arrêt de la journée")}
            </small>
          </span>
        ) : (
          <span className="v3-today">
            <span className="v3-today-none">{td.hadStops ? t("Plus rien de prévu aujourd’hui.") : t("Rien de prévu aujourd’hui.")}</span>
            {td.later && (
              <>
                <small className="v3-lbl" style={{ marginTop: 16 }}>{laterLabel}</small>
                <b className="v3-d v3-today-name small">{td.later.place.name}</b>
                <span className="v3-today-meta">
                  {td.later.when != null && <b>{fmtMin(td.later.when)}</b>}
                  <span>{kind(td.later.place)}</span>
                </span>
              </>
            )}
          </span>
        )}

        <span className="v3-today-acts">
          {td.next ? (
            <>
              <button type="button" className="v3-hero-go" onClick={() => open(td.day ? { kind: "day", day: td.day.key } : undefined)}>
                {t("Ouvrir la journée")}
                <span aria-hidden="true">→</span>
              </button>
              <button type="button" className="v3-hero-alt" onClick={() => open({ kind: "go", placeId: td.next!.id })}>{t("Y aller")}</button>
            </>
          ) : td.later ? (
            <>
              <button type="button" className="v3-hero-go" onClick={() => open({ kind: "day", day: td.later!.day.key })}>
                {td.later.tomorrow ? t("Voir demain") : t("Voir ce jour")}
                <span aria-hidden="true">→</span>
              </button>
              <button type="button" className="v3-hero-alt" onClick={() => open()}>{t("Ouvrir le voyage")}</button>
            </>
          ) : (
            <button type="button" className="v3-hero-go" onClick={() => open()}>
              {t("Ouvrir le voyage")}
              <span aria-hidden="true">→</span>
            </button>
          )}
        </span>

        {progress}
        <small className="v3-today-ret" role="timer" aria-label={t("Temps restant sur place")}>{t("Retour dans {t}", { t: returnIn })}</small>
        {facts}
      </span>
    </div>
  );
}

/** Just back: the trip in figures, and its story image to share */
function RecapCard({ trip, top, route, onOpen }: {
  trip: Trip; top: ReactNode; route: ReactNode; onOpen: () => void;
}) {
  const states = useStore((s) => (s.tripId === trip.id ? s.data : null));
  const draft = useStore((s) => s.trips[trip.id]?.draft);
  const r = useMemo(() => recapOf(trip), [trip, states, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = JSON.stringify(r);
  const lang = useLang();
  // the signature card: spending per day, else places visited (stable across the hero's one-second re-renders)
  const peak = useMemo(() => recapPeak(r), [key, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  // the image is drawn ahead, so the share sheet opens right on the touch (phones refuse it after a wait); in idle
  // time, since its first drawing paints its own wide field (shared with the card on a computer, not on a phone)
  const [img, setImg] = useState<{ key: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const run = () => {
      recapImage(r).then((blob) => { if (live) setImg({ key, blob }); }, () => undefined);
    };
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const idle = w.requestIdleCallback ? w.requestIdleCallback(run, { timeout: 2000 }) : 0;
    const id = idle ? 0 : window.setTimeout(run, 500);
    return () => {
      live = false;
      if (idle) w.cancelIdleCallback?.(idle);
      window.clearTimeout(id);
    };
  }, [key, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = img?.key === key ? img.blob : await recapImage(r);
      const res = await shareRecapBlob(r, blob);
      if (res !== "cancelled") track("export", "recap", trip.id);
      if (res === "saved") toast(t("Image du récapitulatif enregistrée"));
    } catch {
      toast(t("L'image n'a pas pu être préparée. Réessayez."));
    } finally {
      setBusy(false);
    }
  };

  // when the card carries the total, the euros are not printed twice
  const stats = recapStats(r, { eur: peak?.mode !== "chart" });
  const showCities = r.cities.length > 1 || r.cities[0] !== r.title;

  return (
    <div className="v3-hero static recap" onClick={onGround(onOpen)}>
      {top}
      <span className="v3-hero-body">
        <span className="v3-lbl hx-kicker">{t("Récapitulatif")}</span>
        <b className="v3-d v3-hero-title">{trip.title}</b>
        <small className="v3-hero-when">{r.dates}</small>
        {coordText(r.center) && <small className="hx-coord">{coordText(r.center)}</small>}
        {route}
        {peak && <PeakSlot {...peak} locale={locale()} periodLabel={t("Période")} formatValue={(v) => eurText(Math.max(0, v))} />}
        <span className="v3-recap-stats">
          {stats.map(([v, l]) => (
            <span key={l}>
              <b>{v}</b>
              <small>{l}</small>
            </span>
          ))}
        </span>
        {showCities && (
          <span className="v3-facts">
            <span>{r.cities.length > 1 ? t("Villes") : t("Ville")} <b>{r.cities.join(" · ")}</b></span>
          </span>
        )}
        <span className="v3-today-acts col">
          <button type="button" className="v3-hero-go" onClick={() => void share()} disabled={busy} aria-busy={busy}>
            {busy ? t("Préparation de l'image…") : t("Partager le récapitulatif")}
          </button>
          <button type="button" className="v3-hero-alt" onClick={onOpen}>{t("Ouvrir le voyage")}</button>
        </span>
      </span>
    </div>
  );
}
