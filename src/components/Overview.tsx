import { TYPE_LABEL } from "../data/trip";
import type { Trip } from "../data/types";
import type { PlaceState } from "../lib/model";
import { countable, dayStops } from "../lib/plan";
import { countdownParts, fmtDay, phase, tripStartMs } from "../lib/time";
import { useWeather, wxKind, WX_LABEL } from "../lib/weather";
import { WxIcon } from "./WxIcon";
import { locale, t } from "../lib/i18n";

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
          <span className="label">{ph === "before" ? t("Départ") : ph === "during" ? t("En cours") : t("Terminé")}</span>
          <b>{ph === "before" ? t("J-{n}", { n: cd.d }) : ph === "during" ? t("Live") : "✓"}</b>
          <small>{trip.dateLabel}</small>
        </div>
        <div className="stat">
          <span className="label">{t("Lieux")}</span>
          <b>{all.length}</b>
          <small>{t("{n} par jour en moyenne", { n: (all.length / nights).toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</small>
        </div>
        <div className="stat">
          <span className="label">{t("Visités")}</span>
          <b>{visited}</b>
          <small>{t("{n} % du programme", { n: all.length ? Math.round((visited / all.length) * 100) : 0 })}</small>
        </div>
        <div className="stat">
          <span className="label">{t("Favoris")}</span>
          <b>{favs}</b>
          <small>{favs ? t("{n} encore à voir", { n: favs - all.filter((p) => states[p.id]?.favorite && states[p.id]?.visited).length }) : t("Touchez l'étoile d'une fiche")}</small>
        </div>
      </div>

      <div className="block">
        <span className="label">{t("Avancement par jour")}</span>
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
          <span className="label">{t("Météo à {city}", { city: trip.title })}{wx.now ? ` · ${t("maintenant {temp}°, {sky}", { temp: wx.now.temp, sky: t(WX_LABEL[wxKind(wx.now.code)]).toLowerCase() })}` : ""}</span>
          <div className="wx-row">
            {wx.days.map((d) => (
              <div key={d.date} className={"wx-day" + (tripDates.has(d.date) ? " trip" : "")} title={t(WX_LABEL[wxKind(d.code)])}>
                {fmtDay(d.date, trip.timezone, { weekday: "short", day: "numeric" })}
                <WxIcon code={d.code} />
                <b>
                  {d.max}° <span style={{ color: "var(--soft)", fontWeight: 400 }}>{d.min}°</span>
                </b>
                {d.rain >= 30 && <span>{d.rain} %</span>}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 8 }}>{t("Prévisions Open-Meteo sur 16 jours. Les jours du voyage sont encadrés.")}</p>
        </div>
      )}

      <div className="block">
        <span className="label">{t("Répartition")}</span>
        <div className="catbars">
          {cats.map(([ty, n]) => (
            <div key={ty} className="catbar">
              <span>{t(TYPE_LABEL[ty as keyof typeof TYPE_LABEL] || ty)}</span>
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
