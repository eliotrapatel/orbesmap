import { useEffect, useRef, useState } from "react";
import { track } from "../../lib/track";
import OrbitMark from "../OrbitMark";
import { legalHref } from "./Legal";
import AuthBox, { type AuthMode } from "./AuthBox";
import ProMark from "./ProMark";
import LandingHero from "./LandingMap";
import { locale, t, tk, getLang, setLang } from "../../lib/i18n";
import "../../styles/landing.css";

/**
 * First screen when nobody is signed in. A real city at night is the stage of the hero (one day's route drawn on the
 * map, its stops set like a timetable); then the story in numbered chapters, what changes on the ground, China and
 * Asia, the plans in one aligned table, questions, privacy, and the account (e-mail + password).
 * One grid for everything: 4 columns on a phone (16 px margins), 8 on a tablet, 12 on a computer; spacing on 8 px.
 */
export default function Welcome() {
  const [mode, setMode] = useState<AuthMode>("signup");
  const [focusKey, setFocusKey] = useState(0);
  const [scrolled, setScrolled] = useState(false);
  // the account form is on screen: the phone's bottom bar steps aside
  const [atForm, setAtForm] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
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
    track("landing_cta", m);
    setMode(m);
    setFocusKey((k) => k + 1);
    let wide = false;
    try {
      wide = window.matchMedia("(min-width: 1024px)").matches;
    } catch {
      /* ignore */
    }
    if (wide) scrollToId("compte", "center");
    else scrollToId("compte-top");
  };
  // "Créer un compte / Se connecter" from the Pro screen (?auth=signup|signin): straight to the account form, in that mode
  useEffect(() => {
    const m = new URLSearchParams(location.search).get("auth");
    if (m !== "signup" && m !== "signin") return;
    history.replaceState(history.state, "", location.pathname + location.hash);
    const tm = window.setTimeout(() => goTo(m), 120);
    return () => window.clearTimeout(tm);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const other = getLang() === "fr" ? "en" : "fr";
  const langBtn = (cls: string) => (
    <button type="button" className={cls} onClick={() => setLang(other)} lang={other}>
      {other === "en" ? "English" : "Français"}
    </button>
  );
  const eur = (n: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);
  /** "39 € / an" → ["39 €", "/ an"]: the figure on the common baseline, the unit under it */
  const split = (s: string) => {
    const i = s.indexOf(" / ");
    return i < 0 ? [s, ""] : [s.slice(0, i), "/ " + s.slice(i + 3)];
  };
  const plans = [
    { name: t("Gratuit"), price: eur(0), unit: t("Sans carte bancaire"), line: t("1 voyage préparé par l'IA par mois, programme complet, consultable et partageable, voyageurs invités."), pro: false },
    { name: t("Pass voyage"), price: eur(9.99), unit: t("une fois"), line: t("Pro pour un voyage, jusqu'à 30 jours après le retour."), pro: true },
    { name: t("Pro annuel"), price: split(t("{price} / an", { price: eur(39) }))[0], unit: split(t("{price} / an", { price: eur(39) }))[1], line: t("Tout Pro, pour tous vos voyages."), pro: true },
    { name: t("Business"), price: split(t("{price} / mois", { price: eur(19) }))[0], unit: `${split(t("{price} / mois", { price: eur(19) }))[1]} · ${t("par personne")}`, line: t("Pour les voyages professionnels : sourcing, salons, rendez-vous."), pro: true },
  ];

  return (
    <div className={"v3 lp2" + (scrolled ? " lp2-scrolled" : "")}>
      <div ref={top} className="lp2-sentinel" aria-hidden="true" />

      {/* ---------- header: over the map, its glass once the page has moved ---------- */}
      <header className="lp2-top">
        <div className="lp2-top-in">
          <span className="lp2-brand">
            <OrbitMark size={18} />
            <span>ORBES Trips</span>
          </span>
          <span className="lp2-grow" />
          {langBtn("lp2-toplink")}
          <button type="button" className="lp2-toplink" onClick={() => goTo("signin")}>{t("Se connecter")}</button>
          <button type="button" className="lp2-headcta" onClick={() => goTo("signup")} tabIndex={scrolled ? 0 : -1} aria-hidden={!scrolled}>{t("Créer un compte")}</button>
        </div>
      </header>

      {/* ---------- hero: a real city at night, one day drawn on it ---------- */}
      <LandingHero copyRef={copy}>
        <div ref={copy} className="lp2-copy">
          <p className="v3-lbl lp2-rise" style={{ ["--d" as string]: 0 }}>{t("Carnet de voyage · préparé par IA")}</p>
          <h1 className="lp2-h1 lp2-rise" id="lp2-h1" style={{ ["--d" as string]: 1 }}>{t("Vos voyages, préparés au détail près.")}</h1>
          <p className="lp2-sub lp2-rise" style={{ ["--d" as string]: 2 }}>{t("Dites où et quand. ORBES Trips prépare chaque journée et vérifie chaque lieu : horaires, fermetures, trajets.")}</p>
          <div className="lp2-ctas lp2-rise" style={{ ["--d" as string]: 3 }}>
            <button type="button" className="lp2-btn" onClick={() => goTo("signup")}>
              {t("Créer mon compte")} <IArrow />
            </button>
            <button type="button" className="lp2-quiet" onClick={() => goTo("signin")}>{t("Se connecter")}</button>
          </div>
          <p className="lp2-fine lp2-rise" style={{ ["--d" as string]: 4 }}>{t("Gratuit pour commencer · sans carte bancaire")}</p>
        </div>
      </LandingHero>

      <main className="lp2-main">
        {/* ---------- how it works: three chapters ---------- */}
        <section className="lp2-sec lp2-grid" id="comment" aria-labelledby="lp2-how-h">
          <header className="lp2-head rv">
            <p className="v3-lbl">{t("Comment ça marche")}</p>
            <h2 className="lp2-h2" id="lp2-how-h">{t("Trois étapes pour un voyage entier.")}</h2>
          </header>
          <ol className="lp2-chapters">
            {CHAPTERS.map(([title, text, facts], i) => (
              <li key={title} className="lp2-chapter rv">
                <span className="lp2-num" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="lp2-h3">{t(title)}</h3>
                <div className="lp2-chapter-body">
                  <p>{t(text)}</p>
                  <ul className="lp2-facts" aria-label={t(title)}>
                    {facts.map((f) => <li key={f}>{t(f)}</li>)}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ---------- what changes everything, then on site ---------- */}
        <section className="lp2-sec lp2-grid" aria-labelledby="lp2-diff-h">
          <header className="lp2-head rv">
            <p className="v3-lbl">{t("Ce qui change tout")}</p>
            <h2 className="lp2-h2" id="lp2-diff-h">{t("Chaque journée tient debout.")}</h2>
          </header>
          <dl className="lp2-truths">
            {TRUTHS.map(([title, text]) => (
              <div key={title} className="rv">
                <dt>{t(title)}</dt>
                <dd>{t(text)}</dd>
              </div>
            ))}
          </dl>
          <div className="lp2-pocket rv">
            <p className="v3-lbl">{tk("on-site", "Sur place")} · {t("Tout ce qu'il faut, dans la poche.")}</p>
            <ul>
              {FEATURES.map(([f, d]) => (
                <li key={f}>
                  <b>{t(f)}</b>
                  <span>{t(d)}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- China and Asia (after the value story) ---------- */}
        <section className="lp2-sec lp2-grid lp2-asia" aria-labelledby="pub-asia-h">
          <header className="lp2-head rv">
            <p className="v3-lbl">{t("Chine et Asie")}</p>
            <h2 className="lp2-h2" id="pub-asia-h">{t("Là où vos applis habituelles ne marchent plus.")}</h2>
            <p className="lp2-lead">{t("En Chine, Google ne marche pas. Ailleurs en Asie, c'est souvent la langue et l'écriture qui bloquent.")}</p>
          </header>
          <div className="lp2-asia-list">
            <ol>
              {ASIA.map(([f, d], i) => (
                <li key={f} className="rv">
                  <span className="lp2-n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <b>{t(f)}</b>
                  <p>{t(d)}</p>
                </li>
              ))}
            </ol>
            <p className="lp2-asia-else rv">{t("Et tout cela marche aussi partout ailleurs.")}</p>
          </div>
        </section>

        {/* ---------- the plans (payments not open yet) ---------- */}
        <section className="lp2-sec lp2-grid" aria-labelledby="lp2-plans-h">
          <header className="lp2-head rv">
            <p className="v3-lbl">{t("Les formules")}</p>
            <h2 className="lp2-h2" id="lp2-plans-h">{t("Gratuit pour commencer.")}</h2>
            <p className="lp2-lead">{t("Pro arrive bientôt, pour ceux qui voyagent souvent. Les paiements ne sont pas encore ouverts : d'ici là, le compte gratuit suffit pour préparer votre prochain voyage.")}</p>
          </header>
          <div className="lp2-plans rv">
            <div className="lp2-plans-group lp2-g-free">
              <span>{t("Disponible")}</span>
            </div>
            <div className="lp2-plans-group lp2-g-pro">
              <ProMark size="sm" />
              <span>{t("Bientôt")}</span>
            </div>
            {plans.map((p) => (
              <div key={p.name} className={"lp2-plan" + (p.pro ? " pro" : "")}>
                <b className="lp2-plan-name">{p.name}</b>
                <span className="lp2-plan-price">{p.price}</span>
                <span className="lp2-plan-unit">{p.unit}</span>
                <p className="lp2-plan-line">{p.line}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- questions ---------- */}
        <section className="lp2-sec lp2-grid lp2-qa" aria-labelledby="lp2-faq-h">
          <header className="lp2-head rv">
            <p className="v3-lbl">{t("Questions")}</p>
            <h2 className="lp2-h2" id="lp2-faq-h">{t("Avant de commencer.")}</h2>
          </header>
          <div className="lp2-faq rv">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>
                  <span>{t(q)}</span>
                  <IPlus />
                </summary>
                <p>{t(a)}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ---------- privacy, in one line of two ---------- */}
        <section className="lp2-sec lp2-grid lp2-trust" aria-label={t("Confiance")}>
          {TRUST.map(([title, text]) => (
            <div key={title} className="rv">
              <b>{t(title)}</b>
              <span>{t(text)}</span>
            </div>
          ))}
        </section>

        {/* ---------- the account ---------- */}
        <section className="lp2-sec lp2-grid lp2-end" id="compte-sec" aria-labelledby="lp2-end-h">
          <div className="lp2-end-text rv" id="compte-top">
            <p className="v3-lbl">{t("Compte")}</p>
            <h2 className="lp2-h2" id="lp2-end-h">{t("Votre prochain voyage commence ici.")}</h2>
            <p className="lp2-lead">{mode === "signup" ? t("Un e-mail, un mot de passe, et votre premier voyage se prépare. Un voyage préparé par l'IA est offert chaque mois.") : t("Content de vous revoir. Vos voyages vous attendent, sur ce téléphone comme sur un ordinateur.")}</p>
          </div>
          <div className="lp2-end-box rv" id="compte">
            <AuthBox mode={mode} onMode={setMode} focusKey={focusKey} />
          </div>
        </section>
      </main>

      {/* phones: the account always within thumb reach, once the hero has gone and until the form shows */}
      <div className={"lp2-dock" + (scrolled && !atForm ? " on" : "")} aria-hidden={!(scrolled && !atForm)}>
        <button type="button" className="lp2-btn" onClick={() => goTo("signup")} tabIndex={scrolled && !atForm ? 0 : -1}>
          {t("Créer mon compte")} <IArrow />
        </button>
      </div>

      <footer className="lp2-foot lp2-grid">
        <span className="lp2-brand">
          <OrbitMark size={14} />
          <span>ORBES Trips</span>
        </span>
        <nav className="lp2-foot-links" aria-label={t("Informations")}>
          <a href={legalHref("cgu")}>{t("Conditions")}</a>
          <a href={legalHref("confidentialite")}>{t("Confidentialité")}</a>
          <a href="mailto:hello@joinentity.com">{t("Contact")}</a>
          {langBtn("lp2-foot-lang")}
        </nav>
        <small>© 2026 ORBES Trips</small>
      </footer>
    </div>
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

/** Blocks come in once, as they reach the screen (all at once without IntersectionObserver or with less motion) */
function useReveal() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".lp2 .rv"));
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
      { rootMargin: "0px 0px -6% 0px", threshold: 0.08 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

// ---------------------------------------------------------------- content

/** How it works: what you say, what gets checked, what you have on the ground (each line is something the app does) */
const CHAPTERS: [string, string, string[]][] = [
  ["Dites où et quand", "Racontez votre voyage au concierge comme à un ami, ou remplissez le formulaire en 4 étapes. Collez ce que vous avez déjà : vols, hôtel, réservations.", ["Destination", "Dates", "Rythme", "Ce que vous savez déjà"]],
  ["Le programme se prépare", "Jour par jour, heure par heure, sur la carte. Chaque lieu est vérifié avant d'être placé : horaires, fermetures, trajets.", ["Horaires d'ouverture", "Jours de fermeture", "Temps de trajet"]],
  ["Sur place, tout est là", "« Aujourd'hui » montre le prochain lieu et son heure. Le programme se lit sans réseau, et ceux qui partent avec vous le suivent sur leur téléphone.", ["Aujourd'hui", "Hors ligne", "À plusieurs"]],
];

/** Only what the chapters above do not already say */
const TRUTHS: [string, string][] = [
  ["Rien ne se perd", "Ce qui ne rentre pas dans une journée reste dans vos pistes, à voir si le temps le permet."],
  ["Les dépenses", "Chacun note ce qu'il paie, en monnaie locale et en euros. L'app calcule qui doit combien à qui."],
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

const FAQ: [string, string][] = [
  ["Faut-il un mot de passe\u00a0?", "Oui, celui que vous choisissez en créant votre compte. Oublié\u00a0? «\u00a0Mot de passe oublié\u00a0» vous envoie un lien pour en choisir un nouveau."],
  ["Pour quelles destinations\u00a0?", "Partout. L'IA cherche et vérifie les lieux pour la ville que vous indiquez, dans la langue du pays pour les adresses."],
  ["Et sans réseau\u00a0?", "Votre programme et vos fiches restent sur votre téléphone\u00a0: ils se lisent même sans connexion, et se synchronisent au retour du réseau."],
  ["Qui voit mon voyage\u00a0?", "Vous seul, et les personnes que vous invitez. Vous choisissez si elles peuvent modifier ou seulement consulter."],
];

const TRUST: [string, string][] = [
  ["Privé par défaut", "Vos voyages ne sont visibles que par vous et les personnes que vous invitez."],
  ["Sur votre téléphone", "Le programme est gardé sur l'appareil et se lit sans réseau."],
];

// ---------------------------------------------------------------- line icons (24 grid, 1.5 stroke)

const ic = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
function IArrow() {
  return <svg {...ic} className="lp2-arrow"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}
function IPlus() {
  return <svg {...ic} className="lp2-plus"><path d="M12 5v14M5 12h14" /></svg>;
}
