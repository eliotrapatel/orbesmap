// Pro on one trip, in the trip's Infos tab: its Pass ("Pass voyage jusqu'au …"), the owner's Pro shared with the
// travellers ("Pro sur ce voyage, offert par …"), or, on a trip created by hand by a free account whose AI trip of
// the month is used, "Compléter avec l'IA" (the Pro screen). Nothing for Pro accounts, nor before supabase/saas-13.sql.
import type { Trip } from "../../data/types";
import { TRIP_BY_ID } from "../../data/trip";
import { requestPro, tripHasPro, useStore } from "../../lib/store";
import { proDate } from "../../lib/pro";
import { track } from "../../lib/track";
import { t } from "../../lib/i18n";
import "../../styles/plans.css";

export default function TripPassLine({ trip }: { trip: Trip }) {
  const plan = useStore((s) => s.plan);
  const hasDraft = useStore((s) => !!s.trips[trip.id]?.draft);
  // its creator (or a trip not sent yet, with no role): invited travellers never see "Créé à la main"
  const owner = useStore((s) => (s.roles[trip.id] ?? "owner") === "owner");
  if (!plan || plan.pro) return null;
  const pass = plan.passes?.[trip.id];
  if (pass?.kind === "pass" && pass.until)
    return (
      <div className="card tp-line">
        <span className="pro-tag">PRO</span>
        <p>
          {t("Pass voyage jusqu'au {date}", { date: proDate(pass.until) })}
          {!pass.mine && pass.by ? ` · ${t("offert par {name}", { name: pass.by })}` : ""}
        </p>
      </div>
    );
  if (pass?.kind === "owner" && !pass.mine)
    return (
      <div className="card tp-line">
        <span className="pro-tag">PRO</span>
        <p>{pass.by ? t("Pro sur ce voyage, offert par {name}", { name: pass.by }) : t("Pro sur ce voyage")}</p>
      </div>
    );
  // a trip created by hand (no preparation) by this account, the free AI trip of the month used, the trip not Pro
  if (!owner || hasDraft || TRIP_BY_ID[trip.id] || plan.prepLeft > 0 || tripHasPro(trip.id)) return null;
  return (
    <div className="card tp-line tp-manual">
      <p>{t("Créé à la main")}</p>
      <button
        type="button"
        className="v3-chip tp-ai"
        onClick={() => {
          track("tool_opened", "complete_ai", trip.id);
          requestPro("prep");
        }}
      >
        {t("Compléter avec l'IA")} <span className="pro-tag">PRO</span>
      </button>
    </div>
  );
}
