// Phrases, converter, flights, practical info, export.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Trip } from "../data/types";
import { exportCsv, exportPdf, exportReport } from "../lib/export";
import { useBusiness } from "../lib/business";
import { exportIcs } from "../lib/ics";
import { useLiveRate } from "../lib/rates";
import { getState, requestPro, setEurRate, toast, tripHasPro, useCanEdit, useStore } from "../lib/store";
import { ai, AiError, imageToBase64, type ExtractResult } from "../lib/ai";
import { applyBookings } from "../lib/alerts";
import { phase } from "../lib/time";
import { ICalPlus, ICopy, IDownload, IOffline, IPlane, ISpeaker } from "./Icons";
import { cancelOffline, deleteOffline, offlineSupported, preparePack, useOffline, verifyPack } from "../lib/offline";
import { packFor, reportReady } from "../lib/offlinePack";
import { legacyPack, packSummary, type PackCheck } from "../lib/packPlan";
import { ShowScreen, copy, speak } from "./ui";
import { ExpenseReportSheet } from "./Expenses";
import { track } from "../lib/track";
import TripPassLine from "./v3/TripPass";
import { locale, t } from "../lib/i18n";

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
      <input className="input" placeholder={trip.lang && !trip.lang.code.toLowerCase().startsWith("zh") ? t("Chercher une phrase (français ou transcription)…") : t("Chercher une phrase (français ou pinyin)…")} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 14 }} />
      {groups.map((g) => (
        <div className="phr-group" key={g.title}>
          <span className="label">{g.title}</span>
          {g.items.map((p) => (
            <div className="phr" key={g.title + p.zh}>
              <button className="phr-main" onClick={() => setShow({ zh: p.zh, sub: `${p.pinyin} — ${p.fr}` })}>
                <span className="zh" lang={trip.lang?.code || "zh-CN"}>{p.zh}</span>
                <small>{p.pinyin}</small>
                <small className="fr">{p.fr}</small>
              </button>
              <button className="icon-btn" aria-label={t("Écouter {text}", { text: p.fr })} onClick={() => speak(p.zh) || toast(t("Lecture vocale indisponible sur cet appareil"))}>
                <ISpeaker />
              </button>
              <button className="icon-btn" aria-label={t("Copier {text}", { text: p.zh })} onClick={() => copy(p.zh, t("Phrase copiée"), toast)}>
                <ICopy />
              </button>
            </div>
          ))}
        </div>
      ))}
      {!groups.length && <div className="empty"><b>{t("Aucune phrase")}</b>{t("Essayez un autre mot.")}</div>}
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
          <input inputMode="decimal" placeholder="0" value={rmb} aria-label={t("Montant en yuans")} onChange={(e) => fromRmb(e.target.value)} />
          <span>¥ CNY</span>
        </label>
        <label className="conv-row">
          <input inputMode="decimal" placeholder="0" value={eur} aria-label={t("Montant en euros")} onChange={(e) => { setEur(e.target.value); setRmb(e.target.value ? fmt(parse(e.target.value) * rate) : ""); }} />
          <span>€ EUR</span>
        </label>
      </div>
      <div className="quick">
        {[50, 100, 200, 500, 1000, 5000].map((n) => (
          <button key={n} className="btn-sm" onClick={() => fromRmb(String(n))}>
            {n.toLocaleString(locale())} ¥
          </button>
        ))}
      </div>
      <div className="rate-line">
        {t("Taux utilisé : 1 € =")}
        <input inputMode="decimal" value={rateTxt} onChange={(e) => setRateTxt(e.target.value)} onBlur={() => { const v = parse(rateTxt); if (v > 0) applyRate(v); else setRateTxt(String(rate).replace(".", ",")); }} aria-label={t("Taux EUR vers CNY")} />
        ¥
      </div>
      {live && (
        <div className="rate-line">
          {t("Taux du jour (BCE, {date}) :", { date: new Date(live.date).toLocaleDateString(locale()) })}{" "}<b style={{ color: "var(--ink)" }}>{live.rate.toFixed(4).replace(".", ",")} ¥</b>
          {Math.abs(live.rate - rate) > 0.0005 && (
            <button className="btn-sm" onClick={() => { applyRate(live.rate); toast(t("Taux du jour appliqué")); }}>
              {t("Utiliser ce taux")}
            </button>
          )}
        </div>
      )}
      <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 14 }}>{t("Le taux de change réel à la caisse (Alipay, carte) peut différer de 1 à 3 %.")}</p>
    </div>
  );
}

/** A flight or a booking added to the trip: pasted confirmation or screenshot, read by the AI */
function AddBooking({ trip }: { trip: Trip }) {
  const canEdit = useCanEdit();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  if (!canEdit) return null;
  const read = async (shot?: File) => {
    if ((!text.trim() && !shot) || busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const image = shot ? await imageToBase64(shot, 1600, 0.8) : undefined;
      const r = await ai<ExtractResult>("extract", { text: text.trim(), image }, 100_000);
      const res = await applyBookings(r, trip, text.trim().slice(0, 60));
      setText("");
      setMsg(res.added ? (res.manual.length ? t("{n} ajouté(s) · à placer à la main : {list}", { n: res.added, list: res.manual.join(", ") }) : t("{n} ajouté(s) au voyage", { n: res.added })) : t("Rien de lisible : collez le texte de la confirmation ou une capture plus nette."));
    } catch (e) {
      setMsg(e instanceof AiError ? e.message : t("La lecture a échoué. Réessayez."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h4>{t("Ajouter un vol ou une réservation")}</h4>
      <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Collez une confirmation de vol, d'hôtel ou de restaurant")} style={{ width: "100%", marginTop: 8 }} />
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => pick.current?.click()}>{t("＋ Capture")}</button>
        <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void read()}>{busy ? t("Lecture…") : t("Lire")}</button>
      </div>
      <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void read(f); }} />
      {msg && <p style={{ marginTop: 10, color: "var(--soft)", fontSize: 13 }}>{msg}</p>}
    </div>
  );
}

export function Flights({ trip }: { trip: Trip }) {
  const now = Date.now();
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(locale(), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: iso.endsWith("+01:00") ? "Europe/Paris" : trip.timezone }) : "—");
  return (
    <div>
      <AddBooking trip={trip} />
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
              <span className={"pill" + (done ? " done" : inAir ? " live" : "")}>{done ? (f.kind === "arrival" ? t("Arrivé") : t("Parti")) : inAir ? t("En vol") : t("Prévu")}</span>
            </div>
            <div className="flight-route">
              <div>
                <div className="iata">{f.from}</div>
                <div className="city">{f.fromCity}</div>
                <div className="time">{when(dep)}</div>
              </div>
              <div className="flight-line"><IPlane /></div>
              <div className="right">
                <div className="iata">{f.to}</div>
                <div className="city">{f.toCity}</div>
                <div className="time">{when(arr)}</div>
              </div>
            </div>
            <div className="flight-foot">
              <span>{f.terminal || ""}</span>
              <span>{dur ? t("{h} h {m} de vol", { h: Math.floor(dur / 60), m: String(dur % 60).padStart(2, "0") }) : ""}</span>
            </div>
          </div>
        );
      })}
      <p style={{ fontSize: 12, color: "var(--mute)", marginTop: 14 }}>{t("Heures locales de chaque aéroport. Vérifiez le statut dans l'appli de la compagnie la veille du vol.")}</p>
    </div>
  );
}

// the last finished check of each trip's pack (complete or not): the badge shows it while the next check runs
const KNOWN_KEY = "orbes.offline.known";
const known = new Map<string, boolean>();
function knownComplete(tripId: string): boolean | undefined {
  if (known.has(tripId)) return known.get(tripId);
  try {
    const v = (JSON.parse(localStorage.getItem(KNOWN_KEY) || "{}") as Record<string, boolean>)[tripId];
    return typeof v === "boolean" ? v : undefined;
  } catch {
    return undefined;
  }
}
function rememberComplete(tripId: string, v: boolean) {
  known.set(tripId, v);
  try {
    const m = JSON.parse(localStorage.getItem(KNOWN_KEY) || "{}") as Record<string, boolean>;
    m[tripId] = v;
    localStorage.setItem(KNOWN_KEY, JSON.stringify(Object.fromEntries(Object.entries(m).slice(-40))));
  } catch {
    /* ignore: kept in memory for this opening */
  }
}

export function OfflineCard({ trip }: { trip: Trip }) {
  const st = useOffline();
  const states = useStore((s) => s.data.places);
  const mb = (b: number) => t("{n} Mo", { n: Math.max(1, Math.round(b / 1e6)) });
  // the pack of this trip (lot cycle): the map around its places (places added in the app are already in trip.places),
  // each day's routes, the programme's photos
  const spec = useMemo(() => packFor(trip, states), [trip, states]);
  const shellHost = location.hostname.endsWith(".vercel.app");
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent);
  // real check of what is on the phone (Safari may clear storage; places may have been added since)
  const [check, setCheck] = useState<PackCheck | null | "busy">(() => (st.state === "ready" && !st.phase ? "busy" : null));
  const key = `${spec.points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join("|")}#${spec.legs.length}#${spec.photos.length}`;
  const running = st.state === "running" || !!st.phase;
  useEffect(() => {
    if (st.state !== "ready" || st.phase) return setCheck(null);
    let alive = true;
    setCheck("busy");
    verifyPack(spec, trip).then((r) => {
      if (!alive) return;
      setCheck(r);
      if (r) {
        const s = packSummary(r);
        rememberComplete(trip.id, s.complete);
        if (s.mapOk) reportReady(trip.id, s.complete);
      }
    });
    return () => {
      alive = false;
    };
  }, [st.state, st.at, st.phase, key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!offlineSupported) return null;
  // "Mode hors ligne" = the pack of this trip on the phone (the trip itself is always on it)
  const checked = st.state === "ready" && !st.phase && check && check !== "busy" ? check : null;
  const sum = checked ? packSummary(checked) : null;
  const missing = checked?.map ? checked.map.missing : 0;
  // while the check runs (or when it could not run): the last known result; never checked on this phone: "Vérification…"
  // while it runs, "Activé" if it could not run (as before the pack)
  const last = knownComplete(trip.id);
  const pending = st.state === "ready" && !st.phase && !checked;
  const verifying = pending && check === "busy" && last === undefined;
  const on = sum ? sum.complete : pending && !verifying && last !== false;
  const pro = () => {
    if (!tripHasPro(trip.id)) return false;
    track("export", "offline", trip.id);
    void preparePack(spec);
    return true;
  };
  const activate = () => {
    if (!pro()) requestPro("export");
  };
  // one bar over the whole pack: map, then routes, then photos
  const rt = st.routes || { done: 0, total: 0, failed: 0 };
  const ph = st.photos || { done: 0, total: 0 };
  const mapDone = st.phase ? st.total : st.done;
  const all = st.total + rt.total + ph.total;
  const progress = all ? ((mapDone + (st.phase ? rt.done : 0) + (st.phase === "photos" ? ph.done : 0)) / all) * 100 : 0;
  return (
    <div className="card off-card" id="offline-mode">
      <h4>
        <IOffline width={18} height={18} /> {t("Mode hors ligne")}
        <span className={"off-state " + (running || verifying ? "busy" : on ? "on" : st.state === "ready" ? "warn" : "")}>
          {running ? t("Téléchargement") : verifying ? t("Vérification…") : on ? t("Activé") : st.state === "ready" ? t("À compléter") : t("Désactivé")}
        </span>
      </h4>
      {st.state === "none" && (
        <p>
          {t("Sans réseau, votre voyage reste disponible : programme, lieux, notes, statuts, check-list, dépenses et phrases sont toujours sur ce téléphone.")}{" "}
          <b>{t("La carte, les trajets et les photos se téléchargent en une fois.")}</b>{" "}
          {t("Activez le mode hors ligne une fois, de préférence en Wi-Fi, quelques jours avant le départ : la carte marchera ensuite sans réseau, même dans le métro, sans consommer de données.")}
        </p>
      )}
      {running && (
        <>
          <p>
            {st.phase === "routes"
              ? t("Calcul des trajets… {done} / {total}", { done: rt.done, total: rt.total })
              : st.phase === "photos"
                ? t("Photos des lieux… {done} / {total}", { done: ph.done, total: ph.total })
                : t("Téléchargement de la carte… {done} / {total} · {size}", { done: st.done, total: st.total, size: mb(st.bytes) })}
          </p>
          <div className="bar"><span style={{ width: `${Math.min(100, progress)}%` }} /></div>
          <p className="em-small">{t("Vous pouvez continuer à utiliser l'app pendant le téléchargement.")}</p>
        </>
      )}
      {st.state === "ready" && !st.phase && (
        <p>
          {st.at ? t("La carte de ce voyage est sur le téléphone ({size}, téléchargée le {date}).", { size: mb(st.bytes), date: new Date(st.at).toLocaleDateString(locale(), { day: "numeric", month: "long" }) }) : t("La carte de ce voyage est sur le téléphone ({size}).", { size: mb(st.bytes) })}{" "}
          {shellHost && standalone ? t("La carte, les lieux et votre position marchent sans réseau, même dans le métro.") : t("La carte, les lieux et votre position marchent sans réseau, même dans le métro, tant que cette page reste ouverte.")}
        </p>
      )}
      {st.state === "ready" && !st.phase && check === "busy" && <p className="em-small">{t("Vérification du contenu…")}</p>}
      {checked && (
        <>
          {checked.map && (missing === 0 ? (
            <p className="em-small">{t("Carte : complète")}</p>
          ) : (
            <p className="tr-err">{missing > 1 ? t("{n} éléments manquants (lieux ajoutés depuis, ou stockage effacé) : touchez « Mettre à jour » en Wi-Fi.", { n: missing.toLocaleString(locale()) }) : t("{n} élément manquant (lieux ajoutés depuis, ou stockage effacé) : touchez « Mettre à jour » en Wi-Fi.", { n: missing.toLocaleString(locale()) })}</p>
          ))}
          {checked.routes.total > 0 && <p className="em-small">{t("Trajets : {done} / {total}", { done: checked.routes.have, total: checked.routes.total })}</p>}
          {checked.routes.failed > 0 && <p className="em-small">{checked.routes.failed > 1 ? t("{n} trajets impossibles à calculer : une estimation s'affichera.", { n: checked.routes.failed }) : t("1 trajet impossible à calculer : une estimation s'affichera.")}</p>}
          {checked.photos === null ? (
            <p className="em-small">{t("Photos : hors ligne seulement dans l'app installée (orbesmap.vercel.app).")}</p>
          ) : (
            checked.photos.total > 0 && (
              <>
                <p className="em-small">{t("Photos : {done} / {total}", { done: checked.photos.have, total: checked.photos.total })}</p>
                {(checked.photos.failed || 0) > 0 && <p className="em-small">{(checked.photos.failed || 0) > 1 ? t("{n} photos introuvables : elles ne s'afficheront pas.", { n: checked.photos.failed || 0 }) : t("1 photo introuvable : elle ne s'affichera pas.")}</p>}
              </>
            )
          )}
          <p className="em-small">{checked.trip ? t("Voyage : programme, lieux et notes sur ce téléphone") : t("Voyage : à ouvrir une fois avec réseau")}</p>
          {checked.cards.have > 0 && (
            <>
              <p className="em-small">{t("Cartes chauffeur : {n} / {total} lieux", { n: checked.cards.have, total: checked.cards.total })}</p>
              {checked.cards.total > checked.cards.have && <p className="em-small">{checked.cards.total - checked.cards.have > 1 ? t("{n} lieux sans nom local à montrer au chauffeur.", { n: checked.cards.total - checked.cards.have }) : t("1 lieu sans nom local à montrer au chauffeur.")}</p>}
            </>
          )}
          {on ? (
            <p className="off-ok">{t("✓ Complète : la carte, les trajets de chaque jour et les photos du programme sont sur ce téléphone.")}</p>
          ) : (
            legacyPack(st) && <p className="em-small">{t("La carte marche déjà sans réseau. Trajets et photos : touchez « Mettre à jour » pour les ajouter.")}</p>
          )}
        </>
      )}
      {st.state === "ready" && !st.phase && st.error && <p className="tr-err">{st.error}</p>}
      {st.state === "error" && <p className="tr-err">{st.error}</p>}
      <div className="em-actions">
        {running ? (
          <button className="btn-sm" onClick={cancelOffline}>{t("Arrêter")}</button>
        ) : st.state === "ready" ? (
          <button className={"btn-sm" + (missing || (sum && !sum.complete) ? " on" : "")} onClick={activate}>{t("Mettre à jour")}</button>
        ) : (
          <button className="btn-sm on" onClick={activate}>{t("Activer le mode hors ligne")}</button>
        )}
        {st.state === "ready" && !running && <button className="btn-sm" onClick={() => { if (confirm(t("Désactiver le mode hors ligne ? La carte téléchargée est retirée de ce téléphone ; votre voyage, lui, reste."))) deleteOffline(); }}>{t("Désactiver")}</button>}
      </div>
      <details className="off-more">
        <summary>{t("Ce qui marche sans réseau")}</summary>
        <p>
          {t("Inclus : la carte autour de chaque lieu du programme et de vos lieux ajoutés (rues jusqu'au détail) et leurs environs, pour qu'elle reste nette en dézoomant. Vos notes, statuts, check-list, horaires, fiche d'urgence et phrases sont toujours sur le téléphone, sans téléchargement.")}
        </p>
        <p>
          {t("Pas inclus : les trajets depuis un endroit hors du programme (l'app affiche une estimation), les photos de l'autre téléphone pas encore ouvertes, et les fonctions IA (Traduire, Demander, Ajouter un lieu) qui ont besoin du réseau.")}
        </p>
        <p>
          {t("Les mises à jour de l'app ne touchent pas à la carte téléchargée. Après un ajout de lieu, la vérification ci-dessus le signale : « Mettre à jour » ne télécharge que ce qui manque.")}
          {ios && !standalone ? " " + t("Sur iPhone, Safari peut effacer les données d'un site non ouvert pendant 7 jours : activez le mode hors ligne 2 ou 3 jours avant le départ et ouvrez l'app régulièrement (ou utilisez l'icône d'écran d'accueil, non concernée).") : ""}
        </p>
      </details>
      <p className="em-small">
        {shellHost && standalone
          ? t("Cette icône s'ouvre aussi sans réseau.")
          : shellHost && ios
            ? t("Pour rouvrir l'app sans aucun réseau : ajoutez d'abord cette page à l'écran d'accueil (Partager › Sur l'écran d'accueil), ouvrez l'icône une fois avec réseau, puis activez le mode hors ligne depuis l'icône (sur iPhone, l'icône garde ses propres données).")
            : shellHost
              ? t("Ajoutez cette page à l'écran d'accueil pour la rouvrir sans réseau.")
              : t("Pour rouvrir l'app sans aucun réseau, utilisez orbesmap.vercel.app ajoutée à l'écran d'accueil, et activez le mode hors ligne depuis cette icône.")}
      </p>
    </div>
  );
}

export function Practical({ trip }: { trip: Trip }) {
  if (!trip.practical?.length) return <div className="cards"><TripPassLine trip={trip} /><OfflineCard trip={trip} /></div>;
  return (
    <div className="cards">
      <TripPassLine trip={trip} />
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
  const business = useBusiness(trip);
  const ph = phase(trip);
  const [expenseReport, setExpenseReport] = useState(false);
  return (
    <div>
      <p style={{ color: "var(--soft)", fontSize: 13.5, marginBottom: 16 }}>{ph !== "before" ? t("Tout le carnet {title} : lieux, statuts, notes, fiches fournisseurs, contacts et visites.", { title: trip.title }) : t("Tout le carnet {title} : lieux, statuts, notes, fiches fournisseurs, contacts.", { title: trip.title })}</p>
      <div className="cards">
        {business && (
          <button className="card" style={{ textAlign: "left" }} onClick={() => { if (!tripHasPro(trip.id)) return requestPro("business"); track("export", "report", trip.id); if (!exportReport(trip, getState().data)) toast(t("Autorisez les fenêtres pop-up pour imprimer le PDF")); }}>
            <IDownload width={20} height={20} />
            <h4 style={{ marginTop: 10 }}>{t("Compte-rendu fournisseurs")}</h4>
            <p>{t("Chaque fournisseur : fiche, statut, rendez-vous, contacts, notes, photos et dépenses. À envoyer à l'équipe.")}</p>
          </button>
        )}
        {business && (
          <button className="card" style={{ textAlign: "left" }} onClick={() => { if (!tripHasPro(trip.id)) return requestPro("business"); setExpenseReport(true); }}>
            <IDownload width={20} height={20} />
            <h4 style={{ marginTop: 10 }}>{t("Note de frais")}</h4>
            <p>{t("Les dépenses jour par jour, en euros, avec les justificatifs. En PDF et en tableur pour la comptabilité.")}</p>
          </button>
        )}
        {expenseReport && <ExpenseReportSheet trip={trip} onClose={() => setExpenseReport(false)} />}
        <button className="card" style={{ textAlign: "left" }} onClick={() => { if (!tripHasPro(trip.id)) return requestPro("export"); track("export", "pdf", trip.id); if (!exportPdf(trip, getState().data)) toast(t("Autorisez les fenêtres pop-up pour imprimer le PDF")); }}>
          <IDownload width={20} height={20} />
          <h4 style={{ marginTop: 10 }}>PDF</h4>
          <p>{t("Carnet imprimable, jour par jour.")}</p>
        </button>
        <button className="card" style={{ textAlign: "left" }} onClick={() => { if (!tripHasPro(trip.id)) return requestPro("export"); track("export", "csv", trip.id); exportCsv(trip, getState().data); toast(t("Fichier CSV téléchargé")); }}>
          <IDownload width={20} height={20} />
          <h4 style={{ marginTop: 10 }}>{t("Tableur (CSV)")}</h4>
          <p>{t("Pour Excel ou Numbers.")}</p>
        </button>
        <button className="card" style={{ textAlign: "left" }} onClick={() => { if (!tripHasPro(trip.id)) return requestPro("export"); track("export", "ics", trip.id); exportIcs(trip, getState().data.places); toast(t("Calendrier téléchargé")); }}>
          <ICalPlus width={20} height={20} />
          <h4 style={{ marginTop: 10 }}>{t("Calendrier (.ics)")}</h4>
          <p>{t("Le programme et les vols dans Calendrier ou Google Agenda.")}</p>
        </button>
      </div>
    </div>
  );
}
