import { useEffect, useRef, useState } from "react";
import { amapDirections } from "../lib/geo";
import { setFollow, startLocate, useLoc } from "../lib/locate";
import { estimate, fetchRoute, fmtDistance, fmtDuration, progress, secondsLeft, type LL, type Mode, type Route } from "../lib/route";
import { IClose, ILocate, INav, IPinPlus } from "./Icons";

export type NavTarget = LL & { name: string };
export type NavState = { target: NavTarget; mode: Mode } | null;

const clockIn = (s: number) => new Date(Date.now() + s * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export const IWalk = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <circle cx="13" cy="4" r="1.8" />
    <path d="M10.5 21l1.8-5.5-2.3-2.3.9-4.4L8 10.5V14M12.3 15.5 15 21M10.9 8.8l2.7.4 1.6 2.6 2.3.7" />
  </svg>
);
export const ICar = (p: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <path d="M5 16.5V12l1.8-4.6A2 2 0 0 1 8.7 6h6.6a2 2 0 0 1 1.9 1.4L19 12v4.5" />
    <path d="M3.5 12h17v4.5h-17zM6.5 16.5V19M17.5 16.5V19" />
    <circle cx="7.5" cy="14.2" r=".6" fill="currentColor" />
    <circle cx="16.5" cy="14.2" r=".6" fill="currentColor" />
  </svg>
);

/** Live route to a target: fetched once, then distance/time left are updated locally from the GPS. */
export function useNavigation(nav: NavState) {
  const fix = useLoc((s) => s.fix);
  const [route, setRoute] = useState<Route | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetch = useRef<{ t: number; key: string } | null>(null);
  const key = nav ? `${nav.mode}:${nav.target.lat},${nav.target.lng}` : "";
  const hasFix = !!fix;

  // new target or mode: drop the old route
  useEffect(() => {
    setRoute(null);
    lastFetch.current = null;
  }, [key]);

  const prog = route && fix ? progress(route, fix) : null;
  const off = prog?.off ?? 0;
  const needFetch = !!nav && hasFix && (!route || (off > Math.max(60, (fix?.acc || 0) * 1.5) && Date.now() - (lastFetch.current?.t || 0) > 20_000));

  useEffect(() => {
    if (!nav || !fix || !needFetch) return;
    const ctl = new AbortController();
    lastFetch.current = { t: Date.now(), key };
    setLoading(true);
    fetchRoute(fix, nav.target, nav.mode, ctl.signal)
      .then((r) => !ctl.signal.aborted && setRoute(r))
      .catch(() => {})
      .finally(() => !ctl.signal.aborted && setLoading(false));
    return () => ctl.abort();
  }, [needFetch, key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!nav) return null;
  const r = route || (fix ? estimate(fix, nav.target, nav.mode) : null);
  if (!r || !fix) return { route: null, left: null, secs: null, loading, arrived: false };
  const left = route ? (prog?.left ?? r.distance) : r.distance;
  const secs = secondsLeft(r, left, nav.mode);
  return { route: route ? { ...r, coords: [[fix.lng, fix.lat] as [number, number], ...trimFrom(r.coords, fix)] } : null, left, secs, loading, arrived: left < 35, estimate: r.estimate };
}

/** Drop the part of the line already walked (nearest vertex onwards). */
function trimFrom(c: [number, number][], p: LL): [number, number][] {
  let bi = 0, bd = Infinity;
  c.forEach(([x, y], i) => {
    const d = (x - p.lng) ** 2 + (y - p.lat) ** 2;
    if (d < bd) {
      bd = d;
      bi = i;
    }
  });
  return c.slice(Math.min(bi + 1, c.length - 1));
}

export function NavCard({ nav, info, onMode, onClose }: { nav: NonNullable<NavState>; info: ReturnType<typeof useNavigation>; onMode: (m: Mode) => void; onClose: () => void }) {
  const status = useLoc((s) => s.status);
  const follow = useLoc((s) => s.follow);
  return (
    <div className="navcard glass" role="region" aria-label={`Itinéraire vers ${nav.target.name}`}>
      <div className="nav-top">
        <div className="seg nav-modes" role="group" aria-label="Mode de déplacement">
          <button className={nav.mode === "walk" ? "on" : ""} aria-pressed={nav.mode === "walk"} onClick={() => onMode("walk")}><IWalk /> À pied</button>
          <button className={nav.mode === "car" ? "on" : ""} aria-pressed={nav.mode === "car"} onClick={() => onMode("car")}><ICar /> Voiture</button>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Arrêter l'itinéraire"><IClose /></button>
      </div>
      {info?.left != null && info.secs != null ? (
        info.arrived ? (
          <div className="nav-main"><b>Vous êtes arrivé</b><span>{nav.target.name}</span></div>
        ) : (
          <div className="nav-main">
            <b>
              {info.estimate ? "~" : ""}
              {fmtDuration(info.secs)} <em>· {fmtDistance(info.left)}</em>
            </b>
            <span>
              {nav.target.name} · arrivée {clockIn(info.secs)}
              {info.loading ? " · calcul…" : info.estimate ? " · estimation (hors ligne)" : nav.mode === "car" ? " · avec trafic moyen" : ""}
            </span>
          </div>
        )
      ) : (
        <div className="nav-main">
          <b>{status === "denied" ? "Position refusée" : "Recherche de votre position…"}</b>
          <span>{status === "denied" ? "Autorisez la localisation pour ce site dans les réglages" : `Vers ${nav.target.name}`}</span>
        </div>
      )}
      <div className="nav-btns">
        <button className={"btn-sm" + (follow ? " on" : "")} aria-pressed={follow} onClick={() => (status === "on" ? setFollow(!follow) : startLocate(true))}>
          <ILocate /> {follow ? "Je suis suivi" : "Me suivre"}
        </button>
        <a className="btn-sm" href={amapDirections(nav.target, nav.mode)} target="_blank" rel="noopener"><INav /> Guidage Amap</a>
      </div>
    </div>
  );
}

/** "Y aller" block in a place / pin sheet: instant estimates, real route on tap. */
export function GoBlock({ target, onGo }: { target: NavTarget; onGo: (m: Mode) => void }) {
  const fix = useLoc((s) => s.fix);
  const status = useLoc((s) => s.status);
  if (!fix) {
    return (
      <div className="sec go">
        <span className="label">Y aller</span>
        <button className="btn-sm" onClick={() => startLocate(false)}>
          <ILocate /> {status === "searching" ? "Recherche de votre position…" : "Voir la distance depuis ma position"}
        </button>
      </div>
    );
  }
  const w = estimate(fix, target, "walk");
  const c = estimate(fix, target, "car");
  return (
    <div className="sec go">
      <span className="label">Y aller · à {fmtDistance(w.distance / 1.25)} à vol d'oiseau</span>
      <div className="go-row">
        <button className="go-btn" onClick={() => onGo("walk")}><IWalk /><b>~{fmtDuration(w.duration)}</b><small>à pied · {fmtDistance(w.distance)}</small></button>
        <button className="go-btn" onClick={() => onGo("car")}><ICar /><b>~{fmtDuration(c.duration)}</b><small>en voiture · {fmtDistance(c.distance)}</small></button>
      </div>
    </div>
  );
}

/** Card for a point chosen by a long press on the map. */
export function PointCard({ point, onGo, onPin, onClose }: { point: LL; onGo: (m: Mode) => void; onPin: () => void; onClose: () => void }) {
  const fix = useLoc((s) => s.fix);
  const w = fix ? estimate(fix, point, "walk") : null;
  const c = fix ? estimate(fix, point, "car") : null;
  return (
    <div className="navcard glass" role="region" aria-label="Point choisi sur la carte">
      <div className="nav-top">
        <div className="nav-main" style={{ padding: 0 }}>
          <b style={{ fontSize: 16 }}>Point choisi</b>
          <span>{fix && w ? `À ${fmtDistance(w.distance / 1.25)} à vol d'oiseau` : `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`}</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer"><IClose /></button>
      </div>
      {fix && w && c ? (
        <div className="go-row">
          <button className="go-btn" onClick={() => onGo("walk")}><IWalk /><b>~{fmtDuration(w.duration)}</b><small>à pied</small></button>
          <button className="go-btn" onClick={() => onGo("car")}><ICar /><b>~{fmtDuration(c.duration)}</b><small>en voiture</small></button>
        </div>
      ) : (
        <button className="btn-sm" onClick={() => startLocate(false)}><ILocate /> Voir la distance depuis ma position</button>
      )}
      <div className="nav-btns">
        <button className="btn-sm" onClick={onPin}><IPinPlus /> Ajouter à mes lieux</button>
      </div>
    </div>
  );
}
