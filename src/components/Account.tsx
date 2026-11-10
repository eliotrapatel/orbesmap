import { useState } from "react";
import { sendLoginEmail, signInWithPassword, signOut, useStore, verifyLoginCode, type SyncState } from "../lib/store";
import { supabaseConfigured } from "../lib/supabase";
import AiCredit from "./AiCredit";

const SYNC_TEXT: Record<SyncState, string> = {
  local: "Enregistré sur cet appareil",
  idle: "Tout est synchronisé",
  syncing: "Synchronisation…",
  pending: "Hors connexion : envoi dès le retour du réseau",
  error: "Envoi en attente, nouvel essai automatique",
  denied: "Ce compte n'a pas accès à l'espace partagé",
};

export function useSyncState(): SyncState {
  const sync = useStore((s) => s.sync);
  const session = useStore((s) => s.session);
  return session ? sync : "local";
}

export function SyncBadge() {
  const state = useSyncState();
  const pending = useStore((s) => s.pending);
  return (
    <span className={"sync " + state}>
      <i /> {SYNC_TEXT[state]}
      {pending > 0 && state !== "idle" ? ` · ${pending} en attente` : ""}
    </span>
  );
}

export default function Account() {
  const session = useStore((s) => s.session);
  const member = useStore((s) => s.member);
  const pending = useStore((s) => s.pending);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [step, setStep] = useState<"password" | "email" | "code">("password");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!supabaseConfigured) {
    return (
      <div>
        <div className="card">
          <h4>Sauvegarde</h4>
          <p style={{ marginTop: 6 }}>Vos notes, statuts, contacts et photos sont enregistrés sur cet appareil, même hors connexion.</p>
          <p style={{ marginTop: 10 }}>La sauvegarde en ligne et le partage avec votre père s'activeront dès que le projet Supabase sera relié à l'app.</p>
          <div style={{ marginTop: 14 }}><SyncBadge /></div>
        </div>
      </div>
    );
  }

  if (session) {
    return (
      <div>
        <div className="card">
          <h4>{member === false ? "Accès non autorisé" : "Espace partagé"}</h4>
          <p style={{ marginTop: 6 }}>Connecté avec {session.user.email}</p>
          <div style={{ marginTop: 14 }}><SyncBadge /></div>
          {member === false ? (
            <p style={{ marginTop: 14 }}>Cette adresse ne figure pas dans la liste des membres. Ajoutez-la dans Supabase (table « members »), puis reconnectez-vous.</p>
          ) : (
            <p style={{ marginTop: 14 }}>Vos données sont sauvegardées en ligne et partagées en direct avec les autres membres. Elles restent aussi sur cet appareil pour fonctionner sans réseau.</p>
          )}
          {member !== false && <AiCredit />}
          <button
            className="btn danger block"
            style={{ marginTop: 16 }}
            onClick={() => {
              if (pending > 0 && !confirm(`${pending} modification(s) ne sont pas encore envoyées. Elles resteront sur cet appareil et partiront à la prochaine connexion. Se déconnecter ?`)) return;
              void signOut();
            }}
          >
            Se déconnecter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card">
        <h4>Sauvegarder et partager</h4>
        <p style={{ marginTop: 6 }}>Connectez-vous pour retrouver vos notes, contacts et photos sur tous vos appareils et les partager avec votre père. Sans connexion, tout reste sur cet appareil.</p>
        <div style={{ marginTop: 12 }}><SyncBadge /></div>
        {step === "password" ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr(null);
              try {
                await signInWithPassword(email.trim(), password);
              } catch (x) {
                const m = x instanceof Error ? x.message : "";
                setErr(/invalid login credentials/i.test(m) ? "E-mail ou mot de passe incorrect." : /fetch|network/i.test(m) ? "Pas de connexion au serveur. Vérifiez le réseau (en Chine : eSIM, itinérance ou VPN)." : m || "La connexion a échoué. Réessayez.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>E-mail</span>
              <input className="input" type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.com" />
            </label>
            <label className="field">
              <span>Mot de passe</span>
              <input className="input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <button className="btn primary block" style={{ marginTop: 12 }} disabled={busy || !email.includes("@") || !password}>
              {busy ? "Connexion…" : "Se connecter"}
            </button>
            <button type="button" className="btn block" style={{ marginTop: 8 }} onClick={() => { setErr(null); setStep("email"); }}>
              Recevoir plutôt un lien par e-mail
            </button>
          </form>
        ) : step === "email" ? (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr(null);
              try {
                await sendLoginEmail(email.trim());
                setStep("code");
              } catch (x) {
                setErr(x instanceof Error ? x.message : "L'e-mail n'a pas pu être envoyé. Vérifiez l'adresse et réessayez.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="field">
              <span>E-mail</span>
              <input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.com" />
            </label>
            <button className="btn primary block" style={{ marginTop: 12 }} disabled={busy || !email.includes("@")}>
              {busy ? "Envoi…" : "Recevoir le lien de connexion"}
            </button>
            <button type="button" className="btn block" style={{ marginTop: 8 }} onClick={() => { setErr(null); setStep("password"); }}>
              Se connecter avec un mot de passe
            </button>
          </form>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setErr(null);
              try {
                await verifyLoginCode(email.trim(), code.trim());
              } catch {
                setErr("Ce code n'est pas valide ou a expiré. Demandez un nouvel e-mail.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <p style={{ marginTop: 14, color: "var(--soft)", fontSize: 13.5 }}>
              E-mail envoyé à <b style={{ color: "var(--ink)" }}>{email}</b>. Ouvrez le lien sur cet appareil, ou saisissez le code reçu.
            </p>
            <label className="field">
              <span>Code</span>
              <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" maxLength={10} />
            </label>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => setStep("email")}>Changer d'e-mail</button>
              <button className="btn primary" disabled={busy || code.length < 6}>Se connecter</button>
            </div>
          </form>
        )}
        {err && <p style={{ marginTop: 12, color: "var(--bad)", fontSize: 13.5 }}>{err}</p>}
      </div>
    </div>
  );
}
