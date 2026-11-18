import { Fragment, useEffect, useRef, useState } from "react";
import { ai, AiError, imageToBase64, type ConciergeResult, type ExtractResult } from "../../lib/ai";
import { dateLabel, dayCount, searchCities, type Destination } from "../../lib/newTrip";
import { getLang, locale, t } from "../../lib/i18n";
import { getState, requestPro, useStore } from "../../lib/store";
import { track } from "../../lib/track";
import OrbitMark from "../OrbitMark";
import Shell from "./Shell";
import { createTripFromWizard, WIZARD_KEY, type Wiz } from "./CreateWizard";
import { PACES, TRAVEL } from "./Onboarding";
import { CcArrow, CcBed, CcCal, CcCheck, CcClock, CcClose, CcImg, CcLink, CcMic, CcPeople, CcPin, CcPlane, CcPlus, CcSend, CcSpark } from "./ConciergeIcons";
import "../../styles/concierge.css";

// The look follows the validated mockup, direction « C · Concierge » (.claude/mockups/saas-v3, screens 06 to 11):
// no bubbles on the concierge's side, glass cards inside the exchange, discreet bubbles for the traveller.

/** The concierge's avatar: the orbit mark in a dark round */
function Avatar({ size = "md" }: { size?: "xs" | "md" | "lg" }) {
  return (
    <span className={"cc-av " + size} aria-hidden="true">
      <OrbitMark size={size === "lg" ? 24 : size === "xs" ? 9 : 13} />
    </span>
  );
}
/** Three dots that breathe: the concierge is writing or preparing */
const Dots = ({ sm }: { sm?: boolean }) => <span className={"cc-dots" + (sm ? " sm" : "")} aria-hidden="true"><i /><i /><i /></span>;

// ---------- the choice: the form or the concierge ----------

/** "Créer un voyage": a preview of the two ways, the person picks one */
export function CreateChooser({ onPick, onCancel }: { onPick: (k: "concierge" | "form") => void; onCancel: () => void }) {
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onCancel} aria-label={t("Fermer")}><CcClose /></button>
      <span className="v3-grow" />
    </div>
  );
  return (
    <Shell ring={false} top={top} className="cc-chooser">
      <p className="v3-lbl" style={{ marginTop: 18 }}>{t("Créer un voyage")}</p>
      <h1 className="v3-d v3-h2">{t("Comment préférez-vous ?")}</h1>
      <button type="button" className="ch-card" onClick={() => onPick("concierge")}>
        <div className="ch-preview ch-chat" aria-hidden="true">
          <span className="ch-mini-top">
            <Avatar size="xs" />
            <b>{t("Concierge")}</b>
            <small><i className="cc-on" />{t("Brouillon enregistré")}</small>
          </span>
          <span className="cc-me">{t("Florence 4 jours en décembre, avec ma femme. On adore la cuisine.")}</span>
          <span className="cc-glass ch-mini-card">
            <span className="cc-dest"><span className="n">1</span><span className="t">Florence<small>{t("Italie")}</small></span><CcPin /></span>
            <span className="cc-dest"><CcCal /><span className="t">{t("déc.")} · {t("{n} jours", { n: 4 })}</span></span>
            <span className="cc-dest"><CcPeople /><span className="t">{t("À deux")}</span></span>
          </span>
          <span className="cc-ai">{t("Parfait. Vous avez déjà réservé l'hôtel ou les vols ?")}</span>
        </div>
        <span className="ch-t"><b>{t("Avec le concierge")}</b><small>{t("Racontez votre voyage comme à un ami : texte, voix, captures ou liens. Il pose les bonnes questions.")}</small></span>
        <CcArrow className="cc-ic ch-go" />
      </button>
      <button type="button" className="ch-card" onClick={() => onPick("form")}>
        <div className="ch-preview ch-form" aria-hidden="true">
          <span className="ch-bars"><i className="on" /><i /><i /><i /></span>
          <span className="ch-field">{t("Où allez-vous ?")}</span>
          <span className="ch-field">{t("Quand partez-vous ?")}</span>
          <span className="ch-field dim">{t("Ce que vous savez déjà")}</span>
        </div>
        <span className="ch-t"><b>{t("Le formulaire")}</b><small>{t("4 étapes rapides et précises, à votre rythme.")}</small></span>
        <CcArrow className="cc-ic ch-go" />
      </button>
    </Shell>
  );
}

// ---------- the conversation ----------

type Facts = Omit<ConciergeResult, "reply" | "ready"> & { cities: Destination[] };
type Kind = "city" | "dates" | "who" | "flight" | "hotel" | "place" | "fixed" | "wish" | "interests";
type Flight = ExtractResult["flights"][number];
/** One thing understood, as shown in a card (kept in the conversation, so it survives closing the app) */
type Card = { kind: Kind; title: string; sub?: string; text: string; must?: boolean; booked?: boolean; list?: string[]; flight?: Flight };
/** `cards` held "icon text" strings before Nov 2026: still read when a saved conversation is resumed */
type Msg = { from: "concierge" | "me"; text: string; image?: boolean; cards?: (Card | string)[]; shot?: boolean };
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
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
/** "lun. 23 · 23:20" (English "Mon 23 · 23:20") from "2026-11-23T23:20" */
function when(iso: string): string {
  if (!iso || !validDate(iso.slice(0, 10))) return iso || "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  let day = `${d}/${m}`;
  try {
    day = new Intl.DateTimeFormat(locale(), { weekday: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  } catch {
    /* keep d/m */
  }
  const time = iso.slice(11, 16);
  return time ? `${day} · ${time}` : day;
}

/** "24–29 nov." (English "24–29 Nov"), "30 mars – 2 avr." for the line under the title */
function shortDates(start: string, end: string): string {
  const d = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 12));
  try {
    const fmt = new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", timeZone: "UTC" });
    if (start.slice(0, 7) === end.slice(0, 7)) return `${+start.slice(8, 10)}–${fmt.format(d(end))}`;
    return `${fmt.format(d(start))} – ${fmt.format(d(end))}`;
  } catch {
    return dateLabel(start, end);
  }
}

type Item = Card & { key: string };
/** One line per thing understood (used for the cards and the recap); `kind:index` keys allow removing them */
function items(f: Facts): Item[] {
  const out: Item[] = [];
  f.cities.forEach((c, i) => out.push({ key: `city:${i}`, kind: "city", title: c.name, sub: c.countryName || "", text: [c.name, c.countryName].filter(Boolean).join(", ") }));
  if (f.start && f.end) {
    const title = dateLabel(f.start, f.end);
    const sub = t("{n} jours", { n: dayCount(f.start, f.end) });
    out.push({ key: "dates", kind: "dates", title, sub, text: `${title} · ${sub}` });
  }
  if (f.travel || f.pace) {
    const title = t(label(TRAVEL, f.travel));
    const sub = f.pace ? t("rythme {p}", { p: t(label(PACES, f.pace)).toLowerCase() }) : "";
    out.push({ key: "who", kind: "who", title: title || sub, sub: title ? sub : "", text: [title, sub].filter(Boolean).join(" · ") });
  }
  f.flights.forEach((x, i) => out.push({ key: `flight:${i}`, kind: "flight", title: `${x.from} → ${x.to}`, sub: [x.code, when(x.departAt)].filter(Boolean).join(" · "), flight: x,
    text: `${x.code} ${x.from} → ${x.to}${x.departAt ? ` · ${x.departAt.slice(8, 10)}/${x.departAt.slice(5, 7)} ${x.departAt.slice(11, 16)}` : ""}` }));
  if (f.hotel.name) out.push({ key: "hotel", kind: "hotel", title: f.hotel.name, sub: f.hotel.address, text: [f.hotel.name, f.hotel.address].filter(Boolean).join(" · ") });
  f.places.forEach((p, i) => out.push({ key: `place:${i}`, kind: "place", title: p.name, sub: [p.city, p.why].filter(Boolean).join(" · "), must: p.mustSee, text: `${p.name}${p.city ? ` (${p.city})` : ""}${p.why ? ` · ${p.why}` : ""}` }));
  f.fixed.forEach((x, i) => {
    const sub = [x.date ? when(x.date) : "", x.time].filter(Boolean).join(" · ");
    out.push({ key: `fixed:${i}`, kind: "fixed", title: x.name, sub, booked: x.kind === "reservation" || x.kind === "billet", text: `${x.name}${x.date ? ` · ${x.date}${x.time ? ` ${x.time}` : ""}` : ""}` });
  });
  f.wishes.forEach((w, i) => out.push({ key: `wish:${i}`, kind: "wish", title: w, text: w }));
  if (f.interests.length) out.push({ key: "interests", kind: "interests", title: f.interests.join(", "), list: f.interests, text: f.interests.join(", ") });
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

/** A card saved before Nov 2026 (a pin mark, then "Florence, Italie"): its kind from the old mark, the mark dropped */
// (written as code points: no emoji is ever shown, they are only recognised to be dropped)
const OLD_MARKS: Record<string, Kind> = {
  "\u{1F4CD}": "city", "\u{1F4C5}": "dates", "\u{1F465}": "who", "\u2708": "flight", "\u{1F3E8}": "hotel",
  "\u2605": "place", "\u2022": "place", "\u{1F552}": "fixed", "\u2726": "wish", "\u2661": "interests",
};
function fromOld(s: string): Card {
  const m = s.match(/^(\S+)\s+([\s\S]*)$/u);
  const mark = m ? m[1].replace(/\uFE0F/g, "") : "";
  if (m && OLD_MARKS[mark]) return { kind: OLD_MARKS[mark], title: m[2], text: m[2], must: mark === "\u2605" };
  return { kind: "wish", title: s, text: s };
}

const KIND_ICON: Record<Kind, typeof CcPin> = {
  city: CcPin, dates: CcCal, who: CcPeople, flight: CcPlane, hotel: CcBed, place: CcPin, fixed: CcClock, wish: CcSpark, interests: CcSpark,
};
const KindIcon = ({ kind }: { kind: Kind }) => {
  const I = KIND_ICON[kind];
  return <I />;
};

/** The glass cards a concierge message brings: destinations, the trip, flights, the programme, the rest sorted */
function Cards({ cards, shot }: { cards: (Card | string)[]; shot?: boolean }) {
  const all = cards.map((c) => (typeof c === "string" ? { ...fromOld(c), old: true } : { ...c, old: false }));
  const fresh = all.filter((c) => !c.old);
  const cities = fresh.filter((c) => c.kind === "city");
  const trip = fresh.filter((c) => c.kind === "hotel" || c.kind === "dates");
  const flights = fresh.filter((c) => c.kind === "flight" && c.flight);
  const who = fresh.find((c) => c.kind === "who");
  const interests = fresh.find((c) => c.kind === "interests");
  const places = fresh.filter((c) => c.kind === "place");
  const rest = [...places.slice(0, 6), ...fresh.filter((c) => c.kind === "fixed" || c.kind === "wish" || (c.kind === "flight" && !c.flight)), ...all.filter((c) => c.old)];
  const more = Math.max(0, places.length - 6);
  const tag = shot ? t("Extrait") : t("Noté");
  return (
    <>
      {cities.length > 0 && (
        <div className="cc-glass cc-rc">
          <div className="cc-rc-h"><span className="v3-lbl">{t("Destinations")}</span></div>
          {cities.map((c, i) => (
            <div key={i} className="cc-dest"><span className="n">{i + 1}</span><span className="t">{c.title}{c.sub && <small>{c.sub}</small>}</span><CcPin className="cc-ic s mute" /></div>
          ))}
        </div>
      )}
      {flights.map((c, i) => {
        const x = c.flight as Flight;
        return (
          <div key={`f${i}`} className="cc-glass cc-rc">
            <div className="cc-rc-h"><span className="v3-lbl">{t("Vol")}</span><span className="v3-tag ok">{tag}</span></div>
            <div className="cc-fl">
              <span className="c">{x.from}<small>{when(x.departAt) || x.fromCity}</small></span>
              <span className="ln"><CcPlane /></span>
              <span className="c r">{x.to}<small>{when(x.arriveAt) || x.toCity}</small></span>
            </div>
            <div className="cc-meta">
              <span><b>{x.code}</b>{x.airline ? ` · ${x.airline}` : ""}</span>
              {x.terminal ? <span>{t("Terminal")} <b>{x.terminal}</b></span> : x.cabin ? <span>{x.cabin}</span> : null}
            </div>
          </div>
        );
      })}
      {trip.length > 0 && (
        <div className="cc-glass cc-rc tight">
          {trip.map((c, i) => (
            <div key={i} className="cc-dest"><KindIcon kind={c.kind} /><span className="t">{c.title}{c.sub && <small>{c.sub}</small>}</span>{c.kind === "hotel" && <span className="v3-tag ok">{tag}</span>}</div>
          ))}
        </div>
      )}
      {(who || interests) && (
        <div className="cc-glass cc-rc">
          <div className="cc-rc-h"><span className="v3-lbl">{t("Programme idéal")}</span></div>
          {who && <div className="cc-rowk"><span className="k">{t("Voyage")}</span><span className="v">{[who.title, who.sub].filter(Boolean).join(" · ")}</span></div>}
          {interests && (
            <div className="cc-rowk"><span className="k">{t("Envies")}</span><span className="cc-tags">{(interests.list || interests.title.split(", ")).map((x) => <span key={x}>{x}</span>)}</span></div>
          )}
        </div>
      )}
      {(rest.length > 0 || more > 0) && (
        <div className="cc-glass cc-rc">
          <ul className="cc-sum">
            {rest.map((c, i) => (
              <li key={i}>
                <KindIcon kind={c.kind} />
                <span className="t">{c.title}{c.sub && <small>{c.sub}</small>}</span>
                {c.kind === "place" && c.must && <span className="v3-tag gold">{t("Incontournable")}</span>}
                {c.kind === "fixed" && <span className="v3-tag gold">{c.booked ? t("Réservé") : t("Fixe")}</span>}
              </li>
            ))}
            {more > 0 && <li><CcPin /><span className="t">{t("+ {n} autres", { n: more })}<small>{t("Dans « Le point »")}</small></span></li>}
          </ul>
        </div>
      )}
    </>
  );
}

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
/** The traveller's message: a capture shown as a small sheet, links as small cards, then the text */
function Mine({ m, old, fresh }: { m: Msg; old: boolean; fresh: boolean }) {
  const links = m.text.match(URL_RE) || [];
  const rest = links.length ? m.text.replace(URL_RE, "").replace(/[ \t]+/g, " ").trim() : m.text;
  return (
    <>
      {m.image && (
        <span className={"cc-shot" + (old ? " old" : "") + (fresh ? " in" : "")} role="img" aria-label={t("Capture jointe")}><i className="h" /><i /><i style={{ width: "80%" }} /><i className="b" /><i style={{ width: "60%" }} /><i /></span>
      )}
      {(rest || links.length > 0) && (
        <div className={"cc-me" + (old ? " old" : "") + (fresh ? " in" : "") + (links.length ? " links" : "")}>
          {links.map((u, i) => (
            <span key={i} className="cc-link"><span className="lg"><CcLink className="cc-ic s" /></span><span className="tx">{host(u)}<small>{u.replace(/^https?:\/\//, "")}</small></span></span>
          ))}
          {rest && <span className={links.length ? "cc-me-tx" : undefined}>{rest}</span>}
        </div>
      )}
    </>
  );
}

const IDEAS = ["Un long week-end à Rome, en mai", "Tokyo au printemps, 6 jours", "Lisbonne, tranquille, à deux"];
const STEPS = ["Où", "Quand", "Infos", "Programme"];

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
  const input = useRef<HTMLTextAreaElement>(null);
  const rec = useRef<{ stop: () => void } | null>(null);
  // a resumed conversation appears at once; only what arrives afterwards slides in
  const seen = useRef(state.msgs.length);
  const first = useRef(true);
  useEffect(() => {
    save(state);
  }, [state]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: first.current ? "auto" : "smooth", block: "end" });
    first.current = false;
  }, [state.msgs.length, busy, launching]);
  // the on-screen keyboard: the page is fitted to what stays visible, so the composer sits right above the keys
  useEffect(() => {
    const vv = window.visualViewport;
    const el = document.querySelector<HTMLElement>(".v3.v3-concierge");
    if (!vv || !el) {
      return;
    }
    const fit = () => {
      if (window.innerHeight - vv.height > 80) {
        el.style.top = `${vv.offsetTop}px`;
        el.style.height = `${vv.height}px`;
        el.style.bottom = "auto";
      } else {
        el.style.top = "";
        el.style.height = "";
        el.style.bottom = "";
      }
    };
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    fit();
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      el.style.top = "";
      el.style.height = "";
      el.style.bottom = "";
    };
  }, []);

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
      const before = new Set(items(f).map((x) => `${x.kind}${x.text}`));
      const fresh: Card[] = items(facts).filter((x) => !before.has(`${x.kind}${x.text}`)).map(({ key: _k, ...c }) => c);
      setState((s) => ({ msgs: [...s.msgs, { from: "concierge", text: r.reply || t("C'est noté."), cards: fresh, shot: !!mine.image }], facts, ready: !!r.ready }));
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
    setRecap(false);
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

  // where the conversation is: où → quand → ce que vous savez → programme idéal
  const done = [
    f.cities.length > 0,
    validDate(f.start) && validDate(f.end),
    !!(f.hotel.name || f.flights.length || f.places.length || f.fixed.length || f.wishes.length),
    !!(state.ready || f.pace || f.travel || f.interests.length),
  ];
  const open = done.findIndex((d) => !d);
  const step = launching ? 4 : (state.ready && done[0] && done[1]) || open === -1 ? 3 : open;
  const title = launching ? t("Concierge") : f.cities.map((c) => c.name).join(" · ") || t("Nouveau voyage");
  const status = launching
    ? <><Dots sm />{t("prépare votre voyage")}</>
    : busy
      ? <><Dots sm />{state.msgs[state.msgs.length - 1]?.image ? t("lit votre capture") : t("écrit…")}</>
      : <><i className="cc-on" />{validDate(f.start) && validDate(f.end) ? shortDates(f.start, f.end) : t("Brouillon enregistré")}</>;
  const lastMe = state.msgs.map((m) => m.from).lastIndexOf("me");
  const intro = state.msgs.length === 1 && !busy && !launching;
  // the greeting, large up to its first question, the rest underneath (screen 06 of the mockup)
  const greet = state.msgs[0]?.text || "";
  const cut = greet.indexOf("? ");
  const hi = cut >= 0 ? greet.slice(0, cut + 1) : greet;
  const sub = cut >= 0 ? greet.slice(cut + 2) : "";

  const top = (
    <div className="cc-top">
      <div className="cc-bar">
        <button className="v3-tool" onClick={onCancel} aria-label={t("Fermer")}><CcClose /></button>
        <div className="cc-who">
          <Avatar />
          <span className="cc-who-t"><b>{title}</b><small aria-live="polite">{status}</small></span>
        </div>
        {!launching && (
          <button type="button" className="cc-point" onClick={() => setRecap(true)} disabled={!all.length}>
            {t("Le point")}{all.length > 0 && <span className="num">{all.length}</span>}
          </button>
        )}
      </div>
      <div className="cc-steps" aria-label={t("Étape {n} sur {of}", { n: Math.min(4, step + 1), of: 4 })}>
        {STEPS.map((s, i) => (
          <Fragment key={s}>
            {i > 0 && <s className={i <= step ? "on" : ""} />}
            <span className={i === step ? "on" : i < step || done[i] ? "done" : ""}>{t(s)}</span>
          </Fragment>
        ))}
      </div>
    </div>
  );

  return (
    <Shell ring={false} top={top} className="v3-concierge">
      <div className={"cc-thread" + (intro ? " intro" : "")} aria-live="polite">
        {intro ? (
          <>
            <div className="cc-hero in">
              <Avatar size="lg" />
              <p className="cc-ai big">{hi}</p>
              {sub && <p className="cc-sub">{sub}</p>}
            </div>
            <div className="cc-ideas in">
              <p className="v3-lbl">{t("Quelques idées")}</p>
              <div className="cc-glass">
                {IDEAS.map((s) => (
                  <button key={s} type="button" className="cc-prompt" onClick={() => { setText(t(s)); input.current?.focus(); }}>
                    <CcSpark className="cc-ic mute" /><span>{t(s)}</span><CcSend className="cc-ic s" />
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          state.msgs.map((m, i) => (
            m.from === "me"
              ? <Mine key={i} m={m} old={i < lastMe} fresh={i >= seen.current} />
              : (
                <div key={i} className={"cc-turn" + (i >= seen.current ? " in" : "")}>
                  <div className={"cc-ai" + (i < lastMe ? " old" : "")}>
                    {i === 0 && <span className="cc-by"><OrbitMark size={11} />{t("Concierge")}</span>}
                    {m.text}
                  </div>
                  {m.cards && m.cards.length > 0 && <Cards cards={m.cards} shot={m.shot} />}
                </div>
              )
          ))
        )}
        {busy && <div className="cc-ai cc-typing in" role="status" aria-label={t("Le concierge écrit…")}><Dots /></div>}
        {launching && (
          <div className="cc-turn in">
            <div className="cc-ai">{t("Je prépare {city}. Le programme se construit jour par jour : je vous montre où j'en suis.", { city: f.cities.map((c) => c.name).join(" · ") })}</div>
            <div className="cc-glass cc-rc">
              <div className="cc-rc-h"><span className="v3-lbl">{t("Préparation")}</span><b className="num cc-n">{t("{n} jours", { n: dayCount(f.start, f.end) })}</b></div>
              <div className="cc-prog"><i /></div>
              <div className="cc-meta"><span>{dateLabel(f.start, f.end)}</span><span>{f.places.length > 1 ? t("{n} lieux retenus", { n: f.places.length }) : t("{n} lieu retenu", { n: f.places.length })}</span></div>
            </div>
            <div className="cc-live"><Dots />{t("Je crée le voyage…")}</div>
          </div>
        )}
        {state.ready && canLaunch && !busy && !launching && (
          <div className="cc-ready in">
            <button className="v3-btn" onClick={() => setRecap(true)}><CcSpark />{t("Faire le point et lancer la préparation")}</button>
          </div>
        )}
        <div ref={end} />
      </div>
      {err && <p className="v3-err cc-err" role="alert">{err}</p>}
      <div className="cc-input">
        {launching ? (
          <div className="cc-glass cc-comp quiet"><span className="cc-r"><CcCheck /></span><span className="cc-in">{t("La préparation continue dans le voyage")}</span></div>
        ) : (
          <>
            {shot && (
              <span className="cc-att"><CcImg className="cc-ic s" /><span className="nm">{shot.name}</span><button type="button" onClick={() => setShot(null)} aria-label={t("Retirer la capture")}><CcClose className="cc-ic s" /></button></span>
            )}
            <div className="cc-glass cc-comp">
              <button type="button" className="cc-r" onClick={() => file.current?.click()} aria-label={t("Ajouter une capture ou une photo")}><CcPlus /></button>
              <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={listening ? t("Je vous écoute…") : t("Écrivez, collez un lien, ou dictez…")} aria-label={t("Message au concierge")}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
              {(!text.trim() || listening) && (
                <button type="button" className={"cc-r" + (listening ? " on" : "")} onClick={mic} aria-label={listening ? t("Arrêter la dictée") : t("Dicter")} aria-pressed={listening}><CcMic /></button>
              )}
              {(text.trim() || shot) && (
                <button type="button" className="cc-r go" onClick={() => void send()} disabled={busy} aria-label={t("Envoyer")}><CcSend /></button>
              )}
            </div>
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { setShot(e.target.files?.[0] || null); e.target.value = ""; }} />
            <button type="button" className="v3-link cc-switch" onClick={toForm}>{t("Je préfère remplir le formulaire")}</button>
          </>
        )}
      </div>

      {recap && (
        <div className="v3-acct-wrap pt-sheet-wrap" onClick={() => setRecap(false)}>
          <div className="v3-glass pt-sheet cc-recap" role="dialog" aria-label={t("Le point")} onClick={(e) => e.stopPropagation()}>
            <div className="cc-recap-h">
              <Avatar />
              <span className="v3-lbl">{t("Le point")}</span>
              <button type="button" className="v3-tool" onClick={() => setRecap(false)} aria-label={t("Fermer")}><CcClose /></button>
            </div>
            <h2 className="v3-d cc-recap-title">{f.cities.map((c) => c.name).join(" · ") || t("Votre voyage")}</h2>
            <div className="cc-list">
              {all.map((x) => (
                <div key={x.key} className="cc-item">
                  <KindIcon kind={x.kind} />
                  <span className="t">{x.title}{x.sub && <small>{x.sub}</small>}</span>
                  {x.kind === "place" && x.must && <span className="v3-tag gold">{t("Incontournable")}</span>}
                  {x.kind === "fixed" && <span className="v3-tag gold">{x.booked ? t("Réservé") : t("Fixe")}</span>}
                  <button type="button" className="cc-x" onClick={() => setState((s) => ({ ...s, facts: without(s.facts, x.key) }))} aria-label={`${t("Retirer")} : ${x.title}`}><CcClose className="cc-ic s" /></button>
                </div>
              ))}
              {!all.length && <p className="v3-note">{t("Rien encore : parlez-moi de votre voyage.")}</p>}
            </div>
            {!canLaunch && <p className="v3-note">{t("Il me faut au moins la destination et les dates pour lancer la préparation.")}</p>}
            <button className="v3-btn" style={{ marginTop: 16 }} disabled={!canLaunch || launching} onClick={() => void launch()}><CcSpark />{launching ? t("Création…") : t("Lancer la préparation")}</button>
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
