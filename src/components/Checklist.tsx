import { useMemo, useState } from "react";
import type { Trip } from "../data/types";
import { uid } from "../lib/model";
import { toast, updateRecord, useStore } from "../lib/store";
import { ICheck, IPlus, ITrash } from "./Icons";

type Item = { id: string; text: string; due?: string; group?: string; owner?: string; done?: boolean; deleted?: boolean; custom?: boolean; order?: number };
const OWNERS = [
  { key: "eliot", label: "Eliot" },
  { key: "papa", label: "Papa" },
  { key: "both", label: "Les deux" },
];
const fmtDue = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/** Shared departure checklist: who does what before when. Synced live between Eliot and his father. */
export function useChecklist(trip: Trip) {
  const places = useStore((s) => s.data.places) as Record<string, Record<string, unknown>>;
  return useMemo(() => {
    const rec = (id: string) => places[`_check:${id}`] || {};
    const seeds: Item[] = (trip.checklist || []).map((c, i) => ({ ...c, order: i, ...(rec(c.id) as Partial<Item>) }));
    const custom: Item[] = Object.entries(places)
      .filter(([k, v]) => k.startsWith("_check:") && v.custom)
      .map(([k, v]) => ({ ...(v as Partial<Item>), id: k.slice(7), text: String(v.text || ""), custom: true, order: Number(v.order) || 1000 }));
    return [...seeds, ...custom].filter((i) => !i.deleted && i.text);
  }, [places, trip.checklist]);
}

export default function Checklist({ trip }: { trip: Trip }) {
  const items = useChecklist(trip);
  const [text, setText] = useState("");
  const [who, setWho] = useState<string>("all");
  const today = new Date().toISOString().slice(0, 10);
  const left = items.filter((i) => !i.done);
  const shown = items.filter((i) => who === "all" || i.owner === who || (who !== "all" && i.owner === "both"));
  const groups = [...new Set(shown.map((i) => i.group || "Ajouts"))];

  const add = () => {
    const t = text.trim();
    if (!t) return;
    updateRecord(`_check:${uid()}`, { text: t, custom: true, order: 1000 + items.length });
    setText("");
    toast("Ajouté à la check-list");
  };

  return (
    <div>
      <div className="ck-head">
        <div>
          <b>{left.length ? `${left.length} à faire` : "Tout est prêt"}</b>
          <span>{items.length - left.length} / {items.length} faites · partagée avec votre père</span>
        </div>
        <div className="bar"><span style={{ width: `${items.length ? ((items.length - left.length) / items.length) * 100 : 0}%` }} /></div>
      </div>
      <div className="seg" role="group" aria-label="Filtrer par personne" style={{ margin: "14px 0 6px" }}>
        {[{ key: "all", label: "Tout" }, ...OWNERS.slice(0, 2)].map((o) => (
          <button key={o.key} className={who === o.key ? "on" : ""} style={{ ["--c" as string]: "var(--ink)" }} aria-pressed={who === o.key} onClick={() => setWho(o.key)}>{o.label}</button>
        ))}
      </div>
      {groups.map((g) => (
        <section key={g} className="ck-group">
          <span className="label">{g}</span>
          {shown
            .filter((i) => (i.group || "Ajouts") === g)
            .sort((a, b) => Number(!!a.done) - Number(!!b.done) || (a.due || "9").localeCompare(b.due || "9") || (a.order ?? 0) - (b.order ?? 0))
            .map((i) => {
              const late = !i.done && i.due && i.due < today;
              return (
                <div key={i.id} className={"ck-item" + (i.done ? " done" : "")}>
                  <button className="ck-box" role="checkbox" aria-checked={!!i.done} aria-label={i.text} onClick={() => updateRecord(`_check:${i.id}`, { done: !i.done })}>
                    {i.done && <ICheck />}
                  </button>
                  <div className="ck-main">
                    <span className="ck-text">{i.text}</span>
                    <span className="ck-meta">
                      {i.due && <em className={late ? "late" : ""}>{late ? "En retard · " : "Avant le "}{fmtDue(i.due)}</em>}
                      <select
                        aria-label="Qui s'en occupe"
                        value={i.owner || ""}
                        onChange={(e) => updateRecord(`_check:${i.id}`, { owner: e.target.value || null })}
                      >
                        <option value="">Personne</option>
                        {OWNERS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                      </select>
                    </span>
                  </div>
                  <button className="icon-btn" aria-label="Retirer" onClick={() => updateRecord(`_check:${i.id}`, { deleted: true })}><ITrash /></button>
                </div>
              );
            })}
        </section>
      ))}
      <form className="ck-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ajouter une tâche…" aria-label="Nouvelle tâche" />
        <button className="btn primary" disabled={!text.trim()}><IPlus /> Ajouter</button>
      </form>
    </div>
  );
}
