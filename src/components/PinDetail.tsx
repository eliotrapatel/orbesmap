import { useState } from "react";
import { amapDirections, googleDirections } from "../lib/geo";
import type { Pin } from "../lib/model";
import { deletePin, toast, updatePin } from "../lib/store";
import { IBack, ICopy, INav, IPin, ITrash } from "./Icons";
import { Modal, SavedInput, copy } from "./ui";

export default function PinDetail({ pin, onBack }: { pin: Pin; onBack: () => void }) {
  const coords = `${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}`;
  return (
    <article style={{ paddingBottom: 28 }}>
      <div className="detail-top">
        <button className="icon-btn" onClick={onBack} aria-label="Retour à la liste">
          <IBack />
        </button>
        <button
          className="icon-btn"
          aria-label="Supprimer ce lieu"
          onClick={() => {
            if (confirm(`Supprimer « ${pin.name} » ?`)) {
              deletePin(pin.id);
              toast("Lieu supprimé");
              onBack();
            }
          }}
        >
          <ITrash />
        </button>
      </div>
      <header className="hero">
        <div className="hero-kicker">
          <span className="dot" style={{ ["--c" as string]: "#000" }} />
          Mon lieu
        </div>
        <h2>{pin.name}</h2>
        <div className="hero-time">{coords}</div>
      </header>
      <div className="actions">
        <a className="action" href={amapDirections(pin)} target="_blank" rel="noopener">
          <INav /> Amap
        </a>
        <a className="action" href={googleDirections(pin)} target="_blank" rel="noopener">
          <IPin /> Google Maps
        </a>
        <button className="action" onClick={() => copy(coords, "Coordonnées copiées", toast)}>
          <ICopy /> Copier
        </button>
      </div>
      <section className="sec">
        <h4>Nom</h4>
        <SavedInput value={pin.name} onSave={(v) => v.trim() && updatePin(pin.id, { name: v.trim() })} />
      </section>
      <section className="sec">
        <h4>Notes</h4>
        <SavedInput multiline value={pin.note || ""} placeholder="Stand, contact, prix…" onSave={(v) => updatePin(pin.id, { note: v })} />
      </section>
    </article>
  );
}

export function PinForm({ onClose, onSave }: { onClose: () => void; onSave: (name: string, note: string) => void }) {
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  return (
    <Modal title="Ajouter un lieu" intro="Il apparaîtra sur la carte et dans « Mes lieux »." onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim(), note.trim());
        }}
      >
        <label className="field">
          <span>Nom</span>
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Fournisseur vu au salon" />
        </label>
        <label className="field">
          <span>Note</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. stand A12, contact Lily" />
        </label>
        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" className="btn dark" disabled={!name.trim()}>
            Ajouter
          </button>
        </div>
      </form>
    </Modal>
  );
}
