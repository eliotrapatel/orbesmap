import { useEffect, useRef, useState } from "react";
import { ai, AiError, imageToBase64, type ConciergeResult } from "../../lib/ai";
import { dateLabel, dayCount, searchCities, type Destination } from "../../lib/newTrip";
import { getLang, t } from "../../lib/i18n";
import { getState, requestPro, useStore } from "../../lib/store";
import { track } from "../../lib/track";
import Shell from "./Shell";
import { createTripFromWizard, WIZARD_KEY, type Wiz } from "./CreateWizard";
import { PACES, TRAVEL } from "./Onboarding";

// ---------- the choice: the form or the concierge ----------

/** "Créer un voyage": a preview of the two ways, the person picks one */
export function CreateChooser({ onPick, onCancel }: { onPick: (k: "concierge" | "form") => void; onCancel: () => void }) {
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onCancel} aria-label={t("Fermer")}>✕</button>
      <span className="v3-grow" />
    </div>
  );
  return (
    <Shell ring={false} top={top}>
      <p className="v3-lbl" style={{ marginTop: 18 }}>{t("Créer un voyage")}</p>
      <h1 className="v3-d v3-h2">{t("Comment préférez-vous ?")}</h1>
      <button type="button" className="ch-card" onClick={() => onPick("concierge")}>
        <div className="ch-preview ch-chat" aria-hidden="true">
          <span className="cc-b me">{t("Florence 4 jours en décembre, avec ma femme. On adore la cuisine.")}</span>
          <span className="cc-b">{t("Parfait. Vous avez déjà réservé l'hôtel ou les vols ?")}</span>
          <span className="cc-mini">📍 Florence · 📅 {t("déc.")} · 👥 {t("À deux")}</span>
        </div>
        <span className="ch-t"><b>{t("Avec le concierge")}</b><small>{t("Racontez votre voyage comme à un ami : texte, voix, captures ou liens. Il pose les bonnes questions.")}</small></span>
      </button>
      <button type="button" className="ch-card" onClick={() => onPick("form")}>
        <div className="ch-preview ch-form" aria-hidden="true">
          <span className="ch-bars"><i className="on" /><i /><i /><i /></span>
          <span className="ch-field">{t("Où allez-vous ?")}</span>
          <span className="ch-field">{t("Quand partez-vous ?")}</span>
          <span className="ch-field dim">{t("Ce que vous savez déjà")}</span>
        </div>
        <span className="ch-t"><b>{t("Le formulaire")}</b><small>{t("4 étapes rapides et précises, à votre rythme.")}</small></span>
      </button>
    </Shell>
  );
}

// ---------- the conversation ----------

type Facts = Omit<ConciergeResult, "reply" | "ready"> & { cities: Destination[] };
type Msg = { from: "concierge" | "me"; text: string; image?: boolean; cards?: string[] };
type Saved = { msgs: Msg[]; facts: Facts; ready: boolean };
const KEY = "orbes.concierge.v1";
const EMPTY: Facts = { destinations: [], cities: [], start: "", end: "", travel: "", pace: "", hotel: { name: "", address: "" }, flights: [], places: [], fixed: [], wishes: [], interests: [] };

const load = (): Saved | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    return null;
  }
};
const save = (s: Saved | null) => {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
const label = (list: readonly { key: string; label: string }[], k: string) => list.find((x) => x.key === k)?.label || "";

/** One line per thing understood (used for the cards and the recap); `kind:index` keys allow removing them */
function items(f: Facts): { key: string; icon: string; text: string }[] {
  const out: { key: string; icon: string; text: string }[] = [];
  f.cities.forEach((c, i) => out.push({ key: `city:${i}`, icon: "📍", text: [c.name, c.countryName].filter(Boolean).join(", ") }));
  if (f.start && f.end) out.push({ key: "dates", icon: "📅", text: `${dateLabel(f.start, f.end)} · ${t("{n} jours", { n: dayCount(f.start, f.end) })}` });
  if (f.travel || f.pace) out.push({ key: "who", icon: "👥", text: [t(label(TRAVEL, f.travel)), f.pace ? t("rythme {p}", { p: t(label(PACES, f.pace)).toLowerCase() }) : ""].filter(Boolean).join(" · ") });
  f.flights.forEach((x, i) => out.push({ key: `flight:${i}`, icon: "✈", text: `${x.code} ${x.from} → ${x.to}${x.departAt ? ` · ${x.departAt.slice(8, 10)}/${x.departAt.slice(5, 7)} ${x.departAt.slice(11, 16)}` : ""}` }));
  if (f.hotel.name) out.push({ key: "hotel", icon: "🏨", text: [f.hotel.name, f.hotel.address].filter(Boolean).join(" · ") });
  f.places.forEach((p, i) => out.push({ key: `place:${i}`, icon: p.mustSee ? "★" : "•", text: `${p.name}${p.city ? ` (${p.city})` : ""}${p.why ? ` · ${p.why}` : ""}` }));
  f.fixed.forEach((x, i) => out.push({ key: `fixed:${i}`, icon: "🕒", text: `${x.name}${x.date ? ` · ${x.date}${x.time ? ` ${x.time}` : ""}` : ""}` }));
  f.wishes.forEach((w, i) => out.push({ key: `wish:${i}`, icon: "✦", text: w }));
  if (f.interests.length) out.push({ key: "interests", icon: "♡", text: f.interests.join(", ") });
  return out;
}
function without(f: Facts, key: string): Facts {
  const [k, i] = key.split(":");
  const n = Number(i);
  const drop = <T,>(a: T[]) => a.filter((_, j) => j !== n);
  if (k === "city") return { ...f, cities: drop(f.cities), destinations: drop(f.destinations) };
  if (k === "dates") return { ...f, start: "", end: "" };
  if (k === "who") return { ...f, travel: "", pace: "" };
  if (k === "flight") return { ...f, flights: drop(f.flights) };
  if (k === "hotel") return { ...f, hotel: { name: "", address: "" } };
  if (k === "place") return { ...f, places: drop(f.places) };
  if (k === "fixed") return { ...f, fixed: drop(f.fixed) };
  if (k === "wish") return { ...f, wishes: drop(f.wishes) };
  if (k === "interests") return { ...f, interests: [] };
  return f;
}
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** What the form needs, from what the concierge understood */
function toWizard(f: Facts): Wiz {
  const p = getState().profile;
  return {
    step: f.cities.length && validDate(f.start) && validDate(f.end) ? 3 : 1,
    cities: f.cities, start: f.start, end: f.end, hotelName: f.hotel.name, hotelAddress: f.hotel.address, flights: f.flights, know: "",
    places: f.places.map((x) => ({ ...x, keep: true })), fixed: f.fixed.map((x) => ({ ...x, keep: true })), wishes: f.wishes.map((text) => ({ text, keep: true })),
    pace: f.pace || (p.pace as string) || "balanced", interests: f.interests.length ? f.interests : (p.interests as string[]) || [], dayWishes: {},
    mode: f.travel === "business" ? "business" : "leisure",
  };
}

/** Creating a trip by talking: the concierge understands each answer, turns it into cards and asks what is missing */
export default function Concierge({ onCancel, onCreated, onForm }: { onCancel: () => void; onCreated: (id: string) => void; onForm: () => void }) {
  const name = useStore((s) => (s.profile.name as string) || "");
  const plan = useStore((s) => s.plan);
  const [state, setState] = useState<Saved>(() => load() || {
    msgs: [{ from: "concierge", text: name
      ? t("Bonjour {name}. Je suis votre concierge. Où partez-vous, et quand ? Vous pouvez aussi m'envoyer vos réservations, des captures ou des liens : je fais le tri.", { name })
      : t("Bonjour. Je suis votre concierge. Où partez-vous, et quand ? Vous pouvez aussi m'envoyer vos réservations, des captures ou des liens : je fais le tri.") }],
    facts: EMPTY, ready: false,
  });
  const [text, setText] = useState("");
  const [shot, setShot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recap, setRecap] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [listening, setListening] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const rec = useRef<{ stop: () => void } | null>(null);
  useEffect(() => {
    save(state);
  }, [state]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.msgs.length, busy]);

  const f = state.facts;
  const all = items(f);
  const canLaunch = f.cities.length > 0 && validDate(f.start) && validDate(f.end) && f.end >= f.start;

  const send = async () => {
    const msg = text.trim();
    if ((!msg && !shot) || busy) return;
    setBusy(true);
    setErr(null);
    const mine: Msg = { from: "me", text: msg, image: !!shot };
    const history = state.msgs.slice(-8).map((m) => `${m.from === "me" ? "Voyageur" : "Concierge"} : ${m.text}`).join("\n");
    setState((s) => ({ ...s, msgs: [...s.msgs, mine] }));
    setText("");
    const image = shot ? await imageToBase64(shot, 1600, 0.8).catch(() => undefined) : undefined;
    setShot(null);
    try {
      const { cities: _c, ...known } = f;
      const r = await ai<ConciergeResult>("concierge", { text: msg, image, facts: JSON.stringify(known), history }, 290_000);
      // the destinations on the map: found once, kept in the order the concierge gives
      const cities: Destination[] = [];
      for (const d of r.destinations || []) {
        const have = f.cities.find((c) => c.name.toLowerCase() === d.name.toLowerCase()) || cities.find((c) => c.name.toLowerCase() === d.name.toLowerCase());
        if (have) {
          if (!cities.includes(have)) cities.push(have);
          continue;
        }
        const found = await searchCities(d.name).catch(() => []);
        const best = found.find((c) => !d.country || (c.country || "").toLowerCase() === d.country.toLowerCase()) || found[0];
        if (best) cities.push(best);
      }
      const facts: Facts = {
        destinations: r.destinations || [], cities, start: validDate(r.start) ? r.start : "", end: validDate(r.end) ? r.end : "",
        travel: r.travel || "", pace: r.pace || "", hotel: r.hotel || { name: "", address: "" }, flights: r.flights || [], places: r.places || [],
        fixed: r.fixed || [], wishes: r.wishes || [], interests: r.interests || [],
      };
      const before = new Set(items(f).map((x) => `${x.icon}${x.text}`));
      const fresh = items(facts).filter((x) => !before.has(`${x.icon}${x.text}`)).map((x) => `${x.icon} ${x.text}`);
      setState((s) => ({ msgs: [...s.msgs, { from: "concierge", text: r.reply || t("C'est noté."), cards: fresh }], facts, ready: !!r.ready }));
    } catch (e) {
      setErr(e instanceof AiError ? e.message : t("Le concierge ne répond pas. Réessayez."));
      setState((s) => ({ ...s, msgs: s.msgs.filter((m) => m !== mine) }));
      setText(msg);
    } finally {
      setBusy(false);
    }
  };

  const mic = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition || W.webkitSpeechRecognition;
    if (!Ctor) return setErr(t("La dictée n'est pas disponible dans ce navigateur."));
    const r = new Ctor();
    r.lang = getLang() === "en" ? "en-US" : "fr-FR";
    r.interimResults = true;
    r.continuous = true;
    const base = text ? `${text.trim()} ` : "";
    r.onresult = (e) => {
      let s = "";
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
      setText(base + s);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  const launch = async () => {
    if (!canLaunch || launching) return;
    const p = getState().plan;
    if (p && !p.pro && p.prepLeft <= 0) return requestPro("prep");
    setLaunching(true);
    try {
      const w = toWizard(f);
      const id = await createTripFromWizard(w, w.mode === "business" && (!plan || plan.pro));
      track("trip_created", "concierge", id);
      save(null);
      onCreated(id);
    } catch {
      setErr(t("Le voyage n'a pas pu être créé. Réessayez."));
      setLaunching(false);
    }
  };
  const toForm = () => {
    try {
      localStorage.setItem(WIZARD_KEY, JSON.stringify(toWizard(f)));
    } catch {
      /* ignore */
    }
    save(null);
    onForm();
  };

  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onCancel} aria-label={t("Fermer")}>✕</button>
      <span className="v3-grow" style={{ textAlign: "center", color: "var(--soft)", fontSize: 13 }}>{t("Concierge")}</span>
      <button type="button" className="v3-chip cc-point" onClick={() => setRecap(true)} disabled={!all.length}>{t("Le point")}{all.length ? ` · ${all.length}` : ""}</button>
    </div>
  );
  return (
    <Shell ring={false} top={top} className="v3-concierge">
      <div className="cc-thread" aria-live="polite">
        {state.msgs.map((m, i) => (
          <div key={i} className={"cc-row " + m.from}>
            <div className={"cc-b " + (m.from === "me" ? "me" : "")}>
              {m.image && <span className="cc-att">📷 {t("Capture jointe")}</span>}
              {m.text}
            </div>
            {m.cards && m.cards.length > 0 && (
              <div className="cc-cards">
                {m.cards.slice(0, 12).map((c, j) => <span key={j} className="cc-card">{c}</span>)}
                {m.cards.length > 12 && <span className="cc-card dim">{t("+ {n} autres", { n: m.cards.length - 12 })}</span>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="cc-row concierge"><div className="cc-b cc-typing"><i /><i /><i /></div></div>}
        {state.ready && canLaunch && !busy && (
          <div className="cc-ready">
            <button className="v3-btn" onClick={() => setRecap(true)}>{t("Faire le point et lancer la préparation")}</button>
          </div>
        )}
        <div ref={end} />
      </div>
      {err && <p className="v3-err">{err}</p>}
      <div className="cc-input">
        {shot && <span className="cc-shot">📷 {shot.name} <button onClick={() => setShot(null)} aria-label={t("Retirer la capture")}>×</button></span>}
        <div className="cc-bar">
          <button type="button" className="cc-icon" onClick={() => file.current?.click()} aria-label={t("Ajouter une capture ou une photo")}>📷</button>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={listening ? t("Je vous écoute…") : t("Écrivez, collez un lien, ou dictez…")} aria-label={t("Message au concierge")}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button type="button" className={"cc-icon" + (listening ? " on" : "")} onClick={mic} aria-label={listening ? t("Arrêter la dictée") : t("Dicter")} aria-pressed={listening}>🎙</button>
          <button type="button" className="cc-send" onClick={() => void send()} disabled={busy || (!text.trim() && !shot)} aria-label={t("Envoyer")}>↑</button>
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { setShot(e.target.files?.[0] || null); e.target.value = ""; }} />
        <button type="button" className="v3-link cc-switch" onClick={toForm}>{t("Je préfère remplir le formulaire")}</button>
      </div>

      {recap && (
        <div className="v3-acct-wrap pt-sheet-wrap" onClick={() => setRecap(false)}>
          <div className="v3-glass pt-sheet cc-recap" role="dialog" aria-label={t("Le point")} onClick={(e) => e.stopPropagation()}>
            <span className="v3-lbl">{t("Le point")}</span>
            <h2 className="v3-d" style={{ fontSize: 24, marginTop: 8 }}>{f.cities.map((c) => c.name).join(" · ") || t("Votre voyage")}</h2>
            <div className="cc-list">
              {all.map((x) => (
                <div key={x.key} className="cc-item">
                  <span className="cc-ic">{x.icon}</span>
                  <span className="v3-grow">{x.text}</span>
                  <button type="button" onClick={() => setState((s) => ({ ...s, facts: without(s.facts, x.key) }))} aria-label={t("Retirer")}>×</button>
                </div>
              ))}
              {!all.length && <p className="v3-note">{t("Rien encore : parlez-moi de votre voyage.")}</p>}
            </div>
            {!canLaunch && <p className="v3-note">{t("Il me faut au moins la destination et les dates pour lancer la préparation.")}</p>}
            <button className="v3-btn" style={{ marginTop: 14 }} disabled={!canLaunch || launching} onClick={() => void launch()}>{launching ? t("Création…") : t("Lancer la préparation")}</button>
            <button type="button" className="v3-link" onClick={() => setRecap(false)}>{t("Continuer la conversation")}</button>
          </div>
        </div>
      )}
    </Shell>
  );
}

type SR = {
  lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void;
};
