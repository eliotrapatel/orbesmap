import { useEffect, useLayoutEffect, useRef, useState } from "react";
import OrbitMark from "./OrbitMark";
import type { Trip } from "../data/types";
import { countable } from "../lib/plan";
import { liveTrip } from "../lib/live";
import { getState, useTrips } from "../lib/store";
import { clock, countdownParts, phase, tripEndMs, tripStartMs } from "../lib/time";
import { t } from "../lib/i18n";

function visitedOf(t: Trip): number {
  try {
    const raw = t.id === getState().tripId ? getState().data : JSON.parse(localStorage.getItem("orbes.v2." + t.id) || "null");
    const places = raw?.places || {};
    return countable(t).filter((p) => places[p.id]?.visited).length;
  } catch {
    return 0;
  }
}

/** A trip with its places added / moved in the app (the current one is already live) */
function liveOf(t: Trip, current: Trip): Trip {
  if (t.id === current.id) return current;
  try {
    const raw = JSON.parse(localStorage.getItem("orbes.v2." + t.id) || "null");
    return raw ? liveTrip(t, { places: raw.places || {}, pins: raw.pins || [], defs: raw.defs || {} }) : t;
  } catch {
    return t;
  }
}

export default function Landing({ trip, onPick, onEnter }: { trip: Trip; onPick: (id: string) => void; onEnter: () => void }) {
  const trips = useTrips();
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
  // every line holds on one line: a line too long for the screen (narrow phone, folded Z Fold) is set smaller
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      root.current?.querySelectorAll<HTMLElement>("[data-fit]").forEach((el) => {
        el.style.fontSize = "";
        const avail = el.clientWidth;
        const probe = el.cloneNode(true) as HTMLElement;
        Object.assign(probe.style, { position: "absolute", left: "0", top: "0", visibility: "hidden", display: "inline-block", width: "max-content", maxWidth: "none", animation: "none", whiteSpace: "nowrap", pointerEvents: "none" });
        el.parentElement?.appendChild(probe);
        const need = probe.getBoundingClientRect().width;
        probe.remove();
        if (avail > 0 && need > avail) el.style.fontSize = `${(parseFloat(getComputedStyle(el).fontSize) * avail * 0.985) / need}px`;
      });
    };
    fit();
    document.fonts?.ready.then(fit);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [trip.id]);
  const days = trip.days.filter((d) => d.scheduled).reduce((n, d) => n + (d.dates?.length || 0), 0);
  const ordered = trips.map((tr) => liveOf(tr, trip)).sort((a, b) => b.start.localeCompare(a.start));

  return (
    <div ref={root} className={"landing" + (out ? " out" : "")} role="dialog" aria-label={t("Accueil")}>
      <div className="l-top">
        <span className="brand-mark"><OrbitMark size={26} title="ORBES Trips" /></span>
        <div className="l-clocks">
          <span>Paris<b>{clock("Europe/Paris", new Date(now))}</b></span>
          <span>{trip.title}<b>{clock(trip.timezone, new Date(now))}</b></span>
        </div>
      </div>
      <div className="l-hero">
        <span className="label l-kicker" data-fit>{trip.subtitle} · {trip.dateLabel}</span>
        <h1 className="l-title" key={trip.id} data-fit>{trip.title}</h1>
        <div className="l-sub">
          <span><b>{trip.places.length}</b> {t("lieux")}</span>
          <span><b>{days}</b> {days <= 1 ? t("jour sur place") : t("jours sur place")}</span>
          <span>{t("Hôtel")} <b>{trip.hotel.name}</b></span>
          {trip.flights.map((f) => <span key={f.code}><b>{f.code}</b> {f.from} → {f.to}</span>)}
        </div>
        {ph !== "after" && (
          <div className="countdown" aria-label={ph === "before" ? t("Compte à rebours avant l'arrivée") : t("Temps restant sur place")}>
            {([["d", "Jours"], ["h", "Heures"], ["m", "Min"], ["s", "Sec"]] as const).map(([k, l]) => (
              <div key={k} className="cd-cell glass">
                <b>{String(cd[k]).padStart(2, "0")}</b>
                <span className="label">{t(l)}</span>
              </div>
            ))}
            <span className="label" style={{ alignSelf: "center", marginLeft: 6 }}>{ph === "before" ? t("avant l'arrivée") : t("avant le retour")}</span>
          </div>
        )}
        <div className="l-trips">
          {ordered.map((tr) => {
            const tp = phase(tr, now);
            const total = countable(tr).length;
            const v = visitedOf(tr);
            return (
              <button key={tr.id} className={"trip-card glass" + (tr.id === trip.id ? " sel" : "")} onClick={() => onPick(tr.id)} aria-pressed={tr.id === trip.id}>
                <span className="label" data-fit>{tr.code} · {tr.dateLabel}</span>
                <span className={"pill tc-state" + (tp === "after" ? " done" : tp === "during" ? " live" : "")}>{tp === "before" ? t("J-{n}", { n: countdownParts(tripStartMs(tr), now).d }) : tp === "during" ? t("En cours") : t("Terminé")}</span>
                <h3>{tr.title}</h3>
                <p>{tr.subtitle}</p>
                <div className="tc-stats">
                  <span><b>{tr.places.length}</b>{t("lieux")}</span>
                  <span><b>{tr.days.filter((d) => d.scheduled).length}</b>{t("jours")}</span>
                  <span><b>{v}/{total}</b>{t("visités")}</span>
                </div>
                <div className="bar tc-bar"><span style={{ width: `${total ? (v / total) * 100 : 0}%` }} /></div>
              </button>
            );
          })}
        </div>
        <div className="l-enter">
          <button ref={enterBtn} className="btn primary" onClick={enter}>{t("Entrer")}</button>
          <small data-fit>{t("Carte, programme, phrases, vols, carnet partagé.")}</small>
        </div>
      </div>
    </div>
  );
}
