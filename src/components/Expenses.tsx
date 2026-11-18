import "../styles/expenses.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Trip } from "../data/types";
import {
  addExpense, categoryOf, deleteExpense, expenseKey, EXPENSE_CATEGORIES, localCurrency, money, receiptsOf, setTravellers, settle, symbolOf, toEur, travellersOf, updateExpense, useBusiness, useEurRate, useExpenses, useReceipts, type Expense,
} from "../lib/business";
import { exportExpenseCsv, exportExpenseReport, payersOf, reportLines } from "../lib/expenseReport";
import { locale, t } from "../lib/i18n";
import { addPhoto, deletePhoto, getState, hasPro, photoSrc, requestPro, toast, useCanEdit, useStore } from "../lib/store";
import { localDate } from "../lib/time";
import { track } from "../lib/track";
import { ICamera, IClose, IDownload } from "./Icons";
import { Lightbox, Modal, compressImage } from "./ui";

/** The trip's expenses: add one, totals in the local currency and in euros, who owes whom; per supplier in business mode */
export default function Expenses({ trip }: { trip: Trip }) {
  useStore((s) => s.trips[trip.id]);
  const list = useExpenses();
  const canEdit = useCanEdit();
  const business = useBusiness(trip);
  const local = localCurrency(trip);
  const rate = useEurRate(local);
  const rates = useMemo(() => ({ [local]: rate, EUR: 1 }), [local, rate]);
  const people = travellersOf(trip);
  const loc = locale();
  const known = list.filter((e) => e.currency === local || e.currency === "EUR");
  const totalEur = known.reduce((s, e) => s + (toEur(e, rates) ?? 0), 0);
  const totalLocal = local === "EUR" ? totalEur : list.filter((e) => e.currency === local).reduce((s, e) => s + e.amount, 0);
  const missingRate = list.some((e) => toEur(e, rates) == null);
  const { balances, moves } = settle(list, people, rates);
  const suppliers = trip.places.filter((p) => p.type !== "hotel" && p.type !== "transport");
  const byDay = useMemo(() => {
    const m = new Map<string, Expense[]>();
    for (const e of list) m.set(e.date, [...(m.get(e.date) || []), e]);
    return [...m];
  }, [list]);
  const [editing, setEditing] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [view, setView] = useState<string | null>(null);
  const dayName = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  };

  return (
    <div className="exp">
      <div className="exp-total">
        <span className="label">{t("Total du voyage")}</span>
        <b>{money(totalEur, "EUR", loc)}</b>
        {local !== "EUR" && <small>{money(totalLocal, local, loc)}{t(" en {cur}", { cur: local })}{rate ? ` · ${t("1 € = {r} {cur}", { r: rate.toLocaleString(loc, { maximumFractionDigits: 2 }), cur: symbolOf(local) })}` : ""}</small>}
        {missingRate && <small>{t("Taux de change indisponible hors connexion : certains montants ne sont pas comptés en euros.")}</small>}
      </div>

      {business && (
        <button className="btn block exp-report-btn" onClick={() => { if (!hasPro()) return requestPro("business"); setReport(true); }}>
          <IDownload /> {t("Note de frais")}
        </button>
      )}
      {report && <ExpenseReportSheet trip={trip} onClose={() => setReport(false)} />}
      {view && <Lightbox src={view} onClose={() => setView(null)} />}

      {list.length > 0 && (
        <div className="exp-cats">
          {EXPENSE_CATEGORIES.map((c) => {
            const sum = list.filter((e) => e.category === c.key).reduce((s, e) => s + (toEur(e, rates) ?? e.eur ?? 0), 0);
            return sum > 0 ? <span key={c.key} className="exp-cat">{c.icon} {t(c.label)} <b>{money(sum, "EUR", loc)}</b></span> : null;
          })}
        </div>
      )}

      <People trip={trip} people={people} canEdit={canEdit} />

      {people.length > 1 && list.length > 0 && (
        <div className="card exp-bal">
          <h4>{t("Qui doit quoi")}</h4>
          {people.map((p) => (
            <div key={p} className="exp-row">
              <span className="exp-grow">{p}</span>
              <span className={(balances[p] || 0) >= 0 ? "exp-plus" : "exp-minus"}>{(balances[p] || 0) >= 0 ? "+" : "−"}{money(Math.abs(balances[p] || 0), "EUR", loc)}</span>
            </div>
          ))}
          {moves.length ? (
            <div className="exp-moves">
              {moves.map((m, i) => <p key={i}>{t("{from} donne {amount} à {to}", { from: m.from, to: m.to, amount: money(m.eur, "EUR", loc) })}</p>)}
            </div>
          ) : (
            <p className="em-small">{t("Tout est équilibré.")}</p>
          )}
        </div>
      )}

      {canEdit && <AddForm trip={trip} people={people} local={local} business={business} suppliers={suppliers} />}

      {byDay.map(([day, items]) => (
        <div key={day} className="exp-day">
          <span className="label">{dayName(day)}</span>
          {items.map((e) => {
            const sup = e.placeId ? trip.places.find((p) => p.id === e.placeId) : undefined;
            const eur = toEur(e, rates);
            if (canEdit && editing === e.id) return <AddForm key={e.id} trip={trip} people={people} local={local} business={business} suppliers={suppliers} edit={e} onClose={() => setEditing(null)} />;
            const main = (
              <>
                <b>{categoryOf(e.category).icon} {e.label || t(categoryOf(e.category).label)}</b>
                <small>
                  {t("payé par {who}", { who: e.paidBy || "?" })}
                  {e.split.length && e.split.length < people.length ? ` · ${t("pour {list}", { list: e.split.join(", ") })}` : ""}
                  {sup ? ` · ${sup.name}` : ""}
                </small>
              </>
            );
            return (
              <div key={e.id} className="exp-item">
                {canEdit ? (
                  <button type="button" className="exp-grow exp-edit" aria-label={t("Modifier la dépense {label}", { label: e.label || t(categoryOf(e.category).label) })} onClick={() => setEditing(e.id)}>{main}</button>
                ) : (
                  <span className="exp-grow">{main}</span>
                )}
                <ReceiptThumbs id={e.id} onView={setView} />
                <span className="exp-amt">
                  <b>{money(e.amount, e.currency, loc)}</b>
                  {e.currency !== "EUR" && eur != null && <small>{money(eur, "EUR", loc)}</small>}
                </span>
                {canEdit && <button className="icon-btn" aria-label={t("Supprimer la dépense {label}", { label: e.label || "" })} onClick={() => { if (confirm(t("Supprimer cette dépense ?"))) { deleteExpense(e.id); receiptsOf(getState().data.photos, e.id).forEach((p) => deletePhoto(p.id)); toast(t("Dépense supprimée")); } }}>×</button>}
              </div>
            );
          })}
        </div>
      ))}
      {!list.length && <p className="empty">{t("Aucune dépense pour l'instant. Ajoutez la première : elle est partagée avec les voyageurs du voyage.")}</p>}
    </div>
  );
}

function People({ trip, people, canEdit }: { trip: Trip; people: string[]; canEdit: boolean }) {
  const [name, setName] = useState("");
  return (
    <div className="exp-people">
      <span className="label">{t("Voyageurs")}</span>
      <div className="exp-chips">
        {people.map((p) => (
          <span key={p} className="fchip on">
            {p}
            {canEdit && people.length > 1 && <button aria-label={t("Retirer {name}", { name: p })} onClick={() => setTravellers(trip, people.filter((x) => x !== p))}>×</button>}
          </span>
        ))}
        {canEdit && (
          <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) { setTravellers(trip, [...people, name.trim()]); setName(""); } }}>
            <input className="input exp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("+ Ajouter")} maxLength={30} aria-label={t("Ajouter un voyageur")} />
          </form>
        )}
      </div>
    </div>
  );
}

/** A receipt waiting to be saved with a new expense */
type Pending = { blob: Blob; url: string };

/** Adds an expense, or changes one (`edit`); a receipt can be photographed or picked in both cases */
function AddForm({ trip, people, local, business, suppliers, edit, onClose }: { trip: Trip; people: string[]; local: string; business: boolean; suppliers: Trip["places"]; edit?: Expense; onClose?: () => void }) {
  const today = localDate(trip.timezone);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(edit ? String(edit.amount).replace(".", ",") : "");
  const [currency, setCurrency] = useState(edit?.currency || local);
  const [label, setLabel] = useState(edit?.label || "");
  const [paidBy, setPaidBy] = useState(edit ? edit.paidBy : people[0] || "");
  const [split, setSplit] = useState<string[]>(edit?.split || []);
  const [placeId, setPlaceId] = useState(edit?.placeId || "");
  const [date, setDate] = useState(edit?.date || today);
  const [category, setCategory] = useState(edit?.category || "food");
  const [pending, setPending] = useState<Pending[]>([]);
  const [view, setView] = useState<string | null>(null);
  const saved = useReceipts(edit?.id || "");
  useStore((s) => s.photoUrls);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const pendingRef = useRef<Pending[]>([]);
  pendingRef.current = pending;
  useEffect(() => {
    return () => {
      pendingRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    };
  }, []);
  const rate = useEurRate(local);
  const n = Number(amount.replace(/\s/g, "").replace(",", "."));
  const ok = Number.isFinite(n) && n > 0 && !!(paidBy || !people.length);
  const close = () => {
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    setPending([]);
    if (edit) onClose?.();
    else setOpen(false);
  };
  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      const blob = await compressImage(f);
      if (edit) {
        if (await addPhoto(expenseKey(edit.id), blob, "receipt")) toast(t("Justificatif ajouté"));
      } else setPending((cur) => [...cur, { blob, url: URL.createObjectURL(blob) }]);
    } catch {
      toast(t("Cette image ne peut pas être lue"));
    }
  };
  if (!edit && !open) return <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => { setPaidBy(people[0] || ""); setOpen(true); }}>{t("+ Ajouter une dépense")}</button>;
  const thumbs: { key: string; src?: string; remove: () => void }[] = [
    ...saved.map((p) => ({ key: p.id, src: photoSrc(p), remove: () => { if (confirm(t("Retirer ce justificatif ?"))) deletePhoto(p.id); } })),
    ...pending.map((p) => ({ key: p.url, src: p.url, remove: () => { URL.revokeObjectURL(p.url); setPending((cur) => cur.filter((x) => x.url !== p.url)); } })),
  ];
  return (
    <form
      className={"card exp-form" + (edit ? " exp-form-edit" : "")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        const amt = Math.round(n * 100) / 100;
        const fields = { amount: amt, currency, label: label.trim(), date: date || today, paidBy: paidBy || people[0] || "", split: split.length === people.length ? [] : split, placeId: placeId || undefined, category };
        if (edit) {
          // the euro value keeps the rate of the day it was entered, unless the amount or the currency changed
          const same = amt === edit.amount && currency === edit.currency;
          updateExpense(edit.id, { ...fields, eur: same && edit.eur != null ? edit.eur : currency === "EUR" ? amt : rate ? amt / rate : null });
          toast(t("Dépense modifiée"));
          onClose?.();
          return;
        }
        const id = addExpense({ ...fields, eur: currency === "EUR" ? amt : rate ? amt / rate : null }, trip.id);
        for (const p of pending) void addPhoto(expenseKey(id), p.blob, "receipt").finally(() => URL.revokeObjectURL(p.url));
        toast(t("Dépense ajoutée"));
        setAmount("");
        setLabel("");
        setSplit([]);
        setPlaceId("");
        setPending([]);
        setOpen(false);
      }}
    >
      <div className="grid2">
        <label className="field"><span>{t("Montant")}</span><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus /></label>
        <label className="field">
          <span>{t("Devise")}</span>
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {[...new Set([local, "EUR", currency])].map((c) => <option key={c} value={c}>{c} {symbolOf(c)}</option>)}
          </select>
        </label>
      </div>
      <div className="field">
        <span>{t("Catégorie")}</span>
        <div className="exp-chips">
          {EXPENSE_CATEGORIES.map((c) => (
            <button key={c.key} type="button" className={"fchip" + (category === c.key ? " on" : "")} aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>{c.icon} {t(c.label)}</button>
          ))}
        </div>
      </div>
      <label className="field"><span>{t("Quoi")}</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("ex. dîner, taxi, échantillons")} maxLength={80} /></label>
      <div className="grid2">
        <label className="field">
          <span>{t("Payé par")}</span>
          <select className="input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {[...new Set([...people, ...(paidBy ? [paidBy] : [])])].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <label className="field"><span>{t("Date")}</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      </div>
      {people.length > 1 && (
        <div className="field">
          <span>{t("Pour qui")}</span>
          <div className="exp-chips">
            {people.map((p) => {
              const on = !split.length || split.includes(p);
              return (
                <button key={p} type="button" className={"fchip" + (on ? " on" : "")} aria-pressed={on} onClick={() => {
                  const cur = split.length ? split : people;
                  const next = on ? cur.filter((x) => x !== p) : [...cur, p];
                  setSplit(next.length ? next : [p]);
                }}>{p}</button>
              );
            })}
          </div>
        </div>
      )}
      {suppliers.length > 0 && (
        <label className="field">
          <span>{business ? t("Fournisseur (facultatif)") : t("Lieu (facultatif)")}</span>
          <select className="input" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
            <option value="">{t("Aucun")}</option>
            {suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      <div className="field">
        <span>{t("Justificatif")}</span>
        <div className="exp-rc">
          {thumbs.map((x) => (
            <div key={x.key} className="exp-rc-thumb">
              {x.src ? (
                <button type="button" className="exp-rc-img" aria-label={t("Voir le justificatif")} onClick={() => setView(x.src!)}><img src={x.src} alt="" /></button>
              ) : (
                <span className="exp-rc-wait">{t("Chargement…")}</span>
              )}
              <button type="button" className="exp-rc-x" aria-label={t("Retirer le justificatif")} onClick={x.remove}><IClose width={12} height={12} /></button>
            </div>
          ))}
          <div className="exp-rc-add">
            <button type="button" className="btn-sm" onClick={() => camera.current?.click()}><ICamera /> {t("Ajouter le justificatif")}</button>
            <button type="button" className="exp-rc-pick" onClick={() => gallery.current?.click()}>{t("ou choisir une image")}</button>
          </div>
        </div>
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {view && <Lightbox src={view} onClose={() => setView(null)} />}
      <div className="btn-row">
        <button type="button" className="btn" onClick={close}>{t("Annuler")}</button>
        <button className="btn primary" disabled={!ok}>{edit ? t("Enregistrer") : t("Ajouter")}</button>
      </div>
    </form>
  );
}

/** An expense's receipts in its line: small thumbnails, tap to view */
function ReceiptThumbs({ id, onView }: { id: string; onView: (src: string) => void }) {
  const list = useReceipts(id);
  useStore((s) => s.photoUrls);
  if (!list.length) return null;
  return (
    <span className="exp-thumbs">
      {list.slice(0, 2).map((p) => {
        const src = photoSrc(p);
        return src ? (
          <button key={p.id} type="button" className="exp-thumb" aria-label={t("Voir le justificatif")} onClick={() => onView(src)}><img src={src} alt="" /></button>
        ) : (
          <span key={p.id} className="exp-thumb exp-thumb-wait" role="img" aria-label={t("Justificatif")} />
        );
      })}
      {list.length > 2 && <small>+{list.length - 2}</small>}
    </span>
  );
}

/** The expense report ("note de frais"): whose expenses, then the printable document (PDF) or the CSV */
export function ExpenseReportSheet({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const local = localCurrency(trip);
  const rate = useEurRate(local);
  const rates = useMemo(() => ({ [local]: rate, EUR: 1 }), [local, rate]);
  const people = useMemo(() => [...new Set([...travellersOf(trip), ...payersOf(data)])], [trip, data]);
  const [person, setPerson] = useState("");
  const who = person || undefined;
  const lines = useMemo(() => reportLines(trip, data, rates, who), [trip, data, rates, who]);
  const loc = locale();
  const total = lines.reduce((s, l) => s + (l.eur ?? 0), 0);
  const receipts = lines.reduce((s, l) => s + l.receipts.length, 0);
  return (
    <Modal title={t("Note de frais")} intro={t("Les dépenses jour par jour, en euros, avec les justificatifs. À imprimer ou enregistrer en PDF, et en tableur pour la comptabilité.")} onClose={onClose} className="exp-sheet">
      <div className="field">
        <span>{t("Dépenses de")}</span>
        <div className="exp-chips">
          <button type="button" className={"fchip" + (!person ? " on" : "")} aria-pressed={!person} onClick={() => setPerson("")}>{t("Tous les voyageurs")}</button>
          {people.map((p) => (
            <button key={p} type="button" className={"fchip" + (person === p ? " on" : "")} aria-pressed={person === p} onClick={() => setPerson(p)}>{p}</button>
          ))}
        </div>
        {person && <p className="exp-sheet-hint">{t("Seules les dépenses payées par {who} figurent dans la note.", { who: person })}</p>}
      </div>
      <p className="exp-sheet-sum">
        {lines.length ? t("{n} dépense(s) · {r} justificatif(s) · {total}", { n: lines.length, r: receipts, total: money(total, "EUR", loc) }) : t("Aucune dépense pour ce choix.")}
      </p>
      <div className="btn-row">
        <button type="button" className="btn primary" disabled={!lines.length} onClick={() => { track("export", "expense_report", trip.id); if (!exportExpenseReport(trip, getState().data, rates, who)) toast(t("Autorisez les fenêtres pop-up pour imprimer le PDF")); }}>
          <IDownload /> {t("Imprimer ou PDF")}
        </button>
        <button type="button" className="btn" disabled={!lines.length} onClick={() => { track("export", "expense_report", trip.id); exportExpenseCsv(trip, getState().data, rates, who); toast(t("Fichier CSV téléchargé")); }}>
          {t("Tableur (CSV)")}
        </button>
      </div>
      <button type="button" className="btn block exp-sheet-close" onClick={onClose}>{t("Fermer")}</button>
    </Modal>
  );
}
