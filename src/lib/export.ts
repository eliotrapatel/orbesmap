import { notesText } from "./notes";
import { STATUSES, TYPE_LABEL } from "../data/trip";
import type { Trip } from "../data/types";
import type { Data } from "./model";
import { getLang, locale, t } from "./i18n";
import { expensesOf, money, type Expense } from "./business";
import { photoSrc } from "./store";

const statusLabel = (k?: string | null) => {
  const l = STATUSES.find((s) => s.key === k)?.label;
  return l ? t(l) : "";
};
const typeLabel = (k: string) => (TYPE_LABEL[k as keyof typeof TYPE_LABEL] ? t(TYPE_LABEL[k as keyof typeof TYPE_LABEL]) : k);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The app's address now (https://theorbes.com/maps, https://orbesmap.vercel.app/…), without the query or the hash */
export function appHome(): string {
  return location.origin + location.pathname.replace(/index\.html$/, "");
}
/** The same address, short, to read (theorbes.com/maps) */
export const appHomeLabel = (href = appHome()) => href.replace(/^https?:\/\//, "").replace(/\/$/, "");

/**
 * "Préparé avec ORBES Trips · theorbes.com/maps" at the foot of a printed document: on every printed page (a fixed
 * footer, its room kept free on each page by a repeated table footer), once at the end on screen.
 */
const COLOPHON_CSS = `
  .ob-pg{width:100%;table-layout:fixed;border-collapse:collapse;margin:0}.ob-pg>tbody>tr>td,.ob-pg>tfoot>tr>td{padding:0;border:0}
  .ob-pg>tbody>tr>td{overflow-wrap:anywhere;word-break:break-word}
  .ob-colo{margin-top:36px;padding-top:10px;border-top:1px solid #e5e2dc;color:#8a8780;font-size:9.5px;letter-spacing:.06em;text-align:center}
  .ob-colo a{color:inherit;text-decoration:none}
  .ob-sp{display:none}
  @media print{
    .ob-colo{position:fixed;left:0;right:0;bottom:0;margin:0;padding:4px 0 0;border-top:0;background:#fff}
    .ob-sp{display:block;height:26px}
  }`;
const PAGE_OPEN = `<table class="ob-pg"><tbody><tr><td>`;
const pageClose = () => {
  const href = appHome();
  return `</td></tr></tbody><tfoot><tr><td><div class="ob-sp"></div></td></tr></tfoot></table><div class="ob-colo">${esc(t("Préparé avec ORBES Trips"))} · <a href="${esc(href)}">${esc(appHomeLabel(href))}</a></div>`;
};

export function exportCsv(trip: Trip, d: Data) {
  const head = ["Jour", "Lieu", "Type", "Statut", "Note /5", "MOQ", "Prix", "Délai", "Échantillon", "RDV", "Créneau", "Adresse", "Adresse (chinois)", "Métro", "Site", "Notes", "Contacts", "Visité", "Favori", "Latitude", "Longitude"].map((x) => t(x));
  const rows: (string | number)[][] = [head];
  for (const day of trip.days) {
    for (const p of trip.places.filter((x) => x.day === day.key)) {
      const s = d.places[p.id] || {};
      const contacts = d.contacts.filter((c) => c.placeId === p.id).map((c) => `${c.name} (${c.kind === "wa" ? "WhatsApp" : "WeChat"} ${c.value})`).join(" | ");
      rows.push([day.title, p.name, typeLabel(p.type), statusLabel(s.status), s.rating || "", s.moq || "", s.price || "", s.lead || "", s.sample || "", s.appt || "", p.time, p.address, p.cn, p.metro || "", p.website || "", notesText(s as Record<string, unknown>, p.added?.note).replace(/\n/g, " "), contacts, s.visited ? t("Oui") : "", s.favorite ? t("Oui") : "", p.lat, p.lng]);
    }
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `orbes-${trip.id}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function exportPdf(trip: Trip, d: Data): boolean {
  let h = `<!doctype html><html lang="${getLang()}"><head><meta charset="utf-8"><title>ORBES — ${esc(trip.title)}</title><style>
  body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#0a0a0a;padding:36px;max-width:780px;margin:0 auto;font-size:12px;line-height:1.45}
  .wm{letter-spacing:.46em;font-size:12px;font-weight:500}
  h1{font-weight:500;font-size:30px;letter-spacing:-.02em;margin:14px 0 2px}
  .sub{color:#666;margin:0 0 26px}
  h2{font-size:11px;letter-spacing:.24em;text-transform:uppercase;font-weight:500;border-bottom:1px solid #0a0a0a;padding-bottom:5px;margin:28px 0 8px}
  .p{padding:9px 0;border-bottom:1px solid #e5e2dc;page-break-inside:avoid}
  .n{font-weight:600;font-size:13px}.m{color:#666}.cn{font-family:"PingFang SC","Noto Sans SC",sans-serif}
  .b{display:inline-block;border:1px solid #0a0a0a;border-radius:3px;padding:0 5px;margin-right:4px;font-size:10.5px}${COLOPHON_CSS}
  </style></head><body>${PAGE_OPEN}<div class="wm">ORBES</div><h1>${esc(trip.title)}</h1><div class="sub">${esc(trip.subtitle)}, ${esc(trip.dateLabel)}. ${t("Hôtel : {name}.", { name: esc(trip.hotel.name) })}</div>`;
  for (const day of trip.days) {
    const items = trip.places.filter((x) => x.day === day.key);
    if (!items.length) continue;
    h += `<h2>${esc(day.title)}${day.theme ? ` — ${esc(day.theme)}` : ""}</h2>`;
    for (const p of items) {
      const s = d.places[p.id] || {};
      h += `<div class="p"><div class="n">${esc(p.name)}${s.visited ? " ✓" : ""}${s.favorite ? " ★" : ""}</div><div class="m">${esc(typeLabel(p.type))}${p.time ? `, ${esc(p.time)}` : ""}</div>`;
      const badges = [statusLabel(s.status), s.rating ? `${s.rating}/5` : ""].filter(Boolean);
      if (badges.length) h += `<div>${badges.map((b) => `<span class="b">${esc(b)}</span>`).join("")}</div>`;
      if (s.moq || s.price || s.lead || s.sample) h += `<div>${t("MOQ : {moq} · Prix : {price} · Délai : {lead} · Échantillon : {sample}", { moq: esc(s.moq || "–"), price: esc(s.price || "–"), lead: esc(s.lead || "–"), sample: esc(s.sample || "–") })}</div>`;
      if (s.appt) h += `<div>${t("RDV : {appt}", { appt: esc(s.appt) })}</div>`;
      if (p.address || p.cn) h += `<div class="m">${esc(p.address)}${p.address && p.cn ? " — " : ""}<span class="cn">${esc(p.cn)}</span></div>`;
      else if (p.added) h += `<div class="m">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>`;
      const cs = d.contacts.filter((c) => c.placeId === p.id);
      if (cs.length) h += `<div>${t("Contacts : {list}", { list: cs.map((c) => esc(`${c.name} (${c.kind === "wa" ? "WhatsApp" : "WeChat"} ${c.value})`)).join(", ") })}</div>`;
      const nt = notesText(s as Record<string, unknown>, p.added?.note, "\n");
      if (nt) h += `<div><b>${t("Notes :")}</b> ${esc(nt).replace(/\n/g, "<br>")}</div>`;
      h += `</div>`;
    }
  }
  h += `${pageClose()}</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(h);
  w.document.close();
  setTimeout(() => w.print(), 400);
  return true;
}

/**
 * Business mode: the suppliers' report (one supplier with `placeId`, else every supplier of the trip), to print or
 * save as PDF — sheet, status, meetings, contacts, notes, photos and what was spent there.
 */
export function exportReport(trip: Trip, d: Data, placeId?: string): boolean {
  const loc = locale();
  const exps = expensesOf(d.places as Record<string, Record<string, unknown>>);
  const sums = (list: Expense[]) => {
    const m = new Map<string, number>();
    for (const e of list) m.set(e.currency, (m.get(e.currency) || 0) + e.amount);
    return [...m].map(([c, v]) => money(v, c, loc)).join(" + ");
  };
  const isSupplier = (p: Trip["places"][number]) => {
    const s = d.places[p.id] || {};
    return p.type !== "hotel" && p.type !== "transport" && (p.type === "fabricant" || !!(s.status || s.moq || s.price || s.lead || s.sample || s.products) || exps.some((e) => e.placeId === p.id) || d.contacts.some((c) => c.placeId === p.id));
  };
  const list = placeId ? trip.places.filter((p) => p.id === placeId) : trip.places.filter(isSupplier);
  const today = new Date().toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" });
  let h = `<!doctype html><html lang="${getLang()}"><head><meta charset="utf-8"><title>ORBES — ${esc(placeId ? list[0]?.name || trip.title : trip.title)}</title><style>
  body{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;color:#0a0a0a;padding:36px;max-width:780px;margin:0 auto;font-size:12px;line-height:1.45}
  .wm{letter-spacing:.46em;font-size:12px;font-weight:500}
  h1{font-weight:500;font-size:28px;letter-spacing:-.02em;margin:14px 0 2px}
  .sub{color:#666;margin:0 0 22px}
  h2{font-size:16px;font-weight:600;margin:26px 0 6px;padding-top:10px;border-top:1px solid #0a0a0a;page-break-after:avoid}
  h3{font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;font-weight:500;color:#555;margin:14px 0 4px}
  table{width:100%;border-collapse:collapse;margin:6px 0 4px}td,th{text-align:left;padding:5px 6px;border-bottom:1px solid #e5e2dc;vertical-align:top}th{font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#666;font-weight:500}
  .m{color:#666}.cn{font-family:"PingFang SC","Noto Sans SC",sans-serif}
  .b{display:inline-block;border:1px solid #0a0a0a;border-radius:3px;padding:0 5px;margin-right:4px;font-size:10.5px}
  .ph{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.ph img{width:150px;height:150px;object-fit:cover;border-radius:4px}
  .sec{page-break-inside:avoid}${COLOPHON_CSS}
  </style></head><body>${PAGE_OPEN}<div class="wm">ORBES</div>`;
  h += `<h1>${esc(placeId ? list[0]?.name || "" : t("Compte-rendu fournisseurs"))}</h1>`;
  h += `<div class="sub">${esc(trip.title)} · ${esc(trip.dateLabel)} · ${esc(t("édité le {date}", { date: today }))}</div>`;
  if (!placeId && list.length) {
    h += `<table><tr><th>${esc(t("Fournisseur"))}</th><th>${esc(t("Statut"))}</th><th>${esc(t("Note"))}</th><th>MOQ</th><th>${esc(t("Prix"))}</th><th>${esc(t("Délai"))}</th><th>${esc(t("Dépenses"))}</th></tr>`;
    for (const p of list) {
      const s = d.places[p.id] || {};
      h += `<tr><td>${esc(p.name)}</td><td>${esc(statusLabel(s.status))}</td><td>${s.rating ? `${s.rating}/5` : ""}</td><td>${esc(s.moq || "")}</td><td>${esc(s.price || "")}</td><td>${esc(s.lead || "")}</td><td>${esc(sums(exps.filter((e) => e.placeId === p.id)))}</td></tr>`;
    }
    h += `</table>`;
  }
  for (const p of list) {
    const s = d.places[p.id] || {};
    const day = trip.days.find((x) => x.key === p.day);
    h += `<div class="sec">${placeId ? "" : `<h2>${esc(p.name)}</h2>`}`;
    h += `<div class="m">${esc(typeLabel(p.type))}${day?.dates?.length ? ` · ${esc(day.short)}${p.time ? `, ${esc(p.time)}` : ""}` : ""}</div>`;
    const badges = [statusLabel(s.status), s.rating ? `${s.rating}/5` : "", s.visited ? t("Visité") : ""].filter(Boolean);
    if (badges.length) h += `<div style="margin-top:4px">${badges.map((b) => `<span class="b">${esc(b)}</span>`).join("")}</div>`;
    if (p.address || p.cn) h += `<div class="m" style="margin-top:4px">${esc(p.address)}${p.address && p.cn ? " — " : ""}<span class="cn">${esc(p.cn)}</span></div>`;
    const rows: [string, string][] = ([
      [t("Produits"), s.products || ""], ["MOQ", s.moq || ""], [t("Prix unitaire"), s.price || ""], [t("Délai de production"), s.lead || ""],
      [t("Échantillon"), s.sample || ""], [t("Rendez-vous"), s.appt || ""],
    ] as [string, string][]).filter(([, v]) => v);
    if (rows.length) h += `<h3>${esc(t("Fiche fournisseur"))}</h3><table>${rows.map(([k, v]) => `<tr><td style="width:34%" class="m">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>`;
    const cs = d.contacts.filter((c) => c.placeId === p.id);
    if (cs.length) h += `<h3>${esc(t("Contacts"))}</h3><div>${cs.map((c) => esc(`${c.name} — ${c.kind === "wa" ? "WhatsApp" : "WeChat"} ${c.value}`)).join("<br>")}</div>`;
    const nt = notesText(s as Record<string, unknown>, p.added?.note, "\n");
    if (nt) h += `<h3>${esc(t("Notes de rendez-vous"))}</h3><div>${esc(nt).replace(/\n/g, "<br>")}</div>`;
    const ex = exps.filter((e) => e.placeId === p.id);
    if (ex.length) {
      h += `<h3>${esc(t("Dépenses"))}</h3><table>${ex.map((e) => `<tr><td style="width:22%" class="m">${esc(e.date)}</td><td>${esc(e.label || "")}</td><td>${esc(e.paidBy)}</td><td style="text-align:right">${esc(money(e.amount, e.currency, loc))}</td></tr>`).join("")}`;
      h += `<tr><td></td><td><b>${esc(t("Total"))}</b></td><td></td><td style="text-align:right"><b>${esc(sums(ex))}</b></td></tr></table>`;
    }
    const photos = d.photos.filter((x) => x.placeId === p.id).map((x) => photoSrc(x)).filter((x): x is string => !!x);
    if (photos.length) h += `<h3>${esc(t("Photos"))}</h3><div class="ph">${photos.map((src) => `<img src="${esc(src)}" alt="">`).join("")}</div>`;
    h += `</div>`;
  }
  if (!list.length) h += `<p class="m">${esc(t("Aucun fournisseur pour l'instant : un lieu devient fournisseur dès qu'il a un statut, une fiche fournisseur, un contact ou une dépense."))}</p>`;
  if (!placeId && exps.length) h += `<h2>${esc(t("Toutes les dépenses du voyage"))}</h2><div>${esc(sums(exps))}</div>`;
  h += `${pageClose()}</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(h);
  w.document.close();
  setTimeout(() => w.print(), 600);
  return true;
}
