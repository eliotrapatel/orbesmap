// The free AI trip of the month, said where a trip is created (free accounts only; nothing for Pro, members, admins).
import { useStore } from "../../lib/store";
import { quota } from "../../lib/planRules";
import { getLang, locale, t } from "../../lib/i18n";
import "../../styles/plans.css";

/** "1 December" / "1er décembre" style date of an ISO day */
export const dayLong = (iso: string) => {
  const s = new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "long", timeZone: "UTC" });
  // French writes the first of the month "1er"
  return getLang() === "fr" ? s.replace(/^1 /, "1er ") : s;
};

/** "1 voyage préparé par l'IA offert ce mois-ci" or "Voyage IA du mois utilisé · revient le 1 décembre" */
export function QuotaNote({ className = "" }: { className?: string }) {
  const plan = useStore((s) => s.plan);
  const q = quota(plan, Date.now());
  if (!q) return null;
  return (
    <p className={"qn-note " + (q.left ? "left " : "used ") + className}>
      {q.left ? t("1 voyage préparé par l'IA offert ce mois-ci") : t("Voyage IA du mois utilisé · revient le {date}", { date: dayLong(q.back) })}
    </p>
  );
}
