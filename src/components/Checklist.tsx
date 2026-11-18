import { useMemo, useState } from "react";
import type { Trip } from "../data/types";
import { uid } from "../lib/model";
import { toast, updateRecord, useCanEdit, useStore } from "../lib/store";
import { localDate } from "../lib/time";
import { ICheck, IPlus, ITrash } from "./Icons";
import { locale, t } from "../lib/i18n";
import { travellersOf } from "../lib/business";
import { track } from "../lib/track";

type Item = { id: string; text: string; due?: string; group?: string; owner?: string; done?: boolean; deleted?: boolean; custom?: boolean; order?: number };
/** Who an item is for: each traveller of the trip, or everyone (keys are the names in lower case: "eliot", "papa"…) */
const ownersOf = (trip: Trip) => {
  const people = travellersOf(trip);
  return [...people.map((p) => ({ key: p.toLowerCase(), label: p })), { key: "both", label: people.length > 2 ? "Tous" : "Les deux" }];
};
const fmtDue = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "short" });

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
  // readers of a shared trip see the list without changing it
  const canEdit = useCanEdit();
  const items = useChecklist(trip);
  useStore((s) => s.trips[trip.id]);
  const OWNERS = ownersOf(trip);
  const people = travellersOf(trip);
  const [text, setText] = useState("");
  const [who, setWho] = useState<string>("all");
  const today = localDate(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const places = useStore((s) => s.data.places) as Record<string, Record<string, unknown>>;
  const removed = Object.entries(places).filter(([k, v]) => k.startsWith("_check:") && v.deleted);
  const left = items.filter((i) => !i.done);
  const shown = items.filter((i) => who === "all" || i.owner === who || (who !== "all" && i.owner === "both"));
  const groups = [...new Set(shown.map((i) => i.group || "Ajouts"))];

  const add = () => {
    const txt = text.trim();
    if (!txt) return;
    updateRecord(`_check:${uid()}`, { text: txt, custom: true, order: 1000 + items.length, ...(who !== "all" ? { owner: who } : {}) });
    setText("");
    toast(t("Ajouté à la check-list"));
  };

  return (
    <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <div>
      <div className="ck-head">
        <div>
          <b>{left.length ? t("{n} à faire", { n: left.length }) : t("Tout est prêt")}</b>
          <span>{people.length > 1 ? t("{done} / {total} faites · partagée avec les voyageurs du voyage", { done: items.length - left.length, total: items.length }) : t("{done} / {total} faites", { done: items.length - left.length, total: items.length })}</span>
        </div>
        <div className="bar"><span style={{ width: `${items.length ? ((items.length - left.length) / items.length) * 100 : 0}%` }} /></div>
      </div>
      <div className="seg" role="group" aria-label={t("Filtrer par personne")} style={{ margin: "14px 0 6px" }}>
        {[{ key: "all", label: "Tout" }, ...OWNERS.slice(0, -1)].map((o) => (
          <button key={o.key} className={who === o.key ? "on" : ""} style={{ ["--c" as string]: "var(--ink)" }} aria-pressed={who === o.key} onClick={() => setWho(o.key)}>{t(o.label)}</button>
        ))}
      </div>
      {groups.map((g) => (
        <section key={g} className="ck-group">
          <span className="label">{t(g)}</span>
          {shown
            .filter((i) => (i.group || "Ajouts") === g)
            .sort((a, b) => Number(!!a.done) - Number(!!b.done) || (a.due || "9").localeCompare(b.due || "9") || (a.order ?? 0) - (b.order ?? 0))
            .map((i) => {
              const late = !i.done && i.due && i.due < today;
              return (
                <div key={i.id} className={"ck-item" + (i.done ? " done" : "")}>
                  <button className="ck-box" role="checkbox" aria-checked={!!i.done} aria-label={i.text} onClick={() => { updateRecord(`_check:${i.id}`, { done: !i.done }); if (!i.done) track("checklist_done", null, trip.id); }}>
                    {i.done && <ICheck />}
                  </button>
                  <div className="ck-main">
                    <span className="ck-text">{i.text}</span>
                    <span className="ck-meta">
                      {i.due && <em className={late ? "late" : ""}>{late ? t("En retard · {date}", { date: fmtDue(i.due) }) : t("Avant le {date}", { date: fmtDue(i.due) })}</em>}
                      <select
                        aria-label={t("Qui s'en occupe")}
                        value={i.owner || ""}
                        onChange={(e) => updateRecord(`_check:${i.id}`, { owner: e.target.value || null })}
                      >
                        <option value="">{t("Personne")}</option>
                        {OWNERS.map((o) => <option key={o.key} value={o.key}>{t(o.label)}</option>)}
                      </select>
                    </span>
                  </div>
                  <button
                    className="icon-btn"
                    aria-label={t("Retirer")}
                    onClick={() => {
                      if (!i.custom && !confirm(t("Retirer « {text} » de la check-list (pour vous deux) ?", { text: i.text }))) return;
                      updateRecord(`_check:${i.id}`, { deleted: true });
                      toast(t("Tâche retirée (restaurable en bas de la liste)"));
                    }}
                  >
                    <ITrash />
                  </button>
                </div>
              );
            })}
        </section>
      ))}
      {removed.length > 0 && (
        <button className="btn-sm" style={{ marginTop: 14 }} onClick={() => removed.forEach(([k]) => updateRecord(k, { deleted: false }))}>
          {removed.length === 1 ? t("1 tâche retirée · restaurer") : t("{n} tâches retirées · tout restaurer", { n: removed.length })}
        </button>
      )}
      <form className="ck-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Ajouter une tâche…")} aria-label={t("Nouvelle tâche")} />
        <button className="btn primary" disabled={!text.trim()}><IPlus /> {t("Ajouter")}</button>
      </form>
    </div>
    </fieldset>
  );
}
