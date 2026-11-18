import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Day, Place, Trip } from "../../data/types";
import { TYPE_LABEL } from "../../data/trip";
import { countable, dayStops, isHotel, stopTime } from "../../lib/plan";
import { liveTrip } from "../../lib/live";
import type { PlaceState } from "../../lib/model";
import { getState, toast, useStore } from "../../lib/store";
import { clock, countdownParts, dayOfTrip, fmtDay, fmtMin, homeZone, localDate, phase, sameHour, tripEndMs, tripStartMs } from "../../lib/time";
import { t } from "../../lib/i18n";
import { dateLabel } from "../../lib/newTrip";
import { recapDue, recapImage, recapOf, recapStats, shareRecapBlob } from "../../lib/recap";
import { track } from "../../lib/track";
import { setIntent } from "./nav";

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

// where home is on the globe, from the phone's timezone (the arc starts there)
const ZONES: Record<string, [number, number]> = {
  "Europe/Paris": [2.35, 48.86], "Europe/London": [-0.13, 51.5], "Europe/Brussels": [4.35, 50.85], "Europe/Madrid": [-3.7, 40.42],
  "Europe/Lisbon": [-9.14, 38.72], "Europe/Berlin": [13.4, 52.52], "Europe/Rome": [12.5, 41.9], "Europe/Zurich": [8.54, 47.37],
  "Europe/Amsterdam": [4.9, 52.37], "Europe/Luxembourg": [6.13, 49.61], "Europe/Monaco": [7.42, 43.74], "Europe/Geneva": [6.14, 46.2],
  "America/New_York": [-74, 40.71], "America/Toronto": [-79.38, 43.65], "America/Montreal": [-73.57, 45.5], "America/Chicago": [-87.63, 41.88],
  "America/Los_Angeles": [-118.24, 34.05], "America/Sao_Paulo": [-46.63, -23.55], "Asia/Shanghai": [121.47, 31.23], "Asia/Hong_Kong": [114.17, 22.32],
  "Asia/Tokyo": [139.69, 35.69], "Asia/Singapore": [103.82, 1.35], "Asia/Dubai": [55.27, 25.2], "Australia/Sydney": [151.21, -33.87],
  "Africa/Casablanca": [-7.59, 33.57], "Indian/Reunion": [55.45, -20.88], "America/Martinique": [-61.02, 14.6], "America/Guadeloupe": [-61.53, 16.24],
};

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

const rad = Math.PI / 180;
const toVec = ([lng, lat]: [number, number]) => [Math.cos(lat * rad) * Math.cos(lng * rad), Math.cos(lat * rad) * Math.sin(lng * rad), Math.sin(lat * rad)];
const toLL = (v: number[]): [number, number] => [Math.atan2(v[1], v[0]) / rad, Math.asin(Math.max(-1, Math.min(1, v[2]))) / rad];
/** A point `f` of the way along the great circle from a to b */
function along(a: [number, number], b: [number, number], f: number): [number, number] {
  const A = toVec(a), B = toVec(b);
  const w = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  if (w < 1e-6) return a;
  const s = Math.sin(w), k1 = Math.sin((1 - f) * w) / s, k2 = Math.sin(f * w) / s;
  return toLL([k1 * A[0] + k2 * B[0], k1 * A[1] + k2 * B[1], k1 * A[2] + k2 * B[2]]);
}

/** A still globe (meridians and parallels), the flight arc from home to the destination and a plane on it */
function Globe({ from, to }: { from: [number, number] | null; to: [number, number] }) {
  const R = 120;
  const paths = useMemo(() => {
    // centred a little south of the route, so the flight reads as a curve over the globe
    const mid = from ? along(from, to, 0.6) : to;
    const l0 = mid[0] + (from ? 0 : -18), p0 = Math.max(-60, mid[1] - (from ? 26 : 10));
    const sp0 = Math.sin(p0 * rad), cp0 = Math.cos(p0 * rad);
    // orthographic projection centred on (l0, p0); `lift` raises the arc above the ground
    const proj = ([lng, lat]: [number, number], lift = 1) => {
      const cp = Math.cos(lat * rad), sp = Math.sin(lat * rad), dl = (lng - l0) * rad;
      const vis = sp0 * sp + cp0 * cp * Math.cos(dl);
      return { x: R * lift * cp * Math.sin(dl), y: -R * lift * (cp0 * sp - sp0 * cp * Math.cos(dl)), vis };
    };
    const line = (pts: [number, number][], lift?: (i: number) => number, min = 0) => {
      let d = "";
      let pen = false;
      pts.forEach((p, i) => {
        const q = proj(p, lift ? lift(i) : 1);
        if (q.vis > min) {
          d += `${pen ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
          pen = true;
        } else pen = false;
      });
      return d;
    };
    const grid: string[] = [];
    for (let lng = -180; lng < 180; lng += 20) grid.push(line(Array.from({ length: 61 }, (_, i) => [lng, -90 + i * 3] as [number, number])));
    for (let lat = -60; lat <= 60; lat += 20) grid.push(line(Array.from({ length: 121 }, (_, i) => [-180 + i * 3, lat] as [number, number])));
    const N = 64;
    const arcPts = from ? Array.from({ length: N + 1 }, (_, i) => along(from, to, i / N)) : [];
    const arc = from ? line(arcPts, (i) => 1 + 0.16 * Math.sin((Math.PI * i) / N), -0.12) : "";
    const end = proj(to);
    const start = from ? proj(from) : null;
    return { grid: grid.filter(Boolean), arc, end, start };
  }, [from?.[0], from?.[1], to[0], to[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <svg className="v3-hero-globe" viewBox="-150 -150 300 300" aria-hidden="true">
      <defs>
        <radialGradient id="v3g-sphere" cx="0.68" cy="0.28" r="0.9">
          <stop offset="0" stopColor="#1d1c1a" />
          <stop offset="0.55" stopColor="#0c0c0d" />
          <stop offset="1" stopColor="#050505" />
        </radialGradient>
        <radialGradient id="v3g-halo" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.78" stopColor="rgba(216,196,126,0)" />
          <stop offset="0.86" stopColor="rgba(216,196,126,0.10)" />
          <stop offset="1" stopColor="rgba(216,196,126,0)" />
        </radialGradient>
      </defs>
      <circle r={R + 22} fill="url(#v3g-halo)" />
      <circle r={R} fill="url(#v3g-sphere)" stroke="rgba(246,242,234,0.16)" strokeWidth="0.8" />
      <g fill="none" stroke="rgba(246,242,234,0.09)" strokeWidth="0.6">
        {paths.grid.map((d, i) => <path key={i} d={d} />)}
      </g>
      {paths.arc && (
        <>
          <path id="v3g-arc" className="v3-hero-arc" d={paths.arc} pathLength={1} fill="none" stroke="var(--gold)" strokeWidth="1.6" strokeLinecap="round" />
          <circle className="v3-hero-plane" r="2.6" fill="var(--ink)">
            <animateMotion dur="7s" repeatCount="indefinite" keyPoints="0;1" keyTimes="0;1" calcMode="linear">
              <mpath href="#v3g-arc" />
            </animateMotion>
          </circle>
        </>
      )}
      {paths.start && paths.start.vis > 0 && <circle cx={paths.start.x} cy={paths.start.y} r="2.2" fill="rgba(246,242,234,0.7)" />}
      {paths.end.vis > 0 && (
        <g transform={`translate(${paths.end.x} ${paths.end.y})`}>
          <circle r="8" fill="none" stroke="var(--gold)" strokeOpacity="0.35" strokeWidth="0.8" />
          <circle r="3.2" fill="var(--gold)" />
        </g>
      )}
    </svg>
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

/** The trip to come (or under way) at the top of "Mes voyages": globe, clocks, countdown, what is ready, and the way in */
export default function TripHero({ trip: base, onOpen }: { trip: Trip; onOpen: (id: string) => void }) {
  const now = useNow(1000);
  const trip = useMemo(() => liveOf(base), [base]);
  const draft = (useStore((s) => s.trips[base.id])?.draft as { status?: string } | undefined)?.status;
  const preparing = !!draft && draft !== "done";
  const ph = phase(trip, now);
  const cd = countdownParts(ph === "before" ? tripStartMs(trip) : tripEndMs(trip), now);
  const home = useMemo(() => homeFor(trip), [trip.id, trip.timezone]); // eslint-disable-line react-hooks/exhaustive-deps
  const from = home ? ZONES[home.zone] || (home.zone.startsWith("Europe/") ? ZONES["Europe/Paris"] : null) : ZONES["Europe/Paris"];
  const days = trip.days.filter((d) => d.scheduled).reduce((n, d) => n + (d.dates?.length || 0), 0);
  const today = ph === "during" ? dayOfTrip(trip, now) : null;
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

  const top = (
    <span className="v3-hero-top">
      <span className="v3-tags">
        {preparing ? (
          <span className="v3-tag dim">{draft === "preparing" ? t("En préparation") : t("À valider")}</span>
        ) : (
          <span className={"v3-tag " + (ph === "during" ? "ok" : ph === "before" ? "gold" : "dim")}>{ph === "during" ? t("En cours") : ph === "before" ? t("À venir") : t("Passé")}</span>
        )}
      </span>
      <span className="v3-clocks">
        {home && !sameHour(home.zone, trip.timezone, d) && <span><small>{home.city}</small><b>{clock(home.zone, d)}</b></span>}
        <span><small>{trip.title}</small><b>{clock(trip.timezone, d)}</b></span>
      </span>
    </span>
  );
  const progress = total > 0 && (
    <span className="v3-hero-prog">
      <span className="v3-hero-bar"><i style={{ width: `${(visited / total) * 100}%` }} /></span>
      <small>{t("{v}/{n} visités", { v: visited, n: total })}</small>
    </span>
  );

  // on site: today's programme first; just back: the recap (both are cards with their own buttons)
  if (ph === "during" && !preparing)
    return (
      <TodayCard trip={trip} now={now} top={top} globe={<Globe from={from} to={trip.center} />} onOpen={() => onOpen(base.id)} progress={progress}
        returnIn={cd.d > 0 ? t("{d} j {h} h", { d: cd.d, h: cd.h }) : t("{h} h {m} min", { h: cd.h, m: String(cd.m).padStart(2, "0") })}
        facts={
          <span className="v3-facts">
            {hotel && <span>{t("Hôtel")} <b>{hotel}</b></span>}
            {flight?.code && <span><b>{flight.code}</b> {flight.from} → {flight.to}</span>}
          </span>
        }
      />
    );
  if (ph === "after" && !preparing && recapDue(trip, now))
    return <RecapCard trip={trip} from={from} top={top} globe={<Globe from={from} to={trip.center} />} onOpen={() => onOpen(base.id)} />;

  return (
    <button className={"v3-hero" + (ph === "during" ? " live" : "")} onClick={() => onOpen(base.id)}>
      <Globe from={from} to={trip.center} />
      {top}

      <span className="v3-hero-body">
        <b className="v3-d v3-hero-title">{trip.title}</b>
        <small className="v3-hero-when">
          {dateLabel(trip.start, trip.end)}
          {today ? ` · ${t("Jour {i} sur {n}", { i: today.i, n: today.n })}` : days ? ` · ${days > 1 ? t("{n} jours", { n: days }) : t("{n} jour", { n: days })}` : ""}
        </small>

        {ph !== "after" && (
          <span className="v3-cdn" role="timer" aria-label={ph === "before" ? t("Compte à rebours avant l'arrivée") : t("Temps restant sur place")}>
            {([["d", "Jours"], ["h", "Heures"], ["m", "Min"], ["s", "Sec"]] as const).map(([k, l]) => (
              <span key={k}>
                <b>{String(cd[k]).padStart(2, "0")}</b>
                <small>{t(l)}</small>
              </span>
            ))}
            <em>{ph === "before" ? t("avant l'arrivée") : t("avant le retour")}</em>
          </span>
        )}

        <span className="v3-facts">
          <span><b>{total}</b> {total > 1 ? t("lieux") : t("lieu")}</span>
          {hotel && <span>{t("Hôtel")} <b>{hotel}</b></span>}
          {flight?.code && <span><b>{flight.code}</b> {flight.from} → {flight.to}</span>}
        </span>

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
  if (!(e.target as HTMLElement).closest?.("button,a")) open();
};

/** On site: "Aujourd'hui", day X of N, the next stop and how its time stands, what is left today, and two ways in */
function TodayCard({ trip, now, top, globe, onOpen, progress, returnIn, facts }: {
  trip: Trip; now: number; top: ReactNode; globe: ReactNode; onOpen: () => void; progress: ReactNode; returnIn: string; facts: ReactNode;
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
      {globe}
      {top}
      <span className="v3-hero-body today">
        <span className="v3-lbl v3-today-k">{t("Aujourd'hui")} · {t("Jour {i} sur {n}", { i: dt.i, n: dt.n })}</span>
        <small className="v3-hero-when">{trip.title}{theme ? ` · ${theme}` : ""}</small>

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
              {td.left > 1 ? t("Encore {n} arrêts aujourd'hui", { n: td.left }) : t("Dernier arrêt de la journée")}
            </small>
          </span>
        ) : (
          <span className="v3-today">
            <span className="v3-today-none">{td.hadStops ? t("Plus rien de prévu aujourd'hui.") : t("Rien de prévu aujourd'hui.")}</span>
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
function RecapCard({ trip, from, top, globe, onOpen }: {
  trip: Trip; from: [number, number] | null; top: ReactNode; globe: ReactNode; onOpen: () => void;
}) {
  const states = useStore((s) => (s.tripId === trip.id ? s.data : null));
  const draft = useStore((s) => s.trips[trip.id]?.draft);
  const r = useMemo(() => recapOf(trip), [trip, states, draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = JSON.stringify(r) + (from || []).join(",");
  // the image is drawn ahead, so the share sheet opens right on the touch (phones refuse it after a wait)
  const [img, setImg] = useState<{ key: string; blob: Blob } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const id = window.setTimeout(() => {
      recapImage(r, from).then((blob) => { if (live) setImg({ key, blob }); }, () => undefined);
    }, 500);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const blob = img?.key === key ? img.blob : await recapImage(r, from);
      const res = await shareRecapBlob(r, blob);
      if (res !== "cancelled") track("export", "recap", trip.id);
      if (res === "saved") toast(t("Image du récapitulatif enregistrée"));
    } catch {
      toast(t("L'image n'a pas pu être préparée. Réessayez."));
    } finally {
      setBusy(false);
    }
  };

  const stats = recapStats(r);
  const showCities = r.cities.length > 1 || r.cities[0] !== r.title;

  return (
    <div className="v3-hero static recap" onClick={onGround(onOpen)}>
      {globe}
      {top}
      <span className="v3-hero-body">
        <span className="v3-lbl">{t("Récapitulatif")}</span>
        <b className="v3-d v3-hero-title" style={{ marginTop: 8 }}>{trip.title}</b>
        <small className="v3-hero-when">{r.dates}</small>
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
