import { TYPE_LABEL } from "../data/trip";
import type { Trip } from "../data/types";
import type { PlaceState } from "../lib/model";
import { countable, dayStops } from "../lib/plan";
import { countdownParts, fmtDay, phase, tripStartMs } from "../lib/time";
import { useWeather, wxKind, WX_LABEL } from "../lib/weather";
import { WxIcon } from "./WxIcon";

export default function Overview({ trip, states, onShowDay }: { trip: Trip; states: Record<string, PlaceState>; onShowDay: (key: string) => void }) {
  const all = countable(trip);
  const visited = all.filter((p) => states[p.id]?.visited).length;
  const favs = all.filter((p) => states[p.id]?.favorite).length;
  const scheduledDays = trip.days.filter((d) => d.scheduled);
  const nights = Math.max(1, scheduledDays.reduce((n, d) => n + (d.dates?.length || 0), 0));
  const ph = phase(trip);
  const cd = countdownParts(tripStartMs(trip));
  const wx = useWeather(trip.center[1], trip.center[0], trip.timezone);
  const tripDates = new Set(scheduledDays.flatMap((d) => d.dates || []));

  const cats = Object.entries(
    all.reduce<Record<string, number>>((acc, p) => {
      acc[p.type] = (acc[p.type] || 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(1, ...cats.map((c) => c[1]));

  return (
    <div>
      <div className="stats">
        <div className="stat">
          <span className="label">{ph === "before" ? "Départ" : ph === "during" ? "En cours" : "Terminé"}</span>
          <b>{ph === "before" ? `J-${cd.d}` : ph === "during" ? "Live" : "✓"}</b>
          <small>{trip.dateLabel}</small>
        </div>
        <div className="stat">
          <span className="label">Lieux</span>
          <b>{all.length}</b>
          <small>{scheduledDays.length} jours programmés</small>
        </div>
        <div className="stat">
          <span className="label">Visités</span>
          <b>{visited}</b>
          <small>{all.length ? Math.round((visited / all.length) * 100) : 0} % du programme</small>
        </div>
        <div className="stat">
          <span className="label">Favoris</span>
          <b>{favs}</b>
          <small>{(all.length / nights).toFixed(1)} lieux par jour</small>
        </div>
      </div>

      <div className="block">
        <span className="label">Avancement par jour</span>
        {trip.days.map((d) => {
          const stops = dayStops(trip, d.key, states).filter((p) => all.includes(p));
          if (!stops.length) return null;
          const v = stops.filter((p) => states[p.id]?.visited).length;
          return (
            <button key={d.key} className="dayrow" style={{ ["--c" as string]: d.color }} onClick={() => onShowDay(d.key)}>
              <span className="nm">
                <i />
                {d.short}
              </span>
              <span className="bar">
                <span style={{ width: `${(v / stops.length) * 100}%`, minWidth: v ? 6 : 0 }} />
              </span>
              <span className="ct">
                {v}/{stops.length}
              </span>
            </button>
          );
        })}
      </div>

      {wx && wx.days.length > 0 && (
        <div className="block">
          <span className="label">Météo à {trip.title}{wx.now ? ` · maintenant ${wx.now.temp}°, ${WX_LABEL[wxKind(wx.now.code)].toLowerCase()}` : ""}</span>
          <div className="wx-row">
            {wx.days.map((d) => (
              <div key={d.date} className={"wx-day" + (tripDates.has(d.date) ? " trip" : "")} title={WX_LABEL[wxKind(d.code)]}>
                {fmtDay(d.date, trip.timezone, { weekday: "short", day: "numeric" })}
                <WxIcon code={d.code} />
                <b>
                  {d.max}° <span style={{ color: "var(--soft)", fontWeight: 400 }}>{d.min}°</span>
                </b>
                {d.rain >= 30 && <span>{d.rain} %</span>}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 8 }}>Prévisions Open-Meteo sur 16 jours. Les jours du voyage sont encadrés.</p>
        </div>
      )}

      <div className="block">
        <span className="label">Répartition</span>
        <div className="catbars">
          {cats.map(([t, n]) => (
            <div key={t} className="catbar">
              <span>{TYPE_LABEL[t as keyof typeof TYPE_LABEL] || t}</span>
              <span className="bar">
                <span style={{ width: `${(n / maxCat) * 100}%` }} />
              </span>
              <span>{n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
