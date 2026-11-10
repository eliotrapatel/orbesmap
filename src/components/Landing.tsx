import { useEffect, useRef, useState } from "react";
import { TRIPS } from "../data/trip";
import type { Trip } from "../data/types";
import { countable } from "../lib/plan";
import { getState } from "../lib/store";
import { clock, countdownParts, phase, tripEndMs, tripStartMs } from "../lib/time";

function visitedOf(t: Trip): number {
  try {
    const raw = t.id === getState().tripId ? getState().data : JSON.parse(localStorage.getItem("orbes.v2." + t.id) || "null");
    const places = raw?.places || {};
    return countable(t).filter((p) => places[p.id]?.visited).length;
  } catch {
    return 0;
  }
}

export default function Landing({ trip, onPick, onEnter }: { trip: Trip; onPick: (id: string) => void; onEnter: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [out, setOut] = useState(false);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const entered = useRef(false);
  const enterBtn = useRef<HTMLButtonElement>(null);
  // keyboard focus on "Entrer" without scrolling the page down to it on small screens
  useEffect(() => {
    enterBtn.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || (e.target as HTMLElement).closest?.("button,input,textarea,a")) return;
      enter();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const ph = phase(trip, now);
  const target = ph === "before" ? tripStartMs(trip) : tripEndMs(trip);
  const cd = countdownParts(target, now);
  const enter = () => {
    if (entered.current) return;
    entered.current = true;
    setOut(true);
    onEnter();
  };
  const days = trip.days.filter((d) => d.scheduled).reduce((n, d) => n + (d.dates?.length || 0), 0);
  const ordered = [...TRIPS].sort((a, b) => b.start.localeCompare(a.start));

  return (
    <div className={"landing" + (out ? " out" : "")} role="dialog" aria-label="Accueil">
      <div className="l-top">
        <span className="wordmark">ORBES</span>
        <div className="l-clocks">
          <span>Paris<b>{clock("Europe/Paris", new Date(now))}</b></span>
          <span>{trip.title}<b>{clock(trip.timezone, new Date(now))}</b></span>
        </div>
      </div>
      <div className="l-hero">
        <span className="label l-kicker">{trip.subtitle} · {trip.dateLabel}</span>
        <h1 className="l-title" key={trip.id}>{trip.title}</h1>
        <div className="l-sub">
          <span><b>{trip.places.length}</b> lieux</span>
          <span><b>{days}</b> {days <= 1 ? "jour" : "jours"} sur place</span>
          <span>Hôtel <b>{trip.hotel.name}</b></span>
          {trip.flights.map((f) => <span key={f.code}><b>{f.code}</b> {f.from} → {f.to}</span>)}
        </div>
        {ph !== "after" && (
          <div className="countdown" aria-label={ph === "before" ? "Compte à rebours avant l'arrivée" : "Temps restant sur place"}>
            {([["d", "Jours"], ["h", "Heures"], ["m", "Min"], ["s", "Sec"]] as const).map(([k, l]) => (
              <div key={k} className="cd-cell glass">
                <b>{String(cd[k]).padStart(2, "0")}</b>
                <span className="label">{l}</span>
              </div>
            ))}
            <span className="label" style={{ alignSelf: "center", marginLeft: 6 }}>{ph === "before" ? "avant l'arrivée" : "avant le retour"}</span>
          </div>
        )}
        <div className="l-trips">
          {ordered.map((t) => {
            const tp = phase(t, now);
            const total = countable(t).length;
            const v = visitedOf(t);
            return (
              <button key={t.id} className={"trip-card glass" + (t.id === trip.id ? " sel" : "")} onClick={() => onPick(t.id)} aria-pressed={t.id === trip.id}>
                <span className="label">{t.code} · {t.dateLabel}</span>
                <span className={"pill tc-state" + (tp === "after" ? " done" : tp === "during" ? " live" : "")}>{tp === "before" ? `J-${countdownParts(tripStartMs(t), now).d}` : tp === "during" ? "En cours" : "Terminé"}</span>
                <h3>{t.title}</h3>
                <p>{t.subtitle}</p>
                <div className="tc-stats">
                  <span><b>{t.places.length}</b>lieux</span>
                  <span><b>{t.days.filter((d) => d.scheduled).length}</b>jours</span>
                  <span><b>{v}/{total}</b>visités</span>
                </div>
                <div className="bar tc-bar"><span style={{ width: `${total ? (v / total) * 100 : 0}%` }} /></div>
              </button>
            );
          })}
        </div>
        <div className="l-enter">
          <button ref={enterBtn} className="btn primary" onClick={enter}>Entrer</button>
          <small>Carte, programme jour par jour, phrases, convertisseur, vols, carnet partagé.</small>
        </div>
      </div>
    </div>
  );
}
