import type { Place, Trip } from "../data/types";
import { formatMinutes, km, travelMinutes } from "../lib/geo";
import { exportIcs } from "../lib/ics";
import type { PlaceState } from "../lib/model";
import { dayStops, isHotel, stopTime } from "../lib/plan";
import { fmtDay, fmtMin, localDate } from "../lib/time";
import { ICalPlus, IMap, IRoute } from "./Icons";

export default function Agenda({ trip, states, onOpen, onShowDay, onOptimize }: { trip: Trip; states: Record<string, PlaceState>; onOpen: (p: Place) => void; onShowDay: (d: string) => void; onOptimize: (d: string) => void }) {
  const today = localDate(trip.timezone);
  return (
    <div>
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
                    {d.theme}. {stops.length} lieux · {v}/{stops.length} visités · ~{formatMinutes(total)} de trajet ({Math.round(dist)} km)
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
                    </span>
                  </button>
                );
              })}
            </section>
          );
        })}
      <p style={{ fontSize: 12, color: "var(--mute)" }}>Temps de trajet estimés en voiture. Une heure de rendez-vous saisie dans la fiche d'un lieu le replace dans la journée.</p>
    </div>
  );
}
