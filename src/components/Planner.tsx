import { useMemo, useState } from "react";
import type { Day, Place, Trip } from "../data/types";
import { checkVisit } from "../lib/hours";
import type { PlaceState } from "../lib/model";
import { durationOf, fitAll, overlaps, rangeOf, slotText, type DayFit } from "../lib/slots";
import { toast, updatePlace } from "../lib/store";
import { formatMinutes } from "../lib/geo";
import { parseTime } from "../lib/time";
import { Modal } from "./ui";

const LENGTHS = [30, 45, 60, 90, 120];

const dayLabel = (d?: Day) => (d ? (d.dates?.[0] ? `${d.short} · ${d.theme || d.title}` : d.title) : "");

/** Puts a place in the programme: the best slot of each day, another time, or no time (Sorties, Pistes…) */
export function placeAt(place: Place, day: string, slot: string, trip: Trip) {
  // back to the programme's day and slot (same times): the place simply follows the programme again, with its notes
  const o = place.orig ? rangeOf(place.orig.time) : null;
  const n = rangeOf(slot);
  const same = !!place.orig && place.orig.day === day && (place.orig.time === slot || (!!o && !!n && o.start === n.start && o.end === n.end));
  if (same) updatePlace(place.id, { day: null, slot: null });
  else updatePlace(place.id, { day, slot });
  const d = trip.days.find((x) => x.key === day);
  toast(`« ${place.name} » : ${d?.dates?.[0] ? d.short : d?.title || ""}${slot ? `, ${slot}` : ", sans heure"}`);
}

export function fitLine(f: Extract<DayFit, { ok: true }>): string {
  if (f.tight) return `journée pleine : ${f.clash ? `empiète de ${f.tight} min sur ${f.clash}` : "trajets très serrés"}${f.guessed ? " · horaires à vérifier" : ""}`;
  const where = f.after && f.before ? `entre ${f.after} et ${f.before}` : f.after ? `après ${f.after}` : f.before ? `avant ${f.before}` : "journée libre";
  return `${where} · ${f.extra <= 0 ? "sur le chemin" : `+${formatMinutes(f.extra)} de trajet`}${f.guessed ? " · horaires à vérifier" : ""}`;
}

export default function Planner({ trip, place, states, onClose }: { trip: Trip; place: Place; states: Record<string, PlaceState>; onClose: () => void }) {
  const [dur, setDur] = useState(() => durationOf(place));
  const { fits, best } = useMemo(() => fitAll(trip, place, states, dur), [trip, place, states, dur]);
  const scheduled = trip.days.filter((d) => d.scheduled && d.dates?.length);
  const loose = trip.days.filter((d) => !d.scheduled && d.key !== "base");
  const [manDay, setManDay] = useState(() => (scheduled.some((d) => d.key === place.day) ? place.day : best?.day.key || scheduled[0]?.key || ""));
  const [manTime, setManTime] = useState(() => {
    // only a planned slot pre-fills the time (in Sorties / Pistes the text is opening hours)
    const t = trip.days.some((d) => d.key === place.day && d.scheduled) ? parseTime(place.time) : null;
    return t != null ? `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}` : "";
  });
  const lengths = LENGTHS.includes(dur) ? LENGTHS : [...LENGTHS, dur].sort((a, b) => a - b);
  const manStart = parseTime(manTime);
  const manDayObj = trip.days.find((d) => d.key === manDay);
  const clash = manStart != null && manDay ? overlaps(trip, manDay, states, place, manStart, dur) : [];
  const issues = manStart != null && manDayObj ? checkVisit(trip.hours?.[place.id], manDayObj.dates?.[0], manStart).filter((x) => x.tone !== "info") : [];
  const timed = parseTime(place.time) != null && scheduled.some((d) => d.key === place.day);
  const appt = states[place.id]?.appt;
  const done = (day: string, slot: string) => {
    placeAt(place, day, slot, trip);
    onClose();
  };

  return (
    <Modal title={`Placer « ${place.name} »`} intro="Pour chaque jour, le meilleur créneau libre selon ce qui est déjà prévu, les trajets et les horaires du lieu." onClose={onClose} className="modal-plan">
      <div className="pl-len" role="group" aria-label="Durée sur place">
        <span className="label">Sur place</span>
        {lengths.map((m) => (
          <button key={m} type="button" className={"fchip" + (dur === m ? " on" : "")} aria-pressed={dur === m} onClick={() => setDur(m)}>
            {formatMinutes(m)}
          </button>
        ))}
      </div>

      <div className="pl-days">
        {fits.map((f) => {
          const current = timed && place.day === f.day.key;
          return f.ok ? (
            <button key={f.day.key} type="button" className={"pl-day" + (best && best.day.key === f.day.key ? " best" : "") + (f.tight ? " tight" : "")} style={{ ["--c" as string]: f.day.color }} onClick={() => done(f.day.key, slotText(f.start, f.end))}>
              <span className="pl-d"><i />{f.day.short}</span>
              <span className="pl-main">
                <b>
                  {slotText(f.start, f.end)}
                  {best && best.day.key === f.day.key && <em className="pl-tag">{f.tight ? "Le moins serré" : "Conseillé"}</em>}
                  {current && <em className="pl-tag soft">Jour actuel</em>}
                </b>
                <small>{fitLine(f)}</small>
              </span>
            </button>
          ) : (
            <div key={f.day.key} className="pl-day off" style={{ ["--c" as string]: f.day.color }}>
              <span className="pl-d"><i />{f.day.short}</span>
              <span className="pl-main"><small>{f.reason}</small></span>
            </div>
          );
        })}
      </div>

      <div className="pl-sec">
        <span className="label">Autre heure</span>
        <div className="pl-man">
          <select className="input" value={manDay} onChange={(e) => setManDay(e.target.value)} aria-label="Jour">
            {scheduled.map((d) => <option key={d.key} value={d.key}>{dayLabel(d)}</option>)}
          </select>
          <input className="input" type="time" step={300} value={manTime} onChange={(e) => setManTime(e.target.value)} aria-label="Heure d'arrivée" />
        </div>
        {clash.map((b) => <p key={b.place.id} className="hb-issue warn">! Chevauche {b.place.name} ({slotText(b.start, b.end)})</p>)}
        {issues.map((x, i) => <p key={i} className={"hb-issue " + x.tone}>{x.tone === "bad" ? "⚠ " : "! "}{x.text}</p>)}
        <button type="button" className="btn-sm on" disabled={manStart == null || !manDay} onClick={() => manStart != null && done(manDay, slotText(manStart, manStart + dur))}>
          Placer à cette heure
        </button>
      </div>

      <div className="pl-sec">
        <span className="label">Sans heure</span>
        <div className="pl-loose">
          {scheduled.some((d) => d.key === place.day) && (
            <button type="button" className="btn-sm" onClick={() => done(place.day, "")}>Garder {trip.days.find((d) => d.key === place.day)?.short}, sans heure</button>
          )}
          {loose.map((d) => (
            <button key={d.key} type="button" className={"btn-sm" + (place.day === d.key ? " on" : "")} onClick={() => done(d.key, "")}>{d.title}</button>
          ))}
        </div>
      </div>

      {place.orig && (
        <div className="pl-sec">
          <button type="button" className="link-btn" onClick={() => { updatePlace(place.id, { day: null, slot: null }); toast(`« ${place.name} » revient au programme d'origine`); onClose(); }}>
            Revenir au programme d'origine : {trip.days.find((d) => d.key === place.orig!.day)?.short}{place.orig.time ? `, ${place.orig.time}` : ""}
          </button>
        </div>
      )}
      {appt && <p className="em-small">Un rendez-vous est noté sur la fiche ({appt}) : c'est lui qui fixe l'heure dans l'agenda.</p>}

      <div className="btn-row" style={{ gridTemplateColumns: "1fr" }}>
        <button type="button" className="btn" onClick={onClose}>Fermer</button>
      </div>
    </Modal>
  );
}
