import { useEffect, useState } from "react";
import Shell from "./Shell";
import AuthBox, { type AuthMode } from "./AuthBox";
import Welcome from "./Welcome";
import { supabase } from "../../lib/supabase";
import { dateLabel } from "../../lib/newTrip";
import { forgetJoin } from "../../lib/entry";
import { t } from "../../lib/i18n";

type Preview = { ok: boolean; used?: boolean; expired?: boolean; title?: string; start?: string; end?: string; places?: number; inviter?: string; email?: string; has_account?: boolean };

/**
 * The invitation link (?join=…) opened without an account on this device (lot cycle, R09): who invites, the trip,
 * then the account form with the invited address filled in (sign-in when that address already has an account).
 * The trip opens right after the sign-in, or after the e-mail confirmation. Before supabase/saas-14.sql (or an
 * unknown link): the public page, as today.
 */
export default function JoinTripPage({ token }: { token: string }) {
  const [p, setP] = useState<Preview | null | "none">(null);
  const [mode, setMode] = useState<AuthMode>("signup");
  useEffect(() => {
    let alive = true;
    if (!supabase) return setP("none");
    void supabase.rpc("invite_preview", { p_token: token }).then(
      ({ data, error }) => {
        if (!alive) return;
        const r = (data || null) as Preview | null;
        if (error || !r) return setP("none");
        if (!r.ok && !r.used && !r.expired) {
          forgetJoin();
          return setP("none");
        }
        if (r.ok && r.has_account) setMode("signin");
        setP(r);
      },
      () => alive && setP("none"),
    );
    return () => {
      alive = false;
    };
  }, [token]);

  if (p === "none") return <Welcome />;
  if (p === null)
    return (
      <Shell>
        <p className="v3-note" role="status" style={{ marginTop: 28 }}>{t("Chargement de l'invitation…")}</p>
      </Shell>
    );
  if (!p.ok)
    return (
      <Shell>
        <p className="v3-lbl" style={{ marginTop: 22 }}>{t("Invitation")}</p>
        <h1 className="v3-d v3-h2" style={{ marginTop: 10 }}>{p.used ? t("Cette invitation a déjà servi.") : t("Cette invitation a expiré.")}</h1>
        <p className="v3-lead" style={{ marginTop: 10 }}>
          {p.used ? t("Connectez-vous avec l'adresse invitée : le voyage est dans « Mes voyages ».") : t("Demandez à la personne qui vous a invité de vous l'envoyer à nouveau. Si vous avez déjà un compte avec cette adresse, connectez-vous : le voyage vous attend.")}
        </p>
        <div style={{ marginTop: 18 }}>
          <AuthBox mode={mode === "signup" && p.used ? "signin" : mode} onMode={setMode} />
        </div>
      </Shell>
    );
  const n = Number(p.places) || 0;
  const dates = p.start ? dateLabel(p.start, p.end && p.end >= p.start ? p.end : p.start) : "";
  const facts = dates ? (n > 1 ? t("{dates} · {n} lieux", { dates, n }) : n === 1 ? t("{dates} · 1 lieu", { dates }) : dates) : "";
  return (
    <Shell>
      <p className="v3-lbl" style={{ marginTop: 22 }}>{t("Invitation")}</p>
      <h1 className="v3-d v3-h2" style={{ marginTop: 10 }}>{p.inviter ? t("{inviter} vous invite", { inviter: p.inviter }) : t("Vous êtes invité")}</h1>
      <div className="v3-glass" style={{ padding: "14px 16px", marginTop: 16 }}>
        <p className="v3-d" style={{ fontSize: 22, lineHeight: 1.2, margin: 0, overflowWrap: "anywhere" }}>{p.title}</p>
        {facts && <p className="v3-note" style={{ margin: "6px 0 0" }}>{facts}</p>}
      </div>
      <p className="v3-lead" style={{ marginTop: 14 }}>
        {mode === "signin" ? t("Connectez-vous avec l'adresse de l'invitation : le voyage vous attend.") : t("Créez votre compte avec l'adresse de l'invitation : le voyage s'ouvrira dès la confirmation.")}
      </p>
      <div style={{ marginTop: 14 }}>
        <AuthBox mode={mode} onMode={setMode} lockedEmail={p.email || undefined} />
      </div>
      {/* another address on this device (a shared phone, an account under another address): the usual welcome */}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 6 }}>
        <button
          type="button"
          className="v3-link auth-back"
          onClick={() => {
            forgetJoin();
            setP("none");
          }}
        >
          {t("Utiliser une autre adresse")}
        </button>
      </div>
    </Shell>
  );
}
