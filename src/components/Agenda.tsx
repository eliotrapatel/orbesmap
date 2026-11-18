import type { Place, Trip } from "../data/types";
import { formatMinutes, km, travelMinutes } from "../lib/geo";
import { exportIcs } from "../lib/ics";
import type { Pin, PlaceState } from "../lib/model";
import { dayStops, isHotel, stopTime } from "../lib/plan";
import { plural } from "../lib/fmt";
import { fmtDay, fmtMin, localDate } from "../lib/time";
import { checkVisit } from "../lib/hours";
import { ICalPlus, IClose, IMap, IRoute } from "./Icons";
import RemovedList, { removeFromProgramme } from "./RemovedList";
import { useCanEdit, hasPro, requestPro } from "../lib/store";
import { track } from "../lib/track";
import { t } from "../lib/i18n";
import { useState } from "react";
import { addComment, deleteComment, useComments } from "../lib/social";
import { ago } from "../lib/notes";
import { PhThumb } from "./PlacePhoto";

export default function Agenda({ trip, states, pins = [], onOpen, onOpenPin, onShowDay, onOptimize }: { trip: Trip; states: Record<string, PlaceState>; pins?: Pin[]; onOpen: (p: Place) => void; onOpenPin?: (p: Pin) => void; onShowDay: (d: string) => void; onOptimize: (d: string) => void }) {
  const canEdit = useCanEdit();
  // places added from a link / on the map, with the day chosen for them
  const pinDay = (p: Pin) => ((states as Record<string, Record<string, unknown>>)[`_pin:${p.id}`]?.day as string | undefined) || "";
  const today = localDate(trip.timezone);
  // alerts across the whole programme (closed days, last entry passed, opening later than planned)
  const alerts = trip.days
    .filter((d) => d.scheduled && (d.dates?.[d.dates.length - 1] ?? "") >= today)
    .flatMap((d) => dayStops(trip, d.key, states).filter((p) => !states[p.id]?.visited).map((p) => ({ d, p, x: checkVisit(trip.hours?.[p.id], d.dates?.[0], stopTime(p, states)).filter((i) => i.tone !== "info") })))
    .filter((a) => a.x.length);
  return (
    <div>
      {alerts.length > 0 && (
        <div className="ag-alerts">
          <b>{alerts.length === 1 ? t("1 visite à vérifier") : t("{n} visites à vérifier", { n: alerts.length })}</b>
          {alerts.map((a) => (
            <button key={a.d.key + ":" + a.p.id} onClick={() => onOpen(a.p)}>
              <span>{a.d.short} · {a.p.name}</span>
              <em className={a.x[0].tone}>{a.x[0].text}</em>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
        <button className="btn-sm" onClick={() => { if (!hasPro()) return requestPro("export"); track("export", "ics", trip.id); exportIcs(trip, states); }}>
          <ICalPlus /> {t("Ajouter à mon calendrier (.ics)")}
        </button>
      </div>
      {trip.days
        .filter((d) => d.scheduled)
        .map((d) => {
          const stops = dayStops(trip, d.key, states).filter((p) => !isHotel(trip, p));
          const first = d.dates?.[0];
          const last = d.dates && d.dates.length > 1 ? d.dates[d.dates.length - 1] : null;
          const isToday = d.dates?.includes(today);
          let prev: { lat: number; lng: number } = trip.hotel;
          let total = 0;
          let dist = 0;
          const legs = stops.map((p) => {
            const m = travelMinutes(prev, p);
            total += m;
            dist += km(prev, p);
            prev = p;
            return m;
          });
          const v = stops.filter((p) => states[p.id]?.visited).length;
          return (
            <section className="ag-day" key={d.key} style={{ ["--c" as string]: d.color }}>
              <div className="ag-head">
                {first && (
                  <div className="ag-date">
                    <b>{fmtDay(first, trip.timezone, { day: "numeric" })}{last ? `–${fmtDay(last, trip.timezone, { day: "numeric" })}` : ""}</b>
                    <span className="label">{fmtDay(first, trip.timezone, { weekday: "short" }).replace(".", "")}</span>
                  </div>
                )}
                <div className="ag-title">
                  <h4>
                    <i /> {d.title}
                    {isToday && <span className="pill live">{t("Aujourd'hui")}</span>}
                  </h4>
                  <p>
                    {d.theme}. {plural(stops.length, t("lieu"), t("lieux"))} · {v}/{stops.length} {v <= 1 ? t("visité") : t("visités")} · {t("~{time} de trajet ({km} km)", { time: formatMinutes(total), km: Math.round(dist) })}
                  </p>
                </div>
              </div>
              <div className="ag-btns">
                <button className="btn-sm" onClick={() => onShowDay(d.key)}>
                  <IMap /> {t("Voir sur la carte")}
                </button>
                {stops.length > 1 && (
                  <button className="btn-sm" onClick={() => onOptimize(d.key)}>
                    <IRoute /> {t("Meilleur ordre")}
                  </button>
                )}
              </div>
              {stops.map((p, i) => {
                const s = states[p.id] || {};
                const tm = stopTime(p, states);
                const issues = checkVisit(trip.hours?.[p.id], first, tm).filter((x) => x.tone !== "info" || x.booking);
                return (
                  <div className="ag-row" key={p.id}>
                  <button className={"ag-stop" + (i === 0 ? " first" : "") + (i === stops.length - 1 ? " last" : "")} onClick={() => onOpen(p)}>
                    <span className="ag-time">{tm != null ? fmtMin(tm) : "—"}</span>
                    <span className="ag-rail">
                      <span className={"ag-node" + (s.visited ? " done" : "")} />
                    </span>
                    <span className="ag-body has-th">
                      <PhThumb photo={p.photo} label={String(i + 1)} />
                      <span className="ag-txt">
                        <b>{p.name}</b>
                        <small>{s.appt ? t("RDV {appt}", { appt: s.appt }) : p.time}</small>
                        <span className="ag-leg">
                          {i === 0 ? t("Depuis l'hôtel : ~{time}", { time: formatMinutes(legs[i]) }) : t("Trajet : ~{time}", { time: formatMinutes(legs[i]) })}
                        </span>
                        {issues.map((x, k) => {
                          // reservation details are long: short label here, full text in the place sheet
                          const short = x.tone === "info" && x.text.length > 70 ? x.text.slice(0, 66).replace(/\s+\S*$/, "") + "…" : x.text;
                          return <span key={k} className={"ag-issue " + x.tone} title={x.text}>{x.tone === "bad" ? "⚠ " : x.tone === "warn" ? "! " : ""}{short}</span>;
                        })}
                      </span>
                    </span>
                  </button>
                  {canEdit && (
                    <button className="ag-x" aria-label={t("Retirer {name} du programme", { name: p.name })} title={t("Retirer du programme")} onClick={() => removeFromProgramme(p)}>
                      <IClose />
                    </button>
                  )}
                  </div>
                );
              })}
              {pins.filter((p) => pinDay(p) === d.key).length > 0 && (
                <div className="ag-pins">
                  <span className="label">{t("Ajoutés ce jour")}</span>
                  {pins.filter((p) => pinDay(p) === d.key).map((p) => (
                    <button key={p.id} className="btn-sm" onClick={() => onOpenPin?.(p)}>● {p.name}</button>
                  ))}
                </div>
              )}
              <DayComments day={d.key} canEdit={canEdit} />
            </section>
          );
        })}
      <RemovedList trip={trip} />
      <p style={{ fontSize: 12, color: "var(--mute)" }}>{t("Temps de trajet estimés en voiture. Une heure de rendez-vous saisie dans la fiche d'un lieu le replace dans la journée.")}</p>
    </div>
  );
}

/** The travellers' comments on a day (anyone who can edit the trip can write; each person deletes their own) */
function DayComments({ day, canEdit }: { day: string; canEdit: boolean }) {
  const list = useComments(day);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  if (!list.length && !canEdit) return null;
  return (
    <div className="ag-cmts">
      {list.map((c) => (
        <div key={c.id} className="ag-cmt">
          <b>{c.name}</b>
          <span className="ag-cmt-text">{c.text}</span>
          <small>{ago(c.at)}{c.mine && canEdit && <> · <button className="link-btn" onClick={() => { if (confirm(t("Supprimer ce commentaire ?"))) deleteComment(c.id); }}>{t("Supprimer")}</button></>}</small>
        </div>
      ))}
      {canEdit && (open || list.length > 0 ? (
        <form className="ag-cmt-form" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { addComment(day, text); setText(""); } }}>
          <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Commenter cette journée…")} maxLength={1000} aria-label={t("Commenter cette journée")} />
          <button className="btn-sm" disabled={!text.trim()}>{t("Envoyer")}</button>
        </form>
      ) : (
        <button className="link-btn ag-cmt-open" onClick={() => setOpen(true)}>{t("+ Commenter cette journée")}</button>
      ))}
    </div>
  );
}
