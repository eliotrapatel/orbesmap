// Business mode (Pro) and the trip's expenses.
// Business mode: a trip's suppliers (sheet, status, meetings, products), their expenses and a PDF report.
// Expenses (every trip): who paid what, shared between the trip's travellers, in the local currency and in euros;
// in business mode an expense can belong to a supplier. They are records like the check-list ("_exp:<id>"), synced
// and merged field by field.
import { useEffect, useMemo, useState } from "react";
import type { Trip } from "../data/types";
import { TRIP_BY_ID } from "../data/trip";
import type { Photo } from "./model";
import { currentAuthor, getState, requestPro, updateRecord, updateTrip, useStore } from "./store";
import { track } from "./track";

// ---------- mode ----------
/** Business mode is on for this trip (and usable: Pro, the trip owner's Pro, or the shared space) */
export function businessOn(trip: Trip): boolean {
  if (trip.mode !== "business") return false;
  const p = getState().plan;
  return !p || p.pro || !!TRIP_BY_ID[trip.id] || p.proTrips.includes(trip.id);
}
export const useBusiness = (trip: Trip) => {
  useStore((s) => s.plan);
  return businessOn(trip);
};
/** Switches a trip's mode; business mode needs Pro (the Pro screen opens otherwise) */
export function setMode(trip: Trip, mode: "leisure" | "business") {
  if (mode === "business") {
    const p = getState().plan;
    if (p && !p.pro && !TRIP_BY_ID[trip.id] && !p.proTrips.includes(trip.id)) return requestPro("business");
  }
  updateTrip(trip.id, { mode });
}

// ---------- currencies ----------
const CURRENCY: Record<string, string> = {
  cn: "CNY", hk: "HKD", mo: "MOP", tw: "TWD", jp: "JPY", kr: "KRW", th: "THB", vn: "VND", sg: "SGD", my: "MYR", id: "IDR", ph: "PHP",
  in: "INR", ae: "AED", tr: "TRY", ma: "MAD", eg: "EGP", za: "ZAR", us: "USD", ca: "CAD", mx: "MXN", br: "BRL", ar: "ARS", au: "AUD",
  nz: "NZD", gb: "GBP", ch: "CHF", se: "SEK", no: "NOK", dk: "DKK", pl: "PLN", cz: "CZK", hu: "HUF", is: "ISK", il: "ILS",
};
/** The trip's local currency (EUR in the euro area or when unknown); the first trips are in China */
export function localCurrency(trip: Trip): string {
  if (TRIP_BY_ID[trip.id]) return "CNY";
  return CURRENCY[(trip.country || "").toLowerCase()] || "EUR";
}
const SYMBOL: Record<string, string> = { EUR: "€", CNY: "¥", JPY: "¥", USD: "$", GBP: "£", HKD: "HK$", KRW: "₩", THB: "฿", CHF: "CHF" };
export const symbolOf = (c: string) => SYMBOL[c] || c;

const RATE_KEY = "orbes.rate.";
/** How many units of `code` for 1 euro (European Central Bank via frankfurter.dev, cached 6 h); null while unknown */
export function useEurRate(code: string): number | null {
  const fallback = useStore((s) => (code === "CNY" ? s.settings.eurRate : null));
  const [rate, setRate] = useState<number | null>(() => {
    if (code === "EUR") return 1;
    try {
      return JSON.parse(localStorage.getItem(RATE_KEY + code) || "null")?.rate ?? null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (code === "EUR") return setRate(1);
    try {
      const c = JSON.parse(localStorage.getItem(RATE_KEY + code) || "null");
      if (c && Date.now() - c.at < 6 * 3600e3) return setRate(c.rate);
    } catch {
      /* ignore */
    }
    fetch(`https://api.frankfurter.dev/v2/rates?base=EUR&quotes=${code}`)
      .then((x) => (x.ok ? x.json() : Promise.reject(x.status)))
      .then((j) => {
        const r = Number(Array.isArray(j) ? j[0]?.rate : j?.rates?.[code]);
        if (!r) return;
        setRate(r);
        try {
          localStorage.setItem(RATE_KEY + code, JSON.stringify({ at: Date.now(), rate: r }));
        } catch {
          /* ignore */
        }
      })
      .catch(() => undefined);
  }, [code]);
  return rate ?? fallback;
}

// ---------- expenses ----------
export type Expense = {
  id: string;
  amount: number;
  currency: string;
  label: string;
  /** yyyy-mm-dd */
  date: string;
  paidBy: string;
  /** who shares it (empty = everyone) */
  split: string[];
  /** business mode: the supplier (place id) it belongs to */
  placeId?: string;
  /** what it was (see EXPENSE_CATEGORIES) */
  category: string;
  /** its value in euros when it was entered (null: the rate was unknown) */
  eur?: number | null;
  createdBy?: string;
};

/** Kinds of expenses (the label is French, translated where shown) */
export const EXPENSE_CATEGORIES: { key: string; label: string; icon: string }[] = [
  { key: "flights", label: "Vols", icon: "✈" },
  { key: "lodging", label: "Hébergement", icon: "🏨" },
  { key: "transport", label: "Transport sur place", icon: "🚕" },
  { key: "food", label: "Restaurants et cafés", icon: "🍽" },
  { key: "activities", label: "Activités et visites", icon: "🎟" },
  { key: "shopping", label: "Shopping", icon: "🛍" },
  { key: "business", label: "Achats pro et échantillons", icon: "📦" },
  { key: "other", label: "Autre", icon: "•" },
];
export const categoryOf = (k?: string) => EXPENSE_CATEGORIES.find((c) => c.key === k) || EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
const PREFIX = "_exp:";

/** The trip's expenses, newest first */
export function expensesOf(records: Record<string, Record<string, unknown>>): Expense[] {
  const out: Expense[] = [];
  for (const [k, r] of Object.entries(records)) {
    if (!k.startsWith(PREFIX) || !r || r.deleted === true) continue;
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    out.push({
      id: k.slice(PREFIX.length), amount, currency: String(r.currency || "EUR"), label: String(r.label || ""), date: String(r.date || ""),
      paidBy: String(r.paidBy || ""), split: Array.isArray(r.split) ? (r.split as unknown[]).map(String) : [],
      placeId: typeof r.placeId === "string" && r.placeId ? r.placeId : undefined, createdBy: typeof r.createdBy === "string" ? r.createdBy : undefined,
      category: typeof r.category === "string" && r.category ? r.category : "other", eur: typeof r.eur === "number" ? r.eur : null,
    });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}
export function useExpenses(): Expense[] {
  const records = useStore((s) => s.data.places);
  return useMemo(() => expensesOf(records as Record<string, Record<string, unknown>>), [records]);
}

/** Adds an expense; returns its id (its receipts are photos of the place id `expenseKey(id)`) */
export function addExpense(e: Omit<Expense, "id" | "createdBy">, tripId?: string): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  updateRecord(PREFIX + id, { ...e, eur: e.eur == null ? null : Math.round(e.eur * 100) / 100, placeId: e.placeId || null, createdBy: currentAuthor() || null });
  track("expense_added", e.category, tripId || getState().tripId);
  return id;
}
/** Changes an expense (only the fields given) */
export function updateExpense(id: string, patch: Partial<Omit<Expense, "id" | "createdBy">>) {
  const p: Record<string, unknown> = { ...patch };
  if ("eur" in patch) p.eur = patch.eur == null ? null : Math.round(patch.eur * 100) / 100;
  if ("placeId" in patch) p.placeId = patch.placeId || null;
  updateRecord(PREFIX + id, p);
}
export const deleteExpense = (id: string) => updateRecord(PREFIX + id, { deleted: true });

// ---------- receipts ----------
// A receipt is an ordinary photo (same storage, sync and deletion as a place's photos) attached to the
// record id "_exp:<id>" instead of a place id: no new table or bucket.
/** The record id an expense's receipts are attached to */
export const expenseKey = (id: string) => PREFIX + id;
/** An expense's receipts, oldest first */
export const receiptsOf = (photos: Photo[], id: string): Photo[] => photos.filter((p) => p.placeId === PREFIX + id).sort((a, b) => a.createdAt - b.createdAt);
export function useReceipts(id: string): Photo[] {
  const photos = useStore((s) => s.data.photos);
  return useMemo(() => receiptsOf(photos, id), [photos, id]);
}

/** The trip's travellers who share expenses: the list kept on the trip, else this person */
export function travellersOf(trip: Trip): string[] {
  if (trip.travellers?.length) return trip.travellers;
  const me = (getState().profile.name as string) || currentAuthor() || "";
  return me ? [me] : [];
}
export const setTravellers = (trip: Trip, list: string[]) =>
  updateTrip(trip.id, { travellers: [...new Set(list.map((x) => x.trim()).filter(Boolean))].slice(0, 20) });

/** Amount in euros (null when the rate is unknown) */
export const toEur = (e: Pick<Expense, "amount" | "currency">, rates: Record<string, number | null>) => {
  if (e.currency === "EUR") return e.amount;
  const r = rates[e.currency];
  return r ? e.amount / r : null;
};

/** Who paid, who owes: each person's balance in euros, and the transfers that settle everything */
export function settle(list: Expense[], people: string[], rates: Record<string, number | null>) {
  const bal: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
  for (const e of list) {
    const eur = toEur(e, rates);
    if (eur == null) continue;
    const among = (e.split.length ? e.split : people).filter((p) => p in bal);
    if (!among.length || !(e.paidBy in bal)) continue;
    bal[e.paidBy] += eur;
    for (const p of among) bal[p] -= eur / among.length;
  }
  const debt = Object.entries(bal).filter(([, v]) => v < -0.005).map(([p, v]) => ({ p, v: -v })).sort((a, b) => b.v - a.v);
  const cred = Object.entries(bal).filter(([, v]) => v > 0.005).map(([p, v]) => ({ p, v })).sort((a, b) => b.v - a.v);
  const moves: { from: string; to: string; eur: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debt.length && j < cred.length) {
    const x = Math.min(debt[i].v, cred[j].v);
    if (x > 0.005) moves.push({ from: debt[i].p, to: cred[j].p, eur: x });
    debt[i].v -= x;
    cred[j].v -= x;
    if (debt[i].v < 0.005) i++;
    if (cred[j].v < 0.005) j++;
  }
  return { balances: bal, moves };
}

export const money = (n: number, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: currency === "JPY" || currency === "KRW" || currency === "VND" || currency === "IDR" ? 0 : 2 }).format(n);
