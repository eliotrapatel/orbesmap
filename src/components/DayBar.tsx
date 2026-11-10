import type { Trip } from "../data/types";
import { fmtDay, localDate } from "../lib/time";

export default function DayBar({ trip, day, onDay }: { trip: Trip; day: string; onDay: (d: string) => void }) {
  const today = localDate(trip.timezone);
  const count = (key: string) => trip.places.filter((p) => p.day === key).length;
  return (
    <div className="daybar" role="group" aria-label="Filtrer par jour">
      <button className={"day" + (day === "all" ? " on" : "")} aria-pressed={day === "all"} onClick={() => onDay("all")}>
        <span className="d-top">Tout</span>
        <span className="d-sub">{trip.places.length} lieux</span>
      </button>
      {trip.days
        .filter((d) => count(d.key) > 0)
        .map((d) => (
          <button
            key={d.key}
            className={"day" + (day === d.key ? " on" : "") + (d.dates?.includes(today) ? " today" : "")}
            aria-pressed={day === d.key}
            style={{ ["--c" as string]: d.color }}
            onClick={() => onDay(day === d.key ? "all" : d.key)}
          >
            <span className="d-top">
              <i />
              {d.short}
            </span>
            <span className="d-sub">{d.dates?.[0] ? fmtDay(d.dates[0], trip.timezone, { weekday: "short", day: "numeric", month: "short" }) : `${count(d.key)} lieux`}</span>
          </button>
        ))}
    </div>
  );
}
