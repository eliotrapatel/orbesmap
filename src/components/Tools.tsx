// Phrases, converter, flights, practical info, export.
import { useEffect, useState } from "react";
import type { Trip } from "../data/types";
import { exportCsv, exportPdf } from "../lib/export";
import { exportIcs } from "../lib/ics";
import { useLiveRate } from "../lib/rates";
import { getState, setEurRate, toast, useStore } from "../lib/store";
import { phase } from "../lib/time";
import { ICalPlus, ICopy, IDownload, IOffline, IPlane, ISpeaker } from "./Icons";
import { cancelOffline, deleteOffline, offlineSupported, prepareOffline, useOffline, verifyOffline } from "../lib/offline";
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

function OfflineCard({ trip }: { trip: Trip }) {
  const st = useOffline();
  const pins = useStore((s) => s.data.pins);
  const mb = (b: number) => `${Math.max(1, Math.round(b / 1e6))} Mo`;
  const points = [...trip.places, trip.hotel, ...trip.zones.map((z) => ({ lng: z.center[0], lat: z.center[1] })), ...pins];
  const shellHost = location.hostname.endsWith(".vercel.app");
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  // real check of what is on the phone (Safari may clear storage; places may have been added since)
  const [check, setCheck] = useState<{ expected: number; missing: number } | null | "busy">(null);
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|");
  useEffect(() => {
    if (st.state !== "ready") return setCheck(null);
    let alive = true;
    setCheck("busy");
    verifyOffline(points).then((r) => alive && setCheck(r));
    return () => {
      alive = false;
    };
  }, [st.state, st.at, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!offlineSupported) return null;
  return (
    <div className="card off-card">
      <h4><IOffline width={18} height={18} /> Carte hors ligne</h4>
      {st.state === "ready" && (
        <p>
          Prête ({mb(st.bytes)} sur le téléphone{st.at ? `, préparée le ${new Date(st.at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}` : ""}). La carte, les lieux et votre position marchent sans réseau, même dans le métro
          {shellHost && standalone ? "." : ", tant que cette page reste ouverte."}
        </p>
      )}
      {st.state === "ready" && check === "busy" && <p className="em-small">Vérification du contenu…</p>}
      {st.state === "ready" && check && check !== "busy" && (
        check.missing === 0 ? (
          <p className="off-ok">✓ Complète : les {check.expected.toLocaleString("fr-FR")} éléments sont sur ce téléphone (programme, lieux ajoutés, Suzhou, globe).</p>
        ) : (
          <p className="tr-err">{check.missing.toLocaleString("fr-FR")} élément{check.missing > 1 ? "s" : ""} manquant{check.missing > 1 ? "s" : ""} (lieux ajoutés depuis, ou stockage effacé) : touchez « Mettre à jour » en Wi-Fi.</p>
        )
      )}
      {st.state === "ready" && st.error && <p className="tr-err">{st.error}</p>}
      {st.state === "none" && <p>Téléchargez une fois, en Wi-Fi, les quartiers du programme, Suzhou et vos lieux ajoutés (environ 35 Mo à télécharger, 60 Mo sur le téléphone). Ensuite la carte s'affiche sans réseau et ne consomme plus de données mobiles.</p>}
      {st.state === "running" && (
        <>
          <p>Téléchargement… {st.done} / {st.total} · {mb(st.bytes)}</p>
          <div className="bar"><span style={{ width: `${st.total ? (st.done / st.total) * 100 : 0}%` }} /></div>
        </>
      )}
      {st.state === "error" && <p className="tr-err">{st.error}</p>}
      <div className="em-actions">
        {st.state === "running" ? (
          <button className="btn-sm" onClick={cancelOffline}>Arrêter</button>
        ) : (
          <button className="btn-sm on" onClick={() => prepareOffline(points)}>{st.state === "ready" ? "Mettre à jour" : "Préparer hors ligne"}</button>
        )}
        {st.state === "ready" && <button className="btn-sm" onClick={() => { if (confirm("Supprimer la carte hors ligne de ce téléphone ?")) deleteOffline(); }}>Supprimer</button>}
      </div>
      <details className="off-more">
        <summary>Ce qui est inclus</summary>
        <p>
          Inclus : la carte autour de chaque lieu du programme et de vos lieux ajoutés (rues jusqu'au détail), toute la région (Suzhou compris), le globe de l'accueil. Vos notes, statuts, check-list, horaires, fiche d'urgence et phrases sont toujours sur le téléphone, sans téléchargement.
        </p>
        <p>
          Pas inclus : les itinéraires jamais calculés (l'app affiche une estimation), les photos de l'autre téléphone pas encore ouvertes, et les fonctions IA (Traduire, Demander, Ajouter un lieu) qui ont besoin du réseau.
        </p>
        <p>
          Les mises à jour de l'app ne touchent pas à la carte téléchargée. Après un ajout de lieu, la vérification ci-dessus le signale : « Mettre à jour » ne télécharge que ce qui manque.
          {ios && !standalone ? " Sur iPhone, Safari peut effacer les données d'un site non ouvert pendant 7 jours : préparez la carte 2 ou 3 jours avant le départ et ouvrez l'app régulièrement (ou utilisez l'icône d'écran d'accueil, non concernée)." : ""}
        </p>
      </details>
      <p className="em-small">
        {shellHost && standalone
          ? "Cette icône s'ouvre aussi sans réseau."
          : shellHost && ios
            ? "Pour rouvrir l'app sans aucun réseau : ajoutez d'abord cette page à l'écran d'accueil (Partager › Sur l'écran d'accueil), ouvrez l'icône une fois avec réseau, puis préparez la carte depuis l'icône (sur iPhone, l'icône garde ses propres données)."
            : shellHost
              ? "Ajoutez cette page à l'écran d'accueil pour la rouvrir sans réseau."
              : "Pour rouvrir l'app sans aucun réseau, utilisez orbesmap.vercel.app ajoutée à l'écran d'accueil, et préparez la carte depuis cette icône."}
      </p>
    </div>
  );
}

export function Practical({ trip }: { trip: Trip }) {
  if (!trip.practical?.length) return <div className="cards"><OfflineCard trip={trip} /></div>;
  return (
    <div className="cards">
      <OfflineCard trip={trip} />
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
