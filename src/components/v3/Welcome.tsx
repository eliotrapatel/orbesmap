import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { track } from "../../lib/track";
import OrbitMark from "../OrbitMark";
import Shell from "./Shell";
import { legalHref } from "./Legal";
import AuthBox, { type AuthMode } from "./AuthBox";
import { locale, t, tk, getLang, setLang } from "../../lib/i18n";
import "../../styles/landing.css";

/**
 * First screen when nobody is signed in: a living demo of a trip taking shape, the story in sections revealed on
 * scroll (how it works, what changes, China and Asia, the plans), then the account (e-mail + password).
 */
export default function Welcome() {
  const [mode, setMode] = useState<AuthMode>("signup");
  const [focusKey, setFocusKey] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  // the account form is on screen: the phone's bottom bar steps aside
  const [atForm, setAtForm] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    track("visit");
  }, []);

  // the header gets its glass once the page has moved
  useEffect(() => {
    const el = top.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setScrolled(!e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const el = document.getElementById("compte-sec");
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setAtForm(e.isIntersecting), { threshold: 0, rootMargin: "0px 0px -15% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useReveal();

  /** Smooth scroll to an element (the address is left as it is: the store reads the hash as a trip) */
  const scrollToId = (id: string, block: ScrollLogicalPosition = "start") => document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block });
  /** "Se connecter" / "Créer un compte": to the account form, in that mode, the e-mail field ready. On a computer the
   *  form is centred beside its title; on a phone the title comes first, just under the header. */
  const goTo = (m: AuthMode) => {
    setMode(m);
    setFocusKey((k) => k + 1);
    let wide = false;
    try {
      wide = window.matchMedia("(min-width: 900px)").matches;
    } catch {
      /* ignore */
    }
    if (wide) scrollToId("compte", "center");
    else scrollToId("compte-top");
  };
  const howBtn = (cls: string) => (
    <button type="button" className={cls} onClick={() => scrollToId("comment")}>{t("Voir comment ça marche")}</button>
  );
  const other = getLang() === "fr" ? "en" : "fr";
  const langBtn = (
    <button type="button" className="v3-toplink" onClick={() => setLang(other)} lang={other}>
      {other === "en" ? "English" : "Français"}
    </button>
  );

  const header = (
    <span className="v3-brand lp-head">
      <OrbitMark size={20} />
      <span>ORBES Trips</span>
      <span className="v3-grow" />
      {langBtn}
      <button type="button" className="v3-toplink" onClick={() => goTo("signin")}>{t("Se connecter")}</button>
      <button type="button" className="lp-headcta" onClick={() => goTo("signup")} tabIndex={scrolled ? 0 : -1} aria-hidden={!scrolled}>{t("Créer un compte")}</button>
    </span>
  );

  return (
    <Shell className={"v3-public lp" + (scrolled ? " lp-scrolled" : "")} top={header} ring={false}>
      <div ref={top} className="lp-sentinel" aria-hidden="true" />

      {/* ---------- hero: the promise beside the product at work ---------- */}
      <section className="lp-hero">
        <div className="lp-hero-text">
          <p className="v3-lbl lp-rise" style={{ ["--d" as string]: 0 }}>{t("Carnet de voyage · préparé par IA")}</p>
          <h1 className="v3-d v3-h1 lp-rise" style={{ ["--d" as string]: 1 }}>{t("Vos voyages, préparés au détail près.")}</h1>
          {/* on a phone, only the second sentence: the demo comes up sooner */}
          <p className="v3-lead lp-rise" style={{ ["--d" as string]: 2 }}>
            <span className="lp-lead-pre">{t("Dites où vous allez et ce que vous savez déjà.")} </span>
            {t("ORBES Trips construit votre programme jour par jour et vérifie chaque lieu.")}
          </p>
          <div className="lp-ctas lp-rise" style={{ ["--d" as string]: 3 }}>
            <button type="button" className="v3-btn" onClick={() => goTo("signup")}>{t("Créer un compte gratuit")} <IArrow /></button>
            {howBtn("v3-btn ghost lp-how-btn")}
          </div>
          <p className="lp-reassure lp-rise" style={{ ["--d" as string]: 4 }}>
            <span>{t("Gratuit pour commencer · sans carte bancaire")}</span>
            {howBtn("lp-how-link")}
          </p>
        </div>
        <div className="lp-hero-demo lp-rise" style={{ ["--d" as string]: 3 }}>
          <LiveDemo />
        </div>
      </section>

      {/* ---------- how it works ---------- */}
      <section className="lp-sec" id="comment" aria-labelledby="lp-how-h">
        <p className="v3-lbl rv">{t("Comment ça marche")}</p>
        <h2 className="v3-d pub-h2 rv" id="lp-how-h">{t("Trois minutes pour un voyage entier.")}</h2>
        <ol className="lp-steps">
          {STEPS.map(([title, text, icon], i) => (
            <li key={title} className="rv" style={{ ["--i" as string]: i }}>
              <span className="lp-step-top">
                <span className="lp-step-ic" aria-hidden="true">{icon}</span>
                <span className="pub-n">{String(i + 1).padStart(2, "0")}</span>
              </span>
              <b>{t(title)}</b>
              <p>{t(text)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- what makes the difference ---------- */}
      <section className="lp-sec" aria-labelledby="lp-diff-h">
        <p className="v3-lbl rv">{t("Ce qui change tout")}</p>
        <h2 className="v3-d pub-h2 rv" id="lp-diff-h">{t("Chaque journée tient debout.")}</h2>
        <div className="lp-bento">
          <article className="lp-tile rv" style={{ ["--i" as string]: 0 }}>
            <PlaceMini />
            <b>{t("Des lieux vérifiés")}</b>
            <p>{t("Les horaires d'ouverture, les jours de fermeture et les temps de trajet sont vérifiés avant de placer un lieu. Ce qui ne rentre pas reste dans vos pistes.")}</p>
          </article>
          <article className="lp-tile rv" style={{ ["--i" as string]: 1 }}>
            <TodayMini />
            <b>{t("La vue « Aujourd'hui »")}</b>
            <p>{t("Sur place, l'écran du jour : le prochain lieu, son heure, ce qu'il reste à voir. Le programme se lit même sans réseau.")}</p>
          </article>
          <article className="lp-tile rv" style={{ ["--i" as string]: 2 }}>
            <PeopleMini />
            <b>{t("À plusieurs")}</b>
            <p>{t("Invitez vos compagnons de voyage : chacun suit le programme sur son téléphone, en modification ou en lecture seule.")}</p>
          </article>
          <article className="lp-tile rv" style={{ ["--i" as string]: 3 }}>
            <ExpenseMini />
            <b>{t("Les dépenses")}</b>
            <p>{t("Chacun note ce qu'il paie, en monnaie locale et en euros. L'app calcule qui doit combien à qui.")}</p>
          </article>
        </div>
      </section>

      {/* ---------- in the pocket ---------- */}
      <section className="lp-sec" aria-labelledby="lp-pocket-h">
        <p className="v3-lbl rv">{tk("on-site", "Sur place")}</p>
        <h2 className="v3-d pub-h2 rv" id="lp-pocket-h">{t("Tout ce qu'il faut, dans la poche.")}</h2>
        <ul className="lp-list">
          {FEATURES.map(([f, d], i) => (
            <li key={f} className="rv" style={{ ["--i" as string]: i % 3 }}>
              <b>{t(f)}</b>
              <p>{t(d)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- China and Asia (after the value story) ---------- */}
      <section className="lp-sec pub-asia" aria-labelledby="pub-asia-h">
        <div className="rv">
          <p className="v3-lbl">{t("Chine et Asie")}</p>
          <h2 className="v3-d pub-h2" id="pub-asia-h">{t("Là où vos applis habituelles ne marchent plus.")}</h2>
          <p className="v3-lead">{t("En Chine, Google ne marche pas. Ailleurs en Asie, c'est souvent la langue et l'écriture qui bloquent.")}</p>
        </div>
        <div>
          <ol className="pub-asia-list">
            {ASIA.map(([f, d], i) => (
              <li key={f} className="rv" style={{ ["--i" as string]: i }}>
                <span className="pub-n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <b>{t(f)}</b>
                  <p>{t(d)}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="pub-asia-else rv">{t("Et tout cela marche aussi partout ailleurs.")}</p>
        </div>
      </section>

      {/* ---------- the plans (payments not open yet) ---------- */}
      <section className="lp-sec" aria-labelledby="lp-plans-h">
        <p className="v3-lbl rv">{t("Les formules")}</p>
        <h2 className="v3-d pub-h2 rv" id="lp-plans-h">{t("Gratuit pour commencer.")}</h2>
        <p className="v3-lead rv">{t("Pro arrive bientôt, pour ceux qui voyagent souvent. Les paiements ne sont pas encore ouverts : d'ici là, le compte gratuit suffit pour préparer votre prochain voyage.")}</p>
        <div className="lp-plans">
          {PLANS().map((p, i) => (
            <div key={p.name} className={"lp-plan rv" + (p.now ? " now" : "")} style={{ ["--i" as string]: i }}>
              <span className="lp-plan-top">
                <b>{t(p.name)}</b>
                <span className={"v3-tag " + (p.now ? "ok" : "dim")}>{p.now ? t("Disponible") : t("Bientôt")}</span>
              </span>
              {/* "39 € / an": the amount large, "/ an" small beside it */}
              <span className="lp-price">
                <span className="v3-d">{p.price.split(" / ")[0]}</span>
                {p.price.includes(" / ") && <small>/ {p.price.split(" / ").slice(1).join(" / ")}</small>}
              </span>
              <small className={"lp-per" + (p.per ? "" : " lp-per-none")}>{p.per ? t(p.per) : " "}</small>
              <p>{t(p.line)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- questions ---------- */}
      <section className="lp-sec" aria-labelledby="lp-faq-h">
        <p className="v3-lbl rv" id="lp-faq-h">{t("Questions")}</p>
        <div className="pub-faq rv">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{t(q)}</summary>
              <p>{t(a)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ---------- trust, then the account ---------- */}
      <section className="lp-sec lp-trust" aria-label={t("Confiance")}>
        {TRUST.map(([title, text, icon], i) => (
          <div key={title} className="rv" style={{ ["--i" as string]: i }}>
            <span className="lp-trust-ic" aria-hidden="true">{icon}</span>
            <span>
              <b>{t(title)}</b>
              <small>{t(text)}</small>
            </span>
          </div>
        ))}
      </section>

      <section className="lp-sec lp-end" id="compte-sec" aria-labelledby="lp-end-h">
        <div className="lp-end-text rv" id="compte-top">
          <p className="v3-lbl">{mode === "signup" ? t("Créer un compte") : t("Se connecter")}</p>
          <h2 className="v3-d pub-h2" id="lp-end-h">{t("Votre prochain voyage commence ici.")}</h2>
          <p className="v3-lead">{mode === "signup" ? t("Un e-mail, un mot de passe, et votre premier voyage se prépare. Un voyage préparé par l'IA est offert chaque mois.") : t("Content de vous revoir. Vos voyages vous attendent, sur ce téléphone comme sur un ordinateur.")}</p>
        </div>
        <div className="lp-end-box rv" id="compte" style={{ ["--i" as string]: 1 }}>
          <AuthBox mode={mode} onMode={setMode} focusKey={focusKey} />
        </div>
      </section>

      {/* phones: the account always within thumb reach, once the hero has gone and until the form shows */}
      <div className={"lp-dock" + (scrolled && !atForm ? " on" : "")} aria-hidden={!(scrolled && !atForm)}>
        <button type="button" className="v3-btn" onClick={() => goTo("signup")} tabIndex={scrolled && !atForm ? 0 : -1}>{t("Créer un compte gratuit")} <IArrow /></button>
      </div>

      <footer className="lp-foot">
        <span className="v3-brand"><OrbitMark size={16} /><span>ORBES Trips</span></span>
        <nav className="lp-foot-links" aria-label={t("Informations")}>
          <a href={legalHref("cgu")}>{t("Conditions")}</a>
          <a href={legalHref("confidentialite")}>{t("Confidentialité")}</a>
          <a href="mailto:hello@joinentity.com">{t("Contact")}</a>
          {langBtn}
        </nav>
        <small>© 2026 ORBES Trips</small>
      </footer>
    </Shell>
  );
}

// ---------------------------------------------------------------- motion helpers

const reducedMotion = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** Sections come in once, as they reach the screen (all at once without IntersectionObserver or with less motion) */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".lp .rv"));
    if (typeof IntersectionObserver === "undefined" || reducedMotion()) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

/** True while the element is on screen and the page is visible (the demo pauses otherwise) */
function useActive(ref: React.RefObject<HTMLElement | null>) {
  const [onScreen, setOnScreen] = useState(false);
  const [shown, setShown] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setOnScreen(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  useEffect(() => {
    const f = () => setShown(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);
  return onScreen && shown;
}

// ---------------------------------------------------------------- the living demo

type LL = [number, number];
type Slot = [time: string, name: string, check: string];
type Scene = { dest: string; country: string; dates: string; to: LL; flight: string; hotel: string; places: string; day: string; slots: Slot[] };
const PARIS: LL = [2.35, 48.86];

/** "8h30" in French, "08:30" in English */
const hm = (h: number, m = 0) => (getLang() === "en" ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` : `${h}h${String(m).padStart(2, "0")}`);

const scenes = (): Scene[] => [
  {
    dest: "Kyoto",
    country: t("Japon"),
    dates: t("12 – 18 avril · à deux"),
    to: [135.77, 35.01],
    // airport codes and the arrival time: the same in every language
    flight: `CDG → KIX · ${hm(13, 5)}`,
    hotel: t("Gion · 6 nuits"),
    places: t("{n} lieux vérifiés", { n: 14 }),
    day: t("Jour 2 · Higashiyama"),
    slots: [
      [hm(8, 30), "Fushimi Inari", t("Ouvert jour et nuit · avant la foule")],
      [hm(11), "Kiyomizu-dera", t("Ouvert {a}–{b} · 20 min à pied", { a: hm(6), b: hm(18) })],
      [hm(13), t("Déjeuner à Gion"), t("Votre réservation · table pour deux")],
      [hm(16), t("Cérémonie du thé"), t("Fermé le mercredi · placé un mardi")],
    ],
  },
  {
    dest: t("Lisbonne"),
    country: t("Portugal"),
    dates: t("3 – 6 juin · en famille"),
    to: [-9.14, 38.72],
    flight: `ORY → LIS · ${hm(12, 10)}`,
    hotel: t("Chiado · 3 nuits"),
    places: t("{n} lieux vérifiés", { n: 11 }),
    day: t("Jour 1 · Alfama"),
    slots: [
      [hm(9, 30), "Castelo de São Jorge", t("Ouvert dès {a} · billets en ligne", { a: hm(9) })],
      [hm(12, 30), t("Déjeuner dans l'Alfama"), t("12 min à pied · sans réservation")],
      [hm(15), t("Musée national de l'Azulejo"), t("Fermé le lundi · ouvert ce jour-là")],
      [hm(19, 30), "Miradouro da Senhora do Monte", t("Pour le coucher du soleil")],
    ],
  },
];

/** When each part of a scene appears (ms from the start of the scene) */
function timeline(s: Scene) {
  const marks: number[] = [];
  const destAt = 700, destPer = 110;
  const destLen = Array.from(s.dest).length;
  for (let i = 0; i < destLen; i++) marks.push(destAt + i * destPer);
  const destEnd = destAt + destLen * destPer;
  const countryAt = destEnd + 220;
  const datesAt = destEnd + 650, datesPer = 34;
  const datesLen = Array.from(s.dates).length;
  for (let i = 0; i < datesLen; i++) marks.push(datesAt + i * datesPer);
  const datesEnd = datesAt + datesLen * datesPer;
  const arcAt = datesEnd + 380;
  const cardAt = [arcAt + 450, arcAt + 800, arcAt + 1150];
  const dayAt = arcAt + 1700;
  const slotAt = s.slots.map((_, i) => dayAt + 380 + i * 440);
  const readyAt = slotAt[slotAt.length - 1] + 600;
  const outAt = readyAt + 3600;
  const endAt = outAt + 700;
  marks.push(300, destEnd + 300, countryAt, datesEnd + 300, arcAt, ...cardAt, dayAt, ...slotAt, readyAt, outAt, endAt);
  return { destAt, destPer, destEnd, countryAt, datesAt, datesPer, datesEnd, arcAt, cardAt, dayAt, slotAt, readyAt, outAt, endAt, marks: [...new Set(marks)].sort((a, b) => a - b) };
}
const typed = (text: string, at: number, per: number, ms: number) => {
  const chars = Array.from(text);
  if (ms < at) return "";
  return chars.slice(0, Math.min(chars.length, Math.floor((ms - at) / per) + 1)).join("");
};

/**
 * A trip taking shape on a slow loop: the destination and the dates typed, the flight arc on the globe, the flight,
 * the hotel and the places, then a day of the programme filling in. Built in DOM / SVG; pauses off screen; with
 * reduced motion, the finished first scene, still.
 */
function LiveDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const active = useActive(ref);
  const [still] = useState(reducedMotion);
  const all = useMemo(scenes, []);
  const [n, setN] = useState(0);
  const [ms, setMs] = useState(0);
  const s = all[n];
  const p = useMemo(() => timeline(s), [s]);
  const now = still ? Number.POSITIVE_INFINITY : ms;

  useEffect(() => {
    if (still || !active) return;
    const next = p.marks.find((m) => m > ms);
    if (next === undefined) {
      const id = window.setTimeout(() => {
        setN((x) => (x + 1) % all.length);
        setMs(0);
      }, 0);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setMs(next), next - ms);
    return () => window.clearTimeout(id);
  }, [still, active, ms, p, all.length]);

  const on = (at: number) => (now >= at ? " on" : "");
  const dest = typed(s.dest, p.destAt, p.destPer, now);
  const dates = typed(s.dates, p.datesAt, p.datesPer, now);
  const typingDest = !still && now < p.destEnd + 300;
  const typingDates = !still && now >= p.destEnd + 300 && now < p.datesEnd + 300;
  const out = !still && now >= p.outAt;
  const ready = now >= p.readyAt && !out;

  return (
    <div ref={ref} className="ld v3-glass" role="img" aria-label={t("Exemple : un voyage à {d} prend forme, avec le vol, l'hôtel et le programme d'une journée.", { d: all[0].dest })}>
      <div className="ld-head" aria-hidden="true">
        <span className="v3-lbl">{t("Nouveau voyage")}</span>
        <span className="v3-grow" />
        <span className={"ld-status" + (ready ? " on" : "")}>
          <i className="ld-dot" />
          {ready ? t("Programme prêt") : t("Préparation…")}
        </span>
      </div>
      <div key={n} className={"ld-body" + (out ? " out" : "")} aria-hidden="true">
        <div className="ld-fields">
          <div className="ld-field">
            <span className="ld-k">{t("Destination")}</span>
            <span className="ld-v">
              {dest || <em>{t("Où allez-vous ?")}</em>}
              {typingDest && now >= 300 && <i className="ld-caret" />}
              <span className={"ld-country" + on(p.countryAt)}>{s.country}</span>
            </span>
          </div>
          <div className="ld-field">
            <span className="ld-k">{t("Dates")}</span>
            <span className="ld-v">
              {dates || <em>{t("Quand partez-vous ?")}</em>}
              {typingDates && <i className="ld-caret" />}
            </span>
          </div>
        </div>

        <div className="ld-mid">
          <div className={"ld-globe" + on(p.arcAt)}>
            <MiniGlobe from={PARIS} to={s.to} />
          </div>
          <div className="ld-cards">
            <DemoCard cls={on(p.cardAt[0])} icon={<IPlaneLine />} k={t("Vol")} v={s.flight} />
            <DemoCard cls={on(p.cardAt[1])} icon={<IBed />} k={t("Hôtel")} v={s.hotel} />
            <DemoCard cls={on(p.cardAt[2])} icon={<IPinLine />} k={t("Lieux")} v={s.places} />
          </div>
        </div>

        <div className={"ld-day" + on(p.dayAt)}>
          <div className="ld-dayhead">
            <b className="v3-d">{s.day}</b>
            <span className="ld-count">{t("{n} lieux", { n: s.slots.length })}</span>
          </div>
          {s.slots.map(([tm, name, check], i) => (
            <div key={tm} className={"ld-slot" + on(p.slotAt[i])}>
              <span className="ld-tm">{tm}</span>
              <span className="ld-what">
                <b>{name}</b>
                <small><ICheckSmall /> {check}</small>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DemoCard({ cls, icon, k, v }: { cls: string; icon: ReactNode; k: string; v: string }) {
  return (
    <div className={"ld-card" + cls}>
      <span className="ld-card-ic">{icon}</span>
      <span className="ld-card-t">
        <small>{k}</small>
        <b>{v}</b>
      </span>
    </div>
  );
}

const rad = Math.PI / 180;
/** Point at fraction f of the great circle from a to b */
function along(a: LL, b: LL, f: number): LL {
  const [l1, p1] = [a[0] * rad, a[1] * rad];
  const [l2, p2] = [b[0] * rad, b[1] * rad];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((l2 - l1) / 2) ** 2));
  if (!d) return a;
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
  const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
  const z = A * Math.sin(p1) + B * Math.sin(p2);
  return [Math.atan2(y, x) / rad, Math.atan2(z, Math.sqrt(x * x + y * y)) / rad];
}

/** The globe of "Mes voyages", smaller: meridians, parallels, the flight arc drawn from Paris, the destination */
function MiniGlobe({ from, to }: { from: LL; to: LL }) {
  const R = 120;
  const g = useMemo(() => {
    const mid = along(from, to, 0.55);
    const l0 = mid[0], p0 = Math.max(-50, mid[1] - 22);
    const sp0 = Math.sin(p0 * rad), cp0 = Math.cos(p0 * rad);
    const proj = ([lng, lat]: LL, lift = 1) => {
      const cp = Math.cos(lat * rad), sp = Math.sin(lat * rad), dl = (lng - l0) * rad;
      return { x: R * lift * cp * Math.sin(dl), y: -R * lift * (cp0 * sp - sp0 * cp * Math.cos(dl)), vis: sp0 * sp + cp0 * cp * Math.cos(dl) };
    };
    const line = (pts: LL[], lift?: (i: number) => number, min = 0) => {
      let d = "";
      let pen = false;
      pts.forEach((pt, i) => {
        const q = proj(pt, lift ? lift(i) : 1);
        if (q.vis > min) {
          d += `${pen ? "L" : "M"}${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
          pen = true;
        } else pen = false;
      });
      return d;
    };
    const grid: string[] = [];
    for (let lng = -180; lng < 180; lng += 20) grid.push(line(Array.from({ length: 61 }, (_, i) => [lng, -90 + i * 3] as LL)));
    for (let lat = -60; lat <= 60; lat += 20) grid.push(line(Array.from({ length: 121 }, (_, i) => [-180 + i * 3, lat] as LL)));
    const N = 64;
    const lift = Math.min(0.22, 0.06 + 0.0000165 * distKm(from, to));
    const arc = line(Array.from({ length: N + 1 }, (_, i) => along(from, to, i / N)), (i) => 1 + lift * Math.sin((Math.PI * i) / N), -0.12);
    return { grid: grid.filter(Boolean), arc, start: proj(from), end: proj(to) };
  }, [from, to]);
  return (
    <svg viewBox="-150 -150 300 300" aria-hidden="true">
      <defs>
        <radialGradient id="ld-sphere" cx="0.68" cy="0.28" r="0.9">
          <stop offset="0" stopColor="#24221f" />
          <stop offset="0.55" stopColor="#0c0c0d" />
          <stop offset="1" stopColor="#050505" />
        </radialGradient>
      </defs>
      <circle r={R} fill="url(#ld-sphere)" stroke="rgba(246,242,234,0.16)" strokeWidth="0.8" />
      <g fill="none" stroke="rgba(246,242,234,0.12)" strokeWidth="0.6">
        {g.grid.map((d, i) => <path key={i} d={d} />)}
      </g>
      <path className="ld-arc" d={g.arc} pathLength={1} fill="none" stroke="var(--gold)" strokeWidth="3" strokeLinecap="round" />
      {g.start.vis > 0 && <circle cx={g.start.x} cy={g.start.y} r="3.2" fill="rgba(246,242,234,0.75)" />}
      {g.end.vis > 0 && (
        <g className="ld-end" transform={`translate(${g.end.x.toFixed(1)} ${g.end.y.toFixed(1)})`}>
          <g className="ld-end-in">
            <circle r="11" fill="none" stroke="var(--gold)" strokeOpacity="0.4" strokeWidth="1" />
            <circle r="4.4" fill="var(--gold)" />
          </g>
        </g>
      )}
    </svg>
  );
}
function distKm(a: LL, b: LL) {
  const p1 = a[1] * rad, p2 = b[1] * rad;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------- the small product views of "what changes"

function PlaceMini() {
  return (
    <div className="lp-mini" aria-hidden="true">
      <div className="lp-mini-row">
        <span className="lp-mini-ic"><IPinLine /></span>
        <span className="lp-mini-t"><b>{t("Galerie des Offices")}</b><small>{t("Florence · musée")}</small></span>
      </div>
      <div className="lp-mini-chips">
        <span className="lp-chip ok"><i />{t("Ouvert · ferme à {t}", { t: hm(18, 30) })}</span>
        <span className="lp-chip">{t("Fermé le lundi")}</span>
      </div>
    </div>
  );
}
function TodayMini() {
  return (
    <div className="lp-mini" aria-hidden="true">
      <span className="v3-lbl lp-mini-k">{t("Aujourd'hui")} · {t("Jour {i} sur {n}", { i: 3, n: 6 })}</span>
      <div className="lp-mini-next">
        <span className="lp-mini-time v3-d">{hm(11)}</span>
        <span className="lp-mini-t"><b>{t("Galleria dell'Accademia")}</b><small>{t("Dans {n} min · 9 min à pied", { n: 25 })}</small></span>
      </div>
      <span className="lp-mini-bar"><i style={{ width: "40%" }} /></span>
      <small className="lp-mini-foot">{t("{a} lieux sur {b} aujourd'hui", { a: 2, b: 5 })}</small>
    </div>
  );
}
function PeopleMini() {
  return (
    <div className="lp-mini" aria-hidden="true">
      <div className="lp-mini-people">
        <span className="lp-av">É</span>
        <span className="lp-av">L</span>
        <span className="lp-av">M</span>
      </div>
      <div className="lp-mini-line"><b>Léa</b><small>{t("Peut modifier")}</small></div>
      <div className="lp-mini-line"><b>Marc</b><small>{t("Lecture seule")}</small></div>
    </div>
  );
}
function ExpenseMini() {
  const eur = (v: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(v);
  return (
    <div className="lp-mini" aria-hidden="true">
      <div className="lp-mini-line"><b>{t("Dîner à Oltrarno")}</b><small className="lp-num">{eur(84)}</small></div>
      <div className="lp-mini-line"><span>{t("Payé par {n}", { n: "Léa" })}</span><small>{t("À trois")}</small></div>
      <div className="lp-mini-settle">{t("{a} doit {m} à {b}", { a: "Marc", m: eur(28), b: "Léa" })}</div>
    </div>
  );
}

// ---------------------------------------------------------------- content

const STEPS: [string, string, ReactNode][] = [
  ["Dites où et quand", "Racontez votre voyage au concierge comme à un ami, ou remplissez le formulaire en 4 étapes. Collez ce que vous avez déjà : vols, hôtel, réservations.", <IChatLine key="i" />],
  ["Le programme se prépare", "Jour par jour, heure par heure, sur la carte. Chaque lieu est vérifié avant d'être placé : horaires, fermetures, trajets.", <ICalLine key="i" />],
  ["Sur place, tout est là", "La journée en un coup d'œil dans « Aujourd'hui », les fiches des lieux, l'adresse pour le chauffeur. Même sans réseau.", <ICompass key="i" />],
];

const FEATURES: [string, string][] = [
  ["La carte du voyage", "Chaque lieu à sa place, jour par jour, avec la distance depuis l'hôtel."],
  ["Des fiches complètes", "Horaires, réservation, adresse en écriture locale à montrer au chauffeur."],
  ["L'agenda", "Les temps de trajet, les visites à vérifier, l'export vers votre calendrier."],
  ["Traduire et parler", "Traduction, phrases utiles, conversion de devises."],
  ["Urgences", "Les numéros du pays, le consulat et votre assurance au même endroit."],
  ["Notes et photos", "Sur chaque lieu, et le récapitulatif du voyage à partager au retour."],
];

/** China and Asia: only what the app really does (map without Google, offline with Pro, the driver screen, phrases + translator, the departure checklist) */
const ASIA: [string, string][] = [
  ["Une carte sans Google", "La carte du voyage n'utilise pas Google. Avec Pro, activez le mode hors ligne : elle marche aussi sans réseau, dans le métro ou sans données."],
  ["L'adresse pour le chauffeur", "Le nom et l'adresse de chaque lieu dans l'écriture locale, en grand à l'écran, avec lecture à voix haute."],
  ["Phrases utiles et traducteur", "Des phrases avec leur prononciation (pinyin, romaji) à écouter, et un traducteur pour parler avec quelqu'un."],
  ["Une check-list de départ", "Visa, eSIM, paiements locaux, applis utiles : ce qu'il faut régler avant de partir, avec des dates conseillées."],
];

/** The plans and their prices, as on the Pro screen (payments open soon) */
const PLANS = () => {
  const eur = (n: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  return [
    { name: "Gratuit", price: eur(0), per: "", line: "1 voyage préparé par l'IA par mois, programme complet utilisable, partage et voyageurs invités.", now: true },
    { name: "Pass voyage", price: eur(9.99), per: "une fois", line: "Pro pour un voyage, jusqu'à 30 jours après le retour.", now: false },
    { name: "Pro annuel", price: t("{price} / an", { price: eur(39) }), per: "", line: "Tout Pro, pour tous vos voyages.", now: false },
    { name: "Business", price: t("{price} / mois", { price: eur(19) }), per: "par personne", line: "Pour les voyages professionnels : sourcing, salons, rendez-vous.", now: false },
  ];
};

const FAQ: [string, string][] = [
  ["Faut-il un mot de passe ?", "Oui, celui que vous choisissez en créant votre compte. Oublié ? « Mot de passe oublié » vous envoie un lien pour en choisir un nouveau."],
  ["Pour quelles destinations ?", "Partout. L'IA cherche et vérifie les lieux pour la ville que vous indiquez, dans la langue du pays pour les adresses."],
  ["Et sans réseau ?", "Votre programme et vos fiches restent sur votre téléphone : ils se lisent même sans connexion, et se synchronisent au retour du réseau."],
  ["Qui voit mon voyage ?", "Vous seul, et les personnes que vous invitez. Vous choisissez si elles peuvent modifier ou seulement consulter."],
];

const TRUST: [string, string, ReactNode][] = [
  ["Privé par défaut", "Vos voyages ne sont visibles que par vous et les personnes que vous invitez.", <ILock key="i" />],
  ["Sur votre téléphone", "Le programme est gardé sur l'appareil et se lit sans réseau.", <IPhone key="i" />],
  ["Sans carte bancaire", "Un e-mail et un mot de passe suffisent pour commencer.", <ICardLine key="i" />],
];

// ---------------------------------------------------------------- line icons (24 grid, 1.6 stroke)

const ic = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
function IArrow() { return <svg {...ic} className="lp-arrow"><path d="M5 12h14M13 6l6 6-6 6" /></svg>; }
function IPlaneLine() { return <svg {...ic}><path d="M10.5 13.5 4 11l1.5-1.5 7 1 4-4c.8-.8 2.2-1 2.8-.4.6.6.4 2-.4 2.8l-4 4 1 7L14.5 21.5 12 15l-3 3v2.5L7.5 22 6.5 18 2.5 17 4 15.5h2.5Z" /></svg>; }
function IBed() { return <svg {...ic}><path d="M3 18V6M3 14h18v4M21 14v-2.5a3 3 0 0 0-3-3h-7V14" /><circle cx="7" cy="11" r="1.8" /></svg>; }
function IPinLine() { return <svg {...ic}><path d="M19 10c0 5.5-7 11-7 11s-7-5.5-7-11a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2.6" /></svg>; }
function ICheckSmall() { return <svg {...ic} className="ld-ck"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>; }
function IChatLine() { return <svg {...ic}><path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12Z" /><path d="M8.5 11h7M8.5 14h4" /></svg>; }
function ICalLine() { return <svg {...ic}><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M16 3v4M8 3v4M3.5 10h17M8 14h3M8 17h6" /></svg>; }
function ICompass() { return <svg {...ic}><circle cx="12" cy="12" r="8.5" /><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" /></svg>; }
function ILock() { return <svg {...ic}><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>; }
function IPhone() { return <svg {...ic}><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>; }
function ICardLine() { return <svg {...ic}><rect x="3" y="5.5" width="18" height="13" rx="2.5" /><path d="M3 10h18M7 15h3" /></svg>; }
