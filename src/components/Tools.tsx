import { useState } from "react";
import { FLIGHTS, PHRASES, TRIP } from "../data/trip";
import { exportCsv, exportPdf } from "../lib/export";
import { getState, setEurRate, toast, useStore } from "../lib/store";
import { ICopy, IDownload, IPlane } from "./Icons";
import { ShowScreen, copy } from "./ui";

const fmt = (n: number) => (Number.isFinite(n) ? (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "");
const parse = (s: string) => parseFloat(s.replace(/\s/g, "").replace(",", "."));

export default function Tools() {
  return (
    <div className="tools">
      <Converter />
      <Phrases />
      <Flights />
      <Export />
    </div>
  );
}

function Converter() {
  const rate = useStore((s) => s.data.settings.eurRate);
  const [rmb, setRmb] = useState("");
  const [eur, setEur] = useState("");
  const [rateTxt, setRateTxt] = useState(String(rate).replace(".", ","));
  return (
    <section className="card">
      <h3>Convertisseur</h3>
      <p>Yuan et euro, dans les deux sens.</p>
      <div className="conv">
        <label className="conv-row">
          <input inputMode="decimal" placeholder="0" value={rmb} aria-label="Montant en yuans" onChange={(e) => { setRmb(e.target.value); const v = parse(e.target.value); setEur(e.target.value ? fmt(v / rate) : ""); }} />
          <span>¥ RMB</span>
        </label>
        <label className="conv-row">
          <input inputMode="decimal" placeholder="0" value={eur} aria-label="Montant en euros" onChange={(e) => { setEur(e.target.value); const v = parse(e.target.value); setRmb(e.target.value ? fmt(v * rate) : ""); }} />
          <span>€ EUR</span>
        </label>
      </div>
      <label className="conv-rate">
        Taux : 1 € =
        <input
          inputMode="decimal"
          value={rateTxt}
          onChange={(e) => setRateTxt(e.target.value)}
          onBlur={() => {
            const v = parse(rateTxt);
            if (v > 0) {
              setEurRate(v);
              const r = parse(rmb);
              if (rmb) setEur(fmt(r / v));
            } else setRateTxt(String(rate).replace(".", ","));
          }}
        />
        ¥
      </label>
    </section>
  );
}

function Phrases() {
  const [show, setShow] = useState<{ zh: string; sub: string } | null>(null);
  return (
    <section className="card">
      <h3>Phrases utiles</h3>
      <p>Touchez une phrase pour l'afficher en grand à votre interlocuteur.</p>
      {PHRASES.map((g) => (
        <div className="phr-group" key={g.title}>
          <h4>{g.title}</h4>
          {g.items.map((p) => (
            <div className="phr" key={p.zh}>
              <button className="phr-main" style={{ textAlign: "left" }} onClick={() => setShow({ zh: p.zh, sub: `${p.pinyin} — ${p.fr}` })}>
                <span className="zh" lang="zh-CN" style={{ display: "block" }}>{p.zh}</span>
                <small>{p.pinyin}</small>
                <small style={{ color: "var(--ink)" }}>{p.fr}</small>
              </button>
              <button className="icon-btn" aria-label={`Copier ${p.zh}`} onClick={() => copy(p.zh, "Phrase copiée", toast)}>
                <ICopy />
              </button>
            </div>
          ))}
        </div>
      ))}
      {show && <ShowScreen zh={show.zh} sub={show.sub} onClose={() => setShow(null)} />}
    </section>
  );
}

function Flights() {
  const now = Date.now();
  return (
    <section className="card">
      <h3>Vols</h3>
      <p>Cathay Pacific, via Hong Kong. Heures locales de Guangzhou.</p>
      {FLIGHTS.map((f) => {
        const at = new Date(f.at);
        const done = now > at.getTime();
        const when = at.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: TRIP.timezone });
        return (
          <div className="flight" key={f.code}>
            <div>
              <div className="iata">{f.from}</div>
              <div className="city">{f.fromCity}</div>
            </div>
            <div className="mid">
              <IPlane />
              {f.code}
            </div>
            <div className="right">
              <div className="iata">{f.to}</div>
              <div className="city">{f.toCity}</div>
            </div>
            <div className="flight-when">
              <span>
                {f.kind === "arrival" ? "Arrivée" : "Départ"} {when}
              </span>
              <span className={"pill" + (done ? " done" : "")}>{done ? (f.kind === "arrival" ? "Arrivé" : "Parti") : "Prévu"}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Export() {
  return (
    <section className="card">
      <h3>Exporter le carnet</h3>
      <p>Tous les lieux avec vos statuts, notes, fiches fournisseurs et contacts.</p>
      <div className="btn-row">
        <button className="btn" onClick={() => { if (!exportPdf(getState().data)) toast("Autorisez les fenêtres pop-up pour imprimer le PDF"); }}>
          <IDownload /> PDF
        </button>
        <button className="btn" onClick={() => { exportCsv(getState().data); toast("Fichier CSV téléchargé"); }}>
          <IDownload /> Tableur (CSV)
        </button>
      </div>
    </section>
  );
}
