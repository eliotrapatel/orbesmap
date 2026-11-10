import { useState } from "react";
import { sendLoginEmail, signOut, useStore, verifyLoginCode, type SyncState } from "../lib/store";
import { supabaseConfigured } from "../lib/supabase";

const SYNC_TEXT: Record<SyncState, string> = {
  local: "Enregistré sur cet appareil",
  idle: "Tout est synchronisé",
  syncing: "Synchronisation…",
  pending: "Hors connexion : envoi dès le retour du réseau",
  error: "Envoi en attente, nouvel essai automatique",
};

export function SyncBadge() {
  const sync = useStore((s) => s.sync);
  const session = useStore((s) => s.session);
  const state: SyncState = session ? sync : "local";
  return (
    <span className={"sync " + state}>
      <i /> {SYNC_TEXT[state]}
    </span>
  );
}

export default function Account() {
  const session = useStore((s) => s.session);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!supabaseConfigured) {
    return (
      <div className="tools">
        <section className="card">
          <h3>Sauvegarde</h3>
          <p style={{ marginTop: 6 }}>Vos notes, statuts, contacts et photos sont enregistrés sur cet appareil.</p>
          <p style={{ marginTop: 10 }}>La synchronisation en ligne sera disponible dès que le compte Supabase sera relié à l'app.</p>
          <div style={{ marginTop: 14 }}>
            <SyncBadge />
          </div>
        </section>
      </div>
    );
  }

  if (session) {
    return (
      <div className="tools">
        <section className="card">
          <h3>Compte</h3>
          <p style={{ marginTop: 6 }}>Connecté avec {session.user.email}</p>
          <div style={{ marginTop: 14 }}>
            <SyncBadge />
          </div>
          <p style={{ marginTop: 14 }}>Vos données sont sauvegardées en ligne et sur cet appareil. Vous les retrouvez sur tous vos appareils en vous connectant avec le même e-mail.</p>
          <button className="btn danger block" style={{ marginTop: 16 }} onClick={() => signOut()}>
            Se déconnecter
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="tools">
      <section className="card">
        <h3>Sauvegarder en ligne</h3>
        <p style={{ marginTop: 6 }}>Connectez-vous pour retrouver vos notes, contacts et photos sur tous vos appareils. Sans connexion, tout reste enregistré sur cet appareil.</p>
        <div style={{ marginTop: 12 }}>
          <SyncBadge />
        </div>
        {step === "email" ? (
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
            <button className="btn dark block" style={{ marginTop: 12 }} disabled={busy || !email.includes("@")}>
              {busy ? "Envoi…" : "Recevoir le lien de connexion"}
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
            <p style={{ marginTop: 14 }}>
              E-mail envoyé à <b>{email}</b>. Ouvrez le lien sur cet appareil, ou saisissez le code reçu.
            </p>
            <label className="field">
              <span>Code</span>
              <input className="input" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" maxLength={10} />
            </label>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => setStep("email")}>
                Changer d'e-mail
              </button>
              <button className="btn dark" disabled={busy || code.length < 6}>
                Se connecter
              </button>
            </div>
          </form>
        )}
        {err && <p style={{ marginTop: 12, color: "#9b1c1c", fontSize: 13.5 }}>{err}</p>}
      </section>
    </div>
  );
}
