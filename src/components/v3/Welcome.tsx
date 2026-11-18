import { useState } from "react";
import { sendLoginEmail, signInWithGoogle, signInWithPassword, verifyLoginCode } from "../../lib/store";
import OrbitMark from "../OrbitMark";
import Shell from "./Shell";

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

  const run = async (f: () => Promise<void>, fail: string) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
    } catch (e) {
      const m = String((e as Error)?.message || "");
      setErr(/provider is not enabled|Unsupported provider/i.test(m) ? "La connexion avec Google n'est pas encore activée. Utilisez votre e-mail." : /rate limit|too many/i.test(m) ? "Trop de demandes : réessayez dans quelques minutes." : /Invalid login/i.test(m) ? "E-mail ou mot de passe incorrect." : fail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell top={<span className="v3-brand"><OrbitWord /></span>}>
      <p className="v3-lbl" style={{ marginTop: 28 }}>Carnet de voyage · préparé par IA</p>
      <h1 className="v3-d v3-h1">Vos voyages, préparés au détail près.</h1>
      <p className="v3-lead">Dites où vous allez et ce que vous savez déjà. ORBES Trips construit votre programme jour par jour et vérifie chaque lieu.</p>
      <div className="v3-spacer" />
      <ul className="v3-vp">
        <li><span>01</span>Un programme heure par heure, à votre rythme</li>
        <li><span>02</span>Des lieux vérifiés : horaires, adresses, fermetures</li>
        <li><span>03</span>Vols, hôtel et rendez-vous pris en compte</li>
      </ul>

      <div className="v3-glass v3-auth">
        {mode === "sent" ? (
          <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) void run(() => verifyLoginCode(email.trim(), code.trim()), "Code incorrect ou expiré."); }}>
            <p className="v3-msg">Un lien de connexion vient d'être envoyé à <b>{email.trim()}</b>. Ouvrez-le sur ce téléphone.</p>
            <label className="v3-field">
              <span className="sr">Code reçu par e-mail</span>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="Ou saisissez le code reçu" />
            </label>
            <button className="v3-btn" disabled={busy || !code.trim()}>{busy ? "Vérification…" : "Valider le code"}</button>
            <button type="button" className="v3-link" onClick={() => { setMode("email"); setCode(""); }}>Changer d'adresse</button>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!valid) return;
              if (mode === "password") void run(() => signInWithPassword(email.trim(), password), "Connexion impossible. Réessayez.");
              else void run(async () => { await sendLoginEmail(email.trim()); setMode("sent"); }, "L'e-mail n'a pas pu partir. Réessayez dans un instant.");
            }}
          >
            <label className="v3-field">
              <span className="sr">Adresse e-mail</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" placeholder="Votre adresse e-mail" />
            </label>
            {mode === "password" && (
              <label className="v3-field">
                <span className="sr">Mot de passe</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" placeholder="Mot de passe" />
              </label>
            )}
            <button className="v3-btn" disabled={busy || !valid || (mode === "password" && !password)}>
              {busy ? "Un instant…" : mode === "password" ? "Se connecter" : "Recevoir le lien de connexion"}
            </button>
            {GOOGLE && (
              <button type="button" className="v3-btn ghost" disabled={busy} onClick={() => void run(signInWithGoogle, "La connexion avec Google n'a pas pu démarrer.")}>
                <GoogleG /> Continuer avec Google
              </button>
            )}
            <button type="button" className="v3-link" onClick={() => setMode(mode === "password" ? "email" : "password")}>
              {mode === "password" ? "Recevoir un lien à la place" : "J'ai un mot de passe"}
            </button>
          </form>
        )}
        {err && <p className="v3-err" role="alert">{err}</p>}
        <p className="v3-fine">Sans mot de passe · gratuit</p>
      </div>
    </Shell>
  );
}

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
