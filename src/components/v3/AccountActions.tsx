import { useState } from "react";
import { requestPro, useStore } from "../../lib/store";
import { deleteMyAccount, exportMyData, proDate } from "../../lib/pro";
import { openAdmin } from "./nav";
import { AlertsBlock } from "./AlertsAndInbox";
import { legalHref } from "./Legal";
import { t, setLang, useLang } from "../../lib/i18n";

/** What the account's Pro status reads as, in one line */
export function useProLine(): string | null {
  const plan = useStore((s) => s.plan);
  if (!plan) return null;
  if (!plan.pro) return plan.prepLeft > 0 ? t("Gratuit · 1 voyage offert ce mois-ci") : t("Gratuit · voyage du mois utilisé");
  return plan.granted ? (plan.until ? t("Pro jusqu'au {date}", { date: proDate(plan.until) }) : t("Pro à vie")) : t("Pro inclus");
}

/** Asks twice (typed word) before deleting the account; returns an error message, or nothing */
export async function confirmAndDelete(): Promise<string | null> {
  if (!confirm(t("Supprimer votre compte ?\nLes voyages que vous avez créés seront supprimés, y compris pour les personnes invitées. Les voyages partagés avec vous restent à leurs propriétaires.\nVous pouvez d'abord exporter vos données."))) return null;
  const word = t("SUPPRIMER");
  const typed = prompt(t("Pour confirmer, écrivez {word}", { word }));
  if ((typed || "").trim().toUpperCase() !== word) return typed == null ? null : t("Suppression annulée : le mot ne correspond pas.");
  try {
    await deleteMyAccount();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** The account's lines: Pro, administration (admins), export, deletion. `variant` = the map app's drawer or the v3 screens */
export default function AccountActions({ variant = "v3" }: { variant?: "v3" | "app" }) {
  const plan = useStore((s) => s.plan);
  const line = useProLine();
  const lang = useLang();
  const signedIn = useStore((st) => !!st.session);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const btn = variant === "app" ? "btn block" : "v3-btn ghost";
  return (
    <div className={"acct-actions is-" + variant}>
      {plan && (
        <button type="button" className="acct-pro" onClick={() => requestPro("info")}>
          <span className="pro-tag">PRO</span>
          <span className="v3-grow">
            <b>ORBES Trips Pro</b>
            <small>{line}</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      )}
      {signedIn && <AlertsBlock />}
      {plan?.admin && <button type="button" className={btn} onClick={() => openAdmin(true)}>{t("Administration")}</button>}
      <button type="button" className={btn} onClick={() => exportMyData()}>{t("Exporter mes données")}</button>
      <button
        type="button"
        className={variant === "app" ? "btn danger block" : "v3-link acct-delete"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(await confirmAndDelete());
          setBusy(false);
        }}
      >
        {busy ? t("Suppression…") : t("Supprimer mon compte")}
      </button>
      {err && <p className="v3-err" role="alert">{err}</p>}
      <div className="v3-seg acct-lang" role="radiogroup" aria-label={t("Langue")}>
        {(["fr", "en"] as const).map((l) => (
          <button key={l} type="button" role="radio" aria-checked={lang === l} className={lang === l ? "on" : ""} onClick={() => setLang(l)}>{l === "fr" ? "Français" : "English"}</button>
        ))}
      </div>
      <p className="v3-fine acct-legal"><a href={legalHref("cgu")}>{t("Conditions")}</a> · <a href={legalHref("confidentialite")}>{t("Confidentialité")}</a> · <a href="mailto:hello@joinentity.com">{t("Contact")}</a></p>
    </div>
  );
}
