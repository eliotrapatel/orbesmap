import { useEffect, useRef, useState, type ReactNode } from "react";
import { resendSignupEmail, sendPasswordReset, signInWithPassword, signUpWithPassword } from "../../lib/store";
import { track } from "../../lib/track";
import { getLang, t } from "../../lib/i18n";
import { intentLabel, type Intent } from "../../lib/intentData";
import { mailersFor, resendLeft } from "../../lib/confirmData";
import { legalHref } from "./Legal";
import "../../styles/auth.css";

export type AuthMode = "signup" | "signin";
type View = "form" | "forgot" | "forgot-sent" | "check";

// the « Vérifiez vos e-mails » screen survives a reload of the tab (iOS drops a page left for the mail app): the address
// and when the e-mail left, for this tab only, never the password
const SIGNUP_KEY = "orbes.signup";
type Pending = { email: string; at: number };
/** A sign-up waiting for its confirmation in this tab (the last 2 hours) */
export function pendingSignup(): Pending | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(SIGNUP_KEY) || "null") as Pending | null;
    return p && typeof p.email === "string" && /^\S+@\S+\.\S+$/.test(p.email) && Number(p.at) > Date.now() - 2 * 3600e3 ? p : null;
  } catch {
    return null;
  }
}
const keepPending = (p: Pending | null) => {
  try {
    if (p) sessionStorage.setItem(SIGNUP_KEY, JSON.stringify(p));
    else sessionStorage.removeItem(SIGNUP_KEY);
  } catch {
    /* ignore */
  }
};
const apple = () => typeof navigator !== "undefined" && (/iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1));

export const MIN_PASSWORD = 8;

/** The French sentence for an error of Supabase Auth (sign-up, sign-in, reset, new password) */
export function authMessage(e: unknown): string {
  const err = (e || {}) as { message?: string; code?: string; name?: string; status?: number };
  const m = String(err.message || "");
  const code = String(err.code || "");
  if (typeof navigator !== "undefined" && navigator.onLine === false) return t("Pas de connexion : vérifiez le réseau et réessayez.");
  if (err.name === "AuthRetryableFetchError" || /Failed to fetch|NetworkError|Load failed|network/i.test(m)) return t("Pas de connexion : vérifiez le réseau et réessayez.");
  if (code === "invalid_credentials" || /Invalid login credentials/i.test(m)) return t("E-mail ou mot de passe incorrect.");
  if (code === "email_not_confirmed" || /Email not confirmed/i.test(m)) return t("Confirmez d'abord votre adresse : ouvrez l'e-mail que nous vous avons envoyé.");
  if (code === "user_already_exists" || code === "email_exists" || /already registered|already exists/i.test(m)) return t("Un compte existe déjà avec cette adresse : connectez-vous.");
  if (code === "same_password" || /different from the old/i.test(m)) return t("Choisissez un mot de passe différent de l'ancien.");
  if (code === "weak_password" || /password should|weak password|at least \d+ characters/i.test(m)) return t("Ce mot de passe est trop simple. Choisissez-en un plus long, avec des chiffres ou des signes.");
  if (/rate limit|too many|over_.*rate_limit/i.test(m + " " + code) || err.status === 429) return t("Trop de demandes : réessayez dans quelques minutes.");
  if (code === "signup_disabled" || /signups? not allowed|signup.*disabled/i.test(m)) return t("La création de compte est momentanément fermée. Réessayez plus tard.");
  if (code === "email_address_invalid" || /invalid.*email|email.*invalid/i.test(m)) return t("Cette adresse e-mail n'est pas valide.");
  if (code === "session_not_found" || code === "session_expired" || /session missing|session not found|expired/i.test(m)) return t("Ce lien n'est plus valide. Demandez-en un nouveau depuis « Mot de passe oublié ».");
  return t("Une erreur est survenue. Réessayez.");
}

/** How strong a new password looks: 0 too short, 1 fair, 2 good, 3 strong */
export function strength(p: string): 0 | 1 | 2 | 3 {
  if (p.length < MIN_PASSWORD) return 0;
  if (/^(.)\1+$/.test(p) || /^(?:12345678|123456789|password|motdepasse|azertyui|qwertyui|00000000)/i.test(p)) return 1;
  let s = 1;
  if (p.length >= 12) s++;
  if ((/[a-z]/.test(p) && /[A-Z]/.test(p)) || (/\d/.test(p) && /[a-z]/i.test(p))) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(3, s) as 1 | 2 | 3;
}
const STRENGTH = ["{n} caractères minimum", "Correct", "Bon", "Solide"];

/** A password field with its show / hide button (the field's name is its label only, never the button's) */
export function PasswordField({ value, onChange, label, autoComplete, id, invalid, describedBy, inputRef, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoComplete: string; id: string; invalid?: boolean; describedBy?: string; inputRef?: React.RefObject<HTMLInputElement | null>; autoFocus?: boolean }) {
  const [shown, setShown] = useState(false);
  const own = useRef<HTMLInputElement>(null);
  const ref = inputRef || own;
  return (
    <div
      className={"v3-field col auth-field" + (invalid ? " bad" : "")}
      onMouseDown={(e) => {
        // a press anywhere in the field (outside the input and the eye) puts the cursor in it
        const el = e.target as HTMLElement;
        if (el.closest("input, button")) return;
        e.preventDefault();
        ref.current?.focus();
      }}
    >
      <label htmlFor={id}><span>{label}</span></label>
      <span className="auth-pw">
        <input ref={ref} id={id} name="password" type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={invalid || undefined} aria-describedby={describedBy} autoFocus={autoFocus} />
        <button type="button" className="auth-eye" onClick={() => setShown((s) => !s)} aria-label={shown ? t("Masquer le mot de passe") : t("Afficher le mot de passe")} aria-pressed={shown} aria-controls={id}>
          {shown ? <IEyeOff /> : <IEye />}
        </button>
      </span>
    </div>
  );
}

/** The strength of a new password, in three quiet bars and a word */
export function StrengthHint({ value }: { value: string }) {
  const s = strength(value);
  return (
    <div className={"auth-strength s" + s} aria-live="polite">
      <span className="auth-bars" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={s >= i ? "on" : ""} />)}</span>
      <small>{s === 0 ? t(STRENGTH[0], { n: MIN_PASSWORD }) : t(STRENGTH[s])}</small>
    </div>
  );
}

type Field = "email" | "password";

/**
 * The account form of the public page: "Créer un compte" (e-mail + password) and "Se connecter" (e-mail + password),
 * "Mot de passe oublié" (a link to choose a new one). No one-time link or code to sign in.
 */
export default function AuthBox({ mode, onMode, focusKey, intent, context, redirectQuery }: {
  mode: AuthMode;
  onMode: (m: AuthMode) => void;
  focusKey?: number;
  /** what the visitor asked for before having an account (a city and dates, a trip to copy): goes with the account */
  intent?: Intent | null;
  /** the line above the sign-up form (« Créez votre compte pour préparer Shanghai · 12–18 mars ») */
  context?: string | null;
  /** what the confirmation link brings back (« ?copyof=<slug> ») */
  redirectQuery?: string;
}) {
  // a sign-up already waiting in this tab (the page was reloaded): its « Vérifiez vos e-mails » screen again
  const [restored] = useState(() => (mode === "signup" ? pendingSignup() : null));
  const [view, setView] = useState<View>(restored ? "check" : "form");
  // the address the confirmation went to, and when (the 60 s before « Renvoyer » counts from there)
  const [sentTo, setSentTo] = useState(restored?.email || "");
  const [sentAt, setSentAt] = useState(restored?.at || 0);
  const [now, setNow] = useState(() => Date.now());
  const autoTried = useRef(false);
  const [email, setEmail] = useState(restored?.email || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // what went wrong: a wrong password offers "Choisir un mot de passe" (accounts created with a link have none yet)
  const [errKind, setErrKind] = useState<"" | "credentials" | "unconfirmed">("");
  const [fieldErr, setFieldErr] = useState<{ field: Field; msg: string } | null>(null);
  const [note, setNote] = useState<ReactNode>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const mail = email.trim();
  const validEmail = /^\S+@\S+\.\S+$/.test(mail);

  // asked from the page ("Se connecter", "Créer un compte"): back to the form, the e-mail field ready
  useEffect(() => {
    if (!focusKey) return;
    setView("form");
    const id = window.setTimeout(() => emailRef.current?.focus({ preventScroll: true }), 520);
    return () => window.clearTimeout(id);
  }, [focusKey]);

  const clearErr = () => {
    setErr(null);
    setErrKind("");
    setFieldErr(null);
  };
  const onEmail = (v: string) => {
    setEmail(v);
    if (err || fieldErr) clearErr();
  };
  const onPassword = (v: string) => {
    setPassword(v);
    if (err || fieldErr) clearErr();
  };

  const switchMode = (m: AuthMode) => {
    if (m === mode && view === "form") return;
    if (view === "check") keepPending(null);
    setView("form");
    clearErr();
    if (m !== mode) setNote(null);
    onMode(m);
  };

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    clearErr();
    try {
      await f();
    } catch (e) {
      setErr(authMessage(e));
      const code = String((e as { code?: string })?.code || "");
      const msg = String((e as Error)?.message || "");
      if (code === "email_not_confirmed" || /Email not confirmed/i.test(msg)) setErrKind("unconfirmed");
      else if (code === "invalid_credentials" || /Invalid login credentials/i.test(msg)) setErrKind("credentials");
      // an account already has this address: the sign-in is the way, ready with the same e-mail
      if (code === "user_already_exists" || code === "email_exists" || /already registered|already exists/i.test(msg)) {
        setNote(null);
        onMode("signin");
      }
    }
    setBusy(false);
  };

  /** Says which field is not right, beside it, and puts the cursor there */
  const invalidField = (field: Field, msg: string) => {
    setErr(null);
    setErrKind("");
    setFieldErr({ field, msg });
    (field === "email" ? emailRef : pwRef).current?.focus();
  };

  const submit = () => {
    if (busy) return;
    if (!mail) return invalidField("email", t("Indiquez votre adresse e-mail."));
    if (!validEmail) return invalidField("email", t("Cette adresse e-mail n'est pas valide."));
    if (mode === "signup" && password.length < MIN_PASSWORD) return invalidField("password", t("Le mot de passe doit faire {n} caractères minimum.", { n: MIN_PASSWORD }));
    if (mode === "signin" && !password) return invalidField("password", t("Indiquez votre mot de passe."));
    if (mode === "signin") {
      void run(async () => {
        await signInWithPassword(mail, password);
        // the session arrives through onAuthStateChange (recorded there as "sign_in"): the app opens
      });
      return;
    }
    track("signup_email");
    void run(async () => {
      const r = await signUpWithPassword(mail, password, intent ? { intent } : undefined, redirectQuery);
      if (r === "exists") {
        setNote(null);
        onMode("signin");
        setErr(t("Un compte existe déjà avec cette adresse : connectez-vous."));
        return;
      }
      track("signup_done");
      if (r === "confirm") {
        // « Vérifiez vos e-mails »: the address in large, the mailbox, « J'ai confirmé · continuer », « Renvoyer »
        const at = Date.now();
        setSentTo(mail);
        setSentAt(at);
        setNow(at);
        setNote(null);
        autoTried.current = false;
        keepPending({ email: mail, at });
        setView("check");
        track("check_email_shown", "signup");
      }
    });
  };

  // the « Renvoyer dans 42 s » count, while the screen shows
  useEffect(() => {
    if (view !== "check") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [view]);
  const wait = resendLeft(sentAt, now);

  /** « J'ai confirmé · continuer »: signs in with the password still typed; auto = once, silently, back on the tab */
  const confirmNow = async (auto = false) => {
    if (busy) return;
    if (!password) {
      // the tab was reloaded (no password kept): the sign-in, the address ready
      keepPending(null);
      setView("form");
      clearErr();
      onMode("signin");
      window.setTimeout(() => pwRef.current?.focus(), 60);
      return;
    }
    if (!auto) {
      setBusy(true);
      clearErr();
    }
    try {
      await signInWithPassword(sentTo, password);
      keepPending(null);
      track("confirm_screen", auto ? "auto_ok" : "continue_ok");
      // the session arrives through onAuthStateChange: the app opens
    } catch (e) {
      const code = String((e as { code?: string })?.code || "");
      const msg = String((e as Error)?.message || "");
      const waiting = code === "email_not_confirmed" || /Email not confirmed/i.test(msg);
      if (waiting) track("confirm_screen", auto ? "auto_wait" : "continue_wait");
      if (!auto) setErr(waiting ? t("Pas encore confirmé : touchez le lien dans l'e-mail, puis revenez ici.") : authMessage(e));
    }
    if (!auto) setBusy(false);
  };
  // back on the tab after opening the e-mail: one silent try (never a loop: Supabase limits sign-in attempts)
  useEffect(() => {
    if (view !== "check" || !password) return;
    const onBack = () => {
      if (document.visibilityState !== "visible" || autoTried.current) return;
      autoTried.current = true;
      void confirmNow(true);
    };
    document.addEventListener("visibilitychange", onBack);
    return () => document.removeEventListener("visibilitychange", onBack);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const resendCheck = () => {
    if (wait > 0) return;
    void run(async () => {
      await resendSignupEmail(sentTo, redirectQuery);
      const at = Date.now();
      setSentAt(at);
      setNow(at);
      keepPending({ email: sentTo, at });
      track("confirm_resent", "button");
      setNote(<b>{t("C'est renvoyé. Regardez aussi dans les courriers indésirables.")}</b>);
    });
  };
  /** « Ce n'est pas la bonne adresse »: back to the sign-up form, the cursor in the e-mail */
  const wrongAddress = () => {
    track("confirm_screen", "wrong_address");
    keepPending(null);
    setNote(null);
    clearErr();
    setView("form");
    if (mode !== "signup") onMode("signup");
    window.setTimeout(() => {
      emailRef.current?.focus();
      emailRef.current?.select();
    }, 60);
  };

  const resend = () =>
    void run(async () => {
      await resendSignupEmail(mail, redirectQuery);
      setNote(<b>{t("C'est renvoyé. Regardez aussi dans les courriers indésirables.")}</b>);
    });

  const forgot = () =>
    void run(async () => {
      await sendPasswordReset(mail);
      setView("forgot-sent");
    });
  const toForgot = () => {
    setView("forgot");
    clearErr();
    setNote(null);
  };

  const errLine = err && (
    <p className="v3-err auth-err" role="alert">
      {err}
      {errKind === "unconfirmed" && validEmail && (
        <>
          {" "}
          <button type="button" className="auth-inline" onClick={resend} disabled={busy}>{t("Renvoyer l'e-mail")}</button>
        </>
      )}
      {errKind === "credentials" && mode === "signin" && (
        <>
          {" "}
          <button type="button" className="auth-inline" onClick={toForgot}>{t("Choisir un mot de passe")}</button>
        </>
      )}
    </p>
  );
  const emailErr = fieldErr?.field === "email" ? fieldErr.msg : null;
  const pwErr = fieldErr?.field === "password" ? fieldErr.msg : null;

  return (
    <div className="v3-glass auth-box">
      {/* two modes: a segmented control (two pressed / not pressed buttons) */}
      <div className="auth-tabs" role="group" aria-label={t("Compte")}>
        <span className="auth-ink" aria-hidden="true" data-on={mode} />
        <button type="button" aria-pressed={mode === "signup" && (view === "form" || view === "check")} className={mode === "signup" ? "on" : ""} onClick={() => switchMode("signup")}>{t("Créer un compte")}</button>
        <button type="button" aria-pressed={mode === "signin" || (view !== "form" && view !== "check")} className={mode === "signin" ? "on" : ""} onClick={() => switchMode("signin")}>{t("Se connecter")}</button>
      </div>

      {view === "check" ? (
        <div className="auth-swap auth-check" key="check">
          <span className="auth-badge" aria-hidden="true"><IMail /></span>
          <p className="auth-title" role="status">{t("Vérifiez vos e-mails")}</p>
          <p className="v3-msg auth-check-to">{t("Nous avons envoyé un lien de confirmation à")}</p>
          <p className="auth-check-mail">{sentTo}</p>
          <p className="auth-sub">{t("Ouvrez-le pour activer votre compte. Il peut arriver dans les courriers indésirables.")}</p>
          {intent && intentText(intent) && <p className="auth-note">{t("Votre voyage {trip} vous attend après la confirmation.", { trip: intentText(intent) })}</p>}
          <div className="auth-check-mailers">
            {mailersFor(sentTo, apple()).map((m) => (
              <a key={m.id} className="v3-btn ghost" href={m.href} target={m.id === "mail" ? undefined : "_blank"} rel="noopener" onClick={() => track("confirm_screen", `mail_${m.id}`)}>{t(m.label)}</a>
            ))}
          </div>
          {err && <p className="v3-err auth-err" role="alert">{err}</p>}
          <button type="button" className="v3-btn auth-go" disabled={busy} aria-busy={busy || undefined} onClick={() => void confirmNow()}>
            {busy ? <span className="auth-wait">{t("Un instant…")}</span> : password ? t("J'ai confirmé · continuer") : t("J'ai confirmé · me connecter")}
          </button>
          {note && <p className="auth-note" role="status">{note}</p>}
          <div className="auth-check-row">
            <button type="button" className="auth-inline" onClick={resendCheck} disabled={busy || wait > 0}>{wait > 0 ? t("Renvoyer dans {n} s", { n: wait }) : t("Renvoyer l'e-mail")}</button>
            <button type="button" className="auth-inline" onClick={wrongAddress}>{t("Ce n'est pas la bonne adresse")}</button>
          </div>
        </div>
      ) : view === "forgot-sent" ? (
        <div className="auth-swap" key="sent">
          <span className="auth-badge" aria-hidden="true"><ICheckLine /></span>
          <p className="auth-title">{t("Regardez vos e-mails")}</p>
          <p className="v3-msg">{t("Si un compte existe pour")} <b>{mail}</b>{t(", un e-mail vient de partir avec un lien pour choisir un nouveau mot de passe.")}</p>
          <p className="auth-sub">{t("Ouvrez-le sur cet appareil. Pensez aussi aux courriers indésirables.")}</p>
          <button type="button" className="v3-btn ghost" onClick={() => switchMode("signin")}>{t("Retour à la connexion")}</button>
        </div>
      ) : view === "forgot" ? (
        <form
          className="auth-swap"
          key="forgot"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            if (!mail) return invalidField("email", t("Indiquez votre adresse e-mail."));
            if (!validEmail) return invalidField("email", t("Cette adresse e-mail n'est pas valide."));
            forgot();
          }}
        >
          <p className="auth-title">{t("Mot de passe oublié")}</p>
          <p className="auth-sub">{t("Indiquez votre adresse : nous vous envoyons un lien pour choisir un nouveau mot de passe.")}</p>
          <EmailField value={email} onChange={onEmail} inputRef={emailRef} error={emailErr} autoFocus={!validEmail} />
          {errLine}
          <button className="v3-btn" disabled={busy}>{busy ? t("Un instant…") : t("Recevoir le lien")}</button>
          <button type="button" className="v3-link auth-back" onClick={() => switchMode("signin")}>{t("Retour à la connexion")}</button>
        </form>
      ) : (
        <form
          className="auth-swap"
          key={mode}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {mode === "signup" && context && !note && <p className="auth-note auth-context">{context}</p>}
          {note && <p className="auth-note" role="status">{note}</p>}
          <EmailField value={email} onChange={onEmail} inputRef={emailRef} error={emailErr} />
          <PasswordField id={"auth-pw-" + mode} inputRef={pwRef} value={password} onChange={onPassword} label={mode === "signup" ? t("Choisissez un mot de passe") : t("Mot de passe")} autoComplete={mode === "signup" ? "new-password" : "current-password"} invalid={!!pwErr} describedBy={pwErr ? "auth-pw-err" : undefined} />
          {pwErr && <p className="auth-ferr" id="auth-pw-err">{pwErr}</p>}
          {mode === "signup" ? (
            <StrengthHint value={password} />
          ) : (
            <div className="auth-row">
              <button type="button" className="auth-forgot" onClick={toForgot}>{t("Mot de passe oublié ?")}</button>
            </div>
          )}
          {errLine}
          <button className="v3-btn auth-go" disabled={busy} aria-busy={busy || undefined}>
            {busy ? <span className="auth-wait">{t("Un instant…")}</span> : mode === "signup" ? t("Créer mon compte") : t("Se connecter")}
          </button>
          {mode === "signin" && <p className="auth-sub auth-first">{t("Première connexion avec mot de passe ? Touchez « Mot de passe oublié » pour en choisir un.")}</p>}
        </form>
      )}

      {view === "form" && (
        <p className="v3-fine auth-fine">
          {mode === "signup" ? t("Gratuit · sans carte bancaire · en créant un compte, vous acceptez les") : t("En vous connectant, vous acceptez les")} <a href={legalHref("cgu")}>{t("conditions")}</a> {t("et la")} <a href={legalHref("confidentialite")}>{t("politique de confidentialité")}</a>
        </p>
      )}
    </div>
  );
}

function EmailField({ value, onChange, inputRef, error, autoFocus }: { value: string; onChange: (v: string) => void; inputRef: React.RefObject<HTMLInputElement | null>; error?: string | null; autoFocus?: boolean }) {
  return (
    <>
      <label className={"v3-field col auth-field" + (error ? " bad" : "")} htmlFor="v3-email">
        <span>{t("Adresse e-mail")}</span>
        <input ref={inputRef} id="v3-email" name="email" type="email" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="username email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={error ? true : undefined} aria-describedby={error ? "auth-email-err" : undefined} autoFocus={autoFocus} />
      </label>
      {error && <p className="auth-ferr" id="auth-email-err">{error}</p>}
    </>
  );
}

/** « Shanghai · 12–18 mars » (a city; a copy's line is the page's own) */
const intentText = (i: Intent) => (i.kind === "dest" ? intentLabel(i, getLang()) : "");

const ic = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
function IMail() {
  return (
    <svg {...ic}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  );
}
function IEye() {
  return (
    <svg {...ic}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function IEyeOff() {
  return (
    <svg {...ic}>
      <path d="M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.9 0 3.5-.6 4.9-1.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
    </svg>
  );
}
export function ICheckLine() {
  return (
    <svg {...ic}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}
