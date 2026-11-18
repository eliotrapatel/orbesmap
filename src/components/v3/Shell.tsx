import type { ReactNode } from "react";
import OrbitMark from "../OrbitMark";
import { t } from "../../lib/i18n";

/** Full-screen "Vault" page: black ground, a faint gold light, a slow orbit ring, content in one column */
export default function Shell({ children, ring = true, top, className }: { children: ReactNode; ring?: boolean; top?: ReactNode; className?: string }) {
  return (
    <div className={"v3" + (className ? " " + className : "")}>
      <div className="v3-bg" aria-hidden="true" />
      {ring && (
        <svg className="v3-ring" viewBox="0 0 700 300" aria-hidden="true">
          <g>
            <ellipse cx="350" cy="150" rx="340" ry="92" transform="rotate(-18 350 150)" fill="none" stroke="currentColor" strokeWidth="1" />
            <ellipse cx="350" cy="150" rx="250" ry="62" transform="rotate(-18 350 150)" fill="none" stroke="currentColor" strokeWidth=".6" opacity=".5" />
            <circle cx="580" cy="13" r="4" fill="currentColor" />
          </g>
        </svg>
      )}
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
