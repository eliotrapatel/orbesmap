import "../../styles/pricing.css";
import "../../styles/plans.css";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { track } from "../../lib/track";
import { closePro, useStore, type ProReason } from "../../lib/store";
import { clearOffer, getCapInfo, joinWaitlist, pendingOffer, proDate, redeemCode, rememberOffer, type SalePlan } from "../../lib/pro";
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
  cap: "Vous avez atteint la limite d'IA de la formule gratuite.",
};

/** The plan selected when the screen opens: the one that answers why it opened.
 *  A locked trip or an export concern one trip: the Pass voyage covers exactly that, at the lowest price.
 *  The free trip of the month used means more trips: only Pro annuel prepares them without a monthly limit. */
const FIRST: Record<ProReason, SalePlan> = { edit: "pass", export: "pass", prep: "annual", business: "business", info: "annual", cap: "annual" };

/** A price in euros, written the language's way: "9,99 €" / "€9.99", "39 €" / "€39" */
const eur = (n: number) =>
  new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n);

/** A date set short, so it holds on one line of the card: "18 nov. 2027" / "18 Nov 2027" */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Paris" });

/** A plan on sale: the figure (display capitals) with its period beside it on one baseline ("par an"),
 *  a short period for the button ("/ an"), the line that says what it is, and why it is worth it.
 *  One pattern everywhere: the card and the membership card say "9,99 € par voyage", the button "9,99 € / voyage". */
type Offer = { id: SalePlan; name: string; amount: number; period: string; short: string; line: string; tag?: string; value: string; cta: string };
const OFFERS: Offer[] = [
  {
    id: "pass",
    name: "Pass voyage",
    amount: 9.99,
    period: "par voyage",
    short: "/ voyage",
    line: "Pro pour un voyage, jusqu'à 30 jours après le retour.",
    value: "Un paiement unique, sans abonnement.",
    cta: "Choisir le Pass voyage",
  },
  {
    id: "annual",
    name: "Pro annuel",
    amount: 39,
    period: "par an",
    short: "/ an",
    line: "Tout Pro, pour tous vos voyages.",
    tag: "Voyageurs fréquents",
    value: "Dès 4 voyages par an, moins cher que 4 Pass voyage.",
    cta: "Choisir Pro annuel",
  },
  {
    id: "business",
    name: "Business",
    amount: 19,
    period: "par mois et par personne",
    short: "/ mois",
    line: "Pour les voyages professionnels : sourcing, salons, rendez-vous.",
    value: "Tout Pro, et en plus : note de frais, plusieurs voyageurs, facture.",
    cta: "Choisir Business",
  },
];
/** The membership card's price fact, worded like the plan cards: "9,99 € par voyage", "39 € par an", "19 € par mois et par personne" */
const priceOf = (o: Offer) => eur(o.amount) + "\u00a0" + t(o.period);

/** The comparison's columns: the free plan for reference, then the three plans on sale (short names: the prices are on the plans) */
type Col = "free" | SalePlan;
const COLS: { id: Col; name: string }[] = [
  { id: "free", name: "Gratuit" },
  { id: "pass", name: "Pass" },
  { id: "annual", name: "Annuel" },
  { id: "business", name: "Business" },
];
type Cell = boolean | string;
/** What each plan gives, in one glance (true = included, false = not included, text = how much).
 *  Same facts as the plan cards: Pass = Pro on one trip, Annuel = Pro on every trip and no monthly limit, Business = all of Pro and its extras. */
const ROWS: { label: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  { label: "Voyages en Pro", cells: [false, "1", "Tous", "Tous"] },
  { label: "Voyages préparés par l'IA", cells: ["1 / mois", "1 / mois", "Illimité", "Illimité"] },
  { label: "Programme, partage, invités", cells: [true, true, true, true] },
  { label: "Modifier un programme validé", cells: [false, true, true, true] },
  { label: "Carte hors ligne et exports", cells: [false, true, true, true] },
  { label: "Mode affaires", cells: [false, true, true, true] },
  { label: "Note de frais et facture", cells: [false, false, false, true] },
];
/** What a member has unlocked (under the membership card) */
const UNLOCKED = [
  "Modifier le programme à tout moment : ajouter, déplacer, retirer des lieux",
  "Des voyages préparés par l'IA sans limite mensuelle, et bien plus de demandes",
  "La carte hors ligne et les exports (PDF, calendrier)",
  "Le mode affaires : fournisseurs, rendez-vous, comptes-rendus",
];
/** The staged reveal on enter: each block rises a little after the one before */
const rise = (ms: number) => ({ "--d": ms + "ms" }) as CSSProperties;

/** The membership card, at a bank card's proportions: the mark, the account's first name, two facts (plan and price, or access and validity).
 *  Deep black with a fine blue edge; nothing on it moves once it has risen into place.
 *  preview = a visitor or a free account: the card is marked "Votre future carte" and the name stays dimmed, so it never reads as owned.
 *  A changed value cross-fades (keyed). */
function MemberCard({ name, facts, preview, delay = 0 }: { name: string; facts: { k: string; v: string }[]; preview?: boolean; delay?: number }) {
  return (
    <div className={"pm-card pm-rise" + (preview ? " is-preview" : " is-member")} style={rise(delay)}>
      <div className="pm-card-top">
        <ProMark size="md" />
        <span className="pm-card-brand">{preview ? t("Votre future carte") : "ORBES Trips"}</span>
      </div>
      <div className="pm-card-name v3-d">{name || (preview ? t("Votre nom") : t("Membre Pro"))}</div>
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

/** One cell of the comparison: a blue check, a hairline dash, or a short quantity */
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

/** ORBES Trips Pro: a membership card, the plans, "choose this plan" until it goes on sale, the plans compared in one glance, a code to activate it.
 *  A member sees their card (first name, validity) and what is unlocked. */
export default function ProScreen() {
  useLang();
  const why = useStore((s) => s.proAsk) || "info";
  const plan = useStore((s) => s.plan);
  const session = useStore((s) => s.session);
  const first = useStore((s) => ((s.profile.name as string) || "").trim().split(/\s+/)[0] || "");
  /** with no first name, a member's card carries the e-mail's local part ("camille" from camille@…) */
  const local = useStore((s) => (s.session?.user?.email || "").split("@")[0] || "");
  // the offer chosen before signing in ("Créer un compte / Se connecter" below) is the one selected again
  const [sel, setSel] = useState<SalePlan>(() => pendingOffer() || FIRST[why]);
  const firstWhy = useRef(why);
  /** the current trip's Pro, by a Pass or by its owner (supabase/saas-13.sql) */
  const tripPass = useStore((s) => s.plan?.passes?.[s.tripId]);
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
    clearOffer();
  }, []);
  useEffect(() => {
    if (why === firstWhy.current) return;
    firstWhy.current = why;
    setSel(FIRST[why]);
  }, [why]);
  /** the free limit with its numbers, when the server told them */
  const cap = why === "cap" ? getCapInfo() : null;
  const lead = cap && cap.limit && cap.pro ? t("Vous avez atteint la limite d'IA de la formule gratuite. Avec Pro : {pro} demandes par jour au lieu de {n}.", { pro: cap.pro, n: cap.limit }) : WHY[why] ? t(WHY[why]) : "";
  /** signed out: to the account form, in that mode; the offer chosen is kept on this device */
  const toAccount = (mode: "signup" | "signin") => {
    rememberOffer(sel);
    track("tool_opened", mode === "signup" ? "pro_signup" : "pro_signin");
    closePro();
    location.assign(`${location.pathname}?auth=${mode}`);
  };
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
  /** what the member card says about where Pro comes from: an access code, the team, or the plan itself */
  const origin = plan?.admin ? { k: t("Accès"), v: t("Équipe") } : plan?.granted ? { k: t("Accès"), v: t("Code d'accès") } : { k: t("Formule"), v: "Pro" };
  /** validity: a dated code says "Valable jusqu'au" over the short date, so the fact never gets cut */
  const validity =
    plan?.granted && plan.until
      ? { k: t("Valable jusqu'au"), v: shortDate(plan.until) }
      : { k: t("Validité"), v: plan?.granted ? t("À vie") : t("Inclus avec votre accès") };
  const top = (
    <div className="v3-bar">
      <button className="v3-tool pm-close" onClick={() => { track("paywall_closed", why); closePro(); }} aria-label={t("Fermer")}>
        <IClose />
      </button>
      <span className="v3-grow" />
    </div>
  );
  return (
    <Shell className={"v3-pro pm" + (pro ? " pm-member" : " prc")} top={top} ring={false}>
      {pro ? (
        <div className="pm-grid">
          <div className="pm-hero">
            <h1 className="v3-d v3-h1 pm-rise" style={rise(40)}>{t("Vous êtes Pro.")}</h1>
            <MemberCard name={first || local} delay={140} facts={[origin, validity]} />
          </div>
          <div className="pm-main">
            <p className="v3-lbl pm-sec pm-rise" style={rise(220)}>{t("Ce qui est débloqué")}</p>
            <ul className="pm-unlocked pm-rise" style={rise(280)}>
              {UNLOCKED.map((u) => (
                <li key={u}>
                  <ICheck className="pm-yes" />
                  <span>{t(u)}</span>
                </li>
              ))}
            </ul>
            <button className="v3-btn pm-cta pm-continue pm-rise" style={rise(340)} onClick={closePro}>{t("Continuer")}</button>
          </div>
        </div>
      ) : (
        <div className="pm-grid">
          <div className="pm-hero">
            <h1 className="v3-d v3-h1 pm-rise" style={rise(40)}>{t("Votre voyage, sans limite.")}</h1>
            {tripPass && (tripPass.kind === "pass" || !tripPass.mine) && (
              <p className="pm-trip pm-rise" style={rise(70)}>
                <span className="pro-tag">PRO</span>
                <span>
                  <b>{tripPass.kind === "pass" && tripPass.until ? t("Pass voyage jusqu'au {date}", { date: proDate(tripPass.until) }) : tripPass.by ? t("Pro sur ce voyage, offert par {name}", { name: tripPass.by }) : t("Pro sur ce voyage")}</b>{" "}
                  {t("Vos autres voyages restent en formule gratuite.")}
                </span>
              </p>
            )}
            {lead && <p className="v3-lead pm-lead pm-rise" style={rise(100)}>{lead}</p>}
            <MemberCard preview delay={160} name={session ? first : ""} facts={[{ k: t("Formule"), v: t(offer.name) }, { k: t("Prix"), v: priceOf(offer) }]} />
          </div>

          <div className="pm-main">
            <p className="v3-lbl pm-sec pm-rise" style={rise(240)}>{t("Choisissez votre formule")}</p>
            <div className="prc-list pm-rise" style={rise(280)} role="radiogroup" aria-label={t("Les formules")} onKeyDown={onArrows}>
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
                    <span className="prc-name">{t(o.name)}</span>
                    {o.tag && <span className="v3-tag pro prc-tag">{t(o.tag)}</span>}
                    <span className="prc-amount">
                      <span className="prc-price">{eur(o.amount)}</span>
                      <span className="prc-period">{t(o.period)}</span>
                    </span>
                    <span className="prc-line">{t(o.line)}</span>
                    <span className="prc-value">{t(o.value)}</span>
                  </button>
                );
              })}
            </div>

            {!session ? (
              <div className="pm-honest pm-rise" style={rise(320)}>
                <p className="v3-msg">{t("Connectez-vous pour activer un code ou être prévenu à l'ouverture des ventes.")}</p>
                <div className="pm-auth">
                  <button type="button" className="v3-btn" onClick={() => toAccount("signup")}>{t("Créer un compte")}</button>
                  <button type="button" className="v3-btn ghost" onClick={() => toAccount("signin")}>{t("Se connecter")}</button>
                </div>
                {err && <p className="v3-err" role="alert">{err}</p>}
              </div>
            ) : (
              <>
                <div className="pm-honest pm-rise" style={rise(320)} role="status" aria-live="polite">
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
                    <p className="v3-msg">{t("Les paiements ne sont pas encore ouverts. Choisissez votre formule : nous vous prévenons par e-mail dès l'ouverture.")}</p>
                  )}
                </div>
                {/* the action stays under the thumb: docked at the bottom of the screen until its place in the page scrolls into view */}
                <div className="pm-dock pm-rise" style={rise(360)}>
                  {/* an error stays in view with the action, wherever the page is scrolled */}
                  {err && <p className="v3-err pm-dock-err" role="alert">{err}</p>}
                  {chosen === sel ? (
                    <p key="done" className="pm-dock-done">
                      <ICheck className="prc-ok-ic" />
                      <span>{t("C'est noté : {plan}.", { plan: t(offer.name) })}</span>
                    </p>
                  ) : (
                    <button key="cta" type="button" className="v3-btn pm-cta" disabled={busy} onClick={choose}>
                      {busy ? (
                        t("Un instant…")
                      ) : (
                        <>
                          <span className="pm-cta-l">{t(offer.cta)}</span>
                          <span key={sel} className="pm-cta-p">
                            {eur(offer.amount)}
                            <span className="pm-cta-per">{t(offer.short)}</span>
                          </span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </>
            )}

            <p className="v3-lbl pm-sec pm-rise" style={rise(400)}>{t("Ce que comprend chaque formule")}</p>
            <div className="pm-cmp-wrap pm-rise" style={{ ...rise(420), "--on": COLS.findIndex((c) => c.id === sel) } as CSSProperties}>
              <table className="pm-cmp">
                <caption className="sr">{t("Ce que comprend chaque formule")}</caption>
                <colgroup>
                  <col className="pm-c0" />
                  {COLS.map((c) => <col key={c.id} />)}
                </colgroup>
                <thead>
                  <tr>
                    <td className="pm-corner" />
                    {COLS.map((c) => (
                      <th key={c.id} scope="col" className={(c.id === sel ? "on" : "") + (c.id === "free" ? " free" : " pick")}>
                        {c.id === "free" ? (
                          <span className="pm-colhead">
                            <span className="pm-cn">{t(c.name)}</span>
                          </span>
                        ) : (
                          <button type="button" className="pm-colhead pm-colbtn" aria-pressed={c.id === sel} onClick={() => setSel(c.id as SalePlan)}>
                            <span className="pm-cn">{t(c.name)}</span>
                          </button>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r, n) => (
                    <Fragment key={r.label}>
                      {/* phones: the label on its own full-width line over its row (seen only; the row's own header is what is read) */}
                      <tr className={"pm-lrow" + (n ? "" : " first")} aria-hidden="true">
                        <td colSpan={COLS.length + 1}>{t(r.label)}</td>
                      </tr>
                      <tr className={"pm-crow" + (n ? "" : " first")}>
                        <th scope="row" className="pm-rl">
                          <span className="pm-rl-t">{t(r.label)}</span>
                        </th>
                        {r.cells.map((v, i) => (
                          <td key={COLS[i].id} className={(COLS[i].id === sel ? "on" : "") + (i === 0 ? " free" : "")}>
                            <Mark v={v} />
                          </td>
                        ))}
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pm-free pm-rise" style={rise(440)}>
              {session && <span className="v3-tag dim">{t("Votre formule")}</span>}
              <b>{t("Gratuit")}</b> {t("1 voyage préparé par l'IA par mois, programme complet, consultable et partageable, voyageurs invités.")}
            </p>

            {session && (
              <div className="pm-codebox pm-rise" style={rise(460)}>
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
              </div>
            )}
          </div>
        </div>
      )}
      {done && !pro && (
        <>
          <p className="sr" role="status">{done}</p>
          <button className="v3-btn pm-cta pm-continue" onClick={closePro}>{t("Continuer")}</button>
        </>
      )}
      {done && pro && <p className="sr" role="status">{done}</p>}
    </Shell>
  );
}
