import type { Place, Trip } from "../data/types";
import { formatMinutes, km, travelMinutes } from "../lib/geo";
import { exportIcs } from "../lib/ics";
import type { Pin, PlaceState } from "../lib/model";
import { dayStops, isHotel, stopTime } from "../lib/plan";
import { plural } from "../lib/fmt";
import { fmtDay, fmtMin, localDate } from "../lib/time";
import { checkVisit } from "../lib/hours";
import { ICalPlus, IMap, IRoute } from "./Icons";

export default function Agenda({ trip, states, pins = [], onOpen, onOpenPin, onShowDay, onOptimize }: { trip: Trip; states: Record<string, PlaceState>; pins?: Pin[]; onOpen: (p: Place) => void; onOpenPin?: (p: Pin) => void; onShowDay: (d: string) => void; onOptimize: (d: string) => void }) {
  // places added from a link / on the map, with the day chosen for them
  const pinDay = (p: Pin) => ((states as Record<string, Record<string, unknown>>)[`_pin:${p.id}`]?.day as string | undefined) || "";
  const today = localDate(trip.timezone);
  // alerts across the whole programme (closed days, last entry passed, opening later than planned)
  const alerts = trip.days
    .filter((d) => d.scheduled && (d.dates?.[d.dates.length - 1] ?? "") >= today)
    .flatMap((d) => dayStops(trip, d.key, states).filter((p) => !states[p.id]?.visited).map((p) => ({ d, p, x: checkVisit(trip.hours?.[p.id], d.dates?.[0], stopTime(p, states)).filter((i) => i.tone !== "info") })))
    .filter((a) => a.x.length);
  return (
    <div>
      {alerts.length > 0 && (
        <div className="ag-alerts">
          <b>{alerts.length === 1 ? "1 visite à vérifier" : `${alerts.length} visites à vérifier`}</b>
          {alerts.map((a) => (
            <button key={a.d.key + ":" + a.p.id} onClick={() => onOpen(a.p)}>
              <span>{a.d.short} · {a.p.name}</span>
              <em className={a.x[0].tone}>{a.x[0].text}</em>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
        <button className="btn-sm" onClick={() => exportIcs(trip, states)}>
          <ICalPlus /> Ajouter à mon calendrier (.ics)
        </button>
      </div>
      {trip.days
        .filter((d) => d.scheduled)
        .map((d) => {
          const stops = dayStops(trip, d.key, states).filter((p) => !isHotel(trip, p));
          const first = d.dates?.[0];
          const last = d.dates && d.dates.length > 1 ? d.dates[d.dates.length - 1] : null;
          const isToday = d.dates?.includes(today);
          let prev: { lat: number; lng: number } = trip.hotel;
          let total = 0;
          let dist = 0;
          const legs = stops.map((p) => {
            const m = travelMinutes(prev, p);
            total += m;
            dist += km(prev, p);
            prev = p;
            return m;
          });
          const v = stops.filter((p) => states[p.id]?.visited).length;
          return (
            <section className="ag-day" key={d.key} style={{ ["--c" as string]: d.color }}>
              <div className="ag-head">
                {first && (
                  <div className="ag-date">
                    <b>{fmtDay(first, trip.timezone, { day: "numeric" })}{last ? `–${fmtDay(last, trip.timezone, { day: "numeric" })}` : ""}</b>
                    <span className="label">{fmtDay(first, trip.timezone, { weekday: "short" }).replace(".", "")}</span>
                  </div>
                )}
                <div className="ag-title">
                  <h4>
                    <i /> {d.title}
                    {isToday && <span className="pill live">Aujourd'hui</span>}
                  </h4>
                  <p>
                    {d.theme}. {plural(stops.length, "lieu", "lieux")} · {v}/{stops.length} {v <= 1 ? "visité" : "visités"} · ~{formatMinutes(total)} de trajet ({Math.round(dist)} km)
                  </p>
                </div>
              </div>
              <div className="ag-btns">
                <button className="btn-sm" onClick={() => onShowDay(d.key)}>
                  <IMap /> Voir sur la carte
                </button>
                {stops.length > 1 && (
                  <button className="btn-sm" onClick={() => onOptimize(d.key)}>
                    <IRoute /> Meilleur ordre
                  </button>
                )}
              </div>
              {stops.map((p, i) => {
                const s = states[p.id] || {};
                const t = stopTime(p, states);
                const issues = checkVisit(trip.hours?.[p.id], first, t).filter((x) => x.tone !== "info" || x.text.startsWith("Réservation"));
                return (
                  <button className={"ag-stop" + (i === 0 ? " first" : "") + (i === stops.length - 1 ? " last" : "")} key={p.id} onClick={() => onOpen(p)}>
                    <span className="ag-time">{t != null ? fmtMin(t) : "—"}</span>
                    <span className="ag-rail">
                      <span className={"ag-node" + (s.visited ? " done" : "")} />
                    </span>
                    <span className="ag-body">
                      <b>{p.name}</b>
                      <small>{s.appt ? `RDV ${s.appt}` : p.time}</small>
                      <span className="ag-leg">
                        {i === 0 ? "Depuis l'hôtel" : "Trajet"} : ~{formatMinutes(legs[i])}
                      </span>
                      {issues.map((x, k) => {
                        // reservation details are long: short label here, full text in the place sheet
                        const short = x.tone === "info" && x.text.length > 70 ? x.text.slice(0, 66).replace(/\s+\S*$/, "") + "…" : x.text;
                        return <span key={k} className={"ag-issue " + x.tone} title={x.text}>{x.tone === "bad" ? "⚠ " : x.tone === "warn" ? "! " : ""}{short}</span>;
                      })}
                    </span>
                  </button>
                );
              })}
              {pins.filter((p) => pinDay(p) === d.key).length > 0 && (
                <div className="ag-pins">
                  <span className="label">Ajoutés ce jour</span>
                  {pins.filter((p) => pinDay(p) === d.key).map((p) => (
                    <button key={p.id} className="btn-sm" onClick={() => onOpenPin?.(p)}>● {p.name}</button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      <p style={{ fontSize: 12, color: "var(--mute)" }}>Temps de trajet estimés en voiture. Une heure de rendez-vous saisie dans la fiche d'un lieu le replace dans la journée.</p>
    </div>
  );
}
