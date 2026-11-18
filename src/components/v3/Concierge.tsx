import { Fragment, useEffect, useRef, useState } from "react";
import { ai, AiError, imageToBase64, type ConciergeResult, type ExtractResult } from "../../lib/ai";
import { dateLabel, dayCount, searchCities, type Destination } from "../../lib/newTrip";
import { getLang, locale, t } from "../../lib/i18n";
import { getState, requestPro, useStore } from "../../lib/store";
import { track } from "../../lib/track";
import Shell from "./Shell";
import { clearWizardDraft, CONCIERGE_KEY, createTripFromWizard, lastWay, LinkTile, linkCard, rememberWay, URL_RE, useKeyboardFit, useOnline, WIZARD_KEY, wizardDraft, wizHasContent, type Wiz } from "./CreateWizard";
import { INTERESTS, PACES, TRAVEL } from "./Onboarding";
import { CcArrow, CcBed, CcBell, CcCal, CcCheck, CcClip, CcClock, CcClose, CcImg, CcMic, CcPeople, CcPin, CcPlane, CcPlus, CcRefresh, CcSend, CcSpark, ConciergeOrbit } from "./ConciergeIcons";
import "../../styles/concierge.css";
import "../../styles/creation.css";

// The look follows the validated mockup, direction « C · Concierge » (.claude/mockups/saas-v3, screens 06 to 11):
// no bubbles on the concierge's side, glass cards inside the exchange, discreet bubbles for the traveller.

/** The concierge's avatar: the orbit mark in a dark round (the large one uses the mockup's lighter line) */
function Avatar({ size = "md" }: { size?: "xs" | "md" | "lg" }) {
  return (
    <span className={"cc-av " + size} aria-hidden="true">
      {size === "lg" ? <ConciergeOrbit thin w={40} h={24} /> : size === "xs" ? <ConciergeOrbit w={15} h={9} /> : <ConciergeOrbit w={22} h={13} />}
    </span>
  );
}
/** Three dots that breathe: the concierge is writing or preparing */
const Dots = () => <span className="cc-dots" aria-hidden="true"><i /><i /><i /></span>;

// ---------- the choice: the form or the concierge ----------

/** "Créer un voyage": a preview of the two ways, the person picks one. The way chosen last time is marked (never
 *  skipped to), and a conversation or a form left half-way says where it stopped. */
export function CreateChooser({ onPick, onCancel }: { onPick: (k: "concierge" | "form") => void; onCancel: () => void }) {
  const [last] = useState(lastWay);
  const [chat, setChat] = useState(() => {
    const s = load();
    return s && s.msgs.length > 1 ? s : null;
  });
  const [form, setForm] = useState(wizardDraft);
  // « Effacer… » asks for a second touch (a stray touch never wipes anything)
  const [forget, setForget] = useState<"chat" | "form" | null>(null);
  useEffect(() => {
    if (!forget) return;
    const tm = window.setTimeout(() => setForget(null), 4000);
    return () => window.clearTimeout(tm);
  }, [forget]);
  // the order is fixed when the screen opens: what is half-way first, else the way chosen last time
  const [formFirst] = useState(() => (form && !chat ? true : chat && !form ? false : last === "form"));
  const pick = (k: "concierge" | "form") => {
    rememberWay(k);
    onPick(k);
  };
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onCancel} aria-label={t("Fermer")}><CcClose /></button>
      <span className="v3-grow" />
    </div>
  );
  const chatWhere = chat?.facts.cities[0]?.name;
  const formWhere = form?.cities.map((c) => c.name).join(" · ");
  const lastTag = <span className="v3-tag dim">{t("Dernier choix")}</span>;
  // something to resume: the previews are shortened so both ways show on a small phone
  const resume = !!chat || !!form;
  const forgetBtn = (k: "chat" | "form") => (
    <button type="button" className={"ch-forget" + (forget === k ? " sure" : "")}
      onClick={() => {
        if (forget !== k) return setForget(k);
        setForget(null);
        if (k === "chat") {
          save(null);
          setChat(null);
        } else {
          clearWizardDraft();
          setForm(null);
        }
      }}>
      {forget === k ? t("Touchez encore pour effacer") : k === "chat" ? t("Effacer la conversation") : t("Effacer le brouillon")}
    </button>
  );
  const concierge = (
    <div className="ch-way" key="concierge">
      <button type="button" className={"ch-card" + (last === "concierge" ? " last" : "")} onClick={() => pick("concierge")}>
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
        <span className="ch-t">
          <span className="ch-name"><b>{t("Avec le concierge")}</b>{last === "concierge" && lastTag}</span>
          <small>{t("Racontez votre voyage comme à un ami : texte, voix, captures ou liens. Il pose les bonnes questions.")}</small>
          <span className="ch-for"><CcCheck />{t("Idéal si vous avez des idées en vrac, des liens ou des captures.")}</span>
        </span>
        {chat && <span className="ch-resume"><i className="cr-dot" /><span>{t("Conversation en cours")}{chatWhere ? <> · <b>{chatWhere}</b></> : null}</span></span>}
        <CcArrow className="cc-ic ch-go" />
      </button>
      {chat && forgetBtn("chat")}
    </div>
  );
  const formCard = (
    <div className="ch-way" key="form">
      <button type="button" className={"ch-card" + (last === "form" ? " last" : "")} onClick={() => pick("form")}>
        <div className="ch-preview ch-form" aria-hidden="true">
          <span className="ch-bars"><i className="on" /><i /><i /><i /></span>
          <span className="ch-field">{t("Où allez-vous ?")}</span>
          <span className="ch-field">{t("Quand partez-vous ?")}</span>
          <span className="ch-field dim">{t("Ce que vous savez déjà")}</span>
        </div>
        <span className="ch-t">
          <span className="ch-name"><b>{t("Le formulaire")}</b>{last === "form" && lastTag}</span>
          <small>{t("4 étapes rapides et précises, à votre rythme.")}</small>
          <span className="ch-for"><CcCheck />{t("Idéal si vous connaissez déjà vos villes et vos dates.")}</span>
        </span>
        {form && <span className="ch-resume"><i className="cr-dot" /><span>{t("Brouillon")}{formWhere ? <> · <b>{formWhere}</b></> : null} · {t("étape {n} sur {of}", { n: form.step, of: 4 })}</span></span>}
        <CcArrow className="cc-ic ch-go" />
      </button>
      {form && forgetBtn("form")}
    </div>
  );
  return (
    <Shell ring={false} top={top} className="cc-chooser">
      <p className="v3-lbl" style={{ marginTop: 18 }}>{t("Créer un voyage")}</p>
      <h1 className="v3-d v3-h2">{t("Comment préférez-vous ?")}</h1>
      <p className="ch-lead">{t("Les deux mènent au même voyage préparé. Vous pouvez passer du concierge au formulaire à tout moment, sans rien perdre.")}</p>
      <div className={"ch-grid" + (resume ? " resume" : "")}>
        {formFirst ? [formCard, concierge] : [concierge, formCard]}
      </div>
    </Shell>
  );
}

// ---------- the conversation ----------

/** `companions`: the first names of who travels with the person (api/ai.ts since Nov 2026; absent from older saves and answers) */
type Facts = Omit<ConciergeResult, "reply" | "ready"> & { cities: Destination[]; companions?: string[] };
type Kind = "city" | "dates" | "who" | "people" | "flight" | "hotel" | "place" | "fixed" | "wish" | "interests";
type Flight = ExtractResult["flights"][number];
/** One thing understood, as shown in a card (kept in the conversation, so it survives closing the app) */
type Card = { kind: Kind; title: string; sub?: string; text: string; must?: boolean; booked?: boolean; list?: string[]; flight?: Flight; src?: string };
/** `cards` held "icon text" strings before Nov 2026: still read when a saved conversation is resumed.
 *  `failed`: the traveller's message did not reach the concierge (kept with « Réessayer », never sent as history) */
type Msg = { from: "concierge" | "me"; text: string; image?: boolean; cards?: (Card | string)[]; shot?: boolean; id?: string; failed?: "offline" | "error"; err?: string };
/** `draft`: what was being typed, kept with the conversation */
type Saved = { msgs: Msg[]; facts: Facts; ready: boolean; draft?: string };
const KEY = CONCIERGE_KEY;
const EMPTY: Facts = { destinations: [], cities: [], start: "", end: "", travel: "", pace: "", hotel: { name: "", address: "" }, flights: [], places: [], fixed: [], wishes: [], interests: [], companions: [] };
/** Travels with others: the moment to ask their first names */
const GROUP = new Set(["duo", "friends", "family"]);
const msgId = () => Math.random().toString(36).slice(2, 10);
/** First names as given: trimmed, one space, 40 characters at most, each once */
function cleanNames(list: unknown[]): string[] {
  const seen = new Set<string>();
  return list
    .map((x) => String(x ?? "").trim().replace(/\s+/g, " ").slice(0, 40))
    .filter((x) => {
      const k = x.toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 19);
}

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
  if (f.companions?.length) {
    const title = t("Avec {names}", { names: f.companions.join(", ") });
    out.push({ key: "companions", kind: "people", title, list: f.companions, text: title });
  }
  f.flights.forEach((x, i) => out.push({ key: `flight:${i}`, kind: "flight", title: `${x.from} – ${x.to}`, sub: [x.code, when(x.departAt)].filter(Boolean).join(" · "), flight: x,
    text: `${x.code} ${x.from} – ${x.to}${x.departAt ? ` · ${x.departAt.slice(8, 10)}/${x.departAt.slice(5, 7)} ${x.departAt.slice(11, 16)}` : ""}` }));
  if (f.hotel.name) out.push({ key: "hotel", kind: "hotel", title: f.hotel.name, sub: f.hotel.address, text: [f.hotel.name, f.hotel.address].filter(Boolean).join(" · ") });
  f.places.forEach((p, i) => out.push({ key: `place:${i}`, kind: "place", title: p.name, sub: [p.city, p.why].filter(Boolean).join(" · "), must: p.mustSee, src: p.source || undefined, text: `${p.name}${p.city ? ` (${p.city})` : ""}${p.why ? ` · ${p.why}` : ""}` }));
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
  if (k === "companions") return { ...f, companions: [] };
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
  city: CcPin, dates: CcCal, who: CcPeople, people: CcPeople, flight: CcPlane, hotel: CcBed, place: CcPin, fixed: CcClock, wish: CcSpark, interests: CcSpark,
};
/** A booking keeps the clock, an appointment or event at a fixed date the calendar (screen 09) */
const KindIcon = ({ kind, booked }: { kind: Kind; booked?: boolean }) => {
  const I = kind === "fixed" && !booked ? CcCal : KIND_ICON[kind];
  return <I />;
};

/** The service a place came from, when it is one people know (Xiaohongshu, Google Maps…) */
function service(s?: string): string | null {
  if (!s) return null;
  if (/xiaohongshu|xhslink|\bxhs\b|小红书|rednote/i.test(s)) return "Xiaohongshu";
  if (/google|maps\.app|goo\.gl/i.test(s)) return "Google Maps";
  if (/instagram/i.test(s)) return "Instagram";
  if (/tiktok|douyin/i.test(s)) return "TikTok";
  return null;
}
/** "12 Xiaohongshu · 34 Google Maps" when the sources are known, else the first names */
function placesLine(places: Card[]): string {
  const count = new Map<string, number>();
  for (const p of places) {
    const s = service(p.src);
    if (s) count.set(s, (count.get(s) || 0) + 1);
  }
  if (count.size) return [...count].map(([s, n]) => `${n} ${s}`).join(" · ");
  return places.slice(0, 3).map((p) => p.title).join(" · ") + (places.length > 3 ? " …" : "");
}

/** The glass cards a concierge message brings: destinations, flights, the hotel and dates, the rest sorted (screens 07 to 09) */
function Cards({ cards, shot, onEdit, onFix }: { cards: (Card | string)[]; shot?: boolean; onEdit: () => void; onFix: () => void }) {
  const all = cards.map((c) => (typeof c === "string" ? { ...fromOld(c), old: true } : { ...c, old: false }));
  const fresh = all.filter((c) => !c.old);
  const cities = fresh.filter((c) => c.kind === "city");
  const trip = fresh.filter((c) => c.kind === "hotel" || c.kind === "dates" || c.kind === "who" || c.kind === "people");
  const flights = fresh.filter((c) => c.kind === "flight" && c.flight);
  const places = fresh.filter((c) => c.kind === "place");
  const musts = places.filter((c) => c.must);
  const rest = [...fresh.filter((c) => c.kind === "fixed" || c.kind === "wish" || (c.kind === "flight" && !c.flight)), ...all.filter((c) => c.old)];
  const tag = shot ? t("Extrait") : t("Noté");
  return (
    <>
      {cities.length > 0 && (
        <div className="cc-glass cc-rc">
          <div className="cc-rc-h"><span className="v3-lbl">{t("Destinations")}</span><button type="button" className="cc-act" onClick={onEdit}>{t("Modifier")}</button></div>
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
            <div key={i} className="cc-dest">
              <KindIcon kind={c.kind} />
              <span className="t">{c.title}{c.sub && <small>{c.sub}</small>}</span>
              {c.kind === "hotel" && <span className="v3-tag ok">{tag}</span>}
              {c.kind === "dates" && <button type="button" className="cc-act" onClick={onFix}>{t("Corriger")}</button>}
            </div>
          ))}
        </div>
      )}
      {(places.length > 0 || rest.length > 0) && (
        <div className="cc-glass cc-rc">
          <ul className="cc-sum">
            {places.length > 0 && (
              <li><CcPin /><span className="t">{places.length > 1 ? t("{n} lieux notés", { n: places.length }) : t("1 lieu noté")}<small>{placesLine(places)}</small></span></li>
            )}
            {musts.length > 0 && (
              <li><CcSpark /><span className="t">{musts.length > 1 ? t("{n} incontournables", { n: musts.length }) : t("1 incontournable")}<small>{musts.slice(0, 4).map((p) => p.title).join(" · ")}</small></span></li>
            )}
            {rest.map((c, i) => (
              <li key={i}>
                <KindIcon kind={c.kind} booked={c.booked} />
                <span className="t">{c.title}{c.sub && <small>{c.sub}</small>}</span>
                {c.kind === "place" && c.must && <span className="v3-tag gold">{t("Incontournable")}</span>}
                {c.kind === "fixed" && <span className="v3-tag gold">{c.booked ? t("Réservé") : t("Fixe")}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** « Programme idéal » (screen 10): the pace and the interests, from the profile until the traveller changes them */
function Programme({ f, onPace, onInterest }: { f: Facts; onPace: (k: string) => void; onInterest: (x: string) => void }) {
  const profile = useStore((s) => s.profile);
  const pPace = typeof profile.pace === "string" ? profile.pace : "";
  const pInt = Array.isArray(profile.interests) ? (profile.interests as string[]) : [];
  const pace = f.pace || pPace;
  const fromProfile = !f.interests.length && pInt.length > 0;
  const on = f.interests.length ? f.interests : pInt;
  const known = [...new Set([...pInt, ...f.interests])];
  const chips = [...new Set([...known, ...INTERESTS])].slice(0, Math.max(6, known.length + 2));
  const travel = t(label(TRAVEL, f.travel));
  return (
    <div className="cc-glass cc-rc">
      <div className="cc-rowk">
        <span className="k">{t("Rythme")}</span>
        <div className="cc-seg" role="group" aria-label={t("Rythme")}>
          {PACES.map((p) => (
            <button key={p.key} type="button" className={pace === p.key ? "on" : ""} aria-pressed={pace === p.key} onClick={() => onPace(p.key)}>{t(p.label)}</button>
          ))}
        </div>
      </div>
      {travel && <div className="cc-rowk"><span className="k">{t("Voyage")}</span><span className="v">{travel}</span></div>}
      <div className="cc-int-h"><span className="v3-lbl">{t("Centres d'intérêt")}</span>{fromProfile && <span className="v3-tag dim">{t("Profil")}</span>}</div>
      <div className="cc-chips">
        {chips.map((x) => (
          <button key={x} type="button" className={"cc-chip" + (on.includes(x) ? " on" : "")} aria-pressed={on.includes(x)} onClick={() => onInterest(x)}>{t(x)}</button>
        ))}
      </div>
    </div>
  );
}

/** The traveller's message: a capture shown as a small sheet, links as small cards, then the text; a message that did
 *  not leave says so under it, with « Réessayer » */
function Mine({ m, old, fresh, onRetry, onEdit }: { m: Msg; old: boolean; fresh: boolean; onRetry: () => void; onEdit: () => void }) {
  const links = m.text.match(URL_RE) || [];
  const rest = links.length ? m.text.replace(URL_RE, "").replace(/[ \t]+/g, " ").trim() : m.text;
  const dim = old && !m.failed;
  return (
    <>
      {m.image && (
        <span className={"cc-shot" + (dim ? " old" : "") + (fresh ? " in" : "") + (m.failed ? " failed" : "")} role="img" aria-label={t("Capture jointe")}><i className="h" /><i /><i style={{ width: "80%" }} /><i className="b" /><i style={{ width: "60%" }} /><i /></span>
      )}
      {(rest || links.length > 0) && (
        <div className={"cc-me" + (dim ? " old" : "") + (fresh ? " in" : "") + (links.length ? " links" : "") + (m.failed ? " failed" : "")}>
          {links.map((u, i) => {
            const l = linkCard(u);
            return (
              <span key={i} className="cc-link">
                <LinkTile tile={l.tile} />
                <span className="tx">{l.title}{l.small && <small>{l.small}</small>}</span>
              </span>
            );
          })}
          {rest && <span className={links.length ? "cc-me-tx" : undefined}>{rest}</span>}
        </div>
      )}
      {m.failed && (
        <div className="cc-failed" role="alert">
          <span>{m.failed === "offline" ? t("Pas de connexion : le message n'est pas parti.") : (m.err || "").replace(AGAIN, "").trim() || t("Le message n'est pas parti.")}</span>
          <button type="button" className="cc-retry" onClick={onRetry}><CcRefresh className="cc-ic s" />{t("Réessayer")}</button>
          {m.text && <button type="button" className="cc-act" onClick={onEdit}>{t("Modifier")}</button>}
        </div>
      )}
    </>
  );
}

/** « Réessayez. » at the end of a reason: the button under it already says it */
const AGAIN = /\s*(Réessayez|Try again)\s*\.?\s*$/i;
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
    travellers: f.companions || [], from: "concierge",
  };
}

/** Every date of the trip, "2026-11-24" … "2026-11-29" */
function daysOf(start: string, end: string): string[] {
  if (!validDate(start) || !validDate(end) || end < start) return [];
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  for (let i = 0; i < 60; i++) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > end) break;
    out.push(iso);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

type Quick = { label: string; on?: boolean; act: () => void };

/** Creating a trip by talking: the concierge understands each answer, turns it into cards and asks what is missing */
export default function Concierge({ onCancel, onCreated, onForm }: { onCancel: () => void; onCreated: (id: string) => void; onForm: () => void }) {
  const name = useStore((s) => (s.profile.name as string) || "");
  const plan = useStore((s) => s.plan);
  const [state, setState] = useState<Saved>(() => load() || {
    msgs: [{ from: "concierge", text: name ? t("Bonjour {name}.\nOù aimeriez-vous aller ?", { name }) : t("Bonjour.\nOù aimeriez-vous aller ?") }],
    facts: EMPTY, ready: false,
  });
  // what was being typed comes back with the conversation
  const [text, setText] = useState(() => state.draft || "");
  const [shot, setShot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recap, setRecap] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [listening, setListening] = useState(false);
  const [mate, setMate] = useState("");
  // the form already holds another trip's draft: asked once before it is replaced
  const [replace, setReplace] = useState<Wiz | null>(null);
  const online = useOnline();
  const end = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const rec = useRef<{ stop: () => void } | null>(null);
  // the image of a message that did not leave, to send it again (on this screen only)
  const images = useRef(new Map<string, string | undefined>());
  // a resumed conversation appears at once; only what arrives afterwards slides in
  const seen = useRef(state.msgs.length);
  const first = useRef(true);
  useEffect(() => {
    save({ ...state, draft: text.trim() ? text : undefined });
  }, [state, text]);
  // the end of the exchange, above the composer (which stays over the bottom of the page)
  const toEnd = (behavior: ScrollBehavior) => {
    const sc = document.querySelector<HTMLElement>(".v3.v3-concierge");
    if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior });
    else end.current?.scrollIntoView({ behavior, block: "end" });
  };
  useEffect(() => {
    toEnd(first.current ? "auto" : "smooth");
    first.current = false;
  }, [state.msgs.length, busy, launching]);
  // the on-screen keyboard: the page is fitted to what stays visible, so the composer sits right above the keys
  useKeyboardFit(".v3.v3-concierge");
  // the composer grows with what is written (up to five lines or so)
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);
  // a long answer (links being read, a capture) says that it is still coming
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const tm = window.setTimeout(() => setSlow(true), 9000);
    return () => window.clearTimeout(tm);
  }, [busy]);

  const f = state.facts;
  const all = items(f);
  const canLaunch = f.cities.length > 0 && validDate(f.start) && validDate(f.end) && f.end >= f.start;
  const companions = f.companions || [];

  /** Sends what is in the composer, or `over` (a quick reply), which leaves what is being typed in place.
   *  The message shows at once; if it cannot leave, it stays in the thread with « Réessayer ». */
  const send = async (over?: string) => {
    const msg = (over ?? text).trim();
    if ((!msg && !shot) || busy) return;
    const mine: Msg = { from: "me", text: msg, image: !!shot, id: msgId() };
    setErr(null);
    setState((s) => ({ ...s, msgs: [...s.msgs, mine] }));
    if (over === undefined) setText("");
    const pic = shot;
    setShot(null);
    setBusy(true);
    const image = pic ? await imageToBase64(pic, 1600, 0.8).catch(() => undefined) : undefined;
    images.current.set(mine.id!, image);
    await deliver(mine, image);
  };
  /** Sends a message that did not leave, as it was */
  const retry = async (id: string) => {
    const m = state.msgs.find((x) => x.id === id);
    if (!m || busy) return;
    const image = images.current.get(id);
    // a capture lost when the app closed: the text leaves alone, else the capture is asked again
    if (m.image && !image && !m.text) {
      setState((s) => ({ ...s, msgs: s.msgs.filter((x) => x.id !== id) }));
      setErr(t("Ajoutez la capture à nouveau."));
      return;
    }
    const again: Msg = { ...m, failed: undefined, err: undefined, image: m.image && !!image };
    setErr(null);
    setState((s) => ({ ...s, msgs: [...s.msgs.filter((x) => x.id !== id), again] }));
    setBusy(true);
    await deliver(again, image);
  };
  /** Puts a message that did not leave back in the composer */
  const edit = (id: string) => {
    const m = state.msgs.find((x) => x.id === id);
    if (!m) return;
    setState((s) => ({ ...s, msgs: s.msgs.filter((x) => x.id !== id) }));
    setText(m.text);
    input.current?.focus();
  };
  const deliver = async (mine: Msg, image: string | undefined) => {
    const msg = mine.text;
    const fail = (kind: "offline" | "error", e?: string) =>
      setState((s) => ({ ...s, msgs: s.msgs.map((m) => (m.id === mine.id ? { ...m, failed: kind, err: e } : m)) }));
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      fail("offline");
      setBusy(false);
      return;
    }
    // the exchange so far, without the messages that never reached the concierge
    const history = state.msgs.filter((m) => !m.failed && m.id !== mine.id).slice(-8).map((m) => `${m.from === "me" ? "Voyageur" : "Concierge"} : ${m.text}`).join("\n");
    try {
      const { cities: _c, ...known } = f;
      const r = await ai<ConciergeResult & { companions?: string[] }>("concierge", { text: msg, image, facts: JSON.stringify({ ...known, companions }), history }, 290_000);
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
        // the first names the concierge heard (a server without the field keeps those already known)
        companions: Array.isArray(r.companions) ? cleanNames(r.companions) : companions,
      };
      const before = new Set(items(f).map((x) => `${x.kind}${x.text}`));
      const fresh: Card[] = items(facts).filter((x) => !before.has(`${x.kind}${x.text}`)).map(({ key: _k, ...c }) => c);
      images.current.delete(mine.id || "");
      setState((s) => ({ msgs: [...s.msgs, { from: "concierge", text: r.reply || t("C'est noté."), cards: fresh, shot: !!mine.image }], facts, ready: !!r.ready }));
    } catch (e) {
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      fail(offline ? "offline" : "error", offline ? undefined : e instanceof AiError ? e.message : t("Le concierge ne répond pas. Réessayez."));
    } finally {
      setBusy(false);
    }
  };
  // back online: the message that could not leave for want of a network leaves by itself
  const lastFailed = [...state.msgs].reverse().find((m) => m.from === "me" && m.failed);
  useEffect(() => {
    if (online && lastFailed?.failed === "offline" && lastFailed.id && !busy) void retry(lastFailed.id);
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Adds a companion's first name (from « Le point »), sent to the concierge with the next message */
  const addMate = () => {
    const n = cleanNames([mate])[0];
    setMate("");
    if (!n || companions.some((x) => x.toLowerCase() === n.toLowerCase()) || companions.length >= 19) return;
    setState((s) => ({ ...s, facts: { ...s.facts, companions: [...(s.facts.companions || []), n] } }));
  };
  const dropMate = (n: string) => setState((s) => ({ ...s, facts: { ...s.facts, companions: (s.facts.companions || []).filter((x) => x !== n) } }));
  /** Puts the start of an answer in the composer and opens the keyboard */
  const prefill = (s: string) => {
    setText(s);
    input.current?.focus();
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
      // a form draft opened from this conversation is done with too (no second copy of the same trip)
      if (wizardDraft()?.from === "concierge") clearWizardDraft();
      onCreated(id);
    } catch {
      setErr(t("Le voyage n'a pas pu être créé. Réessayez."));
      setLaunching(false);
    }
  };
  // the form opens on everything understood; the conversation stays saved until the trip is created (from either)
  // a draft the form holds for another trip is never replaced without asking
  const toForm = (force?: "replace" | "keep") => {
    const cur = wizardDraft();
    const same = (a: { name: string }[], b: { name: string }[]) => a.map((c) => c.name.toLowerCase()).join("|") === b.map((c) => c.name.toLowerCase()).join("|");
    if (!force && cur && wizHasContent(cur) && (cur.from !== "concierge" || !same(cur.cities, f.cities))) {
      setRecap(false);
      setReplace(cur);
      return;
    }
    setReplace(null);
    if (force !== "keep") {
      try {
        localStorage.setItem(WIZARD_KEY, JSON.stringify(toWizard(f)));
      } catch {
        /* ignore */
      }
    }
    rememberWay("form");
    onForm();
  };
  // the ideal programme, changed by hand: a facts edit (like removing a card), sent to the concierge with the next message
  const setPace = (k: string) => setState((s) => ({ ...s, facts: { ...s.facts, pace: k } }));
  const toggleInterest = (x: string) => setState((s) => {
    const p = getState().profile.interests;
    const cur = s.facts.interests.length ? s.facts.interests : Array.isArray(p) ? (p as string[]) : [];
    return { ...s, facts: { ...s.facts, interests: cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x] } };
  });

  // where the conversation is: où – quand (the dates, with the flight and hotel of a capture) – ce que vous savez – programme idéal
  const done = [
    f.cities.length > 0,
    validDate(f.start) && validDate(f.end),
    !!(f.places.length || f.fixed.length || f.wishes.length),
    !!(state.ready || f.pace || f.travel || f.interests.length),
  ];
  const open = done.findIndex((d) => !d);
  const step = launching ? 4 : (state.ready && done[0] && done[1]) || open === -1 ? 3 : open;
  const title = launching ? t("Concierge") : f.cities[0]?.name || t("Nouveau voyage");
  const status = launching
    ? <><Dots />{t("prépare votre voyage")}</>
    : busy
      ? <><Dots />{state.msgs[state.msgs.length - 1]?.image ? t("lit votre capture") : t("écrit…")}</>
      : !online
        ? <><i className="cc-on off" />{t("Hors ligne")}</>
        : <><i className="cc-on" />{validDate(f.start) && validDate(f.end) ? shortDates(f.start, f.end) : t("Brouillon enregistré")}</>;
  const lastMe = state.msgs.map((m) => m.from).lastIndexOf("me");
  const lastAi = state.msgs.map((m) => m.from).lastIndexOf("concierge");
  const intro = state.msgs.length === 1 && !busy && !launching;
  // « Préparer mon voyage » as soon as the destination and the dates are known (in ivory once the concierge has all it asked)
  const ctaReady = state.ready && canLaunch;
  // it stays in place while the concierge answers (dimmed), so the bottom of the screen never jumps
  const showCta = canLaunch && !launching;
  const lastText = state.msgs[state.msgs.length - 1]?.text || "";
  const slowLine = (lastText.match(URL_RE) || []).length ? t("Je lis vos liens, cela peut prendre une minute.") : state.msgs[state.msgs.length - 1]?.image ? t("Je lis votre capture…") : t("Encore un instant…");
  const showProg = done[0] && done[1] && (step === 3 || done[2]) && !launching;

  // quick replies under the last concierge turn, from what it just brought (screen 07: « C'est parfait », « Ajouter une ville »)
  const lastCards = ((state.msgs[lastAi]?.cards || []).filter((c) => typeof c !== "string") as Card[]).map((c) => c.kind);
  const brought = (...k: Kind[]) => lastCards.some((x) => k.includes(x));
  let quick: Quick[] = [];
  if (!busy && !launching && !intro && !ctaReady && lastAi === state.msgs.length - 1) {
    const capture = { label: t("Ajouter une capture"), act: () => file.current?.click() };
    if (brought("city")) quick = [{ label: t("C'est parfait"), on: true, act: () => void send(t("C'est parfait")) }, { label: t("Ajouter une ville"), act: () => prefill(t("Ajouter une ville : ")) }];
    else if (brought("dates", "flight", "hotel")) quick = [{ label: t("C'est bien ça"), on: true, act: () => void send(t("C'est bien ça")) }, done[1] ? { label: t("Corriger les dates"), act: () => prefill(t("Corriger les dates : ")) } : capture];
    else if (brought("place", "fixed", "wish")) quick = [{ label: t("C'est tout"), on: true, act: () => void send(t("C'est tout")) }, capture];
    else if (step === 2) quick = [capture, { label: t("Rien de particulier"), act: () => void send(t("Rien de particulier")) }];
  }
  const placeholder = listening ? t("Je vous écoute…") : intro ? t("Écrivez, collez un lien, ou dictez…") : step <= 1 ? t("Répondre…") : step === 2 ? t("Ajouter autre chose…") : t("Écrire…");
  const days = launching ? daysOf(f.start, f.end) : [];
  const dayLabel = (d: string, i: number) => {
    const fixed = f.fixed.filter((x) => (x.date || "").slice(0, 10) === d).map((x) => x.name).join(" · ");
    if (fixed) return fixed;
    if (i === 0) return t("Arrivée · {city}", { city: f.cities[0]?.name || "" });
    if (i === days.length - 1) return t("Départ");
    return t("Jour {n}", { n: i + 1 });
  };

  const top = (
    <div className="cc-top">
      <div className="cc-bar">
        <button className="v3-tool" onClick={onCancel} aria-label={t("Fermer")}><CcClose /></button>
        <div className="cc-who">
          <Avatar />
          <span className="cc-who-t"><b>{title}</b><small aria-live="polite">{status}</small></span>
        </div>
        {!launching && all.length > 0 && (
          <button type="button" className="v3-tool cc-point" onClick={() => setRecap(true)} aria-label={`${t("Le point")} (${all.length})`}>
            <CcClip /><span className="num">{all.length}</span>
          </button>
        )}
      </div>
      {!launching && (
        <div className="cc-steps" aria-label={t("Étape {n} sur {of}", { n: Math.min(4, step + 1), of: 4 })}>
          {STEPS.map((s, i) => (
            <Fragment key={s}>
              {i > 0 && <s className={i <= step ? "on" : ""} />}
              <span className={i === step ? "on" : i < step ? "done" : ""}>{t(s)}</span>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Shell ring={false} top={top} className="v3-concierge">
      <div className={"cc-thread" + (intro ? " intro" : "")} aria-live="polite">
        {intro ? (
          <>
            <div className="cc-hero">
              <Avatar size="lg" />
              <p className="cc-ai big">{name ? t("Bonjour {name}.\nOù aimeriez-vous aller ?", { name }) : t("Bonjour.\nOù aimeriez-vous aller ?")}</p>
              <p className="cc-sub">{t("Une ville suffit pour commencer. Vous pouvez aussi coller un lien, une liste ou une capture.")}</p>
            </div>
            <div className="cc-ideas in">
              <p className="v3-lbl">{t("Quelques idées")}</p>
              <div className="cc-glass">
                {IDEAS.map((s) => (
                  <button key={s} type="button" className="cc-prompt" onClick={() => prefill(t(s))}>
                    <CcSpark className="cc-ic mute" /><span>{t("«\u00a0{s}\u00a0»", { s: t(s) })}</span><CcSend className="cc-ic s" />
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          state.msgs.map((m, i) => (
            m.from === "me"
              ? <Mine key={m.id || i} m={m} old={i < lastMe || launching} fresh={i >= seen.current} onRetry={() => void retry(m.id || "")} onEdit={() => edit(m.id || "")} />
              : (
                <div key={i} className={"cc-turn" + (i >= seen.current ? " in" : "")}>
                  <div className={"cc-ai" + (i < lastMe || launching ? " old" : "")}>{m.text}</div>
                  {m.cards && m.cards.length > 0 && <Cards cards={m.cards} shot={m.shot} onEdit={() => setRecap(true)} onFix={() => prefill(t("Corriger les dates : "))} />}
                  {i === lastAi && showProg && <Programme f={f} onPace={setPace} onInterest={toggleInterest} />}
                  {i === lastAi && quick.length > 0 && (
                    <div className="cc-quick">
                      {quick.map((q) => <button key={q.label} type="button" className={"cc-chip" + (q.on ? " on" : "")} onClick={q.act}>{q.label}</button>)}
                    </div>
                  )}
                </div>
              )
          ))
        )}
        {busy && <div className="cc-ai cc-typing in" role="status" aria-label={t("Le concierge écrit…")}><Dots />{slow && <span className="cc-slow">{slowLine}</span>}</div>}
        {launching && (
          <>
            <div className="cc-me old in">{t("Oui, prépare tout")}</div>
            <div className="cc-turn in">
              <div className="cc-ai">{t("Je prépare {city}. Le programme se construit jour par jour : je vous montre où j'en suis.", { city: f.cities.map((c) => c.name).join(" · ") })}</div>
              <div className="cc-glass cc-rc">
                <div className="cc-rc-h"><span className="v3-lbl">{t("Préparation · {n} jours", { n: days.length })}</span></div>
                <div className="cc-prog"><i /></div>
                {days.slice(0, 8).map((d, i) => (
                  <div key={d} className="cc-day" data-s={i === 0 ? "live" : "wait"}>
                    <span className="st"><b /></span>
                    <span className="when">{when(d)}</span>
                    <span className="dl">{dayLabel(d, i)}</span>
                    <span className="meter"><i /></span>
                  </div>
                ))}
                {days.length > 8 && <p className="cc-more">{t("+ {n} jours", { n: days.length - 8 })}</p>}
                <div className="cc-meta">
                  <span>{dateLabel(f.start, f.end)}</span>
                  {f.places.length > 0 && <span><b>{f.places.length}</b> {f.places.length > 1 ? t("lieux retenus") : t("lieu retenu")}</span>}
                </div>
              </div>
              <div className="cc-live"><Dots />{t("Je crée le voyage…")}</div>
            </div>
          </>
        )}
        <div ref={end} />
      </div>
      {err && <p className="v3-err cc-err" role="alert">{err}</p>}
      <div className="cc-input">
        {launching ? (
          <div className="cc-glass cc-comp quiet"><span className="cc-r"><CcBell /></span><span className="cc-in">{t("La préparation continue dans le voyage")}</span></div>
        ) : (
          <>
            {replace && (
              <div className="cc-glass cc-replace" role="alertdialog" aria-label={t("Remplacer le brouillon du formulaire ?")}>
                <b>{replace.cities.length ? t("Remplacer le brouillon {where} ?", { where: replace.cities.map((c) => c.name).join(" · ") }) : t("Remplacer le brouillon du formulaire ?")}</b>
                <small>{t("Le formulaire a déjà un brouillon. Cette conversation peut prendre sa place, ou vous pouvez reprendre ce brouillon.")}</small>
                <span className="cc-replace-acts">
                  <button type="button" className="v3-chip on" onClick={() => toForm("replace")}>{t("Remplacer")}</button>
                  <button type="button" className="v3-chip" onClick={() => toForm("keep")}>{t("Reprendre le brouillon")}</button>
                  <button type="button" className="cc-act" onClick={() => setReplace(null)}>{t("Annuler")}</button>
                </span>
              </div>
            )}
            {showCta && <button type="button" className={"v3-btn cc-cta" + (ctaReady ? "" : " ghost") + (busy ? " wait" : "")} disabled={busy} onClick={() => setRecap(true)}><CcSpark />{t("Préparer mon voyage")}</button>}
            {shot && (
              <span className="cc-att"><CcImg className="cc-ic s" /><span className="nm">{shot.name}</span><button type="button" onClick={() => setShot(null)} aria-label={t("Retirer la capture")}><CcClose className="cc-ic s" /></button></span>
            )}
            <div className="cc-glass cc-comp">
              <button type="button" className="cc-r" onClick={() => file.current?.click()} aria-label={t("Ajouter une capture ou une photo")}><CcPlus /></button>
              <textarea ref={input} value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={placeholder} aria-label={t("Message au concierge")} enterKeyHint="send"
                onFocus={() => window.setTimeout(() => toEnd("smooth"), 300)}
                onPaste={(e) => { const img = Array.from(e.clipboardData?.files || []).find((x) => x.type.startsWith("image/")); if (img) { e.preventDefault(); setShot(img); } }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
              <button type="button" className={"cc-r" + (listening ? " on" : "")} onClick={mic} aria-label={listening ? t("Arrêter la dictée") : t("Dicter")} aria-pressed={listening}><CcMic /></button>
              {(text.trim() || shot) && (
                <button type="button" className="cc-r go" onClick={() => void send()} disabled={busy} aria-label={t("Envoyer")}><CcSend /></button>
              )}
            </div>
            <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { setShot(e.target.files?.[0] || null); e.target.value = ""; }} />
            {!showCta && !replace && <button type="button" className="v3-link cc-switch" onClick={() => toForm()}>{t("Je préfère remplir le formulaire")}</button>}
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
              {all.filter((x) => x.kind !== "people").map((x) => (
                <div key={x.key} className="cc-item">
                  <KindIcon kind={x.kind} booked={x.booked} />
                  <span className="t">{x.title}{x.sub && <small>{x.sub}</small>}</span>
                  {x.kind === "place" && x.must && <span className="v3-tag gold">{t("Incontournable")}</span>}
                  {x.kind === "fixed" && <span className="v3-tag gold">{x.booked ? t("Réservé") : t("Fixe")}</span>}
                  <button type="button" className="cc-x" onClick={() => setState((s) => ({ ...s, facts: without(s.facts, x.key) }))} aria-label={`${t("Retirer")} : ${x.title}`}><CcClose className="cc-ic s" /></button>
                </div>
              ))}
              {!all.length && <p className="v3-note">{t("Rien encore : parlez-moi de votre voyage.")}</p>}
            </div>
            {/* travelling with others: their first names, so the trip lists them and they can be invited while it is prepared */}
            {(GROUP.has(f.travel) || companions.length > 0) && (
              <div className="cc-mates">
                <p className="v3-lbl">{t("Qui part avec vous ?")} <span className="cr-opt">{t("facultatif")}</span></p>
                <div className="cr-people">
                  {companions.map((p) => (
                    <span key={p} className="cr-person">
                      <span className="ini" aria-hidden="true">{p.charAt(0).toUpperCase()}</span>{p}
                      <button type="button" onClick={() => dropMate(p)} aria-label={t("Retirer {name}", { name: p })}><CcClose className="cc-ic s" /></button>
                    </span>
                  ))}
                  <form className="cr-person add" onSubmit={(e) => { e.preventDefault(); addMate(); }}>
                    <input value={mate} onChange={(e) => setMate(e.target.value)} placeholder={t("Prénom")} aria-label={t("Prénom du compagnon")} autoComplete="off" autoCapitalize="words" maxLength={40} enterKeyHint="done" />
                    <button type="submit" disabled={!mate.trim()} aria-label={t("Ajouter")}><CcPlus className="cc-ic s" /></button>
                  </form>
                </div>
                {!companions.length && <p className="v3-note">{t("Leurs prénoms suffisent. Vous pourrez les inviter pendant la préparation.")}</p>}
              </div>
            )}
            {!canLaunch && <p className="v3-note">{t("Il me faut au moins la destination et les dates pour lancer la préparation.")}</p>}
            <button className="v3-btn" style={{ marginTop: 16 }} disabled={!canLaunch || launching} onClick={() => void launch()}><CcSpark />{launching ? t("Création…") : t("Lancer la préparation")}</button>
            <button type="button" className="v3-link" onClick={() => setRecap(false)}>{t("Continuer la conversation")}</button>
            <button type="button" className="v3-link cc-switch" onClick={() => toForm()}>{t("Je préfère remplir le formulaire")}</button>
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
