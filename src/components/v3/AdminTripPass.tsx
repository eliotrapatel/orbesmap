// The admin's Pass on a trip (given by hand, no payment yet) and the AI cost by plan (supabase/saas-13.sql).
// Both are read and written on the server; before saas-13.sql runs they say so and change nothing.
import { useEffect, useState } from "react";
import { TRIP_BY_ID } from "../../data/trip";
import { adminAiBudget, adminGrantTripPass, adminTripPasses, proDate, type AiBudget, type TripPassRow } from "../../lib/pro";
import { passUntil } from "../../lib/planRules";
import { locale, t } from "../../lib/i18n";
import "../../styles/plans.css";

const usd = (n: number) => t("{n} $", { n: (Number(n) || 0) < 0.1 && Number(n) > 0 ? (Number(n) || 0).toFixed(4) : (Number(n) || 0).toFixed(2) });
const dayIso = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** In an account's sheet, on one of its trips: "Pass jusqu'au …" or "Offrir un Pass" (a second touch confirms, with
 *  the date it will run to), "Retirer le Pass" (a second touch). `payer`: the account whose sheet is open. */
export function AdminTripPass({ tripId, payer }: { tripId: string; payer: string }) {
  const [row, setRow] = useState<TripPassRow | null | undefined>(undefined);
  const [sure, setSure] = useState<"give" | "remove" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (TRIP_BY_ID[tripId]) return;
    let live = true;
    adminTripPasses([tripId]).then(
      (r) => live && setRow(r === null ? null : r.find((x) => x.trip_id === tripId) || { trip_id: tripId, trip_end: null, until: null, payer_email: null, source: null }),
      (e) => live && setErr((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [tripId, n]);
  useEffect(() => {
    if (!sure) return;
    const tm = window.setTimeout(() => setSure(null), 4000);
    return () => window.clearTimeout(tm);
  }, [sure]);
  // the shared space's trips are always Pro
  if (TRIP_BY_ID[tripId]) return null;
  if (row === null) return <small className="atp-line atp-off">{t("Lancez supabase/saas-13.sql")}</small>;
  if (row === undefined) return err ? <small className="atp-line v3-err">{err}</small> : null;
  const act = (kind: "give" | "remove") => {
    if (sure !== kind) return setSure(kind);
    setSure(null);
    setBusy(true);
    setErr(null);
    adminGrantTripPass(tripId, payer, kind === "give" ? null : 0).then(
      () => {
        setBusy(false);
        setN((x) => x + 1);
      },
      (e) => {
        setBusy(false);
        setErr((e as Error).message);
      },
    );
  };
  return (
    <span className="atp-line">
      {row.until ? (
        <>
          <span className="pro-tag">PRO</span>
          <small>{t("Pass jusqu'au {date}", { date: proDate(row.until) })}</small>
          <button type="button" className={"v3-chip atp-btn" + (sure === "remove" ? " sure" : "")} disabled={busy} onClick={() => act("remove")}>
            {sure === "remove" ? t("Toucher encore pour retirer") : t("Retirer le Pass")}
          </button>
        </>
      ) : (
        <button type="button" className={"v3-chip atp-btn" + (sure === "give" ? " sure" : "")} disabled={busy} onClick={() => act("give")}>
          {sure === "give" ? t("Toucher encore : Pass jusqu'au {date}", { date: dayIso(passUntil(row.trip_end, Date.now())) }) : t("Offrir un Pass")}
        </button>
      )}
      {err && <small className="v3-err atp-err">{err}</small>}
    </span>
  );
}

const PLAN_LABEL: Record<string, string> = { free: "Gratuit", pro: "Pro (codes et accès)", team: "Équipe", shared: "Espace partagé" };

/** The AI by plan over 30 days (accounts, requests, cost; revenue: none before payments), the free accounts above
 *  their monthly budget, and the Pro accounts above 30 % of Pro annuel's monthly price (an alert only) */
export function AdminAiBudget() {
  const [data, setData] = useState<AiBudget | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    adminAiBudget().then((d) => live && setData(d), (e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
  }, []);
  if (err) return <p className="v3-note">{err}</p>;
  if (data === undefined) return null;
  if (data === null) return <p className="v3-note">{t("Lancez supabase/saas-13.sql")}</p>;
  const people = (list: AiBudget["over"]) =>
    list.length ? (
      list.map((r) => (
        <div key={r.email} className="adm-tr atp-tr">
          <span className="atp-mail">{r.email}</span><span>{r.requests}</span><span>{usd(r.usd)}</span>
        </div>
      ))
    ) : (
      <p className="v3-note">{t("Personne pour l'instant.")}</p>
    );
  return (
    <div className="v3-glass adm-card">
      <span className="v3-lbl">{t("IA par formule, 30 jours")}</span>
      <div className="adm-table">
        <div className="adm-tr adm-th atp-tr4"><span>{t("Formule")}</span><span>{t("Comptes")}</span><span>{t("Demandes")}</span><span>{t("Coût")}</span><span>{t("Revenu")}</span></div>
        {data.plans.map((p) => (
          <div key={p.plan} className="adm-tr atp-tr4">
            <span>{t(PLAN_LABEL[p.plan] || p.plan)}</span><span>{p.accounts}</span><span>{p.requests}</span><span>{usd(p.usd)}</span><span>—</span>
          </div>
        ))}
      </div>
      <span className="v3-lbl adm-sub">{t("Au-delà du budget ce mois-ci")}</span>
      <div className="adm-table">{people(data.over)}</div>
      <span className="v3-lbl adm-sub">{t("Comptes Pro au-delà de 30 % du prix Annuel par mois")}</span>
      <div className="adm-table">{people(data.proAlert)}</div>
    </div>
  );
}
