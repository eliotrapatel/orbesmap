// "Créer un voyage" once the free AI trip of the month is used: never a closed door. Three ways: prepare with the
// AI (Pro, first), create it by hand (free, the trip stays editable), or copy a public trip. Opened from "Mes voyages",
// from the concierge and from a booking received by e-mail; `prefill` carries what was already known.
import { useState } from "react";
import type { Destination } from "../../lib/newTrip";
import { requestPro } from "../../lib/store";
import { parsePublicSlug } from "../../lib/planRules";
import { track } from "../../lib/track";
import { t } from "../../lib/i18n";
import Shell from "./Shell";
import { CreateTrip } from "./Trips";
import { QuotaNote } from "./Quota";
import { CcArrow, CcClose } from "./ConciergeIcons";
import "../../styles/concierge.css";
import "../../styles/creation.css";
import "../../styles/plans.css";

/** What is already known of the trip (the concierge's conversation, a booking) */
export type Prefill = { dest?: Destination; start?: string; end?: string; hotel?: string };

export default function CreateOptions({ prefill, onCancel, onCreated }: { prefill?: Prefill; onCancel: () => void; onCreated: (id: string) => void }) {
  const [manual, setManual] = useState(false);
  const [link, setLink] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (manual) return <CreateTrip initial={prefill} onCancel={() => setManual(false)} onCreated={onCreated} />;
  const open = () => {
    const slug = parsePublicSlug(link);
    if (!slug) return setErr(t("Ce lien n'est pas un voyage public ORBES Trips."));
    track("tool_opened", "create_copy");
    // the trip's public page, with its own copy flow (dates, then "Copier dans mes voyages")
    location.assign(`${location.pathname}?t=${slug}`);
  };
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onCancel} aria-label={t("Fermer")}><CcClose /></button>
      <span className="v3-grow" />
    </div>
  );
  return (
    <Shell ring={false} top={top} className="cc-chooser co-opts">
      <p className="v3-lbl" style={{ marginTop: 18 }}>{t("Créer un voyage")}</p>
      <h1 className="v3-d v3-h2">{t("Comment le créer ?")}</h1>
      <QuotaNote className="co-quota" />
      <div className="co-grid">
        <button type="button" className="ch-card co-card" onClick={() => requestPro("prep")}>
          <span className="ch-t">
            <span className="ch-name"><b>{t("Préparer avec l'IA")}</b><span className="pro-tag">PRO</span></span>
            <small>{t("Un programme jour par jour, prêt à valider. Sans limite avec Pro.")}</small>
          </span>
          <CcArrow className="cc-ic ch-go" />
        </button>
        <button
          type="button"
          className="ch-card co-card"
          onClick={() => {
            track("tool_opened", "create_manual");
            setManual(true);
          }}
        >
          <span className="ch-t">
            <span className="ch-name"><b>{t("Créer à la main")}</b><span className="v3-tag dim">{t("Gratuit")}</span></span>
            <small>{t("Vos dates et votre carte : vous ajoutez les lieux. Le voyage reste modifiable.")}</small>
          </span>
          <CcArrow className="cc-ic ch-go" />
        </button>
        <form
          className="ch-card co-card co-copy"
          onSubmit={(e) => {
            e.preventDefault();
            open();
          }}
        >
          <span className="ch-t">
            <span className="ch-name"><b>{t("Copier un voyage public")}</b></span>
            <small>{t("Collez le lien d'un programme partagé, puis choisissez vos dates.")}</small>
          </span>
          <label className="v3-field">
            <span className="sr">{t("Lien du voyage")}</span>
            <input
              value={link}
              onChange={(e) => {
                setLink(e.target.value);
                setErr(null);
              }}
              placeholder={t("Lien du voyage")}
              inputMode="url"
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {err && <p className="v3-err" role="alert">{err}</p>}
          <button type="submit" className="v3-chip on co-open" disabled={!link.trim()}>{t("Ouvrir le programme")}</button>
        </form>
      </div>
    </Shell>
  );
}
