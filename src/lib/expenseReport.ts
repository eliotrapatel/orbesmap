// Business mode: the expense report ("note de frais") of a trip — everyone's expenses or one traveller's (what they
// paid) — as a printable document (save as PDF from the print dialog) with the receipts, and as a CSV for accounting
// software. Opened like the other exports (src/lib/export.ts): a new window, then the print dialog.
import type { Trip } from "../data/types";
import type { Data, Photo } from "./model";
import { getLang, locale, t } from "./i18n";
import { categoryOf, EXPENSE_CATEGORIES, expensesOf, money, receiptsOf, symbolOf, type Expense } from "./business";
import { photoSrc } from "./store";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One line of the report: the expense, its value in euros and the rate used (units of its currency for 1 €) */
export type ReportLine = {
  e: Expense;
  eur: number | null;
  rate: number | null;
  /** where the rate comes from: the day the expense was entered, today's rate, or none (amount not counted in euros) */
  rateFrom: "eur" | "entry" | "today" | "none";
  supplier: string;
  receipts: Photo[];
  /** receipt reference printed in the table and under the image (J1, J2…) */
  refs: string[];
};

/** The travellers who paid at least one expense (for the "whose expenses" choice) */
export function payersOf(d: Data): string[] {
  return [...new Set(expensesOf(d.places as Record<string, Record<string, unknown>>).map((e) => e.paidBy).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

/**
 * The report's lines, oldest first. `person`: only what this traveller paid (else everyone's).
 * Euros: the value saved when the expense was entered (rate of that day), else today's rate from `rates`.
 */
export function reportLines(trip: Trip, d: Data, rates: Record<string, number | null>, person?: string): ReportLine[] {
  const list = expensesOf(d.places as Record<string, Record<string, unknown>>)
    .filter((e) => !person || e.paidBy === person)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let n = 0;
  return list.map((e) => {
    let eur: number | null = null;
    let rate: number | null = null;
    let rateFrom: ReportLine["rateFrom"] = "none";
    if (e.currency === "EUR") {
      eur = e.amount;
      rate = 1;
      rateFrom = "eur";
    } else if (e.eur != null && e.eur > 0) {
      eur = e.eur;
      rate = e.amount / e.eur;
      rateFrom = "entry";
    } else if (rates[e.currency]) {
      rate = rates[e.currency]!;
      eur = e.amount / rate;
      rateFrom = "today";
    }
    const receipts = receiptsOf(d.photos || [], e.id);
    const refs = receipts.map(() => `J${++n}`);
    const supplier = e.placeId ? trip.places.find((p) => p.id === e.placeId)?.name || "" : "";
    return { e, eur, rate, rateFrom, supplier, receipts, refs };
  });
}

const dayLong = (iso: string, loc: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return !iso || Number.isNaN(d.getTime()) ? t("Sans date") : d.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};
const dayShort = (iso: string, loc: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return !iso || Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(loc, { day: "2-digit", month: "2-digit", timeZone: "UTC" });
};
const rateText = (r: number | null, loc: string) => (r == null ? "" : r.toLocaleString(loc, { maximumFractionDigits: 4 }));
const description = (l: ReportLine) => l.e.label || t(categoryOf(l.e.category).label);

/** Opens the printable expense report; false when the browser blocked the new window */
export function exportExpenseReport(trip: Trip, d: Data, rates: Record<string, number | null>, person?: string): boolean {
  const loc = locale();
  const lines = reportLines(trip, d, rates, person);
  const eurOf = (ls: ReportLine[]) => ls.reduce((s, l) => s + (l.eur ?? 0), 0);
  const today = new Date().toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" });
  const nReceipts = lines.reduce((s, l) => s + l.receipts.length, 0);

  let h = `<!doctype html><html lang="${getLang()}"><head><meta charset="utf-8"><title>${esc(t("Note de frais"))} — ${esc(trip.title)}</title><style>
  @page{size:A4;margin:14mm}
  body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#0a0a0a;padding:28px;max-width:820px;margin:0 auto;font-size:11.5px;line-height:1.4}
  @media print{body{padding:0;max-width:none}}
  h1{font-weight:500;font-size:28px;letter-spacing:-.02em;margin:0 0 4px}
  .sub{color:#666;margin:0 0 18px}
  .info{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 18px;border-top:1px solid #0a0a0a;border-bottom:1px solid #e5e2dc;padding:10px 0;margin-bottom:8px}
  .info span{display:block;font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:#777}
  .info b{font-weight:600;font-size:12.5px}
  h2{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;font-weight:600;margin:22px 0 4px;page-break-after:avoid}
  table{width:100%;border-collapse:collapse;margin:4px 0 2px}
  td,th{text-align:left;padding:5px 5px;border-bottom:1px solid #e5e2dc;vertical-align:top}
  th{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#666;font-weight:500;border-bottom:1px solid #0a0a0a}
  tr{page-break-inside:avoid}
  .r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  .m{color:#666}.s{font-size:10px;color:#777}
  .sum td{font-weight:600;border-bottom:none}
  .tot td{font-weight:700;font-size:13px;border-top:1px solid #0a0a0a;border-bottom:none}
  .note{color:#555;font-size:10.5px;margin:8px 0 0}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:26px;page-break-inside:avoid}
  .sign div{border-top:1px solid #0a0a0a;padding-top:6px;height:70px;font-size:10px;color:#555}
  .rcs{page-break-before:always}
  .rc{height:128mm;display:flex;flex-direction:column;page-break-inside:avoid;border-bottom:1px dashed #ccc;padding:6px 0 10px;box-sizing:border-box}
  .rc .cap{font-size:11px;margin-bottom:6px}.rc .cap b{font-weight:700;margin-right:6px}
  .rc .img{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
  .rc img{max-width:100%;max-height:100%;object-fit:contain}
  .rc .miss{color:#777;font-size:11px}
  footer{margin-top:28px;padding-top:8px;border-top:1px solid #e5e2dc;color:#777;font-size:10px;display:flex;justify-content:space-between}
  </style></head><body>`;

  h += `<h1>${esc(t("Note de frais"))}</h1>`;
  h += `<div class="sub">${esc(trip.title)}${trip.subtitle ? ` · ${esc(trip.subtitle)}` : ""}</div>`;
  h += `<div class="info">`;
  h += `<div><span>${esc(t("Voyage"))}</span><b>${esc(trip.title)}</b></div>`;
  h += `<div><span>${esc(t("Dates"))}</span><b>${esc(trip.dateLabel || "")}</b></div>`;
  h += `<div><span>${esc(t("Voyageur"))}</span><b>${esc(person || t("Tous les voyageurs"))}</b></div>`;
  h += `<div><span>${esc(t("Édité le"))}</span><b>${esc(today)}</b></div>`;
  h += `</div>`;
  h += `<div class="m">${esc(t("{n} dépense(s) · {r} justificatif(s)", { n: lines.length, r: nReceipts }))}</div>`;

  if (!lines.length) {
    h += `<p class="note">${esc(person ? t("Aucune dépense payée par {who} dans ce voyage.", { who: person }) : t("Aucune dépense dans ce voyage."))}</p>`;
  }

  // one table per day
  const days = new Map<string, ReportLine[]>();
  for (const l of lines) days.set(l.e.date, [...(days.get(l.e.date) || []), l]);
  const head = `<tr><th>${esc(t("Date"))}</th><th>${esc(t("Catégorie"))}</th><th>${esc(t("Description / fournisseur"))}</th><th class="r">${esc(t("Montant"))}</th><th class="r">${esc(t("Taux (1 € =)"))}</th><th class="r">${esc(t("En euros"))}</th><th>${esc(t("Payé par"))}</th><th>${esc(t("Justif."))}</th></tr>`;
  for (const [day, ls] of days) {
    h += `<h2>${esc(dayLong(day, loc))}</h2><table>${head}`;
    for (const l of ls) {
      const c = categoryOf(l.e.category);
      h += `<tr><td class="m">${esc(dayShort(day, loc))}</td><td>${esc(t(c.label))}</td><td>${esc(description(l))}${l.supplier ? `<div class="s">${esc(l.supplier)}</div>` : ""}</td>`;
      h += `<td class="r">${esc(money(l.e.amount, l.e.currency, loc))}</td><td class="r m">${l.e.currency === "EUR" ? "" : esc(rateText(l.rate, loc))}${l.rateFrom === "today" ? "*" : ""}</td>`;
      h += `<td class="r">${l.eur == null ? "—" : esc(money(l.eur, "EUR", loc))}</td><td>${esc(l.e.paidBy || "")}</td><td class="m">${esc(l.refs.join(", ") || "—")}</td></tr>`;
    }
    if (ls.length > 1) h += `<tr class="sum"><td></td><td colspan="4">${esc(t("Total du jour"))}</td><td class="r">${esc(money(eurOf(ls), "EUR", loc))}</td><td colspan="2"></td></tr>`;
    h += `</table>`;
  }

  if (lines.length) {
    // totals per category and grand total, in euros
    h += `<h2>${esc(t("Totaux par catégorie"))}</h2><table><tr><th>${esc(t("Catégorie"))}</th><th class="r">${esc(t("Dépenses"))}</th><th class="r">${esc(t("En euros"))}</th></tr>`;
    for (const c of EXPENSE_CATEGORIES) {
      const ls = lines.filter((l) => categoryOf(l.e.category).key === c.key);
      if (ls.length) h += `<tr><td>${esc(t(c.label))}</td><td class="r">${ls.length}</td><td class="r">${ls.every((l) => l.eur == null) ? "—" : esc(money(eurOf(ls), "EUR", loc))}</td></tr>`;
    }
    h += `<tr class="tot"><td>${esc(t("Total général"))}</td><td class="r">${lines.length}</td><td class="r">${esc(money(eurOf(lines), "EUR", loc))}</td></tr></table>`;

    // the rates used
    const notes: string[] = [];
    if (lines.some((l) => l.rateFrom === "entry")) notes.push(t("Montants en euros au taux de change du jour où chaque dépense a été saisie (Banque centrale européenne), indiqué sur chaque ligne."));
    const todayCur = [...new Set(lines.filter((l) => l.rateFrom === "today").map((l) => l.e.currency))];
    if (todayCur.length) notes.push(t("* Taux du jour de l'édition : {list}.", { list: todayCur.map((c) => `1 € = ${rateText(rates[c] ?? null, loc)} ${symbolOf(c)}`).join(", ") }));
    const missing = lines.filter((l) => l.eur == null);
    if (missing.length) {
      const m = new Map<string, number>();
      for (const l of missing) m.set(l.e.currency, (m.get(l.e.currency) || 0) + l.e.amount);
      notes.push(t("{n} dépense(s) sans taux de change, non comptée(s) dans le total en euros : {sum}.", { n: missing.length, sum: [...m].map(([c, v]) => money(v, c, loc)).join(" + ") }));
    }
    h += notes.map((x) => `<p class="note">${esc(x)}</p>`).join("");
    h += `<div class="sign"><div>${esc(t("Signature du voyageur"))}</div><div>${esc(t("Validation"))}</div></div>`;
  }

  // receipts: one per half page, with the expense line as caption
  const withReceipts = lines.filter((l) => l.receipts.length);
  if (withReceipts.length) {
    h += `<div class="rcs"><h2>${esc(t("Justificatifs"))}</h2>`;
    for (const l of withReceipts) {
      l.receipts.forEach((p, i) => {
        const src = photoSrc(p);
        const cap = [dayShort(l.e.date, loc), t(categoryOf(l.e.category).label), description(l), l.supplier, money(l.e.amount, l.e.currency, loc) + (l.e.currency !== "EUR" && l.eur != null ? ` (${money(l.eur, "EUR", loc)})` : ""), l.e.paidBy ? t("payé par {who}", { who: l.e.paidBy }) : ""].filter(Boolean).join(" · ");
        h += `<div class="rc"><div class="cap"><b>${esc(l.refs[i])}</b>${esc(cap)}</div><div class="img">${src ? `<img src="${esc(src)}" alt="">` : `<span class="miss">${esc(t("Image pas encore disponible sur cet appareil : ouvrez le voyage avec une connexion, puis relancez la note de frais."))}</span>`}</div></div>`;
      });
    }
    h += `</div>`;
  }

  h += `<footer><span>${esc(t("Préparé avec ORBES Trips"))}</span><span>${esc(today)}</span></footer>`;
  h += `</body></html>`;

  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(h);
  w.document.close();
  // print once the receipts are loaded (at most a few seconds)
  const imgs = [...w.document.images];
  const ready = Promise.all(imgs.map((im) => (im.complete ? Promise.resolve() : new Promise<void>((res) => { im.onload = () => res(); im.onerror = () => res(); }))));
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    w.focus();
    w.print();
  };
  void ready.then(() => setTimeout(go, 300));
  setTimeout(go, 5000);
  return true;
}

/** Downloads the same lines as a CSV for accounting software (";" and decimal comma in French, "," and dot in English) */
export function exportExpenseCsv(trip: Trip, d: Data, rates: Record<string, number | null>, person?: string) {
  const fr = getLang() === "fr";
  const sep = fr ? ";" : ",";
  const num = (n: number | null, digits = 2) => (n == null ? "" : (Math.round(n * 10 ** digits) / 10 ** digits).toFixed(digits).replace(".", fr ? "," : "."));
  const lines = reportLines(trip, d, rates, person);
  const rows: string[][] = [
    ["Date", "Catégorie", "Description", "Fournisseur", "Montant", "Devise", "Taux (1 € =)", "Montant en euros", "Payé par", "Pour qui", "Justificatifs"].map((x) => t(x)),
  ];
  for (const l of lines) {
    rows.push([
      l.e.date, t(categoryOf(l.e.category).label), description(l), l.supplier, num(l.e.amount), l.e.currency,
      l.e.currency === "EUR" ? num(1, 0) : num(l.rate, 4), num(l.eur), l.e.paidBy, l.e.split.length ? l.e.split.join(", ") : t("Tout le monde"), l.refs.join(" "),
    ]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(sep)).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${fr ? "note-de-frais" : "expense-report"}-${trip.id}${person ? `-${slug(person) || "1"}` : ""}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
