import { useEffect, useMemo, useState } from "react";
import { adjustProgramme, confirmTrip, draftOf, prepare, regenerateDay, useDraftRun } from "../../lib/draft";
import { AiError } from "../../lib/ai";
import { parseTime } from "../../lib/time";
import { useStore, useTrip } from "../../lib/store";
import Shell from "./Shell";

/** A new trip being prepared by the AI (live progress), then its review (adjust, regenerate, confirm) */
export default function DraftScreen({ onClose }: { onClose: () => void }) {
  const trip = useTrip();
  useStore((s) => s.trips[trip.id]);
  const d = draftOf(trip.id);
  const run = useDraftRun();
  // the preparation starts (or resumes) as soon as this screen shows
  useEffect(() => {
    if (d?.status === "preparing" && !run.busy && !run.err) void prepare(trip.id);
  }, [trip.id, d?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return null;
  if (d.status === "preparing") return <Preparing onClose={onClose} />;
  return <Review onClose={onClose} />;
}

function Preparing({ onClose }: { onClose: () => void }) {
  const trip = useTrip();
  const d = draftOf(trip.id)!;
  const run = useDraftRun();
  const days = trip.days.filter((x) => x.scheduled && x.dates?.length);
  const done = days.filter((x) => d.days?.[x.dates![0]] === "done").length;
  const pct = Math.round(((d.outline ? 1 : 0) + (d.essentials ? 1 : 0) + done) / (days.length + 2) * 100);
  const liveIdx = days.findIndex((x) => d.days?.[x.dates![0]] !== "done");
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onClose} aria-label="Fermer">✕</button>
      <span className="v3-grow" style={{ textAlign: "center", color: "var(--soft)", fontSize: 13 }}>Préparation</span>
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
        <span className="v3-pct"><b>{pct} %</b><small>{run.step || (run.busy ? "…" : "En pause")}</small></span>
      </div>
      <h1 className="v3-d v3-h2" style={{ textAlign: "center", fontSize: 30 }}>Nous préparons {trip.title}.</h1>
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
        <div><span className="v3-lbl">Lieux trouvés</span><b>{run.found || "—"}</b></div>
        <div><span className="v3-lbl">Placés sur la carte</span><b>{run.placed || "—"}</b></div>
      </div>
      {(run.err || d.error) && !run.busy && (
        <div className="v3-glass" style={{ padding: 14, marginTop: 12 }}>
          <p className="v3-err" style={{ marginTop: 0 }}>{run.err || d.error}</p>
          <button className="v3-btn ghost" style={{ marginTop: 10 }} onClick={() => void prepare(trip.id)}>Reprendre la préparation</button>
        </div>
      )}
      <div className="v3-spacer" />
      <p className="v3-note" style={{ textAlign: "center" }}>Gardez l'app ouverte. Si elle se ferme, la préparation reprend là où elle s'est arrêtée.</p>
    </Shell>
  );
}

function Review({ onClose }: { onClose: () => void }) {
  const trip = useTrip();
  const run = useDraftRun();
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
      setMsg(e instanceof AiError ? e.message : "L'ajustement a échoué. Réessayez.");
    } finally {
      setBusy(false);
    }
  };
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onClose} aria-label="Fermer">✕</button>
      <span className="v3-grow" style={{ textAlign: "center", color: "var(--soft)", fontSize: 13 }}>Revue du programme</span>
      <span className="v3-tool ghost" />
    </div>
  );
  return (
    <Shell ring={false} top={top}>
      <div className="v3-titlerow">
        <h1 className="v3-d v3-h2" style={{ margin: 0 }}>{trip.title}</h1>
        <span>{days.length} jours · {total} lieux</span>
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
          <span className="v3-grow"><b className="v3-d">{dd?.theme || dd?.title}</b><small>{dd?.title}</small></span>
          <button className="v3-chip" disabled={run.busy} onClick={() => { const date = dd?.dates?.[0]; if (date) void regenerateDay(trip.id, date); }}>{run.busy ? "Préparation…" : "↻ Régénérer le jour"}</button>
        </div>
        {!slots.length && <p className="v3-note">Aucun lieu ce jour-là.</p>}
        {slots.map((p) => (
          <div key={p.id} className="v3-slot">
            <span className="v3-tm">{p.time ? p.time.split("–")[0] : "—"}</span>
            <span className="v3-grow"><b>{p.name}</b><small>{p.why || p.desc}</small></span>
          </div>
        ))}
      </div>
      <div className="v3-paste" style={{ marginTop: 12 }}>
        <textarea value={ask} onChange={(e) => setAsk(e.target.value)} rows={2} placeholder="Ajuster en une phrase : « samedi un peu plus calme », « un rooftop un soir »…" aria-label="Ajuster le programme" />
        <div className="v3-paste-bar">
          <span className="v3-grow v3-note" style={{ margin: 0 }}>{busy ? "Ajustement en cours…" : msg}</span>
          <button type="button" className="v3-chip on" disabled={busy || !ask.trim()} onClick={() => void adjust()}>Ajuster</button>
        </div>
      </div>
      <div className="v3-spacer" />
      <button className="v3-btn" disabled={run.busy} onClick={() => { confirmTrip(trip.id); onClose(); }}>Valider le voyage ✓</button>
    </Shell>
  );
}
