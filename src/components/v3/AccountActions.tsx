import { useState } from "react";
import { requestPro, useStore } from "../../lib/store";
import { deleteMyAccount, exportMyData, proDate } from "../../lib/pro";
import { openAdmin } from "./nav";
import { legalHref } from "./Legal";

/** What the account's Pro status reads as, in one line */
export function useProLine(): string | null {
  const plan = useStore((s) => s.plan);
  if (!plan) return null;
  if (!plan.pro) return plan.prepLeft > 0 ? "Gratuit · 1 voyage offert ce mois-ci" : "Gratuit · voyage du mois utilisé";
  return plan.granted ? (plan.until ? `Pro jusqu'au ${proDate(plan.until)}` : "Pro à vie") : "Pro inclus";
}

/** Asks twice (typed word) before deleting the account; returns an error message, or nothing */
export async function confirmAndDelete(): Promise<string | null> {
  if (!confirm("Supprimer votre compte ?\nLes voyages que vous avez créés seront supprimés, y compris pour les personnes invitées. Les voyages partagés avec vous restent à leurs propriétaires.\nVous pouvez d'abord exporter vos données.")) return null;
  const typed = prompt("Pour confirmer, écrivez SUPPRIMER");
  if ((typed || "").trim().toUpperCase() !== "SUPPRIMER") return typed == null ? null : "Suppression annulée : le mot ne correspond pas.";
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
      {plan?.admin && <button type="button" className={btn} onClick={() => openAdmin(true)}>Administration</button>}
      <button type="button" className={btn} onClick={() => exportMyData()}>Exporter mes données</button>
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
        {busy ? "Suppression…" : "Supprimer mon compte"}
      </button>
      {err && <p className="v3-err" role="alert">{err}</p>}
      <p className="v3-fine acct-legal"><a href={legalHref("cgu")}>Conditions</a> · <a href={legalHref("confidentialite")}>Confidentialité</a> · <a href="mailto:hello@joinentity.com">Contact</a></p>
    </div>
  );
}
