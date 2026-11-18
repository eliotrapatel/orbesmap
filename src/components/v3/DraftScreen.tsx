import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { addWish, adjustProgramme, confirmTrip, draftOf, prepare, prepareAgain, preparedElsewhere, regenerateDay, reviewNow, serverBusy, serverStarting, stopPrepare, useDraftRun, watchServer } from "../../lib/draft";
import { AiError } from "../../lib/ai";
import { parseTime } from "../../lib/time";
import { useStore, useTrip, useTripHasPro } from "../../lib/store";
import { TYPE_LABEL } from "../../data/trip";
import Shell from "./Shell";
import InviteTravellers from "./InviteTravellers";
import { locale, t } from "../../lib/i18n";
import { CcBell, CcCheck, CcClose, CcRefresh, CcSpark } from "./ConciergeIcons";
import "../../styles/creation.css";
import "../../styles/prep.css";

/** A preparation's message in the language shown (the server writes the French text, the app translates it) */
function errText(s?: string | null): string {
  if (!s) return "";
  const m = /^(\d+) (?:jours n'ont pas pu être préparés|jour n'a pas pu être préparé)\.$/.exec(s);
  if (m) return +m[1] > 1 ? t("{n} jours n'ont pas pu être préparés.", { n: m[1] }) : t("{n} jour n'a pas pu être préparé.", { n: m[1] });
  return t(s);
}

/** "22–28 nov." (English "Nov 22 – 28"): the dates of the trip, short */
function shortRange(from?: string, to?: string): string {
  if (!from) return "";
  try {
    const f = new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", timeZone: "UTC" });
    const a = new Date(`${from}T12:00:00Z`);
    const b = new Date(`${to || from}T12:00:00Z`);
    return !to || to === from ? f.format(a) : f.formatRange(a, b);
  } catch {
    return "";
  }
}

/** Re-renders every few seconds (a server's sign of life gets old without any change in the store) */
function useClock(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

// One day prepared again from the review: the review stays on screen (the run is the same as a preparation's)
let redoing: { tripId: string; date: string } | null = null;
const redoSubs = new Set<() => void>();
const setRedoing = (v: typeof redoing) => {
  redoing = v;
  redoSubs.forEach((f) => f());
};
function useRedoing(tripId: string): string | null {
  const v = useSyncExternalStore((f) => {
    redoSubs.add(f);
    return () => {
      redoSubs.delete(f);
    };
  }, () => redoing);
  return v && v.tripId === tripId ? v.date : null;
}
// the day open in the review, per trip (it comes back after the missing days are prepared)
const openDay = new Map<string, string>();

/** The screen stays on while the preparation runs (a locked phone freezes the page, and the preparation with it) */
function useWakeLock(on: boolean): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) return;
    type Lock = { release: () => Promise<void>; addEventListener: (e: "release", f: () => void) => void };
    const nav = navigator as Navigator & { wakeLock?: { request: (k: "screen") => Promise<Lock> } };
    if (!nav.wakeLock) return;
    let lock: Lock | null = null;
    let gone = false;
    const ask = async () => {
      if (gone || document.visibilityState !== "visible" || lock) return;
      try {
        const l = await nav.wakeLock!.request("screen");
        if (gone) {
          void l.release().catch(() => undefined);
          return;
        }
        lock = l;
        setHeld(true);
        l.addEventListener("release", () => {
          lock = null;
          setHeld(false);
        });
      } catch {
        setHeld(false);
      }
    };
    // the lock goes when the page is hidden: asked again when it comes back
    const onVis = () => void ask();
    document.addEventListener("visibilitychange", onVis);
    void ask();
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release().catch(() => undefined);
      setHeld(false);
    };
  }, [on]);
  return held;
}

/** "mardi 24 novembre" (English "Tuesday 24 November") */
function longDay(iso?: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(locale(), { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
  } catch {
    return iso;
  }
}

/** A new trip being prepared by the AI (live progress), then its review (adjust, regenerate, confirm) */
export default function DraftScreen({ onClose }: { onClose: () => void }) {
  const trip = useTrip();
  useStore((s) => s.trips[trip.id]);
  const d = draftOf(trip.id);
  const run = useDraftRun(trip.id);
  // the preparation starts (or resumes) as soon as this screen shows; on the server it goes on after the screen closes
  useEffect(() => {
    if (d?.status !== "preparing") return;
    const t = window.setTimeout(() => {
      if (!run.busy && !run.err) void prepare(trip.id);
    }, 50);
    return () => window.clearTimeout(t);
  }, [trip.id, d?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  // the server's progress while this screen shows (and a run that stopped answering is started again)
  useEffect(() => {
    return watchServer(trip.id);
  }, [trip.id]);
  // the app's own run (no server) stops with the screen
  useEffect(() => () => stopPrepare(), [trip.id]);
  const redo = useRedoing(trip.id);
  if (!d) return null;
  // a single day prepared again keeps the review on screen; the whole preparation has its own screen
  if (d.status === "preparing" && !redo) return <Preparing onClose={onClose} />;
  return <Review onClose={onClose} />;
}

function Preparing({ onClose }: { onClose: () => void }) {
  const trip = useTrip();
  const d = draftOf(trip.id)!;
  const run = useDraftRun(trip.id);
  const now = useClock(5000);
  const onServer = run.mode === "server";
  // working now: the app's own run, or the server (its lease is fresh), or the server being asked to start
  const serverOn = serverBusy(trip.id, now) || serverStarting(trip.id);
  const busy = run.busy || serverOn;
  const elsewhere = !busy && preparedElsewhere(trip.id) && d.lease?.by !== "server";
  const [stopping, setStopping] = useState(false);
  const [stopErr, setStopErr] = useState<string | null>(null);
  const days = trip.days.filter((x) => x.scheduled && x.dates?.length);
  const stateOf = (x: (typeof days)[number]) => d.days?.[x.dates![0]];
  const done = days.filter((x) => stateOf(x) === "done").length;
  const pct = Math.round(((d.outline ? 1 : 0) + (d.essentials ? 1 : 0) + done) / (days.length + 2) * 100);
  const liveIdx = days.findIndex((x) => stateOf(x) !== "done" && stateOf(x) !== "error");
  const onDays = !!d.outline && !!d.essentials;
  // what is already on the map, read from the trip itself (also right after a resume, when this run counted nothing yet)
  const keys = new Set(days.map((x) => x.key));
  const placedByDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const p of trip.places) if (keys.has(p.day) && p.type !== "hotel") m.set(p.day, [...(m.get(p.day) || []), p.name]);
    return m;
  }, [trip.places]); // eslint-disable-line react-hooks/exhaustive-deps
  const placed = [...placedByDay.values()].reduce((n, l) => n + l.length, 0);
  // found without a position: kept in « Pistes » to be placed by hand (lib/draft.ts)
  const defs = useStore((s) => s.data.defs);
  const toPlace = trip.places.filter((p) => p.day === "ideas" && (defs[p.id] as { fromDraft?: string } | undefined)?.fromDraft).length;
  const found = Math.max(run.found, placed + toPlace);
  const shown = Math.max(run.placed, placed);
  const themeOf = (x: (typeof days)[number]) => d.outline?.find((o) => o.date === x.dates![0])?.theme || x.theme || x.title;
  // the step in progress: the app's own run says it; the server writes a code in its lease. On the days, the theme
  // only (the counter and the list already say which day)
  const serverStep = (() => {
    const code = d.lease?.by === "server" ? d.lease.step || "" : "";
    if (code === "outline") return t("Trame du voyage");
    if (code === "essentials") return t("L'essentiel pratique");
    const m = /^(?:day|place):(.+)$/.exec(code);
    const x = m ? days.find((y) => y.dates?.[0] === m[1]) : undefined;
    return x ? themeOf(x) : "";
  })();
  const step = run.busy ? run.step : serverOn ? serverStep : "";
  const phase = (k: 0 | 1 | 2) => {
    const ok = k === 0 ? !!d.outline : k === 1 ? !!d.essentials : done === days.length;
    if (ok) return "done";
    const first = k === 0 || (k === 1 ? !!d.outline : onDays);
    return first && busy ? "live" : "";
  };
  const stopped = !busy && !!(run.err || d.error);
  const awake = useWakeLock(run.busy);
  const cities = d.cities.map((c) => c.name);
  const facts = [
    days.length > 1 ? t("{n} jours", { n: days.length }) : t("{n} jour", { n: days.length }),
    cities.length > 1 ? t("{n} villes", { n: cities.length }) : "",
    trip.flights.length ? (trip.flights.length > 1 ? t("{n} vols", { n: trip.flights.length }) : t("1 vol")) : "",
    d.hotelText ? t("1 hôtel") : "",
    d.places.length ? (d.places.length > 1 ? t("{n} lieux de votre liste", { n: d.places.length }) : t("1 lieu de votre liste")) : "",
    d.fixed.length ? (d.fixed.length > 1 ? t("{n} réservations", { n: d.fixed.length }) : t("1 réservation")) : "",
  ].filter(Boolean).join(" · ");
  // where and when, set like a ticket: FLORENCE · 22–28 NOV.
  const where = [cities[0], shortRange(days[0]?.dates?.[0], days[days.length - 1]?.dates?.[0])].filter(Boolean).join(" · ");
  const state = busy ? "live" : elsewhere ? "away" : stopped ? "stop" : "pause";
  const stateLabel = busy ? t("En cours") : elsewhere ? t("Sur un autre appareil") : stopped ? t("Arrêtée") : t("En pause");
  const counter = onDays && days.length ? t("Jour {n} sur {of}", { n: Math.min(days.length, done + (done < days.length ? 1 : 0)), of: days.length }) : d.outline ? t("L'essentiel") : t("La trame");
  const stopNow = async () => {
    if (stopping) return;
    setStopping(true);
    setStopErr(null);
    try {
      const why = await reviewNow(trip.id);
      if (why) setStopErr(why);
    } finally {
      setStopping(false);
    }
  };
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onClose} aria-label={onServer ? t("Fermer (la préparation continue)") : t("Fermer (la préparation reprendra à votre retour)")}><CcClose /></button>
      <span className="dr-ttl">{t("Préparation")}</span>
      <span className="v3-tool ghost" />
    </div>
  );
  return (
    <Shell ring={false} top={top} className="dr-screen pp-screen">
      <div className="pp-grid">
        <div className="pp-aside-l">
          <div className="pp-head">
            <span className={"pp-state " + state}><i aria-hidden="true" />{stateLabel}</span>
            {where && <span className="pp-where">{where}</span>}
          </div>
          <p className="pp-pct" aria-hidden="true"><span key={pct} className="pp-num">{pct}</span><span className="pp-sign">%</span></p>
          <p className="sr" aria-live="polite">{t("{pct} %", { pct })}. {step}</p>
          <div className="pp-step">
            <b>{counter}</b>
            <span key={step}>{step || (stopped ? t("La préparation s'est arrêtée.") : " ")}</span>
          </div>
          <div className={"pp-rule" + (busy ? "" : " off")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Préparation")}>
            <i style={{ transform: `scaleX(${Math.max(0.02, pct / 100)})` }} />
          </div>
          <ol className="pp-phases">
            {[t("La trame"), t("L'essentiel"), t("Les jours")].map((label, k) => (
              <li key={k} className={phase(k as 0 | 1 | 2)}>
                <span className="pp-n">{String(k + 1).padStart(2, "0")}</span>
                <span className="pp-l">{label}</span>
                <span className="pp-mk" aria-hidden="true">{phase(k as 0 | 1 | 2) === "done" && <CcCheck />}</span>
              </li>
            ))}
          </ol>
          {/* the one promise of this screen, said where it is seen: only while the server is actually working */}
          {onServer && busy && !stopped && <p className="pp-promise">{t("La préparation continue sans vous : vous pouvez quitter cet écran ou fermer l'application. Nous vous prévenons dès que le programme est prêt.")}</p>}
          {stopped && !elsewhere && (
            <div className="pp-alert" role="alert">
              <p>{errText(run.err || d.error)}</p>
              <button type="button" onClick={() => void prepare(trip.id)}>{t("Reprendre la préparation")}</button>
            </div>
          )}
          {elsewhere && <p className="pp-aside">{t("Ce voyage est en cours de préparation sur un autre appareil.")}</p>}
        </div>

        <div className="pp-main">
          <h1 className="v3-d pp-title">{t("Nous préparons {title}.", { title: trip.title })}</h1>
          {facts && <p className="pp-facts">{facts}</p>}

          <dl className="pp-stats">
            <div><dt>{t("Lieux trouvés")}</dt><dd>{found || "—"}</dd></div>
            <div><dt>{t("Sur la carte")}</dt><dd>{shown || "—"}</dd></div>
            <div><dt>{t("À placer")}</dt><dd>{toPlace || "—"}</dd></div>
          </dl>

          <ol className="pp-days">
            {days.map((x, i) => {
              const s = stateOf(x);
              const st = s === "done" ? "done" : s === "error" ? "err" : i === liveIdx && busy && onDays ? "live" : "wait";
              const names = placedByDay.get(x.key) || [];
              return (
                <li key={x.key} className={st}>
                  <span className="pp-mk" aria-hidden="true">{st === "done" ? <CcCheck /> : st === "err" ? "!" : null}</span>
                  <span className="pp-when">{x.short}</span>
                  <span className="pp-what">
                    <b>{themeOf(x)}</b>
                    {st === "done" && names.length > 0 && <small>{names.slice(0, 3).join(" · ")}</small>}
                    {st === "err" && <small className="warn">{t("À reprendre")}</small>}
                  </span>
                  <span className="pp-cnt">{st === "done" && names.length ? names.length : ""}</span>
                </li>
              );
            })}
          </ol>
          {/* while it runs, looking now stops the day in progress: the link says so */}
          {done > 0 && done < days.length && (
            <button className="v3-link pp-review" disabled={stopping} onClick={() => void stopNow()}>
              {!busy ? t("Voir le programme avec ce qui est prêt") : done > 1 ? t("Arrêter et voir les {n} jours prêts", { n: done }) : t("Arrêter et voir le jour prêt")}
            </button>
          )}
          {stopErr && <p className="pp-err" role="alert">{stopErr}</p>}

          {/* the waiting time: invite who travels with you, add what comes to mind */}
          <section className="dr-meanwhile">
            <span className="v3-lbl">{t("Pendant ce temps")}</span>
            <InviteTravellers />
            {done < days.length && <AddWish />}
          </section>
          {run.mode === "local" && (
            <p className="dr-note"><CcBell /><span>{t("La préparation avance tant que cet écran reste ouvert. Si vous le quittez, elle reprendra là où elle s'est arrêtée à votre retour sur ce voyage.")}{awake && <> {t("L'écran reste allumé pendant la préparation.")}</>}</span></p>
          )}
        </div>
      </div>
      <div className="dr-end" />
    </Shell>
  );
}

/** "Une envie à ajouter ?": read by each day not prepared yet (the run reads the trip's draft before every day) */
function AddWish() {
  const trip = useTrip();
  const [v, setV] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const add = async () => {
    const s = v.trim().slice(0, 300);
    if (!s || sending || !draftOf(trip.id)) return;
    setSending(true);
    setErr(null);
    try {
      // not taken (the server did not answer): the wish stays in the field, to be sent again
      const why = await addWish(trip.id, s);
      if (why) {
        setErr(why);
        return;
      }
      setAdded((a) => [...a, s]);
      setV("");
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="pp-wish">
      <b>{t("Une envie à ajouter ?")}</b>
      <small>{t("Elle sera prise en compte pour les jours suivants.")}</small>
      <form onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <label className="pp-wish-field">
          <span className="sr">{t("Une envie à ajouter ?")}</span>
          <input value={v} onChange={(e) => setV(e.target.value)} placeholder={t("ex. un rooftop un soir")} autoComplete="off" maxLength={300} enterKeyHint="done" />
        </label>
        <button className="pp-wish-add" disabled={!v.trim() || sending}>{t("Ajouter")}</button>
      </form>
      {err && <p className="pp-err" role="alert">{err}</p>}
      {added.length > 0 && <ul className="pp-wish-added">{added.map((a, i) => <li key={i}><CcCheck />{a}</li>)}</ul>}
    </div>
  );
}

const IDEAS = ["Un jour plus calme", "Un rooftop un soir", "Plus de cuisine locale"];

function Review({ onClose }: { onClose: () => void }) {
  const trip = useTrip();
  const run = useDraftRun(trip.id);
  const draft = draftOf(trip.id);
  const days = trip.days.filter((x) => x.scheduled && x.dates?.length);
  const isMissing = (x: (typeof days)[number]) => draft?.days?.[x.dates![0]] !== "done";
  const missing = days.filter(isMissing).length;
  const [day, setDay] = useState(() => {
    const k = openDay.get(trip.id);
    return k && days.some((x) => x.key === k) ? k : days[0]?.key || "";
  });
  const redo = useRedoing(trip.id);
  // a free account (plan known, the trip not Pro): what validating changes, said before it (the rule itself is unchanged)
  const freePlan = useStore((s) => !!s.plan && !s.plan.pro);
  const tripPro = useTripHasPro(trip.id);
  const lockAhead = freePlan && !tripPro;
  // the day prepared again that did not come back ready: said on its card, with « Réessayer »
  const [redoFail, setRedoFail] = useState<{ date: string; msg: string } | null>(null);
  const [slide, setSlide] = useState(0);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmRedo, setConfirmRedo] = useState(false);
  const [final, setFinal] = useState(false);
  const tabs = useRef<HTMLDivElement>(null);
  const idx = days.findIndex((x) => x.key === day);
  const dd = days[idx];
  const slots = useMemo(
    () => trip.places.filter((p) => p.day === day).sort((a, b) => (parseTime(a.time) ?? 9999) - (parseTime(b.time) ?? 9999)),
    [trip.places, day],
  );
  const countOf = (k: string) => trip.places.filter((p) => p.day === k && p.type !== "hotel").length;
  const total = trip.places.filter((p) => days.some((x) => x.key === p.day)).length;
  // the "regenerate" confirmation goes away on its own
  useEffect(() => {
    if (!confirmRedo) return;
    const tm = window.setTimeout(() => setConfirmRedo(false), 4000);
    return () => window.clearTimeout(tm);
  }, [confirmRedo]);
  // the validation: a short, quiet moment, then the trip opens
  useEffect(() => {
    if (!final) return;
    const quick = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const tm = window.setTimeout(() => confirmTrip(trip.id), quick ? 350 : 1300);
    return () => window.clearTimeout(tm);
  }, [final, trip.id]);
  const choose = (k: string) => {
    const j = days.findIndex((x) => x.key === k);
    setSlide(j > idx ? 1 : -1);
    setDay(k);
    openDay.set(trip.id, k);
    setConfirmRedo(false);
    tabs.current?.querySelector<HTMLElement>(`[data-k="${k}"]`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  };
  /** Prepares the open day again, without leaving the review */
  const redoDay = async (date: string) => {
    if (run.busy || redo) return;
    setRedoFail(null);
    setRedoing({ tripId: trip.id, date });
    let refused: string | void = undefined;
    try {
      refused = await regenerateDay(trip.id, date);
    } finally {
      setRedoing(null);
    }
    const after = draftOf(trip.id);
    if (refused || after?.days?.[date] !== "done") {
      const err = after?.error && !/n'a pas pu être préparé|n'ont pas pu être préparés|could not be prepared|couldn't be prepared/i.test(after.error) ? errText(after.error) : "";
      setRedoFail({ date, msg: refused || err || t("Ce jour n'a pas pu être préparé. Ses lieux sont gardés.") });
    }
  };
  const adjust = async () => {
    if (!ask.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await adjustProgramme(ask.trim()));
      setAsk("");
    } catch (e) {
      setMsg(e instanceof AiError ? e.message : t("L'ajustement a échoué. Réessayez."));
    } finally {
      setBusy(false);
    }
  };
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onClose} aria-label={t("Fermer")}><CcClose /></button>
      <span className="dr-ttl">{t("Revue du programme")}</span>
      <span className="v3-tool ghost" />
    </div>
  );
  if (final) {
    return (
      <div className="dr-final" role="status" aria-live="assertive">
        <div>
          <span className="dr-final-mark" aria-hidden="true"><CcCheck /></span>
          <h2 className="v3-d">{trip.title}</h2>
          <p>{missing > 0 ? t("Votre voyage est ouvert.") : t("Votre voyage est prêt.")}</p>
          {missing > 0 && <small>{missing > 1 ? t("{n} jours restent libres.", { n: missing }) : t("1 jour reste libre.")}</small>}
        </div>
      </div>
    );
  }
  return (
    <Shell ring={false} top={top} className="dr-screen">
      <div className="v3-titlerow">
        <h1 className="v3-d v3-h2" style={{ margin: 0 }}>{trip.title}</h1>
        <span>{days.length > 1 ? t("{n} jours", { n: days.length }) : t("{n} jour", { n: days.length })} · {total > 1 ? t("{n} lieux", { n: total }) : t("{n} lieu", { n: total })}</span>
      </div>
      <p className="dr-intro">{t("Parcourez chaque jour. Régénérez-en un ou ajustez en une phrase, puis validez.")}</p>
      <div className="dr-tabs" role="tablist" aria-label={t("Jours du voyage")} ref={tabs}
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          const j = Math.max(0, Math.min(days.length - 1, idx + (e.key === "ArrowRight" ? 1 : -1)));
          if (days[j]) {
            choose(days[j].key);
            tabs.current?.querySelector<HTMLElement>(`[data-k="${days[j].key}"]`)?.focus();
          }
        }}>
        {days.map((x) => {
          const n = countOf(x.key);
          const miss = isMissing(x);
          return (
            <button key={x.key} data-k={x.key} role="tab" aria-selected={x.key === day} tabIndex={x.key === day ? 0 : -1} className={(x.key === day ? "on" : "") + (miss ? " miss" : "")} onClick={() => choose(x.key)}
              aria-label={`${longDay(x.dates?.[0])} · ${miss ? t("pas encore prêt") : n > 1 ? t("{n} lieux", { n }) : t("{n} lieu", { n })}`}>
              {x.short.split(" ")[0]}<b>{x.short.split(" ")[1] || ""}</b><small>{miss ? <i className="dr-hollow" aria-hidden="true" /> : n || "—"}</small>
            </button>
          );
        })}
      </div>
      <div className="v3-glass dr-daycard" role="tabpanel">
        <div className="dr-dayhead">
          <span className="t"><b>{dd?.theme || dd?.title}</b><small>{[longDay(dd?.dates?.[0]), dd?.theme ? dd?.title : ""].filter(Boolean).join(" · ")}</small></span>
        </div>
        <div className="dr-acts">
          <button className={"v3-chip" + (confirmRedo ? " warn" : "")} disabled={run.busy || !!redo || !dd}
            onClick={() => {
              if (!confirmRedo) return setConfirmRedo(true);
              const date = dd?.dates?.[0];
              setConfirmRedo(false);
              if (date) void redoDay(date);
            }}>
            <CcRefresh className="cc-ic s" />{redo && redo === dd?.dates?.[0] ? t("Préparation…") : confirmRedo ? t("Remplacer les lieux de ce jour ?") : t("Régénérer le jour")}
          </button>
        </div>
        {redo && redo === dd?.dates?.[0] && <p className="dr-redo" role="status">{t("En cours")} · {run.step || t("Préparation…")}</p>}
        {redo && redo !== dd?.dates?.[0] && <p className="dr-redo" role="status">{t("{day} est en préparation.", { day: longDay(redo) })}</p>}
        {!redo && redoFail && redoFail.date === dd?.dates?.[0] && (
          <p className="dr-redo err" role="alert">{redoFail.msg}<button type="button" disabled={run.busy} onClick={() => void redoDay(redoFail.date)}>{t("Réessayer")}</button></p>
        )}
        {!redo && dd && isMissing(dd) && slots.length > 0 && redoFail?.date !== dd.dates?.[0] && <p className="dr-redo">{t("Ce jour a été interrompu avant la fin. Préparez-le à nouveau ci-dessous.")}</p>}
        <div key={day} className="dr-slots" style={{ "--dx": `${slide * 22}px` } as CSSProperties}>
          {!slots.length && <p className="dr-empty">{dd && isMissing(dd) ? t("Ce jour n'est pas encore prêt. Préparez-le ci-dessous, ou régénérez-le.") : t("Aucun lieu ce jour-là.")}</p>}
          {slots.map((p) => {
            const [from, to] = (p.time || "").split("–");
            return (
              <div key={p.id} className="dr-slot">
                <span className="dr-tm">{from || "—"}{to && <small>{to}</small>}</span>
                <span className="bd">
                  <b>{p.name}</b>
                  {(p.why || p.desc) && <small>{p.why || p.desc}</small>}
                  <span className="dr-kind" style={{ "--c": dd?.color } as CSSProperties}>{t(TYPE_LABEL[p.type] || p.type)}</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="v3-paste dr-adjust">
        <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={2} placeholder={t("Ajuster en une phrase : « samedi un peu plus calme », « un rooftop un soir »…")} aria-label={t("Ajuster le programme")}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void adjust(); } }} />
        <div className="v3-paste-bar">
          <span className="v3-grow v3-note" style={{ margin: 0 }}>{busy ? t("Ajustement en cours…") : ""}</span>
          <button type="button" className="v3-chip on" disabled={busy || !ask.trim()} onClick={() => void adjust()}>{t("Ajuster")}</button>
        </div>
      </div>
      {!ask && !busy && <div className="dr-ideas">{IDEAS.map((s) => <button key={s} type="button" onClick={() => setAsk(t(s))}>{t(s)}</button>)}</div>}
      {msg && !busy && <p className="dr-msg" role="status">{msg}</p>}
      {missing > 0 && !run.busy && !redo && (
        <button className="v3-btn ghost" style={{ marginTop: 12 }} onClick={() => void prepareAgain(trip.id)}>
          {missing === 1 ? t("Préparer le jour manquant") : t("Préparer les {n} jours manquants", { n: missing })}
        </button>
      )}
      <InviteTravellers />
      <div className="v3-spacer" />
      <div className="dr-foot">
        <p>{missing > 0 ? (missing > 1 ? t("{n} jours ne sont pas encore prêts.", { n: missing }) : t("1 jour n'est pas encore prêt.")) : t("Tout est prêt.")}</p>
        {lockAhead && <p className="dr-lock"><span className="pro-tag">PRO</span> {t("Après validation, le programme ne se modifie plus qu'avec Pro. Notes, photos, dépenses, check-list et partage restent libres.")}</p>}
        <button className="v3-btn" disabled={run.busy || !!redo} onClick={() => setFinal(true)}><CcSpark />{t("Valider le voyage")}</button>
      </div>
    </Shell>
  );
}
