import type { Place, Trip } from "../data/types";
import { toast, updatePlace } from "../lib/store";

/** Removes a place from the programme: hidden everywhere (both phones), listed in "Lieux retirés" to be put back */
export function removeFromProgramme(place: Place): boolean {
  if (!confirm(`Retirer « ${place.name} » du programme ?\nIl disparaît de la carte, de la liste et de l'agenda. Vous pourrez le remettre depuis « Lieux retirés », en bas de la liste.`)) return false;
  updatePlace(place.id, { removed: true });
  toast(`« ${place.name} » retiré du programme`);
  return true;
}

export function restoreToProgramme(place: Place) {
  updatePlace(place.id, { removed: null });
  toast(`« ${place.name} » remis au programme`);
}

/** Places removed from the programme, with a button to put each one back (in its day and slot) */
export default function RemovedList({ trip }: { trip: Trip }) {
  const list = trip.removed || [];
  if (!list.length) return null;
  return (
    <details className="removed">
      <summary>
        <span className="label">Lieux retirés</span>
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
            <button className="btn-sm" onClick={() => restoreToProgramme(p)}>Remettre</button>
          </div>
        );
      })}
    </details>
  );
}
