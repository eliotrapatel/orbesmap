import { useState } from "react";
import type { Trip } from "../data/types";
import { amapDirections, km } from "../lib/geo";
import { useLoc } from "../lib/locate";
import { fmtDistance } from "../lib/route";
import { updateRecord, useStore } from "../lib/store";
import { IExpand, INav } from "./Icons";
import { SavedInput, ShowScreen } from "./ui";

const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, "")}`;

/** Emergency sheet: works without network (everything is in the page). */
export default function Emergency({ trip }: { trip: Trip }) {
  const em = trip.emergency;
  const fix = useLoc((s) => s.fix);
  const ins = (useStore((s) => s.data.places["_info:insurance"]) || {}) as Record<string, string>;
  const [show, setShow] = useState<{ zh: string; sub: string } | null>(null);
  if (!em) return <div className="empty"><b>Pas de fiche d'urgence</b>Ce voyage n'en a pas.</div>;
  const from = fix || trip.hotel;
  const hospitals = em.hospitals.slice().sort((a, b) => km(from, a) - km(from, b));
  const setIns = (k: string) => (v: string) => updateRecord("_info:insurance", { [k]: v });

  return (
    <div className="em">
      <p className="em-intro">Tout ici s'affiche sans réseau. Touchez un numéro pour appeler.</p>

      <section className="em-sec">
        <span className="label">Numéros d'urgence en Chine</span>
        <div className="em-nums">
          {em.numbers.map((n) => (
            <a key={n.number + n.label} className="em-num" href={tel(n.number)}>
              <b>{n.number}</b>
              <span>{n.label}</span>
              {n.note && <small>{n.note}</small>}
            </a>
          ))}
        </div>
      </section>

      <section className="em-sec">
        <span className="label">Consulat général de France</span>
        <div className="card em-card">
          <h4>{em.consulate.name}</h4>
          <p>{em.consulate.address}</p>
          <p className="zh" lang="zh-CN">{em.consulate.cn}</p>
          {em.consulate.hours && <p className="em-small">{em.consulate.hours}</p>}
          <div className="em-actions">
            <a className="btn-sm" href={tel(em.consulate.phone)}>Standard {em.consulate.phone}</a>
            {em.consulate.emergency && <a className="btn-sm em-red" href={tel(em.consulate.emergency)}>Urgence {em.consulate.emergency}</a>}
            <button className="btn-sm" onClick={() => setShow({ zh: em.consulate.cn, sub: em.consulate.address })}><IExpand /> Montrer au chauffeur</button>
            <a className="btn-sm" href={amapDirections({ lat: em.consulate.lat, lng: em.consulate.lng, name: "法国驻上海总领事馆" })} target="_blank" rel="noopener"><INav /> Amap</a>
          </div>
        </div>
      </section>

      <section className="em-sec">
        <span className="label">Hôpitaux internationaux · du plus proche {fix ? "de vous" : "de l'hôtel"}</span>
        {hospitals.map((h) => (
          <div key={h.name} className="card em-card">
            <h4>{h.name}</h4>
            <p className="em-small">
              À {fmtDistance(km(from, h) * 1000)} · {h.er24 ? "urgences 24h/24" : "pas d'urgences la nuit"}
              {h.english ? " · personnel anglophone" : ""}
            </p>
            <p>{h.address}</p>
            <p className="zh" lang="zh-CN">{h.cn} · {h.addressCn}</p>
            {h.directBilling && <p className="em-small">Assurances : {h.directBilling}</p>}
            {h.note && <p className="em-small">{h.note}</p>}
            <div className="em-actions">
              <a className="btn-sm em-red" href={tel(h.phone)}>Appeler {h.phone}</a>
              <button className="btn-sm" onClick={() => setShow({ zh: `${h.cn}\n${h.addressCn}`, sub: h.address })}><IExpand /> Montrer au chauffeur</button>
              <a className="btn-sm" href={amapDirections({ lat: h.lat, lng: h.lng, name: h.cn })} target="_blank" rel="noopener"><INav /> Amap</a>
            </div>
          </div>
        ))}
      </section>

      <section className="em-sec">
        <span className="label">Assurance voyage · partagée avec votre père</span>
        <div className="card em-card">
          <label className="field"><span>Assureur</span><SavedInput value={ins.insurer || ""} placeholder="ex. AXA Assistance, carte Visa Premier…" onSave={setIns("insurer")} /></label>
          <label className="field"><span>N° de contrat</span><SavedInput value={ins.policy || ""} onSave={setIns("policy")} /></label>
          <label className="field"><span>Assistance 24h/24 (depuis l'étranger)</span><SavedInput value={ins.phone || ""} placeholder="+33 1 …" onSave={setIns("phone")} /></label>
          <label className="field"><span>À savoir</span><SavedInput multiline value={ins.note || ""} placeholder="Appeler avant toute dépense, franchise, garde le dossier…" onSave={setIns("note")} /></label>
          {ins.phone && <a className="btn primary block" style={{ marginTop: 12 }} href={tel(ins.phone)}>Appeler l'assistance</a>}
        </div>
      </section>
      {show && <ShowScreen zh={show.zh} sub={show.sub} onClose={() => setShow(null)} />}
    </div>
  );
}
