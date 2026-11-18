import { useState } from "react";
import type { Trip } from "../data/types";
import { amapDirections, googleDirections } from "../lib/geo";
import type { Pin } from "../lib/model";
import { currentAuthor, deletePin, toast, updatePin, updateRecord, useStore } from "../lib/store";
import { IBack, ICopy, IExpand, INav, IPin, ISpeaker, ITrash } from "./Icons";
import { Modal, SavedInput, ShowScreen, copy, speak, useEscape, useSheetDrag } from "./ui";
import Notes from "./Notes";
import { GoBlock } from "./Nav";
import type { Mode } from "../lib/route";
import { t } from "../lib/i18n";

export default function PinDetail({ trip, pin, onBack, onGo, sheetH }: { trip: Trip; pin: Pin; onBack: () => void; onGo: (m: Mode) => void; sheetH?: string }) {
  const coords = `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`;
  useEscape(onBack);
  const sheet = useSheetDrag(onBack, sheetH);
  const x = (useStore((s) => s.data.places[`_pin:${pin.id}`]) || {}) as Record<string, string>;
  const [show, setShow] = useState(false);
  const zh = [x.nameCn, x.addressCn].filter(Boolean).join("\n");
  const days = trip.days.filter((d) => d.key !== "base");
  return (
    <section ref={sheet.ref} className="detail glass" style={{ ["--c" as string]: "#f6f2ea", ...(sheetH ? { ["--sheet-h" as string]: sheetH } : {}) }} aria-label={pin.name}>
      <div className="sheet-grip" data-grip {...sheet.handlers} role="button" aria-label={t("Glisser vers le bas pour fermer, vers le haut pour agrandir")} />
      <div className="detail-scroll scroll" style={{ flex: 1, minHeight: 0, paddingBottom: 28 }}>
        <header className="detail-hero">
          <div className="detail-actions">
            <button className="icon-btn" onClick={onBack} aria-label={t("Fermer la fiche")}><IBack /></button>
            <button className="icon-btn" aria-label={t("Supprimer ce lieu")} onClick={() => { if (confirm(t("Supprimer « {name} » ?", { name: pin.name }))) { deletePin(pin.id); toast(t("Lieu supprimé")); onBack(); } }}><ITrash /></button>
          </div>
          <div className="kicker"><span className="sdot" /><span className="label">{t("Mon lieu")}</span></div>
          <h2>{pin.name}</h2>
          <div className="sub"><span>{x.nameCn || coords}</span></div>
        </header>
        {zh && (
          <button className="driver" onClick={() => setShow(true)} aria-label={t("Afficher l'adresse en grand pour le chauffeur")}>
            <div className="zh" lang="zh-CN">{x.addressCn || x.nameCn}</div>
            {x.address && <div className="en">{x.address}</div>}
            <div className="cta"><IExpand /> {t("Montrer au chauffeur")}</div>
          </button>
        )}
        <div className="actions" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <a className="action" href={amapDirections(pin)} target="_blank" rel="noopener"><INav /> Amap</a>
          <a className="action" href={googleDirections(pin)} target="_blank" rel="noopener"><IPin /> Google</a>
          {zh ? (
            <button className="action" onClick={() => speak(zh) || toast(t("Lecture vocale indisponible"))}><ISpeaker /> {t("Écouter")}</button>
          ) : (
            <button className="action" onClick={() => copy(coords, t("Coordonnées copiées"), toast)}><ICopy /> {t("Copier")}</button>
          )}
        </div>
        <GoBlock target={pin} onGo={onGo} />
        {(x.desc || x.why || x.hours || x.source || x.price) && (
          <div className="sec">
            <span className="label">{t("Le lieu")}</span>
            {x.desc && <p className="desc">{x.desc}</p>}
            {x.why && <p className="em-small">{t("Pourquoi : {why}", { why: x.why })}</p>}
            {x.hours && <p className="em-small">{t("Horaires : {hours}", { hours: x.hours })}</p>}
            {x.price && <p className="em-small">{t("Prix : {price}", { price: x.price })}</p>}
            {x.source && <p className="em-small"><a href={x.source} target="_blank" rel="noopener">{t("Source")}</a></p>}
          </div>
        )}
        <div className="sec">
          <span className="label">{t("Jour prévu")}</span>
          <select className="input" value={x.day || "ideas"} onChange={(e) => updateRecord(`_pin:${pin.id}`, { day: e.target.value })}>
            {days.map((d) => <option key={d.key} value={d.key}>{d.dates?.[0] ? `${d.short} · ${d.theme}` : d.title}</option>)}
          </select>
        </div>
        <div className="sec">
          <span className="label">{t("Nom")}</span>
          <SavedInput value={pin.name} onSave={(v) => v.trim() && updatePin(pin.id, { name: v.trim() })} />
        </div>
        <Notes
          rec={x as Record<string, unknown>}
          legacyText={pin.note}
          placeholder={t("Stand, contact, prix…")}
          onSave={(key, v) => {
            if (key === "note") {
              updatePin(pin.id, { note: v });
              updateRecord(`_pin:${pin.id}`, { noteBy: currentAuthor() });
            } else updateRecord(`_pin:${pin.id}`, { [key]: v });
          }}
        />
      </div>
      {show && <ShowScreen zh={zh} sub={x.address || pin.name} onClose={() => setShow(false)} />}
    </section>
  );
}

export function PinForm({ onClose, onSave }: { onClose: () => void; onSave: (name: string, note: string) => void }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  return (
    <Modal title={t("Ajouter un lieu")} intro={t("Il apparaîtra sur la carte et dans la liste (Pistes), avec sa fiche.")} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim(), note.trim()); }}>
        <label className="field"><span>{t("Nom")}</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ex. Boutique vue en passant")} /></label>
        <label className="field"><span>{t("Note ")}</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("ex. demander Lily, 2e étage")} /></label>
        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>{t("Ajouter")}</button>
        </div>
      </form>
    </Modal>
  );
}
