import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabase";
import { getState, updatePassword, useStore } from "../../lib/store";
import { t, useLang } from "../../lib/i18n";
import OrbitMark from "../OrbitMark";
import { authMessage, ICheckLine, MIN_PASSWORD, PasswordField, StrengthHint } from "./AuthBox";
import "../../styles/auth.css";

// Read once, before the auth client takes the tokens out of the address: the page was opened from a reset link
// (…?reset=1#access_token=…&type=recovery), or from an expired / already used one (#error_code=…).
const AT_LOAD = (() => {
  try {
    const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    const search = new URLSearchParams(location.search);
    const reset = search.get("reset") === "1" || hash.get("type") === "recovery";
    const failed = reset && !!(hash.get("error_code") || hash.get("error") || search.get("error_code") || search.get("error"));
    return { reset, failed };
  } catch {
    return { reset: false, failed: false };
  }
})();

/** Takes ?reset=1 and the link's leftovers out of the address, the trip in the hash kept */
function cleanUrl(dropHash: boolean) {
  try {
    const u = new URL(location.href);
    u.searchParams.delete("reset");
    const h = dropHash || /(^#|&)(error|error_code|access_token|type)=/.test(u.hash) ? "" : u.hash;
    history.replaceState(history.state, "", u.pathname + (u.search && u.search !== "?" ? u.search : "") + h);
  } catch {
    /* ignore */
  }
}

/** While the full-screen dialog is shown, the app behind it is out of reach (Tab, screen readers) */
function useInertBehind(ref: React.RefObject<HTMLDivElement | null>, shown: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!shown || !el || !el.parentElement) return;
    const others = Array.from(el.parentElement.children).filter((c): c is HTMLElement => c !== el && c instanceof HTMLElement && !c.inert);
    others.forEach((c) => {
      c.inert = true;
    });
    return () => {
      others.forEach((c) => {
        c.inert = false;
      });
    };
  }, [ref, shown]);
}

/**
 * "Choisissez un nouveau mot de passe": over every screen when the page opens from a password reset link
 * (event PASSWORD_RECOVERY, or ?reset=1 with a session). Saves the password, then the app continues.
 */
export default function PasswordRecovery() {
  useLang();
  const session = useStore((s) => s.session);
  const authReady = useStore((s) => s.authReady);
  const [open, setOpen] = useState(AT_LOAD.reset && !AT_LOAD.failed);
  const [failed, setFailed] = useState(AT_LOAD.failed);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const shown = failed || (open && (!!session || done));
  useInertBehind(box, shown);

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setFailed(false);
        setOpen(true);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // ?reset=1 but no session once the auth is known (link opened twice, or in another browser): say so
  useEffect(() => {
    if (open && authReady && !session && !done) {
      // a session arriving meanwhile runs this effect again, which clears the wait
      const id = window.setTimeout(() => {
        if (getState().session) return;
        setOpen(false);
        setFailed(true);
      }, 2500);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open, authReady, session, done]);

  if (failed)
    return (
      <div ref={box} className="v3 auth-recovery" role="dialog" aria-modal="true" aria-labelledby="auth-rec-h">
        <div className="v3-bg" aria-hidden="true" />
        <div className="auth-rec-col">
          <OrbitMark size={22} title="ORBES Trips" />
          <div className="auth-rec-body auth-swap">
            <p className="v3-lbl">{t("Mot de passe")}</p>
            <h1 className="v3-d v3-h2" id="auth-rec-h">{t("Ce lien n'est plus valide.")}</h1>
            <p className="v3-lead">{t("Les liens de réinitialisation ne servent qu'une fois et expirent après un moment. Demandez-en un nouveau depuis « Mot de passe oublié ».")}</p>
            <button
              type="button"
              className="v3-btn"
              autoFocus
              onClick={() => {
                cleanUrl(true);
                setFailed(false);
              }}
            >
              {t("Continuer")}
            </button>
          </div>
        </div>
      </div>
    );

  if (!open || (!session && !done)) return null;

  const ok = password.length >= MIN_PASSWORD;
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (e) {
      setErr(authMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const finish = () => {
    cleanUrl(false);
    setOpen(false);
    setDone(false);
    setPassword("");
  };

  return (
    <div ref={box} className="v3 auth-recovery" role="dialog" aria-modal="true" aria-labelledby="auth-rec-h">
      <div className="v3-bg" aria-hidden="true" />
      <div className="auth-rec-col">
        <OrbitMark size={22} title="ORBES Trips" />
        {done ? (
          <div className="auth-rec-body auth-swap" key="done">
            <span className="auth-badge" aria-hidden="true"><ICheckLine /></span>
            <h1 className="v3-d v3-h2" id="auth-rec-h">{t("Mot de passe enregistré.")}</h1>
            <p className="v3-lead">{t("Utilisez-le désormais pour vous connecter, sur ce téléphone comme sur un ordinateur.")}</p>
            <button type="button" className="v3-btn" onClick={finish} autoFocus>{t("Continuer")}</button>
          </div>
        ) : (
          <form
            className="auth-rec-body auth-swap"
            key="form"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <p className={"v3-lbl" + (session?.user.email ? " auth-rec-mail" : "")}>{session?.user.email || t("Mot de passe")}</p>
            <h1 className="v3-d v3-h2" id="auth-rec-h">{t("Choisissez un nouveau mot de passe")}</h1>
            <p className="v3-lead">{t("Il remplace l'ancien sur tous vos appareils.")}</p>
            {/* the account's e-mail, for the password manager */}
            <input type="email" name="email" autoComplete="username" value={session?.user.email || ""} readOnly hidden />
            <PasswordField id="auth-rec-pw" value={password} onChange={setPassword} label={t("Nouveau mot de passe")} autoComplete="new-password" autoFocus />
            <StrengthHint value={password} />
            <button className="v3-btn" disabled={!ok || busy}>{busy ? t("Un instant…") : t("Enregistrer le mot de passe")}</button>
            {err && <p className="v3-err" role="alert">{err}</p>}
            <button type="button" className="v3-link" onClick={finish}>{t("Plus tard")}</button>
          </form>
        )}
      </div>
    </div>
  );
}
