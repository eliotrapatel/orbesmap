import type { Place, Trip } from "../data/types";
import { toast, updateDef, useCanEdit, needPro } from "../lib/store";
import { t } from "../lib/i18n";

/** Removes a place from the programme: hidden everywhere (both phones), listed in "Lieux retirés" to be put back */
export function removeFromProgramme(place: Place): boolean {
  if (needPro()) return false;
  if (!confirm(t("Retirer « {name} » du programme ?\nIl disparaît de la carte, de la liste et de l'agenda. Vous pourrez le remettre depuis « Lieux retirés », en bas de la liste.", { name: place.name }))) return false;
  if (!updateDef(place.id, { removed: true })) return false;
  toast(t("« {name} » retiré du programme", { name: place.name }));
  return true;
}

export function restoreToProgramme(place: Place) {
  if (updateDef(place.id, { removed: false })) toast(t("« {name} » remis au programme", { name: place.name }));
}

/** Places removed from the programme, with a button to put each one back (in its day and slot) */
export default function RemovedList({ trip }: { trip: Trip }) {
  const list = trip.removed || [];
  const canEdit = useCanEdit(trip.id);
  if (!list.length) return null;
  return (
    <details className="removed">
      <summary>
        <span className="label">{t("Lieux retirés")}</span>
        <em>{list.length}</em>
      </summary>
      {list.map((p) => {
        const d = trip.days.find((x) => x.key === p.day);
        return (
          <div key={p.id} className="removed-row">
            <span className="removed-main">
              <b>{p.name}</b>
              <small>{[d?.dates?.[0] ? d.short : d?.title, p.time].filter(Boolean).join(" · ")}</small>
            </span>
            {canEdit && <button className="btn-sm" onClick={() => restoreToProgramme(p)}>{t("Remettre")}</button>}
          </div>
        );
      })}
    </details>
  );
}
