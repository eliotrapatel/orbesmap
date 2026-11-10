import { DAYS, PLACES, STATUSES, TRIP, TYPE_LABEL } from "../data/trip";
import type { Data } from "./model";

const statusLabel = (k?: string | null) => STATUSES.find((s) => s.key === k)?.label || "";
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function exportCsv(d: Data) {
  const head = ["Jour", "Lieu", "Type", "Statut", "Note /5", "MOQ", "Prix", "Délai", "Échantillon", "RDV", "Adresse", "Adresse (chinois)", "Métro", "Site", "Notes", "Contacts", "Visité", "Favori", "Latitude", "Longitude"];
  const rows: (string | number)[][] = [head];
  for (const day of DAYS) {
    for (const p of PLACES.filter((x) => x.day === day.key)) {
      const s = d.places[p.id] || {};
      const contacts = d.contacts.filter((c) => c.placeId === p.id).map((c) => `${c.name} (${c.kind === "wa" ? "WhatsApp" : "WeChat"} ${c.value})`).join(" | ");
      rows.push([day.title, p.name, TYPE_LABEL[p.type], statusLabel(s.status), s.rating || "", s.moq || "", s.price || "", s.lead || "", s.sample || "", s.appt || "", p.address, p.cn, p.metro || "", p.website || "", (s.note || "").replace(/\n/g, " "), contacts, s.visited ? "Oui" : "", s.favorite ? "Oui" : "", p.lat, p.lng]);
    }
  }
  for (const pin of d.pins) rows.push(["Mes lieux", pin.name, "Lieu ajouté", "", "", "", "", "", "", "", "", "", "", "", pin.note || "", "", "", "", pin.lat, pin.lng]);
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `orbes-sourcing-${TRIP.id}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function exportPdf(d: Data): boolean {
  let h = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>ORBES — Carnet de sourcing ${TRIP.title}</title><style>
  body{font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;color:#000;padding:36px;max-width:780px;margin:0 auto;font-size:12px;line-height:1.45}
  h1{font-family:"Bodoni 72",Didot,Georgia,serif;font-weight:500;font-size:34px;margin:0}
  .sub{color:#555;margin:6px 0 26px}
  h2{font-family:"Bodoni 72",Didot,Georgia,serif;font-weight:500;font-size:20px;border-bottom:1px solid #000;padding-bottom:4px;margin:28px 0 8px}
  .p{padding:9px 0;border-bottom:1px solid #ddd;page-break-inside:avoid}
  .n{font-weight:600;font-size:13px}.m{color:#555}.cn{font-family:"PingFang SC","Noto Sans SC",sans-serif}
  .b{display:inline-block;border:1px solid #000;border-radius:3px;padding:0 5px;margin-right:4px;font-size:10.5px}
  </style></head><body><h1>ORBES — ${esc(TRIP.title)}</h1><div class="sub">Carnet de sourcing, du 7 au 13 juin 2026. Hôtel : ${esc(TRIP.hotel.name)}.</div>`;
  for (const day of DAYS) {
    const items = PLACES.filter((x) => x.day === day.key);
    if (!items.length) continue;
    h += `<h2>${esc(day.title)}${day.theme ? ` — ${esc(day.theme)}` : ""}</h2>`;
    for (const p of items) {
      const s = d.places[p.id] || {};
      h += `<div class="p"><div class="n">${esc(p.name)}${s.visited ? " ✓" : ""}${s.favorite ? " ★" : ""}</div><div class="m">${esc(TYPE_LABEL[p.type])}, ${esc(p.time)}</div>`;
      const badges = [statusLabel(s.status), s.rating ? `${s.rating}/5` : ""].filter(Boolean);
      if (badges.length) h += `<div>${badges.map((b) => `<span class="b">${esc(b)}</span>`).join("")}</div>`;
      if (s.moq || s.price || s.lead || s.sample) h += `<div>MOQ : ${esc(s.moq || "–")} · Prix : ${esc(s.price || "–")} · Délai : ${esc(s.lead || "–")} · Échantillon : ${esc(s.sample || "–")}</div>`;
      if (s.appt) h += `<div>RDV : ${esc(s.appt)}</div>`;
      h += `<div class="m">${esc(p.address)} — <span class="cn">${esc(p.cn)}</span></div>`;
      const cs = d.contacts.filter((c) => c.placeId === p.id);
      if (cs.length) h += `<div>Contacts : ${cs.map((c) => esc(`${c.name} (${c.kind === "wa" ? "WhatsApp" : "WeChat"} ${c.value})`)).join(", ")}</div>`;
      if (s.note) h += `<div><b>Notes :</b> ${esc(s.note).replace(/\n/g, "<br>")}</div>`;
      h += `</div>`;
    }
  }
  if (d.pins.length) {
    h += `<h2>Mes lieux</h2>`;
    for (const pin of d.pins) h += `<div class="p"><div class="n">${esc(pin.name)}</div>${pin.note ? `<div>${esc(pin.note)}</div>` : ""}<div class="m">${pin.lat.toFixed(5)}, ${pin.lng.toFixed(5)}</div></div>`;
  }
  h += `</body></html>`;
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(h);
  w.document.close();
  setTimeout(() => w.print(), 400);
  return true;
}
