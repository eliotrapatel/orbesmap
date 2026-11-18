import { useEffect, useState } from "react";
import { track } from "../../lib/track";
import { closePro, useStore, type ProReason } from "../../lib/store";
import { joinWaitlist, proDate, redeemCode } from "../../lib/pro";
import Shell from "./Shell";
import { t } from "../../lib/i18n";

const WHY: Record<ProReason, string> = {
  edit: "Ce voyage est validé. Pour modifier son programme, ajouter ou déplacer des lieux, passez à Pro.",
  prep: "Votre voyage offert de ce mois a déjà été préparé. Avec Pro, préparez tous vos voyages.",
  export: "La carte hors ligne et les exports font partie de Pro.",
  info: "",
};

/** ORBES Trips Pro: what it brings, a code to activate it, and "prévenez-moi" until it goes on sale */
export default function ProScreen() {
  const why = useStore((s) => s.proAsk) || "info";
  const plan = useStore((s) => s.plan);
  const session = useStore((s) => s.session);
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
  useEffect(() => track("pro_screen", why), []); // eslint-disable-line react-hooks/exhaustive-deps
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={closePro} aria-label={t("Fermer")}>✕</button>
      <span className="v3-grow" />
    </div>
  );
  return (
    <Shell className="v3-pro" top={top}>
      <p className="v3-lbl" style={{ marginTop: 18 }}>ORBES Trips <span className="pro-tag">PRO</span></p>
      <h1 className="v3-d v3-h1">{pro ? t("Vous êtes Pro.") : t("Votre voyage, sans limite.")}</h1>
      {!pro && WHY[why] && <p className="v3-lead">{t(WHY[why])}</p>}
      {pro && (
        <p className="v3-lead">
          {plan?.granted && plan.until ? t("Pro jusqu'au {date}.", { date: proDate(plan.until) }) : plan?.granted ? t("Pro à vie.") : t("Pro est inclus avec votre accès.")}
        </p>
      )}
      <ul className="v3-vp" style={{ marginTop: 26 }}>
        <li><span>01</span>{t("Modifier le programme à tout moment : ajouter, déplacer, retirer des lieux")}</li>
        <li><span>02</span>{t("Des voyages préparés par l'IA sans limite mensuelle, et bien plus de demandes")}</li>
        <li><span>03</span>{t("La carte hors ligne et les exports (PDF, calendrier)")}</li>
        <li><span>04</span>{t("Le mode affaires : fournisseurs, rendez-vous, comptes-rendus")}</li>
      </ul>
      <div className="v3-spacer" />
      {!pro && (
        <div className="v3-glass v3-auth">
          {!session ? (
            <p className="v3-msg">{t("Connectez-vous pour activer un code ou être prévenu à l'ouverture des ventes.")}</p>
          ) : (
            <>
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
                <button className="v3-btn" disabled={busy || !code.trim()}>{busy ? t("Vérification…") : t("Activer Pro")}</button>
              </form>
              <div className="pro-wait">
                <p className="v3-msg">{t("Pro sera bientôt en vente.")}</p>
                {plan?.waitlisted ? (
                  <p className="v3-note" style={{ marginTop: 4 }}>{t("✓ Vous serez prévenu à l'ouverture des ventes.")}</p>
                ) : (
                  <button type="button" className="v3-btn ghost" disabled={busy} onClick={() => void run(joinWaitlist)}>{t("Prévenez-moi à l'ouverture")}</button>
                )}
              </div>
            </>
          )}
          {err && <p className="v3-err" role="alert">{err}</p>}
        </div>
      )}
      {(pro || done) && (
        <>
          {done && <p className="sr" role="status">{done}</p>}
          <button className="v3-btn" onClick={closePro}>{t("Continuer")}</button>
        </>
      )}
    </Shell>
  );
}
