import { useState } from "react";
import { TYPE_LABEL } from "../data/trip";
import type { Place, PlaceType, Trip } from "../data/types";
import type { Hours } from "../lib/hours";
import { hhmm } from "../lib/live";
import { toast, updateDef, useStore } from "../lib/store";
import { Modal } from "./ui";

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** "10:00" for an <input type=time> (24 h, two digits) */
const timeVal = (s?: string) => {
  const v = hhmm(s);
  return v && +v.slice(0, 2) < 24 ? v : "";
};

/** Edits every field of a place's sheet by hand (any place: from the first programme or added) */
export default function EditSheet({ trip, place, onClose, onMovePoint }: { trip: Trip; place: Place; onClose: () => void; onMovePoint?: () => void }) {
  const h0 = trip.hours?.[place.id];
  // the record's own Chinese address (the sheet shows the Chinese name when there is none)
  const def = useStore((s) => s.data.defs[place.id]);
  const cnAddr = typeof def?.addressCn === "string" ? def.addressCn : place.cn;
  const [f, setF] = useState({
    name: place.name,
    nameCn: place.nameCn || "",
    type: place.type,
    address: place.address,
    addressCn: cnAddr,
    metro: place.metro || "",
    website: place.website || "",
    desc: place.desc,
    highlights: place.highlights.join("\n"),
    tip: place.tip || "",
    price: place.price || "",
    duration: place.duration ? String(place.duration) : "",
    open: timeVal(h0?.open),
    close: timeVal(h0?.close),
    lastEntry: timeVal(h0?.lastEntry),
    closed: h0?.closed || [],
    reservation: h0?.reservation || "",
    hoursNote: h0?.note || "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const types = (Object.keys(TYPE_LABEL) as PlaceType[]).filter((t) => t !== "hotel" || place.type === "hotel");

  const save = () => {
    if (!f.name.trim()) return;
    const patch: Record<string, unknown> = {};
    const text = (k: string, v: string, cur: string | undefined) => {
      if (v.trim() !== (cur || "").trim()) patch[k] = v.trim();
    };
    text("name", f.name, place.name);
    text("nameCn", f.nameCn, place.nameCn);
    if (f.type !== place.type) patch.type = f.type;
    text("address", f.address, place.address);
    text("addressCn", f.addressCn, cnAddr);
    text("metro", f.metro, place.metro);
    text("website", f.website, place.website);
    text("desc", f.desc, place.desc);
    text("tip", f.tip, place.tip);
    text("price", f.price, place.price);
    const hl = f.highlights.split("\n").map((x) => x.trim()).filter(Boolean);
    if (hl.join("\n") !== place.highlights.join("\n")) patch.highlights = hl;
    const dur = parseInt(f.duration, 10);
    if ((Number.isFinite(dur) ? dur : undefined) !== place.duration) patch.duration = Number.isFinite(dur) && dur >= 10 && dur <= 600 ? dur : null;
    // opening hours: what was there, with the fields edited here
    const hours: Hours = {
      always: h0?.always || false,
      closed: [...f.closed].sort(),
      open: f.open,
      close: f.close,
      lastEntry: f.lastEntry,
      breaks: h0?.breaks || [],
      byDay: h0?.byDay || [],
      reservation: f.reservation.trim(),
      confidence: h0?.confidence || "probable",
      note: f.hoursNote.trim(),
    };
    const changed = !h0 ? hours.open || hours.close || hours.closed.length || hours.reservation || hours.note : JSON.stringify({ ...h0, closed: [...h0.closed].sort() }) !== JSON.stringify(hours);
    if (changed) patch.hours = { ...hours, confidence: hours.open && hours.close ? "sûr" : hours.confidence };
    if (Object.keys(patch).length) {
      updateDef(place.id, patch);
      toast("Fiche enregistrée");
    }
    onClose();
  };

  const field = (label: string, k: keyof typeof f, opts: { area?: boolean; ph?: string; zh?: boolean; mode?: "url" | "numeric" } = {}) => (
    <label className="field">
      <span>{label}</span>
      {opts.area ? (
        <textarea className="input" rows={k === "desc" ? 4 : 3} value={f[k] as string} placeholder={opts.ph} onChange={(e) => set(k, e.target.value as never)} />
      ) : (
        <input className="input" value={f[k] as string} placeholder={opts.ph} lang={opts.zh ? "zh-CN" : undefined} inputMode={opts.mode} onChange={(e) => set(k, e.target.value as never)} />
      )}
    </label>
  );

  return (
    <Modal title="Modifier la fiche" intro={place.name} onClose={onClose} className="modal-edit">
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        {field("Nom", "name")}
        {field("Nom chinois", "nameCn", { zh: true })}
        <label className="field">
          <span>Genre</span>
          <select className="input" value={f.type} onChange={(e) => set("type", e.target.value as PlaceType)}>
            {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </label>
        {field("Adresse", "address")}
        {field("Adresse chinoise (pour le chauffeur)", "addressCn", { zh: true })}
        {onMovePoint && (
          <button type="button" className="btn-sm" onClick={onMovePoint}>Déplacer le point sur la carte</button>
        )}
        {field("Métro", "metro", { ph: "Ligne 2 – Station (中文), sortie 3" })}
        {field("Site", "website", { mode: "url", ph: "https://" })}
        {field("Description", "desc", { area: true })}
        {field("Points forts (un par ligne)", "highlights", { area: true })}
        {field("Conseil", "tip", { area: true })}
        {field("Prix", "price")}
        {field("Durée de visite (minutes)", "duration", { mode: "numeric", ph: "ex. 45" })}

        <div className="ed-hours">
          <span className="label">Horaires</span>
          <div className="ed-times">
            <label className="field"><span>Ouvre</span><input className="input" type="time" value={f.open} onChange={(e) => set("open", e.target.value)} /></label>
            <label className="field"><span>Ferme</span><input className="input" type="time" value={f.close} onChange={(e) => set("close", e.target.value)} /></label>
            <label className="field"><span>Dernière entrée</span><input className="input" type="time" value={f.lastEntry} onChange={(e) => set("lastEntry", e.target.value)} /></label>
          </div>
          <div className="ed-closed" role="group" aria-label="Jours de fermeture">
            <span>Fermé le</span>
            {WEEK.map((d) => {
              const on = f.closed.includes(d);
              return (
                <button key={d} type="button" className={"fchip" + (on ? " on" : "")} aria-pressed={on} onClick={() => set("closed", on ? f.closed.filter((x) => x !== d) : [...f.closed, d])}>
                  {SHORT[d]}
                </button>
              );
            })}
          </div>
          {field("Réservation", "reservation", { ph: "ex. obligatoire sur WeChat, 7 jours avant" })}
          {field("Précision sur les horaires", "hoursNote")}
        </div>

        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={!f.name.trim()}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
