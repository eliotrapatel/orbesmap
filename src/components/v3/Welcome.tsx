import { useEffect, useState } from "react";
import { track } from "../../lib/track";
import { sendLoginEmail, signInWithGoogle, signInWithPassword, verifyLoginCode } from "../../lib/store";
import OrbitMark from "../OrbitMark";
import Shell from "./Shell";
import { legalHref } from "./Legal";
import { t, tk, getLang, setLang } from "../../lib/i18n";
import "../../styles/landing.css";

type Mode = "email" | "sent" | "password";

/** Google sign-in: shown once it is switched on in Supabase (later) */
const GOOGLE = false;

/** First screen when nobody is signed in: what ORBES Trips does, then an account (e-mail link, code, Google, password) */
export default function Welcome() {
  const [mode, setMode] = useState<Mode>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());
  useEffect(() => track("visit"), []);

  const run = async (f: () => Promise<void>, fail: string) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
    } catch (e) {
      const m = String((e as Error)?.message || "");
      setErr(/provider is not enabled|Unsupported provider/i.test(m) ? t("La connexion avec Google n'est pas encore activée. Utilisez votre e-mail.") : /rate limit|too many/i.test(m) ? t("Trop de demandes : réessayez dans quelques minutes.") : /Invalid login/i.test(m) ? t("E-mail ou mot de passe incorrect.") : fail);
    } finally {
      setBusy(false);
    }
  };

  const toAccount = () => {
    document.getElementById("compte")?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => document.getElementById("v3-email")?.focus({ preventScroll: true }), 450);
  };

  return (
    <Shell className="v3-public" top={<span className="v3-brand"><OrbitWord /><span className="v3-grow" /><button type="button" className="v3-toplink" onClick={() => setLang(getLang() === "fr" ? "en" : "fr")} lang={getLang() === "fr" ? "en" : "fr"}>{getLang() === "fr" ? "English" : "Français"}</button><button type="button" className="v3-toplink" onClick={toAccount}>{t("Se connecter")}</button></span>}>
      <section className="pub-hero">
        <div className="pub-hero-text">
          <p className="v3-lbl" style={{ marginTop: 28 }}>{t("Carnet de voyage · préparé par IA")}</p>
          <h1 className="v3-d v3-h1">{t("Vos voyages, préparés au détail près.")}</h1>
          <p className="v3-lead">{t("Dites où vous allez et ce que vous savez déjà. ORBES Trips construit votre programme jour par jour et vérifie chaque lieu.")}</p>
          <ul className="v3-vp">
            <li><span>01</span>{t("Un programme heure par heure, à votre rythme")}</li>
            <li><span>02</span>{t("Des lieux vérifiés : horaires, adresses, fermetures")}</li>
            <li><span>03</span>{t("Vols, hôtel et rendez-vous pris en compte")}</li>
          </ul>
        </div>
        <div className="pub-hero-card">
          <div className="v3-glass v3-auth" id="compte">
            {mode === "sent" ? (
              <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) void run(() => verifyLoginCode(email.trim(), code.trim()), t("Code incorrect ou expiré.")); }}>
                <p className="v3-msg">{t("Un lien de connexion vient d'être envoyé à")} <b>{email.trim()}</b>. {t("Ouvrez-le sur ce téléphone.")}</p>
                <label className="v3-field">
                  <span className="sr">{t("Code reçu par e-mail")}</span>
                  <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder={t("Ou saisissez le code reçu")} />
                </label>
                <button className="v3-btn" disabled={busy || !code.trim()}>{busy ? t("Vérification…") : t("Valider le code")}</button>
                <button type="button" className="v3-link" onClick={() => { setMode("email"); setCode(""); }}>{t("Changer d'adresse")}</button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!valid) return;
                  if (mode === "password") void run(() => signInWithPassword(email.trim(), password), t("Connexion impossible. Réessayez."));
                  else void run(async () => { await sendLoginEmail(email.trim()); setMode("sent"); track("signup_email"); }, t("L'e-mail n'a pas pu partir. Réessayez dans un instant."));
                }}
              >
                <label className="v3-field">
                  <span className="sr">{t("Adresse e-mail")}</span>
                  <input id="v3-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" placeholder={t("Votre adresse e-mail")} />
                </label>
                {mode === "password" && (
                  <label className="v3-field">
                    <span className="sr">{t("Mot de passe")}</span>
                    <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder={t("Mot de passe")} />
                  </label>
                )}
                <button className="v3-btn" disabled={busy || !valid || (mode === "password" && !password)}>
                  {busy ? t("Un instant…") : mode === "password" ? t("Se connecter") : t("Recevoir le lien de connexion")}
                </button>
                {GOOGLE && (
                  <button type="button" className="v3-btn ghost" disabled={busy} onClick={() => void run(signInWithGoogle, t("La connexion avec Google n'a pas pu démarrer."))}>
                    <GoogleG /> {t("Continuer avec Google")}
                  </button>
                )}
                <button type="button" className="v3-link" onClick={() => setMode(mode === "password" ? "email" : "password")}>
                  {mode === "password" ? t("Recevoir un lien à la place") : t("J'ai un mot de passe")}
                </button>
              </form>
            )}
            {err && <p className="v3-err" role="alert">{err}</p>}
            <p className="v3-fine">{t("Sans mot de passe · gratuit · en continuant, vous acceptez les")} <a href={legalHref("cgu")}>{t("conditions")}</a> {t("et la")} <a href={legalHref("confidentialite")}>{t("politique de confidentialité")}</a></p>
          </div>
          <a className="v3-link pub-more" href="#comment">{t("Comment ça marche ↓")}</a>
        </div>
      </section>

      <section className="pub-sec" id="comment">
        <p className="v3-lbl">{t("Comment ça marche")}</p>
        <h2 className="v3-d pub-h2">{t("Trois minutes pour un voyage entier.")}</h2>
        <ol className="pub-steps">
          <li>
            <span className="pub-n">01</span>
            <b>{t("Où et quand")}</b>
            <p>{t("La destination, les dates, avec qui vous partez et le rythme que vous aimez.")}</p>
          </li>
          <li>
            <span className="pub-n">02</span>
            <b>{t("Ce que vous savez déjà")}</b>
            <p>{t("Collez tout en vrac : vols, hôtel, réservations, envies, liens. L'IA trie et range chaque élément.")}</p>
          </li>
          <li>
            <span className="pub-n">03</span>
            <b>{t("Votre programme, prêt")}</b>
            <p>{t("Jour par jour, heure par heure, sur la carte. Ajustez en une phrase : « samedi plus calme », « un rooftop un soir ».")}</p>
          </li>
        </ol>
      </section>

      <section className="pub-sec pub-demo">
        <div className="pub-demo-text">
          <p className="v3-lbl">{t("Le programme")}</p>
          <h2 className="v3-d pub-h2">{t("Chaque journée tient debout.")}</h2>
          <p className="v3-lead">{t("Les horaires d'ouverture, les jours de fermeture et les temps de trajet sont vérifiés avant de placer un lieu. Ce qui ne rentre pas reste dans vos pistes, prêt à être placé quand un créneau se libère.")}</p>
        </div>
        <div className="v3-glass v3-daycard pub-day" aria-label={t("Exemple de journée")}>
          <div className="v3-dayhead">
            <span className="v3-grow"><b className="v3-d">{t("Vieille ville et thé")}</b><small>{t("Exemple · jour 2")}</small></span>
            <span className="v3-chip on" aria-hidden="true">{t("{n} lieux", { n: 4 })}</span>
          </div>
          {DEMO.map(([tm, name, why]) => (
            <div key={tm} className="v3-slot">
              <span className="v3-tm">{tm}</span>
              <span className="v3-grow"><b>{t(name)}</b><small>{t(why)}</small></span>
            </div>
          ))}
        </div>
      </section>

      <section className="pub-sec">
        <p className="v3-lbl">{tk("on-site", "Sur place")}</p>
        <h2 className="v3-d pub-h2">{t("Tout ce qu'il faut, dans la poche.")}</h2>
        <div className="pub-grid">
          {FEATURES.map(([f, d]) => (
            <div key={f} className="pub-feat">
              <b>{t(f)}</b>
              <p>{t(d)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pub-sec pub-asia" aria-labelledby="pub-asia-h">
        <div>
          <p className="v3-lbl">{t("Chine et Asie")}</p>
          <h2 className="v3-d pub-h2" id="pub-asia-h">{t("Là où vos applis habituelles ne marchent plus.")}</h2>
          <p className="v3-lead">{t("En Chine, Google ne marche pas. Ailleurs en Asie, c'est souvent la langue et l'écriture qui bloquent.")}</p>
        </div>
        <div>
          <ol className="pub-asia-list">
            {ASIA.map(([f, d], i) => (
              <li key={f}>
                <span className="pub-n" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <b>{t(f)}</b>
                  <p>{t(d)}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="pub-asia-else">{t("Et tout cela marche aussi partout ailleurs.")}</p>
        </div>
      </section>

      <section className="pub-sec pub-free">
        <p className="v3-lbl">{tk("pricing", "Prix")}</p>
        <h2 className="v3-d pub-h2">{t("Gratuit pour commencer.")}</h2>
        <p className="v3-lead">{t("Toutes les fonctions sont incluses pendant le lancement. Un compte suffit, sans carte bancaire et sans mot de passe.")}</p>
      </section>

      <section className="pub-sec">
        <p className="v3-lbl">{t("Questions")}</p>
        <div className="pub-faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{t(q)}</summary>
              <p>{t(a)}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="pub-sec pub-end">
        <h2 className="v3-d pub-h2">{t("Votre prochain voyage commence ici.")}</h2>
        <button type="button" className="v3-btn" onClick={toAccount}>{t("Créer mon premier voyage")}</button>
        <p className="v3-fine">ORBES Trips · 2026 · <a href={legalHref("cgu")}>{t("Conditions")}</a> · <a href={legalHref("confidentialite")}>{t("Confidentialité")}</a> · <a href="mailto:hello@joinentity.com">{t("Contact")}</a></p>
      </section>
    </Shell>
  );
}

const DEMO: [string, string, string][] = [
  ["9h00", "Marché du matin", "Avant la foule · petit-déjeuner sur place"],
  ["10h30", "Temple et jardins", "Ouvert dès 9h · fermé le lundi"],
  ["13h00", "Déjeuner dans la vieille ville", "Réservé · 12 min à pied"],
  ["15h30", "Maison de thé", "Dégustation · réservation conseillée"],
];

const FEATURES: [string, string][] = [
  ["La carte du voyage", "Chaque lieu à sa place, jour par jour, avec la distance depuis l'hôtel."],
  ["Des fiches complètes", "Horaires, réservation, adresse en écriture locale à montrer au chauffeur."],
  ["L'agenda", "Les temps de trajet, les visites à vérifier, l'export vers votre calendrier."],
  ["Traduire et parler", "Traduction, phrases utiles, conversion de devises."],
  ["Urgences", "Les numéros du pays, le consulat et votre assurance au même endroit."],
  ["À plusieurs", "Invitez vos compagnons de voyage, en modification ou en lecture seule."],
];

/** China and Asia: only what the app really does (map without Google, offline with Pro, the driver screen, phrases + translator, the departure checklist) */
const ASIA: [string, string][] = [
  ["Une carte sans Google", "La carte du voyage n'utilise pas Google. Avec Pro, activez le mode hors ligne : elle marche aussi sans réseau, dans le métro ou sans données."],
  ["L'adresse pour le chauffeur", "Le nom et l'adresse de chaque lieu dans l'écriture locale, en grand à l'écran, avec lecture à voix haute."],
  ["Phrases utiles et traducteur", "Des phrases avec leur prononciation (pinyin, romaji) à écouter, et un traducteur pour parler avec quelqu'un."],
  ["Une check-list de départ", "Visa, eSIM, paiements locaux, applis utiles : ce qu'il faut régler avant de partir, avec des dates conseillées."],
];

const FAQ: [string, string][] = [
  ["Faut-il un mot de passe ?", "Non. Vous recevez un lien ou un code par e-mail à chaque connexion, rien à retenir."],
  ["Pour quelles destinations ?", "Partout. L'IA cherche et vérifie les lieux pour la ville que vous indiquez, dans la langue du pays pour les adresses."],
  ["Et sans réseau ?", "Votre programme et vos fiches restent sur votre téléphone : ils se lisent même sans connexion, et se synchronisent au retour du réseau."],
  ["Qui voit mon voyage ?", "Vous seul, et les personnes que vous invitez. Vous choisissez si elles peuvent modifier ou seulement consulter."],
];

function OrbitWord() {
  return (
    <>
      <OrbitMark size={20} />
      <span>ORBES Trips</span>
    </>
  );
}

function GoogleG() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}
