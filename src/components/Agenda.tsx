import { DAYS, PLACES, TRIP } from "../data/trip";
import type { DayKey, Place } from "../data/types";
import { formatMinutes, km, travelMinutes } from "../lib/geo";
import type { PlaceState } from "../lib/model";

/** "10h30", "10:30", "9h" → minutes since midnight */
export function parseTime(s?: string): number | null {
  const m = s?.match(/(\d{1,2})\s*[h:]\s*(\d{2})?/i);
  if (!m) return null;
  const h = +m[1];
  if (h > 23) return null;
  return h * 60 + (m[2] ? +m[2] : 0);
}

export function dayStops(day: DayKey, states: Record<string, PlaceState>): Place[] {
  const items = PLACES.filter((p) => p.day === day);
  const timed = items.filter((p) => parseTime(states[p.id]?.appt) != null).sort((a, b) => parseTime(states[a.id]?.appt)! - parseTime(states[b.id]?.appt)!);
  return [...timed, ...items.filter((p) => !timed.includes(p))];
}

const fmtDate = (iso: string) => {
  const d = new Date(iso + "T12:00:00+08:00");
  return {
    num: d.toLocaleDateString("fr-FR", { day: "numeric", timeZone: TRIP.timezone }),
    wd: d.toLocaleDateString("fr-FR", { weekday: "short", timeZone: TRIP.timezone }),
    month: d.toLocaleDateString("fr-FR", { month: "long", timeZone: TRIP.timezone }),
  };
};

export default function Agenda({ states, onOpen, onShowDay, onOptimize }: { states: Record<string, PlaceState>; onOpen: (p: Place) => void; onShowDay: (d: DayKey) => void; onOptimize: (d: DayKey) => void }) {
  return (
    <div>
      {DAYS.filter((d) => d.scheduled).map((d) => {
        const stops = dayStops(d.key, states);
        const first = fmtDate(d.dates![0]);
        const last = d.dates!.length > 1 ? fmtDate(d.dates![d.dates!.length - 1]) : null;
        let prev = TRIP.hotel as { lat: number; lng: number };
        let total = 0;
        let dist = 0;
        const legs = stops.map((p) => {
          const m = travelMinutes(prev, p);
          total += m;
          dist += km(prev, p);
          prev = p;
          return m;
        });
        return (
          <section className="ag-day" key={d.key} style={{ ["--c" as string]: d.color }}>
            <div className="ag-head">
              <div className="ag-date">
                <b>{last ? `${first.num}–${last.num}` : first.num}</b>
                <small>{last ? `${first.wd}–${last.wd}` : first.wd}</small>
              </div>
              <div className="ag-title">
                <h3>{d.title}</h3>
                <p>
                  {d.theme}. {stops.length} lieux, environ {formatMinutes(total)} de trajet ({Math.round(dist)} km)
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, padding: "0 20px 12px 76px" }}>
              <button className="btn-sm" onClick={() => onShowDay(d.key)}>
                Voir sur la carte
              </button>
              {stops.length > 1 && (
                <button className="btn-sm" onClick={() => onOptimize(d.key)}>
                  Meilleur ordre
                </button>
              )}
            </div>
            {stops.map((p, i) => {
              const s = states[p.id] || {};
              const t = parseTime(s.appt);
              return (
                <button className="ag-stop" key={p.id} onClick={() => onOpen(p)}>
                  <span className="ag-time">{t != null ? `${Math.floor(t / 60)}h${String(t % 60).padStart(2, "0")}` : "—"}</span>
                  <span className="ag-rail">
                    <span className={"ag-node" + (s.visited ? " done" : "")} />
                  </span>
                  <span className="ag-body">
                    <b>{p.name}</b>
                    <small>{s.appt || p.time}</small>
                    <span className="ag-leg" style={{ display: "block" }}>
                      {i === 0 ? "Depuis l'hôtel" : "Trajet"} : {formatMinutes(legs[i])}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
      <p style={{ padding: "0 20px 28px", fontSize: 12.5, color: "var(--mist)" }}>
        Les temps de trajet sont des estimations en voiture. Ajoutez une heure de rendez-vous dans la fiche d'un lieu pour le placer dans la journée.
      </p>
    </div>
  );
}
