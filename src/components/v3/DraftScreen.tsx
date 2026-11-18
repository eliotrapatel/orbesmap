import { useEffect, useMemo, useState } from "react";
import { adjustProgramme, confirmTrip, draftOf, prepare, preparedElsewhere, regenerateDay, reviewNow, stopPrepare, useDraftRun } from "../../lib/draft";
import { AiError } from "../../lib/ai";
import { parseTime } from "../../lib/time";
import { useStore, useTrip } from "../../lib/store";
import Shell from "./Shell";
import { getState, updateTrip } from "../../lib/store";
import { t } from "../../lib/i18n";

/** The days not prepared yet are prepared from the review (the review comes back after) */
async function prepareMissing(tripId: string) {
  const d = getState().trips[tripId]?.draft as Record<string, unknown> | undefined;
  if (!d) return;
  updateTrip(tripId, { draft: { ...d, status: "preparing", error: undefined } });
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
  if (!d) return null;
  if (d.status === "preparing") return <Preparing onClose={onClose} />;
  return <Review onClose={onClose} />;
}

function Preparing({ onClose }: { onClose: () => void }) {
  const trip = useTrip();
  const d = draftOf(trip.id)!;
  const run = useDraftRun(trip.id);
  const elsewhere = !run.busy && preparedElsewhere(trip.id);
  const days = trip.days.filter((x) => x.scheduled && x.dates?.length);
  const done = days.filter((x) => d.days?.[x.dates![0]] === "done").length;
  const pct = Math.round(((d.outline ? 1 : 0) + (d.essentials ? 1 : 0) + done) / (days.length + 2) * 100);
  const liveIdx = days.findIndex((x) => d.days?.[x.dates![0]] !== "done");
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onClose} aria-label={t("Fermer")}>✕</button>
      <span className="v3-grow" style={{ textAlign: "center", color: "var(--soft)", fontSize: 13 }}>{t("Préparation")}</span>
      <span className="v3-tool ghost" />
    </div>
  );
  return (
    <Shell ring={false} top={top}>
      <div className="v3-orb" aria-hidden="true">
        <svg viewBox="0 0 200 200">
          <circle cx="100" cy="100" r="92" fill="none" stroke="currentColor" strokeOpacity=".12" />
          <g className="v3-spin"><ellipse cx="100" cy="100" rx="96" ry="30" transform="rotate(-18 100 100)" fill="none" stroke="currentColor" strokeOpacity=".5" /><circle cx="191" cy="70" r="3.5" fill="currentColor" /></g>
          <g className="v3-spin rev"><ellipse cx="100" cy="100" rx="70" ry="22" transform="rotate(24 100 100)" fill="none" stroke="currentColor" strokeOpacity=".22" /></g>
        </svg>
        <span className="v3-pct"><b>{t("{pct} %", { pct })}</b><small>{run.step || (run.busy ? "…" : elsewhere ? t("Sur un autre appareil") : t("En pause"))}</small></span>
      </div>
      <p className="sr" aria-live="polite">{t("{pct} %", { pct })}. {run.step}</p>
      <h1 className="v3-d v3-h2" style={{ textAlign: "center", fontSize: 30 }}>{t("Nous préparons {title}.", { title: trip.title })}</h1>
      <div className="v3-glass v3-days">
        {days.map((x, i) => {
          const st = d.days?.[x.dates![0]] === "done" ? "done" : d.days?.[x.dates![0]] === "error" ? "err" : i === liveIdx && run.busy && d.outline && d.essentials ? "live" : "wait";
          return (
            <div key={x.key} className={"v3-day " + st}>
              <span className="v3-st">{st === "done" ? "✓" : st === "err" ? "!" : ""}</span>
              <span className="v3-when">{x.short}</span>
              <span className="v3-grow">{d.outline?.find((o) => o.date === x.dates![0])?.theme || x.theme || x.title}</span>
            </div>
          );
        })}
      </div>
      <div className="v3-count">
        <div><span className="v3-lbl">{t("Lieux trouvés")}</span><b>{run.found || "—"}</b></div>
        <div><span className="v3-lbl">{t("Placés sur la carte")}</span><b>{run.placed || "—"}</b></div>
      </div>
      {elsewhere && <p className="v3-note" style={{ textAlign: "center" }}>{t("Ce voyage est en cours de préparation sur un autre appareil.")}</p>}
      {(run.err || d.error) && !run.busy && (
        <div className="v3-glass" style={{ padding: 14, marginTop: 12 }}>
          <p className="v3-err" style={{ marginTop: 0 }}>{run.err || d.error}</p>
          <button className="v3-btn ghost" style={{ marginTop: 10 }} onClick={() => void prepare(trip.id)}>{t("Reprendre la préparation")}</button>
        </div>
      )}
      {!run.busy && done > 0 && <button className="v3-link" style={{ marginTop: 10 }} onClick={() => reviewNow(trip.id)}>{t("Voir le programme avec ce qui est prêt")}</button>}
      <div className="v3-spacer" />
      <p className="v3-note" style={{ textAlign: "center" }}>{t("Gardez l'app ouverte. Si elle se ferme, la préparation reprend là où elle s'est arrêtée.")}</p>
    </Shell>
  );
}

function Review({ onClose }: { onClose: () => void }) {
  const trip = useTrip();
  const run = useDraftRun(trip.id);
  const missing = trip.days.filter((x) => x.scheduled && x.dates?.length && draftOf(trip.id)?.days?.[x.dates[0]] !== "done").length;
  const days = trip.days.filter((x) => x.scheduled && x.dates?.length);
  const [day, setDay] = useState(days[0]?.key || "");
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const dd = days.find((x) => x.key === day);
  const slots = useMemo(
    () => trip.places.filter((p) => p.day === day).sort((a, b) => (parseTime(a.time) ?? 9999) - (parseTime(b.time) ?? 9999)),
    [trip.places, day],
  );
  const total = trip.places.filter((p) => days.some((x) => x.key === p.day)).length;
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
      <button className="v3-tool" onClick={onClose} aria-label={t("Fermer")}>✕</button>
      <span className="v3-grow" style={{ textAlign: "center", color: "var(--soft)", fontSize: 13 }}>{t("Revue du programme")}</span>
      <span className="v3-tool ghost" />
    </div>
  );
  return (
    <Shell ring={false} top={top}>
      <div className="v3-titlerow">
        <h1 className="v3-d v3-h2" style={{ margin: 0 }}>{trip.title}</h1>
        <span>{days.length > 1 ? t("{n} jours", { n: days.length }) : t("{n} jour", { n: days.length })} · {total > 1 ? t("{n} lieux", { n: total }) : t("{n} lieu", { n: total })}</span>
      </div>
      <div className="v3-dsel" role="tablist">
        {days.map((x) => (
          <button key={x.key} role="tab" aria-selected={x.key === day} className={x.key === day ? "on" : ""} onClick={() => setDay(x.key)}>
            {x.short.split(" ")[0]}<b>{x.short.split(" ")[1] || ""}</b>
          </button>
        ))}
      </div>
      <div className="v3-glass v3-daycard">
        <div className="v3-dayhead">
          <span className="v3-grow"><b className="v3-d">{dd?.theme || dd?.title}</b>{dd?.theme && <small>{dd.title}</small>}</span>
          <button className="v3-chip" disabled={run.busy} onClick={() => { const date = dd?.dates?.[0]; if (date) void regenerateDay(trip.id, date); }}>{run.busy ? t("Préparation…") : t("↻ Régénérer le jour")}</button>
        </div>
        {!slots.length && <p className="v3-note">{t("Aucun lieu ce jour-là.")}</p>}
        {slots.map((p) => (
          <div key={p.id} className="v3-slot">
            <span className="v3-tm">{p.time ? p.time.split("–")[0] : "—"}</span>
            <span className="v3-grow"><b>{p.name}</b><small>{p.why || p.desc}</small></span>
          </div>
        ))}
      </div>
      <div className="v3-paste" style={{ marginTop: 12 }}>
        <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={2} placeholder={t("Ajuster en une phrase : « samedi un peu plus calme », « un rooftop un soir »…")} aria-label={t("Ajuster le programme")} />
        <div className="v3-paste-bar">
          <span className="v3-grow v3-note" style={{ margin: 0 }}>{busy ? t("Ajustement en cours…") : msg}</span>
          <button type="button" className="v3-chip on" disabled={busy || !ask.trim()} onClick={() => void adjust()}>{t("Ajuster")}</button>
        </div>
      </div>
      {missing > 0 && !run.busy && (
        <button className="v3-btn ghost" style={{ marginTop: 12 }} onClick={() => { const dd0 = draftOf(trip.id); if (dd0) void prepareMissing(trip.id); }}>
          {missing === 1 ? t("Préparer le jour manquant") : t("Préparer les {n} jours manquants", { n: missing })}
        </button>
      )}
      <div className="v3-spacer" />
      <button className="v3-btn" disabled={run.busy} onClick={() => confirmTrip(trip.id)}>{t("Valider le voyage ✓")}</button>
    </Shell>
  );
}
