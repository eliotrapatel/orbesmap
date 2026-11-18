import { useState } from "react";
import { TYPE_LABEL } from "../data/trip";
import type { Place, PlaceType, Trip } from "../data/types";
import type { Hours } from "../lib/hours";
import { hhmm } from "../lib/live";
import { getState, toast, updateDef } from "../lib/store";
import { Modal } from "./ui";
import { t } from "../lib/i18n";

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
/** fields of the sheet an AI update can be undone for: editing one by hand keeps the hand version */
const PREV_KEYS = ["desc", "highlights", "tip", "metro", "website", "hours", "duration", "type", "nameCn", "address", "addressCn", "price", "source"];

type Form = {
  name: string; nameCn: string; type: PlaceType; address: string; addressCn: string; metro: string; website: string; desc: string;
  highlights: string; tip: string; price: string; duration: string;
  open: string; close: string; lastEntry: string; closed: number[]; reservation: string; hoursNote: string;
};

/** Edits every field of a place's sheet by hand (any place: from the first programme or added) */
export default function EditSheet({ trip, place, onClose, onMovePoint }: { trip: Trip; place: Place; onClose: () => void; onMovePoint?: () => void }) {
  // everything is compared with the sheet as it was when the window opened: a change made meanwhile
  // (AI update, the other phone) is never written over unless the same field was edited here
  const [start] = useState(() => {
    const h0 = trip.hours?.[place.id];
    const def = getState().data.defs[place.id] || {};
    const form: Form = {
      name: place.name,
      nameCn: place.nameCn || "",
      type: place.type,
      address: place.address,
      addressCn: typeof def.addressCn === "string" ? def.addressCn : place.cn,
      metro: place.metro || "",
      website: place.website || "",
      desc: place.desc,
      highlights: place.highlights.join("\n"),
      tip: place.tip || "",
      price: place.price || "",
      duration: place.duration ? String(place.duration) : "",
      open: hhmm(h0?.open),
      close: hhmm(h0?.close),
      lastEntry: hhmm(h0?.lastEntry),
      closed: [...(h0?.closed || [])].sort(),
      reservation: h0?.reservation || "",
      hoursNote: h0?.note || "",
    };
    return { form, h0 };
  });
  const [f, setF] = useState<Form>(start.form);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const hotel = place.type === "hotel";
  const types = (Object.keys(TYPE_LABEL) as PlaceType[]).filter((t) => t !== "hotel" || hotel);
  const durOk = !f.duration.trim() || (/^\d+$/.test(f.duration.trim()) && +f.duration >= 10 && +f.duration <= 600);
  const timesOk = [f.open, f.close, f.lastEntry].every((t) => !t.trim() || !!hhmm(t));

  /** What changed in the form, as record fields */
  const patchOf = (): Record<string, unknown> => {
    const s = start.form;
    const patch: Record<string, unknown> = {};
    for (const k of ["name", "nameCn", "address", "addressCn", "metro", "desc", "tip", "price"] as const) {
      if (f[k].trim() !== s[k].trim()) patch[k] = f[k].trim();
    }
    if (f.website.trim() !== s.website.trim()) {
      const w = f.website.trim();
      patch.website = w && !/^https?:\/\//i.test(w) ? `https://${w}` : w;
    }
    if (f.type !== s.type) patch.type = f.type;
    if (f.highlights !== s.highlights) patch.highlights = f.highlights.split("\n").map((x) => x.trim()).filter(Boolean);
    if (f.duration.trim() !== s.duration.trim() && durOk) patch.duration = f.duration.trim() ? +f.duration : null;
    const hoursKeys = ["open", "close", "lastEntry", "reservation", "hoursNote"] as const;
    const hoursTouched = hoursKeys.some((k) => f[k].trim() !== s[k].trim()) || [...f.closed].sort().join() !== s.closed.join();
    if (hoursTouched) {
      const h0 = start.h0;
      const timesEdited = f.open !== s.open || f.close !== s.close;
      const hours: Hours = {
        always: h0?.always || false,
        closed: [...f.closed].sort(),
        open: hhmm(f.open),
        close: hhmm(f.close),
        lastEntry: hhmm(f.lastEntry),
        breaks: h0?.breaks || [],
        // hours typed here replace the per-day hours (they would otherwise silently win)
        byDay: timesEdited ? [] : h0?.byDay || [],
        reservation: f.reservation.trim(),
        confidence: timesEdited && hhmm(f.open) && hhmm(f.close) ? "sûr" : h0?.confidence || "probable",
        note: f.hoursNote.trim(),
      };
      patch.hours = hours;
    }
    // a field corrected by hand is no longer undone by "Revenir à la fiche d'avant la mise à jour"
    const prev = getState().data.defs[place.id]?.prevSheet as Record<string, unknown> | undefined;
    if (prev && Object.keys(patch).some((k) => PREV_KEYS.includes(k) && k in prev)) {
      const rest = Object.fromEntries(Object.entries(prev).filter(([k]) => !(k in patch)));
      patch.prevSheet = Object.keys(rest).some((k) => k !== "at") ? rest : null;
    }
    return patch;
  };

  const save = (close = true) => {
    if (!f.name.trim() || !timesOk) return false;
    const patch = patchOf();
    if (Object.keys(patch).length) {
      if (!updateDef(place.id, patch)) return false;
      toast(t("Fiche enregistrée"));
    }
    if (close) onClose();
    return true;
  };

  const field = (label: string, k: keyof Form, opts: { area?: boolean; ph?: string; zh?: boolean; mode?: "url" | "numeric" } = {}) => (
    <label className="field">
      <span>{label}</span>
      {opts.area ? (
        <textarea className="input" rows={k === "desc" ? 4 : 3} value={f[k] as string} placeholder={opts.ph} onChange={(e) => set(k, e.target.value as never)} />
      ) : (
        <input className="input" value={f[k] as string} placeholder={opts.ph} lang={opts.zh ? "zh-CN" : undefined} inputMode={opts.mode} onChange={(e) => set(k, e.target.value as never)} />
      )}
    </label>
  );
  const time = (label: string, k: "open" | "close" | "lastEntry") => (
    <label className="field">
      <span>{label}</span>
      <input className="input" value={f[k]} inputMode="numeric" placeholder="10:00" onChange={(e) => set(k, e.target.value)} aria-invalid={!!f[k].trim() && !hhmm(f[k])} />
    </label>
  );

  return (
    <Modal title={t("Modifier la fiche")} intro={place.name} onClose={onClose} className="modal-edit">
      <form onSubmit={(e) => { e.preventDefault(); save(); }}>
        {field(t("Nom"), "name")}
        {field(t("Nom chinois"), "nameCn", { zh: true })}
        <label className="field">
          <span>{t("Genre")}</span>
          <select className="input" value={f.type} onChange={(e) => set("type", e.target.value as PlaceType)} disabled={hotel}>
            {types.map((ty) => <option key={ty} value={ty}>{t(TYPE_LABEL[ty])}</option>)}
          </select>
        </label>
        {field(t("Adresse"), "address")}
        {field(t("Adresse chinoise (pour le chauffeur)"), "addressCn", { zh: true })}
        {onMovePoint && !hotel && (
          // what was typed is saved first, then the point is placed on the map
          <button type="button" className="btn-sm" onClick={() => save(false) && onMovePoint()}>{t("Déplacer le point sur la carte")}</button>
        )}
        {field(t("Métro"), "metro", { ph: t("Ligne 2 – Station (中文), sortie 3") })}
        {field(t("Site"), "website", { mode: "url", ph: "https://" })}
        {field(t("Description"), "desc", { area: true })}
        {field(t("Points forts (un par ligne)"), "highlights", { area: true })}
        {field(t("Conseil"), "tip", { area: true })}
        {field(t("Prix"), "price")}
        {field(t("Durée de visite (minutes)"), "duration", { mode: "numeric", ph: t("ex. 45") })}
        {!durOk && <p className="hb-issue warn">{t("Entre 10 et 600 minutes.")}</p>}

        <div className="ed-hours">
          <span className="label">{t("Horaires")}</span>
          <div className="ed-times">
            {time(t("Ouvre"), "open")}
            {time(t("Ferme"), "close")}
            {time(t("Dernière entrée"), "lastEntry")}
          </div>
          <p className="em-small">{t("Heures sur 24 h ; après minuit : 25:30 pour 1h30.")}{start.h0?.byDay.length ? ` ${t("Des horaires différents selon les jours sont notés : changer l'ouverture ou la fermeture les remplace.")}` : ""}</p>
          {!timesOk && <p className="hb-issue warn">{t("Heure illisible : écrivez par exemple 10:00 ou 22:30.")}</p>}
          <div className="ed-closed" role="group" aria-label={t("Jours de fermeture")}>
            <span>{t("Fermé le")}</span>
            {WEEK.map((d) => {
              const on = f.closed.includes(d);
              return (
                <button key={d} type="button" className={"fchip" + (on ? " on" : "")} aria-pressed={on} onClick={() => set("closed", on ? f.closed.filter((x) => x !== d) : [...f.closed, d])}>
                  {t(SHORT[d])}
                </button>
              );
            })}
          </div>
          {field(t("Réservation"), "reservation", { ph: t("ex. obligatoire sur WeChat, 7 jours avant") })}
          {field(t("Précision sur les horaires"), "hoursNote")}
        </div>

        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={!f.name.trim() || !timesOk || !durOk}>{t("Enregistrer")}</button>
        </div>
      </form>
    </Modal>
  );
}
