import "../../styles/pricing.css";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { track } from "../../lib/track";
import { closePro, useStore, type ProReason } from "../../lib/store";
import { joinWaitlist, proDate, redeemCode, type SalePlan } from "../../lib/pro";
import Shell from "./Shell";
import { locale, t, useLang } from "../../lib/i18n";

const WHY: Record<ProReason, string> = {
  edit: "Ce voyage est validé. Pour modifier son programme, ajouter ou déplacer des lieux, passez à Pro.",
  prep: "Votre voyage offert de ce mois a déjà été préparé. Avec Pro, préparez tous vos voyages.",
  export: "La carte hors ligne et les exports font partie de Pro.",
  business: "Le mode affaires (fournisseurs, rendez-vous, comptes-rendus) fait partie de Pro.",
  info: "",
};

/** The plan selected when the screen opens: the one that answers why it opened.
 *  A locked trip or an export concern one trip: the Pass voyage covers exactly that, at the lowest price.
 *  The free trip of the month used means more trips: only Pro annuel prepares them without a monthly limit. */
const FIRST: Record<ProReason, SalePlan> = { edit: "pass", export: "pass", prep: "annual", business: "business", info: "annual" };

/** A price in euros, written the language's way: "9,99 €" / "€9.99", "39 €" / "€39" */
const eur = (n: number) =>
  new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);

type Offer = { id: SalePlan; name: string; price: () => string; per: string; line: string; tag?: string; value?: string; items: string[]; cta: string };
const OFFERS: Offer[] = [
  {
    id: "pass",
    name: "Pass voyage",
    price: () => eur(9.99),
    per: "une fois",
    line: "Pro pour un voyage, jusqu'à 30 jours après le retour.",
    items: ["Modifications illimitées du programme", "« Refaire ma journée » et ajustements par l'IA", "Mode hors ligne", "Exports PDF et calendrier", "Mode affaires : fournisseurs, rendez-vous, comptes-rendus"],
    cta: "Choisir le Pass voyage",
  },
  {
    id: "annual",
    name: "Pro annuel",
    price: () => t("{price} / an", { price: eur(39) }),
    per: "",
    line: "Tout Pro, pour tous vos voyages.",
    tag: "Voyageurs fréquents",
    value: "Dès 4 voyages par an, moins cher que 4 Pass voyage.",
    items: ["Tout le Pass voyage, sur tous vos voyages", "Des voyages préparés par l'IA sans limite mensuelle"],
    cta: "Choisir Pro annuel",
  },
  {
    id: "business",
    name: "Business",
    price: () => t("{price} / mois", { price: eur(19) }),
    per: "par personne",
    line: "Pour les voyages professionnels : sourcing, salons, rendez-vous.",
    value: "Tout Pro, et en plus : note de frais, plusieurs voyageurs, facture.",
    items: ["Mode affaires : fournisseurs, rendez-vous, comptes-rendus", "Note de frais avec justificatifs", "Plusieurs voyageurs", "Facture"],
    cta: "Choisir Business",
  },
];

/** ORBES Trips Pro: the plans and their prices, the reason the screen opened, "choose this plan" until it goes on sale, a code to activate it */
export default function ProScreen() {
  useLang();
  const why = useStore((s) => s.proAsk) || "info";
  const plan = useStore((s) => s.plan);
  const session = useStore((s) => s.session);
  const [sel, setSel] = useState<SalePlan>(FIRST[why]);
  const [chosen, setChosen] = useState<SalePlan | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr((e as Error).message || t("Une erreur est survenue. Réessayez."));
    } finally {
      setBusy(false);
    }
  };
  const pro = !!plan?.pro;
  useEffect(() => {
    track("pro_screen", why);
  }, [why]);
  useEffect(() => {
    setSel(FIRST[why]);
  }, [why]);
  const offer = OFFERS.find((o) => o.id === sel) || OFFERS[1];
  /** The plan cards are one radio group: one tab stop (the selected card), the arrow keys move the selection */
  const cards = useRef<Partial<Record<SalePlan, HTMLButtonElement | null>>>({});
  const onArrows = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = OFFERS.findIndex((o) => o.id === sel);
    const next = OFFERS[(i + step + OFFERS.length) % OFFERS.length].id;
    setSel(next);
    cards.current[next]?.focus();
  };
  /** The plan chosen: the account joins the waiting list (once) and the choice is recorded as purchase intent */
  const choose = () => {
    const p = sel;
    if (plan?.waitlisted) {
      track("waitlist_join", p);
      setErr(null);
      setChosen(p);
      return;
    }
    void run(async () => {
      await joinWaitlist(p);
      setChosen(p);
    });
  };
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={closePro} aria-label={t("Fermer")}>✕</button>
      <span className="v3-grow" />
    </div>
  );
  return (
    <Shell className={"v3-pro" + (pro ? "" : " prc")} top={top}>
      <p className="v3-lbl" style={{ marginTop: 18 }}>ORBES Trips <span className="pro-tag">PRO</span></p>
      <h1 className="v3-d v3-h1">{pro ? t("Vous êtes Pro.") : t("Votre voyage, sans limite.")}</h1>
      {!pro && WHY[why] && <p className="v3-lead">{t(WHY[why])}</p>}
      {pro && (
        <>
          <p className="v3-lead">
            {plan?.granted && plan.until ? t("Pro jusqu'au {date}.", { date: proDate(plan.until) }) : plan?.granted ? t("Pro à vie.") : t("Pro est inclus avec votre accès.")}
          </p>
          <ul className="v3-vp" style={{ marginTop: 26 }}>
            <li><span>01</span>{t("Modifier le programme à tout moment : ajouter, déplacer, retirer des lieux")}</li>
            <li><span>02</span>{t("Des voyages préparés par l'IA sans limite mensuelle, et bien plus de demandes")}</li>
            <li><span>03</span>{t("La carte hors ligne et les exports (PDF, calendrier)")}</li>
            <li><span>04</span>{t("Le mode affaires : fournisseurs, rendez-vous, comptes-rendus")}</li>
          </ul>
        </>
      )}
      {!pro && (
        <>
          <p className="v3-lbl prc-lbl">{t("Les formules")}</p>
          <div className="prc-free">
            <div className="prc-row">
              <b>{t("Gratuit")}</b>
              <span className="prc-price">{eur(0)}</span>
            </div>
            <p>{t("1 voyage préparé par l'IA par mois, programme complet utilisable, partage et voyageurs invités.")}</p>
            {session && <span className="v3-tag dim">{t("Votre formule")}</span>}
          </div>
          <div className="prc-list" role="radiogroup" aria-label={t("Les formules")} onKeyDown={onArrows}>
            {OFFERS.map((o) => {
              const on = o.id === sel;
              return (
                <button
                  key={o.id}
                  ref={(el) => {
                    cards.current[o.id] = el;
                  }}
                  type="button"
                  tabIndex={on ? 0 : -1}
                  role="radio"
                  aria-checked={on}
                  className={"prc-card" + (on ? " on" : "")}
                  onClick={() => setSel(o.id)}
                >
                  <span className="prc-dot" aria-hidden="true" />
                  <span className="prc-body">
                    <span className="prc-row">
                      <b>{t(o.name)}</b>
                      <span className="prc-price">{o.price()}</span>
                    </span>
                    <span className="prc-row prc-sub">
                      <span>{t(o.line)}</span>
                      {o.per && <span className="prc-per">{t(o.per)}</span>}
                    </span>
                    {o.tag && <span className="v3-tag gold prc-tag">{t(o.tag)}</span>}
                    {on && (
                      <span className="prc-more">
                        {o.value && <span className="prc-value">{t(o.value)}</span>}
                        <span className="prc-items">
                          {o.items.map((it) => (
                            <span key={it} className="prc-item">{t(it)}</span>
                          ))}
                        </span>
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="v3-spacer" />
          <div className="v3-glass v3-auth prc-buy">
            {!session ? (
              <p className="v3-msg">{t("Connectez-vous pour activer un code ou être prévenu à l'ouverture des ventes.")}</p>
            ) : (
              <>
                <div role="status" aria-live="polite">
                  {chosen === sel ? (
                    <p className="v3-msg prc-ok">
                      <b>{t("✓ C'est noté : {plan}.", { plan: t(offer.name) })}</b> {t("Les paiements ouvrent très bientôt. Nous vous prévenons par e-mail dès l'ouverture, avec ce plan.")}
                    </p>
                  ) : plan?.waitlisted ? (
                    <p className="v3-msg">{t("✓ Vous serez prévenu à l'ouverture des ventes.")} {t("Vous pouvez encore choisir votre formule.")}</p>
                  ) : (
                    <p className="v3-msg">{t("Les paiements ne sont pas encore ouverts. Choisissez votre formule : nous vous prévenons par e-mail dès l'ouverture.")}</p>
                  )}
                </div>
                {chosen !== sel && (
                  <button type="button" className="v3-btn" disabled={busy} onClick={choose}>
                    {busy ? t("Un instant…") : t(offer.cta)}
                  </button>
                )}
                <details className="prc-code">
                  <summary>{t("J'ai un code d'accès")}</summary>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!code.trim()) return;
                      void run(async () => {
                        const until = await redeemCode(code);
                        setDone(until ? t("Pro activé jusqu'au {date}.", { date: proDate(until) }) : t("Pro activé à vie."));
                        setCode("");
                      });
                    }}
                  >
                    <label className="v3-field">
                      <span className="sr">{t("Code d'accès Pro")}</span>
                      <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder={t("Code d'accès (ORB-…)")} maxLength={32} />
                    </label>
                    <button className="v3-btn ghost" disabled={busy || !code.trim()}>{busy ? t("Vérification…") : t("Activer Pro")}</button>
                  </form>
                </details>
              </>
            )}
            {err && <p className="v3-err" role="alert">{err}</p>}
          </div>
        </>
      )}
      {pro && <div className="v3-spacer" />}
      {(pro || done) && (
        <>
          {done && <p className="sr" role="status">{done}</p>}
          <button className="v3-btn" onClick={closePro}>{t("Continuer")}</button>
        </>
      )}
    </Shell>
  );
}
