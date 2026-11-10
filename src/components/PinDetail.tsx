import { useState } from "react";
import { amapDirections, googleDirections } from "../lib/geo";
import type { Pin } from "../lib/model";
import { deletePin, toast, updatePin } from "../lib/store";
import { IBack, ICopy, INav, IPin, ITrash } from "./Icons";
import { Modal, SavedInput, copy } from "./ui";

export default function PinDetail({ pin, onBack, sheetH }: { pin: Pin; onBack: () => void; sheetH?: string }) {
  const coords = `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`;
  return (
    <section className="detail glass" style={{ ["--c" as string]: "#f6f2ea", ...(sheetH ? { ["--sheet-h" as string]: sheetH } : {}) }} aria-label={pin.name}>
      <div className="sheet-grip" data-grip aria-hidden="true" />
      <div className="detail-scroll scroll" style={{ flex: 1, minHeight: 0, paddingBottom: 28 }}>
        <header className="detail-hero">
          <div className="detail-actions">
            <button className="icon-btn" onClick={onBack} aria-label="Fermer la fiche"><IBack /></button>
            <button className="icon-btn" aria-label="Supprimer ce lieu" onClick={() => { if (confirm(`Supprimer « ${pin.name} » ?`)) { deletePin(pin.id); toast("Lieu supprimé"); onBack(); } }}><ITrash /></button>
          </div>
          <div className="kicker"><span className="sdot" /><span className="label">Mon lieu</span></div>
          <h2>{pin.name}</h2>
          <div className="sub"><span>{coords}</span></div>
        </header>
        <div className="actions" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          <a className="action" href={amapDirections(pin)} target="_blank" rel="noopener"><INav /> Amap</a>
          <a className="action" href={googleDirections(pin)} target="_blank" rel="noopener"><IPin /> Google</a>
          <button className="action" onClick={() => copy(coords, "Coordonnées copiées", toast)}><ICopy /> Copier</button>
        </div>
        <div className="sec">
          <span className="label">Nom</span>
          <SavedInput value={pin.name} onSave={(v) => v.trim() && updatePin(pin.id, { name: v.trim() })} />
        </div>
        <div className="sec">
          <span className="label">Notes</span>
          <SavedInput multiline value={pin.note || ""} placeholder="Stand, contact, prix…" onSave={(v) => updatePin(pin.id, { note: v })} />
        </div>
      </div>
    </section>
  );
}

export function PinForm({ onClose, onSave }: { onClose: () => void; onSave: (name: string, note: string) => void }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  return (
    <Modal title="Ajouter un lieu" intro="Il apparaîtra sur la carte et dans « Mes lieux »." onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name.trim(), note.trim()); }}>
        <label className="field"><span>Nom</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Boutique vue en passant" /></label>
        <label className="field"><span>Note</span><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. demander Lily, 2e étage" /></label>
        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={!name.trim()}>Ajouter</button>
        </div>
      </form>
    </Modal>
  );
}
