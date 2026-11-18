import { useMemo, useState } from "react";
import type { Trip } from "../data/types";
import {
  addExpense, deleteExpense, localCurrency, money, setTravellers, settle, symbolOf, toEur, travellersOf, useBusiness, useEurRate, useExpenses, type Expense,
} from "../lib/business";
import { locale, t } from "../lib/i18n";
import { toast, useCanEdit, useStore } from "../lib/store";
import { localDate } from "../lib/time";

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
            return (
              <div key={e.id} className="exp-item">
                <span className="exp-grow">
                  <b>{e.label || t("Dépense")}</b>
                  <small>
                    {t("payé par {who}", { who: e.paidBy || "?" })}
                    {e.split.length && e.split.length < people.length ? ` · ${t("pour {list}", { list: e.split.join(", ") })}` : ""}
                    {sup ? ` · ${sup.name}` : ""}
                  </small>
                </span>
                <span className="exp-amt">
                  <b>{money(e.amount, e.currency, loc)}</b>
                  {e.currency !== "EUR" && eur != null && <small>{money(eur, "EUR", loc)}</small>}
                </span>
                {canEdit && <button className="icon-btn" aria-label={t("Supprimer la dépense {label}", { label: e.label || "" })} onClick={() => { if (confirm(t("Supprimer cette dépense ?"))) { deleteExpense(e.id); toast(t("Dépense supprimée")); } }}>×</button>}
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

function AddForm({ trip, people, local, business, suppliers }: { trip: Trip; people: string[]; local: string; business: boolean; suppliers: Trip["places"] }) {
  const today = localDate(trip.timezone);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(local);
  const [label, setLabel] = useState("");
  const [paidBy, setPaidBy] = useState(people[0] || "");
  const [split, setSplit] = useState<string[]>([]);
  const [placeId, setPlaceId] = useState("");
  const [date, setDate] = useState(today);
  const n = Number(amount.replace(/\s/g, "").replace(",", "."));
  const ok = Number.isFinite(n) && n > 0 && !!(paidBy || !people.length);
  if (!open) return <button className="btn primary block" style={{ marginTop: 14 }} onClick={() => { setPaidBy(people[0] || ""); setOpen(true); }}>{t("+ Ajouter une dépense")}</button>;
  return (
    <form
      className="card exp-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        addExpense({ amount: Math.round(n * 100) / 100, currency, label: label.trim(), date: date || today, paidBy: paidBy || people[0] || "", split: split.length === people.length ? [] : split, placeId: business && placeId ? placeId : undefined });
        toast(t("Dépense ajoutée"));
        setAmount("");
        setLabel("");
        setSplit([]);
        setPlaceId("");
        setOpen(false);
      }}
    >
      <div className="grid2">
        <label className="field"><span>{t("Montant")}</span><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" autoFocus /></label>
        <label className="field">
          <span>{t("Devise")}</span>
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {[...new Set([local, "EUR"])].map((c) => <option key={c} value={c}>{c} {symbolOf(c)}</option>)}
          </select>
        </label>
      </div>
      <label className="field"><span>{t("Quoi")}</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("ex. dîner, taxi, échantillons")} maxLength={80} /></label>
      <div className="grid2">
        <label className="field">
          <span>{t("Payé par")}</span>
          <select className="input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
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
      {business && (
        <label className="field">
          <span>{t("Fournisseur (facultatif)")}</span>
          <select className="input" value={placeId} onChange={(e) => setPlaceId(e.target.value)}>
            <option value="">{t("Aucun")}</option>
            {suppliers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}
      <div className="btn-row">
        <button type="button" className="btn" onClick={() => setOpen(false)}>{t("Annuler")}</button>
        <button className="btn primary" disabled={!ok}>{t("Ajouter")}</button>
      </div>
    </form>
  );
}
