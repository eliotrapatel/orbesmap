import "../../styles/account.css";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { closePro, getState, requestPro, signOutChecked, toast, updateProfile, useStore } from "../../lib/store";
import { deleteMyAccount, exportMyData, proDate } from "../../lib/pro";
import { alertPrefs, disablePush, enablePush, inboundAddress, pushBlocker, pushEnabled, setAlertPrefs } from "../../lib/alerts";
import { supabase } from "../../lib/supabase";
import { offlineSupported, useOffline } from "../../lib/offline";
import { t, setLang, useLang } from "../../lib/i18n";
import { IBack, IDownload, IExit, IGlobe, IOffline, ITrash } from "../Icons";
import { useEscape } from "../ui";
import AiCredit from "../AiCredit";
import { openAdmin, useAdmin } from "./nav";
import { legalHref } from "./Legal";
import { InboundInbox } from "./AlertsAndInbox";
import ProChip from "./ProMark";
import { track } from "../../lib/track";
import { takeEntry } from "../../lib/entry";

// ---------- the account: one structure for the trip's "Compte" panel and the "Mes voyages" account screen ----------

/** Asks twice (typed word) before deleting the account; returns an error message, or nothing */
export async function confirmAndDelete(): Promise<string | null> {
  if (!confirm(t("Supprimer votre compte\u00a0?\nLes voyages que vous avez créés seront supprimés, y compris pour les personnes invitées. Les voyages partagés avec vous restent à leurs propriétaires.\nVous pouvez d'abord exporter vos données."))) return null;
  const word = t("SUPPRIMER");
  const typed = prompt(t("Pour confirmer, écrivez {word}", { word }));
  if ((typed || "").trim().toUpperCase() !== word) return typed == null ? null : t("Suppression annulée\u00a0: le mot ne correspond pas.");
  try {
    await deleteMyAccount();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// ---------- line icons (24 grid, 1.6 stroke, as ../Icons) ----------
const svg = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const IMail = () => <svg {...svg}><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3.5 7 8.5 6 8.5-6" /></svg>;
const IPhone = () => <svg {...svg}><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></svg>;
const IForward = () => <svg {...svg}><path d="M14 5l6 6-6 6" /><path d="M20 11H10a6 6 0 0 0-6 6v1" /></svg>;
const ILock = () => <svg {...svg}><rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></svg>;
const IShield = () => <svg {...svg}><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6L12 3Z" /></svg>;
const IDoc = () => <svg {...svg}><path d="M7 3h7l4 4v14H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></svg>;
const IAt = () => <svg {...svg}><circle cx="12" cy="12" r="3.6" /><path d="M15.6 12v1.4a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7" /></svg>;
const IKey = () => <svg {...svg}><circle cx="8" cy="15" r="4" /><path d="m11 12 8.5-8.5M16.5 6.5l2.5 2.5M14.5 8.5l2 2" /></svg>;
const ITag = () => <svg {...svg}><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9-8-8Z" /><circle cx="8.5" cy="8.5" r="1.4" /></svg>;
const IChev = () => <svg {...svg} className="ac-chev"><path d="m9 6 6 6-6 6" /></svg>;

// ---------- settings-list pieces ----------
/** A titled group of rows */
export function Group({ label, children, foot, bare, className }: { label: string; children: ReactNode; foot?: ReactNode; bare?: boolean; className?: string }) {
  return (
    <section className={"ac-group" + (className ? " " + className : "")}>
      <h3 className="ac-group-h">{label}</h3>
      {bare ? children : <div className="ac-list">{children}</div>}
      {foot && <p className="ac-foot">{foot}</p>}
    </section>
  );
}

type RowProps = { icon?: ReactNode; title: ReactNode; sub?: ReactNode; end?: ReactNode; danger?: boolean; className?: string };
const RowInner = ({ icon, title, sub, end }: RowProps) => (
  <>
    {icon && <span className="ac-ico">{icon}</span>}
    <span className="ac-txt">
      <b>{title}</b>
      {sub && <small>{sub}</small>}
    </span>
    {end != null && <span className="ac-end">{end}</span>}
  </>
);
const rowCls = (p: RowProps, extra = "") => "ac-row" + extra + (p.danger ? " is-danger" : "") + (p.className ? " " + p.className : "");
/** A row: a button (onClick), a link (href), a switch label (htmlFor) or plain */
export function Row(p: RowProps & { onClick?: () => void; href?: string; htmlFor?: string; disabled?: boolean; expanded?: boolean }) {
  if (p.href) return <a className={rowCls(p, " is-tap")} href={p.href}><RowInner {...p} /></a>;
  if (p.onClick)
    return (
      <button type="button" className={rowCls(p, " is-tap")} onClick={p.onClick} disabled={p.disabled} aria-expanded={p.expanded}>
        <RowInner {...p} />
      </button>
    );
  if (p.htmlFor) return <label className={rowCls(p, " is-tap")} htmlFor={p.htmlFor}><RowInner {...p} /></label>;
  return <div className={rowCls(p)}><RowInner {...p} /></div>;
}

/** An on/off switch (a checkbox read as a switch) */
export function Switch({ id, checked, onChange, disabled, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return <input id={id} className="ac-switch" type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
}

// ---------- the profile header ----------
function PlanCard() {
  const plan = useStore((s) => s.plan);
  const signedIn = useStore((s) => !!s.session);
  // signed in, plan not read yet: the card's shell at its final height, so nothing shifts when it arrives
  if (!plan)
    return signedIn ? (
      <div className="ac-plan is-wait" aria-busy="true">
        <span className="ac-plan-main">
          <span className="ac-plan-k">{t("Votre formule")}</span>
          <span className="ac-plan-bar" aria-hidden="true" />
          <small className="ac-wait">{t("Chargement…")}</small>
        </span>
        <span className="ac-plan-cta is-ghost" aria-hidden="true">{t("Voir les formules")}<IChev /></span>
      </div>
    ) : null;
  if (!plan.pro)
    return (
      <button type="button" className="ac-plan" onClick={() => requestPro("info")}>
        <span className="ac-plan-main">
          <span className="ac-plan-k">{t("Votre formule")}</span>
          <b className="v3-d ac-plan-t">{t("Gratuit")}</b>
          <small>{plan.prepLeft > 0 ? t("1 voyage offert ce mois-ci") : t("Voyage du mois utilisé")}</small>
        </span>
        <span className="ac-plan-cta">{t("Voir les formules")}<IChev /></span>
      </button>
    );
  const line = plan.granted ? (plan.until ? t("Pro jusqu'au {date}", { date: proDate(plan.until) }) : t("Pro à vie")) : t("Pro inclus");
  return (
    <button type="button" className="ac-plan is-pro" onClick={() => requestPro("info")}>
      <span className="ac-plan-main">
        <span className="ac-plan-k">{t("Votre formule")}</span>
        <span className="ac-plan-t"><b className="v3-d">ORBES Trips</b><ProMark /></span>
        <small>{line}</small>
      </span>
      <span className="ac-plan-cta">{t("Détails")}<IChev /></span>
    </button>
  );
}

/** The Pro mark: the same blue chip as the Pro screen (white "PRO" on solid blue) */
export const ProMark = () => <ProChip size="md" className="ac-promark" />;

function AccountHeader({ status }: { status?: ReactNode }) {
  const email = useStore((s) => s.session?.user.email) || "";
  const name = useStore((s) => (s.profile.name as string) || "");
  const pro = useStore((s) => !!s.plan?.pro);
  const shown = name || email.split("@")[0] || t("Sur cet appareil");
  const initial = (name || email || "·").slice(0, 1).toUpperCase();
  return (
    <header className="ac-head">
      <div className="ac-id">
        <span className={"ac-mono" + (pro ? " is-pro" : "")} aria-hidden="true">{initial}</span>
        <div className="ac-who">
          <h2 className="v3-d ac-name">{shown}</h2>
          {email && <p className="ac-mail">{email}</p>}
          {status && <div className="ac-status">{status}</div>}
        </div>
      </div>
      <PlanCard />
    </header>
  );
}

// ---------- alerts ----------
function AlertRows() {
  useStore((s) => s.profile.alerts);
  const prefs = alertPrefs();
  // the cycle's tips and reminders by e-mail (lot cycle): a profile field of its own, off also when the address used
  // the unsubscribe link of an e-mail (mail_optout, supabase/saas-14.sql; ignored before it runs)
  const tipsOn = useStore((s) => s.profile.mailTips !== false);
  const [optedOut, setOptedOut] = useState(false);
  useEffect(() => {
    let alive = true;
    if (supabase)
      void supabase
        .from("mail_optout")
        .select("email")
        .limit(1)
        .then(
          ({ data, error }) => alive && !error && !!data?.length && setOptedOut(true),
          () => undefined,
        );
    return () => {
      alive = false;
    };
  }, []);
  const setTips = (v: boolean) => {
    updateProfile({ mailTips: v });
    if (v) {
      setOptedOut(false);
      void supabase?.rpc("mail_optin").then(() => undefined, () => undefined);
    }
    track("alerts_changed", v ? "tips_on" : "tips_off");
  };
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  useEffect(() => {
    void pushEnabled().then(setOn, () => setOn(false));
  }, []);
  const blocker = pushBlocker();
  const togglePush = async (want: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      if (!want) {
        await disablePush();
        setOn(false);
      } else {
        await enablePush();
        setOn(true);
        toast(t("Notifications activées sur ce téléphone"));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group label={t("Alertes et notifications")}>
      <Row
        htmlFor={id + "m"}
        icon={<IMail />}
        title={t("E-mail du matin")}
        sub={t("Chaque jour du voyage vers 7\u00a0h\u00a030\u00a0: la journée, les horaires, les lieux fermés.")}
        end={<Switch id={id + "m"} label={t("E-mail du matin")} checked={prefs.email} onChange={(v) => setAlertPrefs({ email: v })} />}
      />
      <Row
        htmlFor={id + "t"}
        icon={<IMail />}
        title={t("Conseils et rappels par e-mail")}
        sub={t("Premier voyage, départ, réservation détectée, voyage du mois. Jamais plus d'un tous les 2 jours.")}
        end={<Switch id={id + "t"} label={t("Conseils et rappels par e-mail")} checked={tipsOn && !optedOut} onChange={setTips} />}
      />
      <Row
        htmlFor={blocker ? undefined : id + "p"}
        icon={<IPhone />}
        title={t("Notifications sur ce téléphone")}
        sub={busy ? (on ? t("Désactivation…") : t("Activation…")) : blocker || t("Le résumé du matin et un rappel 30 minutes avant chaque lieu.")}
        end={blocker ? undefined : <Switch id={id + "p"} label={t("Notifications sur ce téléphone")} checked={!!on} disabled={busy || on === null} onChange={(v) => void togglePush(v)} />}
      />
      {err && <p className="ac-err" role="alert">{err}</p>}
    </Group>
  );
}

// ---------- forwarded bookings ----------
function Forwarding({ home }: { home?: boolean }) {
  const [addr, setAddr] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void inboundAddress().then(
      (a) => alive && setAddr(a),
      () => alive && setAddr(null),
    );
    return () => {
      alive = false;
    };
  }, []);
  const copy = () => {
    if (!addr) return;
    const done = () => toast(t("Adresse copiée"));
    const fail = () => toast(t("Copie impossible\u00a0: sélectionnez l'adresse à la main."));
    if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(addr).then(done, fail);
    else fail();
  };
  return (
    <Group label={t("Transfert des réservations")} foot={t("Envoyez à cette adresse vos confirmations de vol, d'hôtel ou de réservation\u00a0: elles arrivent dans le voyage, prêtes à être ajoutées.")}>
      <div className="ac-row ac-fwd">
        <span className="ac-ico"><IForward /></span>
        <span className="ac-txt">
          <b>{t("Votre adresse de transfert")}</b>
          {addr === undefined ? (
            <small className="ac-wait">{t("Chargement…")}</small>
          ) : addr ? (
            <small className="ac-addr" translate="no">{addr}</small>
          ) : (
            <small>{t("Adresse indisponible pour le moment. Réessayez plus tard.")}</small>
          )}
        </span>
        {addr && <button type="button" className="v3-chip ac-copy" onClick={copy}>{t("Copier")}</button>}
      </div>
      <InboundInbox home={home} empty={addr ? <p className="ac-empty">{t("Aucune réservation en attente.")}</p> : null} />
    </Group>
  );
}

// ---------- language ----------
function LanguageRow() {
  const lang = useLang();
  return (
    <Group label={t("Préférences")}>
      <div className="ac-row ac-lang">
        <span className="ac-ico"><IGlobe width={18} height={18} /></span>
        <span className="ac-txt"><b>{t("Langue")}</b></span>
        <div className="v3-seg ac-seg" role="radiogroup" aria-label={t("Langue")}>
          {(["fr", "en"] as const).map((l) => (
            <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? "on" : ""} onClick={() => lang !== l && setLang(l)}>{l === "fr" ? "Français" : "English"}</button>
          ))}
        </div>
      </div>
    </Group>
  );
}

// ---------- password ----------
const MIN_PW = 8;
const pwError = (m: string) =>
  /different from the old|same.*password/i.test(m)
    ? t("C'est déjà votre mot de passe actuel. Choisissez-en un autre.")
    : /weak|pwned|leaked|easy to guess|should contain|at least/i.test(m)
      ? t("Ce mot de passe est trop simple ou trop courant. Choisissez-en un autre.")
      : /reauth|nonce|recent/i.test(m)
        ? t("Par sécurité, déconnectez-vous puis reconnectez-vous avant de changer le mot de passe.")
        : /fetch|network|failed to/i.test(m)
          ? t("Pas de connexion au serveur. Vérifiez le réseau (en Chine\u00a0: eSIM, itinérance ou VPN).")
          : t("Le mot de passe n'a pas pu être enregistré. Réessayez.");

function PasswordRow() {
  const email = useStore((s) => s.session?.user.email) || "";
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const first = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (open) first.current?.focus({ preventScroll: true });
  }, [open]);
  const reset = () => {
    setPw("");
    setPw2("");
    setShow(false);
    setErr(null);
  };
  const submit = async () => {
    setErr(null);
    if (pw.length < MIN_PW) return setErr(t("{n} caractères minimum.", { n: MIN_PW }));
    if (pw !== pw2) return setErr(t("Les deux mots de passe ne correspondent pas."));
    if (!supabase) return setErr(t("Pas de connexion au serveur. Vérifiez le réseau (en Chine\u00a0: eSIM, itinérance ou VPN)."));
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) return setErr(pwError(error.message || ""));
      reset();
      setOpen(false);
      toast(t("Mot de passe enregistré"));
    } catch (e) {
      setErr(pwError((e as Error).message || ""));
    } finally {
      setBusy(false);
    }
  };
  const long = pw.length >= MIN_PW;
  const same = pw2.length > 0 && pw === pw2;
  return (
    <Group label={t("Sécurité")}>
      <Row
        onClick={() => {
          if (open) reset();
          setOpen((v) => !v);
        }}
        expanded={open}
        className={open ? "is-open" : ""}
        icon={<ILock />}
        title={t("Mot de passe")}
        sub={open ? undefined : t("Connectez-vous avec votre e-mail et ce mot de passe. Vous utilisiez un lien\u00a0? Définissez-en un ici.")}
        end={<span className="ac-end-k"><span>{open ? t("Fermer") : t("Définir ou modifier")}</span><IChev /></span>}
      />
      {open && (
        <form
          className="ac-pw"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {/* for password managers: the account the new password belongs to */}
          <input className="sr" type="email" name="username" autoComplete="username" value={email} readOnly tabIndex={-1} aria-hidden="true" />
          <label className="v3-field col ac-pw-f" htmlFor={id + "a"}>
            <span>{t("Nouveau mot de passe")}</span>
            <input ref={first} id={id + "a"} type={show ? "text" : "password"} name="new-password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} aria-invalid={!!err && !long} />
          </label>
          <label className="v3-field col ac-pw-f" htmlFor={id + "b"}>
            <span>{t("Confirmer le mot de passe")}</span>
            <input id={id + "b"} type={show ? "text" : "password"} name="new-password-confirm" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} aria-invalid={!!err && long && !same} />
          </label>
          <div className="ac-pw-meta">
            <span className={"ac-pw-rule" + (long ? " ok" : "")}><i aria-hidden="true" />{t("{n} caractères minimum", { n: MIN_PW })}</span>
            <span className={"ac-pw-rule" + (same ? " ok" : "")}><i aria-hidden="true" />{t("Identiques")}</span>
            <button type="button" className="ac-pw-show" onClick={() => setShow((v) => !v)} aria-pressed={show}>{show ? t("Masquer") : t("Afficher")}</button>
          </div>
          {err && <p className="ac-err" role="alert">{err}</p>}
          <div className="ac-pw-act">
            <button type="button" className="v3-btn ghost" onClick={() => { reset(); setOpen(false); }}>{t("Annuler")}</button>
            <button type="submit" className="v3-btn" disabled={busy || !pw || !pw2}>{busy ? t("Enregistrement…") : t("Enregistrer")}</button>
          </div>
        </form>
      )}
    </Group>
  );
}

// ---------- privacy ----------
function PrivacyRows({ signedIn }: { signedIn: boolean }) {
  const optOut = useStore((s) => s.profile.partnerOptOut === true);
  const id = useId();
  return (
    <Group label={t("Confidentialité")}>
      {signedIn && (
        <Row
          htmlFor={id}
          icon={<ITag />}
          title={t("Offres de nos partenaires")}
          sub={t("Des offres choisies d'après vos voyages et vos dépenses (hôtels, activités, transport, assurance…). Désactivez pour ne plus en recevoir et ne plus figurer dans les données partagées avec nos partenaires.")}
          end={<Switch id={id} label={t("Offres de nos partenaires")} checked={!optOut} onChange={(v) => updateProfile({ partnerOptOut: !v, partnerOptOutAt: Date.now() })} />}
        />
      )}
      <Row onClick={() => exportMyData()} icon={<IDownload width={18} height={18} />} title={t("Exporter mes données")} sub={t("Votre profil et vos voyages, dans un fichier JSON.")} end={<IChev />} />
      <Row href={legalHref("cgu")} icon={<IDoc />} title={t("Conditions d'utilisation")} end={<IChev />} />
      <Row href={legalHref("confidentialite")} icon={<IShield />} title={t("Politique de confidentialité")} end={<IChev />} />
      <Row href="mailto:hello@joinentity.com" icon={<IAt />} title={t("Contact")} sub="hello@joinentity.com" end={<IChev />} />
    </Group>
  );
}

// ---------- the sensitive zone ----------
function DeleteRow() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Group label={t("Zone sensible")} className="ac-danger">
      <Row
        danger
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(await confirmAndDelete());
          setBusy(false);
        }}
        icon={<ITrash width={18} height={18} />}
        title={busy ? t("Suppression…") : t("Supprimer mon compte")}
        sub={t("Les voyages que vous avez créés et leurs photos sont supprimés. Exportez d'abord vos données si besoin.")}
        end={<IChev />}
      />
      {err && <p className="ac-err" role="alert">{err}</p>}
    </Group>
  );
}

// ---------- this trip (the trip's panel): offline mode and exports, each behind its own row ----------
/** The two tools of the open trip as settings rows that open onto their cards (OfflineCard, ExportPanel, unchanged) */
export function TripRows({ offline, exports }: { offline: ReactNode; exports: ReactNode }) {
  const st = useOffline();
  // a download under way stays in view: its progress is what the person came for
  // the J-3 reminder (?offline=1) opens it too
  const [open, setOpen] = useState<"offline" | "exports" | null>(() => (takeEntry("offline") || st.state === "running" || st.phase ? "offline" : null));
  const toggle = (k: "offline" | "exports") => setOpen((v) => (v === k ? null : k));
  const offState = st.state === "running" || st.phase ? t("Téléchargement…") : st.state === "ready" ? t("Carte téléchargée sur ce téléphone") : t("Désactivé");
  return (
    <>
      {offlineSupported && (
        <>
          <Row
            onClick={() => toggle("offline")}
            expanded={open === "offline"}
            className={open === "offline" ? "is-open" : ""}
            icon={<IOffline width={18} height={18} />}
            title={t("Mode hors ligne")}
            sub={offState}
            end={<IChev />}
          />
          {open === "offline" && <div className="ac-trip-body">{offline}</div>}
        </>
      )}
      <Row
        onClick={() => toggle("exports")}
        expanded={open === "exports"}
        className={open === "exports" ? "is-open" : ""}
        icon={<IDownload width={18} height={18} />}
        title={t("Exports")}
        sub={t("PDF, tableur, calendrier")}
        end={<IChev />}
      />
      {open === "exports" && <div className="ac-trip-body">{exports}</div>}
    </>
  );
}

/**
 * The account, in order: who and which plan, this trip (the trip's panel only), alerts, forwarded bookings,
 * language, password, privacy, administration (admins), signing out, then the sensitive zone (last, apart).
 * `variant`: "app" = the trip screen's "Compte" panel, "v3" = the account screen opened from "Mes voyages".
 */
export function AccountSections({ variant = "v3", status, trip, tripFoot }: { variant?: "v3" | "app"; status?: ReactNode; trip?: ReactNode; tripFoot?: ReactNode }) {
  const signedIn = useStore((s) => !!s.session);
  const admin = useStore((s) => !!s.plan?.admin);
  return (
    <div className={"ac is-" + variant}>
      <AccountHeader status={status} />
      {trip && (
        <Group label={t("Ce voyage")} className="ac-trip" foot={tripFoot}>
          {trip}
        </Group>
      )}
      {signedIn && <AlertRows />}
      {signedIn && <Forwarding home={variant === "v3"} />}
      <LanguageRow />
      {signedIn && supabase && <PasswordRow />}
      <PrivacyRows signedIn={signedIn} />
      {admin && (
        <Group label={t("Administration")} bare={false}>
          <Row onClick={() => openAdmin(true)} icon={<IKey />} title={t("Ouvrir la console")} sub={t("Comptes, codes Pro, coût de l'IA")} end={<IChev />} />
          {variant === "app" && <div className="ac-admin-credit"><AiCredit /></div>}
        </Group>
      )}
      {signedIn && (
        <button type="button" className="ac-signout" onClick={() => void signOutChecked()}>
          <IExit width={18} height={18} />
          {t("Se déconnecter")}
        </button>
      )}
      {signedIn && <DeleteRow />}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** Tab stays inside the screen (aria-modal): from the last control back to the first, and the reverse */
function loopFocus(e: KeyboardEvent<HTMLDivElement>) {
  const box = e.currentTarget;
  // events from a portal (the creation form) bubble here through React: only the screen's own controls loop
  if (e.key !== "Tab" || !box.contains(e.target as Node)) return;
  const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
  if (!all.length) return;
  const first = all[0];
  const last = all[all.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

/** The account as its own full screen over "Mes voyages": slides in, Escape or the phone's back closes it */
export default function AccountScreen({ onClose, status }: { onClose: () => void; status?: ReactNode }) {
  const [leaving, setLeaving] = useState(false);
  const back = useRef<HTMLButtonElement>(null);
  const timer = useRef(0);
  const admin = useAdmin();
  const close = () => {
    // Escape and the phone's back close what is on top first: the plans, the console, a trip being created from a booking
    if (getState().proAsk) return closePro();
    if (admin) return openAdmin(false);
    if (document.querySelector(".rt-wizard")) return;
    if (leaving) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) return onClose();
    setLeaving(true);
    timer.current = window.setTimeout(onClose, 200);
  };
  useEscape(close);
  useEffect(() => {
    back.current?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(timer.current);
    };
  }, []);
  return (
    <div className={"v3 ac-screen" + (leaving ? " is-leaving" : "")} role="dialog" aria-modal="true" aria-label={t("Mon compte")} onKeyDown={loopFocus}>
      <div className="v3-bg" aria-hidden="true" />
      <div className="v3-col ac-col">
        <div className="v3-top ac-top">
          <div className="v3-bar">
            <button ref={back} type="button" className="v3-tool" onClick={close} aria-label={t("Retour")}><IBack width={18} height={18} /></button>
            <span className="v3-grow ac-top-t v3-lbl">{t("Mon compte")}</span>
            <span className="v3-tool ghost" aria-hidden="true" />
          </div>
        </div>
        <AccountSections variant="v3" status={status} />
      </div>
    </div>
  );
}
