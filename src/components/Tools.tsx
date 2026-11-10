// Phrases, converter, flights, practical info, export.
import { useState } from "react";
import type { Trip } from "../data/types";
import { exportCsv, exportPdf } from "../lib/export";
import { exportIcs } from "../lib/ics";
import { useLiveRate } from "../lib/rates";
import { getState, setEurRate, toast, useStore } from "../lib/store";
import { phase } from "../lib/time";
import { ICalPlus, ICopy, IDownload, IPlane, ISpeaker } from "./Icons";
import { ShowScreen, copy, speak } from "./ui";

const fmt = (n: number) => (Number.isFinite(n) ? (Math.round(n * 100) / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) : "");
const parse = (s: string) => parseFloat(s.replace(/\s/g, "").replace(",", "."));

export function Phrases({ trip }: { trip: Trip }) {
  const [show, setShow] = useState<{ zh: string; sub: string } | null>(null);
  const [q, setQ] = useState("");
  const qq = q.trim().toLowerCase();
  const groups = trip.phrases
    .map((g) => ({ ...g, items: g.items.filter((p) => !qq || p.fr.toLowerCase().includes(qq) || p.pinyin.toLowerCase().includes(qq) || p.zh.includes(q.trim())) }))
    .filter((g) => g.items.length);
  return (
    <div>
      <input className="input" placeholder="Chercher une phrase (français ou pinyin)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 14 }} />
      {groups.map((g) => (
        <div className="phr-group" key={g.title}>
          <span className="label">{g.title}</span>
          {g.items.map((p) => (
            <div className="phr" key={g.title + p.zh}>
              <button className="phr-main" onClick={() => setShow({ zh: p.zh, sub: `${p.pinyin} — ${p.fr}` })}>
                <span className="zh" lang="zh-CN">{p.zh}</span>
                <small>{p.pinyin}</small>
                <small className="fr">{p.fr}</small>
              </button>
              <button className="icon-btn" aria-label={`Écouter ${p.fr}`} onClick={() => speak(p.zh) || toast("Lecture vocale indisponible sur cet appareil")}>
                <ISpeaker />
              </button>
              <button className="icon-btn" aria-label={`Copier ${p.zh}`} onClick={() => copy(p.zh, "Phrase copiée", toast)}>
                <ICopy />
              </button>
            </div>
          ))}
        </div>
      ))}
      {!groups.length && <div className="empty"><b>Aucune phrase</b>Essayez un autre mot.</div>}
      {show && <ShowScreen zh={show.zh} sub={show.sub} onClose={() => setShow(null)} />}
    </div>
  );
}

export function Converter() {
  const rate = useStore((s) => s.settings.eurRate);
  const live = useLiveRate();
  const [rmb, setRmb] = useState("");
  const [eur, setEur] = useState("");
  const [rateTxt, setRateTxt] = useState(String(rate).replace(".", ","));
  const applyRate = (v: number) => {
    setEurRate(v);
    setRateTxt(String(Math.round(v * 10000) / 10000).replace(".", ","));
    if (rmb) setEur(fmt(parse(rmb) / v));
  };
  const fromRmb = (txt: string) => {
    setRmb(txt);
    setEur(txt ? fmt(parse(txt) / rate) : "");
  };
  return (
    <div>
      <div className="conv">
        <label className="conv-row">
          <input inputMode="decimal" placeholder="0" value={rmb} aria-label="Montant en yuans" onChange={(e) => fromRmb(e.target.value)} />
          <span>¥ CNY</span>
        </label>
        <label className="conv-row">
          <input inputMode="decimal" placeholder="0" value={eur} aria-label="Montant en euros" onChange={(e) => { setEur(e.target.value); setRmb(e.target.value ? fmt(parse(e.target.value) * rate) : ""); }} />
          <span>€ EUR</span>
        </label>
      </div>
      <div className="quick">
        {[50, 100, 200, 500, 1000, 5000].map((n) => (
          <button key={n} className="btn-sm" onClick={() => fromRmb(String(n))}>
            {n.toLocaleString("fr-FR")} ¥
          </button>
        ))}
      </div>
      <div className="rate-line">
        Taux utilisé : 1 € =
        <input inputMode="decimal" value={rateTxt} onChange={(e) => setRateTxt(e.target.value)} onBlur={() => { const v = parse(rateTxt); if (v > 0) applyRate(v); else setRateTxt(String(rate).replace(".", ",")); }} aria-label="Taux EUR vers CNY" />
        ¥
      </div>
      {live && (
        <div className="rate-line">
          Taux du jour (BCE, {new Date(live.date).toLocaleDateString("fr-FR")}) : <b style={{ color: "var(--ink)" }}>{live.rate.toFixed(4).replace(".", ",")} ¥</b>
          {Math.abs(live.rate - rate) > 0.0005 && (
            <button className="btn-sm" onClick={() => { applyRate(live.rate); toast("Taux du jour appliqué"); }}>
              Utiliser ce taux
            </button>
          )}
        </div>
      )}
      <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 14 }}>Le taux de change réel à la caisse (Alipay, carte) peut différer de 1 à 3 %.</p>
    </div>
  );
}

export function Flights({ trip }: { trip: Trip }) {
  const now = Date.now();
  const t = (iso?: string) => (iso ? new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: iso.endsWith("+01:00") ? "Europe/Paris" : trip.timezone }) : "—");
  return (
    <div>
      {trip.flights.map((f) => {
        const dep = f.departAt || (f.kind === "departure" ? f.at : undefined);
        const arr = f.arriveAt || (f.kind === "arrival" ? f.at : undefined);
        const done = now > new Date(arr || f.at).getTime();
        const inAir = dep && arr && now > new Date(dep).getTime() && now < new Date(arr).getTime();
        const dur = dep && arr ? Math.round((new Date(arr).getTime() - new Date(dep).getTime()) / 60000) : null;
        return (
          <div className="flight" key={f.code}>
            <div className="flight-top">
              <span className="label" style={{ color: "var(--ink)" }}>{f.code}{f.airline ? ` · ${f.airline}` : ""}</span>
              <span className={"pill" + (done ? " done" : inAir ? " live" : "")}>{done ? (f.kind === "arrival" ? "Arrivé" : "Parti") : inAir ? "En vol" : "Prévu"}</span>
            </div>
            <div className="flight-route">
              <div>
                <div className="iata">{f.from}</div>
                <div className="city">{f.fromCity}</div>
                <div className="time">{t(dep)}</div>
              </div>
              <div className="flight-line"><IPlane /></div>
              <div className="right">
                <div className="iata">{f.to}</div>
                <div className="city">{f.toCity}</div>
                <div className="time">{t(arr)}</div>
              </div>
            </div>
            <div className="flight-foot">
              <span>{f.terminal || ""}</span>
              <span>{dur ? `${Math.floor(dur / 60)} h ${String(dur % 60).padStart(2, "0")} de vol` : ""}</span>
            </div>
          </div>
        );
      })}
      <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 14 }}>Heures locales de chaque aéroport. Vérifiez le statut dans l'appli de la compagnie la veille du vol.</p>
    </div>
  );
}

export function Practical({ trip }: { trip: Trip }) {
  if (!trip.practical?.length) return <div className="empty"><b>Pas d'infos pratiques</b>Ce voyage n'en a pas encore.</div>;
  return (
    <div className="cards">
      {trip.practical.map((c) => (
        <div className="card" key={c.title}>
          <h4>{c.title}</h4>
          <p style={{ whiteSpace: "pre-line" }}>{c.text}</p>
        </div>
      ))}
    </div>
  );
}

export function ExportPanel({ trip }: { trip: Trip }) {
  const ph = phase(trip);
  return (
    <div>
      <p style={{ color: "var(--soft)", fontSize: 13.5, marginBottom: 16 }}>Tout le carnet {trip.title} : lieux, statuts, notes, fiches fournisseurs, contacts{ph !== "before" ? " et visites" : ""}.</p>
      <div className="cards">
        <button className="card" style={{ textAlign: "left" }} onClick={() => { if (!exportPdf(trip, getState().data)) toast("Autorisez les fenêtres pop-up pour imprimer le PDF"); }}>
          <IDownload width={20} height={20} />
          <h4 style={{ marginTop: 10 }}>PDF</h4>
          <p>Carnet imprimable, jour par jour.</p>
        </button>
        <button className="card" style={{ textAlign: "left" }} onClick={() => { exportCsv(trip, getState().data); toast("Fichier CSV téléchargé"); }}>
          <IDownload width={20} height={20} />
          <h4 style={{ marginTop: 10 }}>Tableur (CSV)</h4>
          <p>Pour Excel ou Numbers.</p>
        </button>
        <button className="card" style={{ textAlign: "left" }} onClick={() => { exportIcs(trip, getState().data.places); toast("Calendrier téléchargé"); }}>
          <ICalPlus width={20} height={20} />
          <h4 style={{ marginTop: 10 }}>Calendrier (.ics)</h4>
          <p>Le programme et les vols dans Calendrier ou Google Agenda.</p>
        </button>
      </div>
    </div>
  );
}
