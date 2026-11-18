import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { adjustProgramme, confirmTrip, draftOf, prepare, preparedElsewhere, regenerateDay, reviewNow, stopPrepare, useDraftRun } from "../../lib/draft";
import { AiError } from "../../lib/ai";
import { parseTime } from "../../lib/time";
import { useStore, useTrip } from "../../lib/store";
import { TYPE_LABEL } from "../../data/trip";
import Shell from "./Shell";
import InviteTravellers from "./InviteTravellers";
import { getState, updateTrip } from "../../lib/store";
import { locale, t } from "../../lib/i18n";
import { CcBell, CcCheck, CcClose, CcRefresh, CcSpark, ConciergeOrbit } from "./ConciergeIcons";
import "../../styles/creation.css";

/** The days not prepared yet are prepared from the review (the review comes back after) */
async function prepareMissing(tripId: string) {
  const d = getState().trips[tripId]?.draft as Record<string, unknown> | undefined;
  if (!d) return;
  updateTrip(tripId, { draft: { ...d, status: "preparing", error: undefined } });
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
  // the preparation starts (or resumes) as soon as this screen shows, and stops when it closes
  useEffect(() => {
    if (d?.status !== "preparing") return;
    const t = window.setTimeout(() => {
      if (!run.busy && !run.err) void prepare(trip.id);
    }, 50);
    return () => window.clearTimeout(t);
  }, [trip.id, d?.status]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const elsewhere = !run.busy && preparedElsewhere(trip.id);
  const days = trip.days.filter((x) => x.scheduled && x.dates?.length);
  const stateOf = (x: (typeof days)[number]) => d.days?.[x.dates![0]];
  const done = days.filter((x) => stateOf(x) === "done").length;
  const pct = Math.round(((d.outline ? 1 : 0) + (d.essentials ? 1 : 0) + done) / (days.length + 2) * 100);
  const liveIdx = days.findIndex((x) => stateOf(x) !== "done");
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
  const phase = (k: 0 | 1 | 2) => {
    const ok = k === 0 ? !!d.outline : k === 1 ? !!d.essentials : done === days.length;
    if (ok) return "done";
    const first = k === 0 || (k === 1 ? !!d.outline : onDays);
    return first && run.busy ? "live" : "";
  };
  const stopped = !!(run.err || d.error);
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
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onClose} aria-label={t("Fermer (la préparation reprendra à votre retour)")}><CcClose /></button>
      <span className="dr-ttl">{t("Préparation")}</span>
      <span className="v3-tool ghost" />
    </div>
  );
  return (
    <Shell ring={false} top={top} className="dr-screen">
      <div className="v3-orb dr-orb" aria-hidden="true">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" strokeOpacity=".12" />
          <g className="v3-spin"><ellipse cx="100" cy="100" rx="96" ry="30" transform="rotate(-18 100 100)" fill="none" stroke="currentColor" strokeOpacity=".5" /><circle cx="191" cy="70" r="3.5" fill="currentColor" /></g>
          <g className="v3-spin rev"><ellipse cx="100" cy="100" rx="70" ry="22" transform="rotate(24 100 100)" fill="none" stroke="currentColor" strokeOpacity=".22" /></g>
        </svg>
        <span className="v3-pct">
          <b>{t("{pct} %", { pct })}</b>
          <small>{run.busy ? (onDays && days.length ? t("Jour {n} sur {of}", { n: Math.min(days.length, done + (done < days.length ? 1 : 0)), of: days.length }) : t("La trame")) : elsewhere ? t("Sur un autre appareil") : stopped ? t("Arrêtée") : t("En pause")}</small>
        </span>
      </div>
      <p className="sr" aria-live="polite">{t("{pct} %", { pct })}. {run.step}</p>
      <h1 className="v3-d dr-h">{t("Nous préparons {title}.", { title: trip.title })}</h1>
      <p className="dr-facts">{facts}</p>

      <div className={"dr-bar" + (stopped && !run.busy ? " off" : "")} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Préparation")}><i style={{ width: `${Math.max(3, pct)}%` }} /></div>
      {stopped && !run.busy && !elsewhere && (
        <p className="dr-stop" role="alert">{t("La préparation s'est arrêtée.")}<button type="button" onClick={() => void prepare(trip.id)}>{t("Reprendre")}</button></p>
      )}
      <div className="dr-phases">
        <span className={"dr-phase " + phase(0)}><i><CcCheck /></i><span>{t("La trame")}</span></span>
        <span className={"dr-phase " + phase(1)}><i><CcCheck /></i><span>{t("L'essentiel")}</span></span>
        <span className={"dr-phase " + phase(2)}><i><CcCheck /></i><span>{t("Les jours · {n}/{of}", { n: done, of: days.length })}</span></span>
      </div>
      {run.busy && run.step && <p key={run.step} className="dr-now">{t("En cours")} · <b>{run.step}</b></p>}

      <div className="v3-glass v3-days dr-days">
        {days.map((x, i) => {
          const s = stateOf(x);
          const st = s === "done" ? "done" : s === "error" ? "err" : i === liveIdx && run.busy && onDays ? "live" : "wait";
          const names = placedByDay.get(x.key) || [];
          return (
            <div key={x.key} className={"v3-day " + st}>
              <span className="v3-st">{st === "done" ? <CcCheck /> : st === "err" ? "!" : ""}</span>
              <span className="v3-when">{x.short}</span>
              <span className="dr-dl">
                {d.outline?.find((o) => o.date === x.dates![0])?.theme || x.theme || x.title}
                {st === "done" && names.length > 0 && <small><b>{names.length > 1 ? t("{n} lieux", { n: names.length }) : t("{n} lieu", { n: names.length })}</b> · {names.slice(0, 3).join(" · ")}</small>}
                {st === "err" && <small>{t("À reprendre")}</small>}
              </span>
            </div>
          );
        })}
      </div>
      <div className="v3-count">
        <div><span className="v3-lbl">{t("Lieux trouvés")}</span><b>{found || "—"}</b></div>
        <div><span className="v3-lbl">{t("Placés sur la carte")}</span><b>{shown || "—"}</b></div>
      </div>
      {elsewhere && <p className="v3-note" style={{ textAlign: "center" }}>{t("Ce voyage est en cours de préparation sur un autre appareil.")}</p>}
      {(run.err || d.error) && !run.busy && (
        <div className="v3-glass" style={{ padding: 14, marginTop: 12 }}>
          <p className="v3-err" style={{ marginTop: 0 }}>{run.err || d.error}</p>
          <button className="v3-btn ghost" style={{ marginTop: 10 }} onClick={() => void prepare(trip.id)}>{t("Reprendre la préparation")}</button>
        </div>
      )}
      {/* while it runs, looking now stops the day in progress: the link says so */}
      {done > 0 && done < days.length && (
        <button className="v3-link" style={{ marginTop: 12 }} onClick={() => reviewNow(trip.id)}>
          {!run.busy ? t("Voir le programme avec ce qui est prêt") : done > 1 ? t("Arrêter et voir les {n} jours prêts", { n: done }) : t("Arrêter et voir le jour prêt")}
        </button>
      )}

      {/* the waiting time: invite who travels with you, add what comes to mind */}
      <section className="dr-meanwhile">
        <span className="v3-lbl">{t("Pendant ce temps")}</span>
        <InviteTravellers />
        {done < days.length && <AddWish />}
      </section>
      <p className="dr-note"><CcBell /><span>{t("La préparation avance tant que cet écran reste ouvert. Si vous le quittez, elle reprendra là où elle s'est arrêtée à votre retour sur ce voyage.")}{awake && <> {t("L'écran reste allumé pendant la préparation.")}</>}</span></p>
      <div className="dr-end" />
    </Shell>
  );
}

/** "Une envie à ajouter ?": read by each day not prepared yet (the run reads the trip's draft before every day) */
function AddWish() {
  const trip = useTrip();
  const [v, setV] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const add = () => {
    const s = v.trim().slice(0, 300);
    const d = draftOf(trip.id);
    if (!s || !d) return;
    updateTrip(trip.id, { draft: { ...d, wishes: [...d.wishes, s] } });
    setAdded((a) => [...a, s]);
    setV("");
  };
  return (
    <div className="v3-glass dr-add">
      <b>{t("Une envie à ajouter ?")}</b>
      <small>{t("Elle sera prise en compte pour les jours suivants.")}</small>
      <form onSubmit={(e) => { e.preventDefault(); add(); }}>
        <label className="v3-field">
          <span className="sr">{t("Une envie à ajouter ?")}</span>
          <input value={v} onChange={(e) => setV(e.target.value)} placeholder={t("ex. un rooftop un soir")} autoComplete="off" maxLength={300} enterKeyHint="done" />
        </label>
        <button className="v3-chip on" disabled={!v.trim()}>{t("Ajouter")}</button>
      </form>
      {added.length > 0 && <div className="dr-added">{added.map((a, i) => <span key={i}><CcCheck />{a}</span>)}</div>}
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
    try {
      await regenerateDay(trip.id, date);
    } finally {
      setRedoing(null);
    }
    const after = draftOf(trip.id);
    if (after?.days?.[date] !== "done") {
      const err = after?.error && !/n'a pas pu être préparé|n'ont pas pu être préparés|could not be prepared|couldn't be prepared/i.test(after.error) ? after.error : "";
      setRedoFail({ date, msg: err || t("Ce jour n'a pas pu être préparé. Ses lieux sont gardés.") });
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
          <span className="dr-final-mark" aria-hidden="true"><ConciergeOrbit thin w={40} h={24} /></span>
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
        <button className="v3-btn ghost" style={{ marginTop: 12 }} onClick={() => { const dd0 = draftOf(trip.id); if (dd0) void prepareMissing(trip.id); }}>
          {missing === 1 ? t("Préparer le jour manquant") : t("Préparer les {n} jours manquants", { n: missing })}
        </button>
      )}
      <InviteTravellers />
      <div className="v3-spacer" />
      <div className="dr-foot">
        <p>{missing > 0 ? (missing > 1 ? t("{n} jours ne sont pas encore prêts.", { n: missing }) : t("1 jour n'est pas encore prêt.")) : t("Tout est prêt.")}</p>
        <button className="v3-btn" disabled={run.busy || !!redo} onClick={() => setFinal(true)}><CcSpark />{t("Valider le voyage")}</button>
      </div>
    </Shell>
  );
}
