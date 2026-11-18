import type { ReactNode } from "react";
import OrbitMark from "../OrbitMark";
import { t } from "../../lib/i18n";

/** Full-screen "Vault" page: near-black ground, content in one column. `ring` is kept for the callers: the orbit
 *  ring it drew (and the gold light) are gone, the page is set by its type alone. */
export default function Shell({ children, top, className }: { children: ReactNode; ring?: boolean; top?: ReactNode; className?: string }) {
  return (
    <div className={"v3" + (className ? " " + className : "")}>
      <div className="v3-bg" aria-hidden="true" />
      <div className="v3-col">
        <div className="v3-top">{top ?? <OrbitMark size={20} title="ORBES Trips" />}</div>
        {children}
      </div>
    </div>
  );
}

/** Progress of a multi-step screen: "01 / 03" and bars */
export function Steps({ n, of }: { n: number; of: number }) {
  return (
    <div className="v3-steps" aria-label={t("Étape {n} sur {of}", { n, of })}>
      <span className="v3-bars">
        {Array.from({ length: of }, (_, i) => <i key={i} className={i < n ? "on" : ""} />)}
      </span>
      <span className="v3-lbl">{String(n).padStart(2, "0")} / {String(of).padStart(2, "0")}</span>
    </div>
  );
}
