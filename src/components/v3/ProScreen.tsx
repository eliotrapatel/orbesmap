import "../../styles/pricing.css";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { track } from "../../lib/track";
import { closePro, useStore, type ProReason } from "../../lib/store";
import { joinWaitlist, proDate, redeemCode, type SalePlan } from "../../lib/pro";
import Shell from "./Shell";
import ProMark from "./ProMark";
import { ICheck, IClose } from "../Icons";
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

/** The comparison's columns: the free plan for reference, then the three plans on sale (short name, price, period) */
type Col = "free" | SalePlan;
const COLS: { id: Col; name: string; price: () => string; per: string }[] = [
  { id: "free", name: "Gratuit", price: () => eur(0), per: "" },
  { id: "pass", name: "Pass", price: () => eur(9.99), per: "une fois" },
  { id: "annual", name: "Annuel", price: () => eur(39), per: "/ an" },
  { id: "business", name: "Business", price: () => eur(19), per: "/ mois" },
];
type Cell = boolean | string;
/** What each plan gives, in one glance (true = included, false = not included, text = how much).
 *  Same facts as the plan cards: Pass = Pro on one trip, Annuel = Pro on every trip and no monthly limit, Business = all of Pro and its extras. */
const ROWS: { label: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  { label: "Voyages en Pro", cells: [false, "1", "Tous", "Tous"] },
  { label: "Voyages préparés par l'IA", cells: ["1 / mois", "1 / mois", "Sans limite", "Sans limite"] },
  { label: "Programme, partage, invités", cells: [true, true, true, true] },
  { label: "Modifier un programme validé", cells: [false, true, true, true] },
  { label: "Carte hors ligne et exports", cells: [false, true, true, true] },
  { label: "Mode affaires", cells: [false, true, true, true] },
  { label: "Note de frais et facture", cells: [false, false, false, true] },
];
/** What a member has unlocked (under the membership card) */
const UNLOCKED = [
  "Modifier le programme à tout moment : ajouter, déplacer, retirer des lieux",
  "Des voyages préparés par l'IA sans limite mensuelle, et bien plus de demandes",
  "La carte hors ligne et les exports (PDF, calendrier)",
  "Le mode affaires : fournisseurs, rendez-vous, comptes-rendus",
];
/** The staged reveal on enter: each block rises a little after the one before */
const rise = (ms: number) => ({ "--d": ms + "ms" }) as CSSProperties;

/** The membership card: the mark, the account's first name, two facts (plan and price, or plan and validity).
 *  A changed value cross-fades (keyed); the gold sheen passes once, when the card appears. */
function MemberCard({ name, facts, member }: { name: string; facts: { k: string; v: string }[]; member?: boolean }) {
  return (
    <div className={"pm-card pm-rise" + (member ? " is-member" : "")} style={rise(0)}>
      <svg className="pm-card-orbit" viewBox="0 0 700 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
        <ellipse cx="350" cy="150" rx="330" ry="88" transform="rotate(-18 350 150)" />
        <ellipse cx="350" cy="150" rx="236" ry="58" transform="rotate(-18 350 150)" />
      </svg>
      <div className="pm-card-top">
        <ProMark size="md" />
        <span className="pm-card-brand">ORBES Trips</span>
      </div>
      <div className="pm-card-name v3-d">{name || t("Membre Pro")}</div>
      <div className="pm-card-foot">
        {facts.map((f, i) => (
          <span key={i} className={"pm-fact" + (i ? " r" : "")}>
            <span className="pm-k">{f.k}</span>
            <span key={f.v} className="pm-v">{f.v}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** One cell of the comparison: a gold check, a hairline dash, or a short quantity */
function Mark({ v }: { v: Cell }) {
  if (v === true)
    return (
      <>
        <ICheck className="pm-yes" />
        <span className="sr">{t("Inclus")}</span>
      </>
    );
  if (v === false)
    return (
      <>
        <span className="pm-no" aria-hidden="true" />
        <span className="sr">{t("Non inclus")}</span>
      </>
    );
  return <span className="pm-qty">{t(v)}</span>;
}

/** ORBES Trips Pro: a membership card, the plans compared in one glance, "choose this plan" until it goes on sale, a code to activate it.
 *  A member sees their card (first name, validity) and what is unlocked. */
export default function ProScreen() {
  useLang();
  const why = useStore((s) => s.proAsk) || "info";
  const plan = useStore((s) => s.plan);
  const session = useStore((s) => s.session);
  const first = useStore((s) => ((s.profile.name as string) || "").trim().split(/\s+/)[0] || "");
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
  const validity = plan?.granted && plan.until ? t("Jusqu'au {date}", { date: proDate(plan.until) }) : plan?.granted ? t("À vie") : t("Inclus avec votre accès");
  const top = (
    <div className="v3-bar">
      <button className="v3-tool pm-close" onClick={closePro} aria-label={t("Fermer")}>
        <IClose />
      </button>
      <span className="v3-grow" />
    </div>
  );
  return (
    <Shell className={"v3-pro pm" + (pro ? " pm-member" : " prc")} top={top} ring={false}>
      {pro ? (
        <>
          <h1 className="v3-d v3-h1 pm-rise" style={rise(60)}>{t("Vous êtes Pro.")}</h1>
          <MemberCard member name={first} facts={[{ k: t("Formule"), v: "Pro" }, { k: t("Validité"), v: validity }]} />
          <p className="v3-lbl pm-sec pm-rise" style={rise(220)}>{t("Ce qui est débloqué")}</p>
          <ul className="pm-unlocked pm-rise" style={rise(280)}>
            {UNLOCKED.map((u) => (
              <li key={u}>
                <ICheck className="pm-yes" />
                <span>{t(u)}</span>
              </li>
            ))}
          </ul>
          <div className="v3-spacer" />
        </>
      ) : (
        <>
          <MemberCard name={session ? first : ""} facts={[{ k: t("Formule"), v: t(offer.name) }, { k: t("Prix"), v: offer.price() + (offer.per ? " · " + t(offer.per) : "") }]} />
          <h1 className="v3-d v3-h1 pm-rise" style={rise(120)}>{t("Votre voyage, sans limite.")}</h1>
          {WHY[why] && <p className="v3-lead pm-rise" style={rise(180)}>{t(WHY[why])}</p>}

          <p className="v3-lbl prc-lbl pm-rise" style={rise(240)}>{t("Les formules")}</p>
          <div className="pm-cmp-wrap pm-rise" style={rise(280)}>
            <table className="pm-cmp">
              <caption className="sr">{t("Ce que comprend chaque formule")}</caption>
              <colgroup>
                <col className="pm-c0" />
                {COLS.map((c) => <col key={c.id} />)}
              </colgroup>
              <thead>
                <tr>
                  <td />
                  {COLS.map((c) => (
                    <th
                      key={c.id}
                      scope="col"
                      className={(c.id === sel ? "on" : "") + (c.id !== "free" ? " pick" : "")}
                      onClick={c.id !== "free" ? () => setSel(c.id as SalePlan) : undefined}
                    >
                      <span className="pm-cn">{t(c.name)}</span>
                      <span className="pm-cp">{c.price()}</span>
                      <span className="pm-cper">{c.per ? t(c.per) : " "}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label}>
                    <th scope="row">{t(r.label)}</th>
                    {r.cells.map((v, i) => (
                      <td key={COLS[i].id} className={(COLS[i].id === sel ? "on" : "") + (i === 0 ? " free" : "")}>
                        <Mark v={v} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="pm-free pm-rise" style={rise(320)}>
            {session && <span className="v3-tag dim">{t("Votre formule")}</span>}
            <b>{t("Gratuit")}</b> {t("1 voyage préparé par l'IA par mois, programme complet utilisable, partage et voyageurs invités.")}
          </p>

          <p className="v3-lbl prc-lbl pm-rise" style={rise(340)}>{t("Choisissez votre formule")}</p>
          <div className="prc-list pm-rise" style={rise(360)} role="radiogroup" aria-label={t("Les formules")} onKeyDown={onArrows}>
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
          <div className="v3-glass v3-auth prc-buy pm-rise" style={rise(400)}>
            {!session ? (
              <p className="v3-msg">{t("Connectez-vous pour activer un code ou être prévenu à l'ouverture des ventes.")}</p>
            ) : (
              <>
                <div role="status" aria-live="polite">
                  {chosen === sel ? (
                    <p className="v3-msg prc-ok">
                      <ICheck className="prc-ok-ic" />
                      <span>
                        <b>{t("C'est noté : {plan}.", { plan: t(offer.name) })}</b> {t("Les paiements ouvrent très bientôt. Nous vous prévenons par e-mail dès l'ouverture, avec ce plan.")}
                      </span>
                    </p>
                  ) : plan?.waitlisted ? (
                    <p className="v3-msg prc-ok">
                      <ICheck className="prc-ok-ic" />
                      <span>{t("Vous serez prévenu à l'ouverture des ventes.")} {t("Vous pouvez encore choisir votre formule.")}</span>
                    </p>
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
      {(pro || done) && (
        <>
          {done && <p className="sr" role="status">{done}</p>}
          <button className="v3-btn pm-continue" onClick={closePro}>{t("Continuer")}</button>
        </>
      )}
    </Shell>
  );
}
