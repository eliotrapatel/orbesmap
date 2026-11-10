import { useEffect, useMemo, useRef, useState } from "react";
import { km } from "../lib/geo";
import { amapDirections } from "../lib/geo";
import { DENIED_HELP, ensureCompass, setFollow, startLocate, useLoc } from "../lib/locate";
import { estimate, fetchRoute, fmtDistance, fmtDuration, progress, secondsLeft, type LL, type Mode, type Route } from "../lib/route";
import { IClose, ILocate, INav, IPinPlus } from "./Icons";
import { useEscape } from "./ui";

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
  const stale = useLoc((s) => s.stale);
  const [route, setRoute] = useState<Route | null>(null); // real routes only (never the offline estimate)
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const inflight = useRef<AbortController | null>(null);
  const lastTry = useRef(0);
  const idx = useRef<number | undefined>(undefined);
  const key = nav ? `${nav.mode}:${nav.target.lat},${nav.target.lng}` : "";

  // new target or mode: drop the old route and any request in flight
  useEffect(() => {
    setRoute(null);
    idx.current = undefined;
    lastTry.current = 0;
    return () => {
      inflight.current?.abort();
      inflight.current = null;
      setLoading(false);
    };
  }, [key]);
  // network back: try again right away
  useEffect(() => {
    const f = () => {
      lastTry.current = 0;
      setTick((t) => t + 1);
    };
    window.addEventListener("online", f);
    return () => window.removeEventListener("online", f);
  }, []);

  const prog = route && fix ? progress(route, fix, idx.current) : null;
  if (prog) idx.current = prog.i;
  const toTarget = fix && nav ? km(fix, nav.target) * 1000 : Infinity;
  const now = Date.now();
  const offRoute = !!(route && prog && fix && toTarget > 150 && !prog.last && prog.off > Math.max(60, fix.acc * 1.5));
  const wantFetch =
    !!nav && !!fix && !stale && !inflight.current && ((!route && now - lastTry.current > (lastTry.current ? 30_000 : 0)) || (offRoute && now - lastTry.current > 20_000));

  useEffect(() => {
    if (!wantFetch || !nav || !fix) return;
    const ctl = new AbortController();
    inflight.current = ctl;
    lastTry.current = Date.now();
    setLoading(true);
    fetchRoute(fix, nav.target, nav.mode, ctl.signal, !!route)
      .then((r) => {
        if (inflight.current === ctl && !r.estimate) {
          idx.current = undefined;
          setRoute(r);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (inflight.current === ctl) {
          inflight.current = null;
          setLoading(false);
        }
      });
    // no cleanup here on purpose: the request is only cancelled when the target changes (effect above)
  }, [wantFetch, key, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // waiting for the 20 s / 30 s pause to end while standing still: re-check when it ends
  const waiting = !!nav && !!fix && !stale && !wantFetch && !inflight.current && (offRoute || !route);
  useEffect(() => {
    if (!waiting) return;
    const ms = Math.max(500, lastTry.current + (route ? 20_000 : 30_000) - Date.now() + 50);
    const t = window.setTimeout(() => setTick((x) => x + 1), ms);
    return () => window.clearTimeout(t);
  }, [waiting, route, tick]);

  const pi = prog?.i;
  const coords = useMemo<[number, number][] | null>(
    () => (route && fix && pi != null ? [[fix.lng, fix.lat], ...route.coords.slice(pi + 1)] : null),
    [route, fix?.lng, fix?.lat, pi], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!nav) return null;
  if (!fix) return { coords: null, left: null, secs: null, loading, arrived: false, estimate: true, stale };
  const est = !route || !prog;
  const left = est ? estimate(fix, nav.target, nav.mode).distance : prog!.left;
  const secs = est ? estimate(fix, nav.target, nav.mode).duration : secondsLeft(route!, left, nav.mode);
  return { coords, left, secs, loading, arrived: !stale && (left < 35 || toTarget < 25), estimate: est, stale };
}

export function NavCard({ nav, info, onMode, onClose }: { nav: NonNullable<NavState>; info: ReturnType<typeof useNavigation>; onMode: (m: Mode) => void; onClose: () => void }) {
  useEscape(onClose); // "back" stops the route instead of leaving the app
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
              {info.stale
                ? `${nav.target.name} · position perdue (métro, tunnel ?), dernière position connue`
                : `${nav.target.name} · arrivée ${clockIn(info.secs)}${info.loading ? " · calcul…" : info.estimate ? " · estimation" : nav.mode === "car" ? " · avec trafic moyen" : ""}`}
            </span>
          </div>
        )
      ) : (
        <div className="nav-main">
          <b>{status === "denied" ? "Position refusée" : "Recherche de votre position…"}</b>
          <span style={status === "denied" ? { whiteSpace: "normal" } : undefined}>{status === "denied" ? DENIED_HELP : `Vers ${nav.target.name}`}</span>
        </div>
      )}
      <div className="nav-btns">
        <button className={"btn-sm" + (follow ? " on" : "")} aria-pressed={follow} onClick={() => {
            ensureCompass(true);
            if (status === "on") setFollow(!follow);
            else startLocate(true);
          }}>
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
  if (w.distance / 1.25 > 80_000) {
    return (
      <div className="sec go">
        <span className="label">Y aller · à {fmtDistance(w.distance / 1.25)} de vous</span>
      </div>
    );
  }
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
  useEscape(onClose);
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
      {fix && w && c && w.distance / 1.25 <= 80_000 ? (
        <div className="go-row">
          <button className="go-btn" onClick={() => onGo("walk")}><IWalk /><b>~{fmtDuration(w.duration)}</b><small>à pied</small></button>
          <button className="go-btn" onClick={() => onGo("car")}><ICar /><b>~{fmtDuration(c.duration)}</b><small>en voiture</small></button>
        </div>
      ) : (
        !fix && <button className="btn-sm" onClick={() => startLocate(false)}><ILocate /> Voir la distance depuis ma position</button>
      )}
      <div className="nav-btns">
        <button className="btn-sm" onClick={onPin}><IPinPlus /> Ajouter à mes lieux</button>
      </div>
    </div>
  );
}
