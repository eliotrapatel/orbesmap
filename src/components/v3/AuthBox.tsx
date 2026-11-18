import { useEffect, useRef, useState, type ReactNode } from "react";
import { resendSignupEmail, sendPasswordReset, signInWithPassword, signUpWithPassword } from "../../lib/store";
import { track } from "../../lib/track";
import { t } from "../../lib/i18n";
import { legalHref } from "./Legal";
import "../../styles/auth.css";

export type AuthMode = "signup" | "signin";
type View = "form" | "forgot" | "forgot-sent";

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

/** A password field with its show / hide button */
export function PasswordField({ value, onChange, label, autoComplete, id, invalid }: { value: string; onChange: (v: string) => void; label: string; autoComplete: string; id: string; invalid?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <label className="v3-field col auth-field" htmlFor={id}>
      <span>{label}</span>
      <span className="auth-pw">
        <input id={id} name="password" type={shown ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={invalid || undefined} />
        <button type="button" className="auth-eye" onClick={() => setShown((s) => !s)} aria-label={shown ? t("Masquer le mot de passe") : t("Afficher le mot de passe")} aria-pressed={shown}>
          {shown ? <IEyeOff /> : <IEye />}
        </button>
      </span>
    </label>
  );
}

/** The strength of a new password, in four quiet bars and a word */
export function StrengthHint({ value }: { value: string }) {
  const s = strength(value);
  return (
    <div className={"auth-strength s" + s} aria-live="polite">
      <span className="auth-bars" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={s >= i ? "on" : ""} />)}</span>
      <small>{s === 0 ? t(STRENGTH[0], { n: MIN_PASSWORD }) : t(STRENGTH[s])}</small>
    </div>
  );
}

/**
 * The account form of the public page: "Créer un compte" (e-mail + password) and "Se connecter" (e-mail + password),
 * "Mot de passe oublié" (a link to choose a new one). No one-time link or code to sign in.
 */
export default function AuthBox({ mode, onMode, focusKey }: { mode: AuthMode; onMode: (m: AuthMode) => void; focusKey?: number }) {
  const [view, setView] = useState<View>("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<ReactNode>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const mail = email.trim();
  const validEmail = /^\S+@\S+\.\S+$/.test(mail);
  const canSubmit = validEmail && (mode === "signup" ? password.length >= MIN_PASSWORD : password.length > 0);

  // asked from the page ("Se connecter", "Créer un compte"): back to the form, the e-mail field ready
  useEffect(() => {
    if (!focusKey) return;
    setView("form");
    const id = window.setTimeout(() => emailRef.current?.focus({ preventScroll: true }), 520);
    return () => window.clearTimeout(id);
  }, [focusKey]);

  const switchMode = (m: AuthMode) => {
    if (m === mode && view === "form") return;
    setView("form");
    setErr(null);
    setUnconfirmed(false);
    if (m !== mode) setNote(null);
    onMode(m);
  };

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr(authMessage(e));
      const code = String((e as { code?: string })?.code || "");
      const msg = String((e as Error)?.message || "");
      setUnconfirmed(code === "email_not_confirmed" || /Email not confirmed/i.test(msg));
      // an account already has this address: the sign-in is the way, ready with the same e-mail
      if (code === "user_already_exists" || code === "email_exists" || /already registered|already exists/i.test(msg)) {
        setNote(null);
        onMode("signin");
      }
    }
    setBusy(false);
  };

  const submit = () => {
    if (!canSubmit || busy) return;
    if (mode === "signin") {
      void run(async () => {
        await signInWithPassword(mail, password);
        // the session arrives through onAuthStateChange (recorded there as "sign_in"): the app opens
      });
      return;
    }
    track("signup_email");
    void run(async () => {
      const r = await signUpWithPassword(mail, password);
      if (r === "exists") {
        setNote(null);
        onMode("signin");
        setErr(t("Un compte existe déjà avec cette adresse : connectez-vous."));
        return;
      }
      track("signup_done");
      if (r === "confirm") {
        onMode("signin");
        setNote(
          <>
            <b>{t("Confirmez votre adresse : nous vous avons envoyé un e-mail.")}</b> {t("Ouvrez le lien qu'il contient, puis connectez-vous ici.")}
          </>,
        );
      }
    });
  };

  const resend = () =>
    void run(async () => {
      await resendSignupEmail(mail);
      setUnconfirmed(false);
      setNote(<b>{t("C'est renvoyé. Regardez aussi dans les courriers indésirables.")}</b>);
    });

  const forgot = () =>
    void run(async () => {
      await sendPasswordReset(mail);
      setView("forgot-sent");
    });

  return (
    <div className="v3-glass auth-box">
      <div className="auth-tabs" role="tablist" aria-label={t("Compte")}>
        <span className="auth-ink" aria-hidden="true" data-on={mode} />
        <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "on" : ""} onClick={() => switchMode("signup")}>{t("Créer un compte")}</button>
        <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "on" : ""} onClick={() => switchMode("signin")}>{t("Se connecter")}</button>
      </div>

      {view === "forgot-sent" ? (
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
          onSubmit={(e) => {
            e.preventDefault();
            if (validEmail && !busy) forgot();
          }}
        >
          <p className="auth-title">{t("Mot de passe oublié")}</p>
          <p className="auth-sub">{t("Indiquez votre adresse : nous vous envoyons un lien pour choisir un nouveau mot de passe.")}</p>
          <EmailField value={email} onChange={setEmail} inputRef={emailRef} />
          <button className="v3-btn" disabled={busy || !validEmail}>{busy ? t("Un instant…") : t("Recevoir le lien")}</button>
          <button type="button" className="v3-link" onClick={() => switchMode("signin")}>{t("Retour à la connexion")}</button>
        </form>
      ) : (
        <form
          className="auth-swap"
          key={mode}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {note && <p className="auth-note" role="status">{note}</p>}
          <EmailField value={email} onChange={setEmail} inputRef={emailRef} />
          <PasswordField id={"auth-pw-" + mode} value={password} onChange={setPassword} label={mode === "signup" ? t("Choisissez un mot de passe") : t("Mot de passe")} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
          {mode === "signup" ? (
            <StrengthHint value={password} />
          ) : (
            <div className="auth-row">
              <button type="button" className="auth-forgot" onClick={() => { setView("forgot"); setErr(null); setNote(null); }}>{t("Mot de passe oublié ?")}</button>
            </div>
          )}
          <button className="v3-btn auth-go" disabled={busy || !canSubmit}>
            {busy ? <span className="auth-wait">{t("Un instant…")}</span> : mode === "signup" ? t("Créer mon compte") : t("Se connecter")}
          </button>
          {mode === "signin" && <p className="auth-sub auth-first">{t("Première connexion avec mot de passe ? Touchez « Mot de passe oublié » pour en choisir un.")}</p>}
        </form>
      )}

      {err && (
        <p className="v3-err auth-err" role="alert">
          {err}
          {unconfirmed && validEmail && (
            <>
              {" "}
              <button type="button" className="auth-inline" onClick={resend} disabled={busy}>{t("Renvoyer l'e-mail")}</button>
            </>
          )}
        </p>
      )}
      {view === "form" && (
        <p className="v3-fine auth-fine">
          {mode === "signup" ? t("Gratuit · sans carte bancaire · en créant un compte, vous acceptez les") : t("En vous connectant, vous acceptez les")} <a href={legalHref("cgu")}>{t("conditions")}</a> {t("et la")} <a href={legalHref("confidentialite")}>{t("politique de confidentialité")}</a>
        </p>
      )}
    </div>
  );
}

function EmailField({ value, onChange, inputRef }: { value: string; onChange: (v: string) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  return (
    <label className="v3-field col auth-field" htmlFor="v3-email">
      <span>{t("Adresse e-mail")}</span>
      <input ref={inputRef} id="v3-email" name="email" type="email" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="username email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
    </label>
  );
}

const ic = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
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
