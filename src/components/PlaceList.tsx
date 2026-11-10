import { DAYS, DAY_BY_KEY, STATUSES } from "../data/trip";
import type { DayKey, Place } from "../data/types";
import type { Pin, PlaceState } from "../lib/model";
import { IStarFill } from "./Icons";

interface Props {
  places: Place[];
  states: Record<string, PlaceState>;
  pins: Pin[];
  selectedId: string | null;
  query: string;
  total: number;
  onOpen: (p: Place) => void;
  onOpenPin: (p: Pin) => void;
}

export default function PlaceList({ places, states, pins, selectedId, query, total, onOpen, onOpenPin }: Props) {
  const visited = Object.values(states).filter((s) => s.visited).length;
  const groups = DAYS.map((d) => ({ day: d, items: places.filter((p) => p.day === d.key) })).filter((g) => g.items.length);
  const q = query.trim().toLowerCase();
  const pinItems = pins.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.note || "").toLowerCase().includes(q));

  return (
    <div>
      <div className="progress" aria-label={`${visited} lieux visités sur ${total}`}>
        <span>
          {visited} / {total} visités
        </span>
        <div className="progress-bar">
          <span style={{ width: `${total ? (visited / total) * 100 : 0}%` }} />
        </div>
      </div>

      {!groups.length && !pinItems.length && (
        <div className="empty">
          <b>Aucun lieu trouvé</b>
          Essayez un autre mot, ou choisissez « Tout » dans les jours.
        </div>
      )}

      {groups.map(({ day, items }) => (
        <section key={day.key}>
          <div className="group-h">
            <h3>{day.title}</h3>
            <span>{day.theme}</span>
            <em>{items.length}</em>
          </div>
          {items.map((p) => (
            <Row key={p.id} place={p} state={states[p.id]} on={selectedId === p.id} onClick={() => onOpen(p)} />
          ))}
        </section>
      ))}

      {pinItems.length > 0 && (
        <section>
          <div className="group-h">
            <h3>Mes lieux</h3>
            <span>Ajoutés sur la carte</span>
            <em>{pinItems.length}</em>
          </div>
          {pinItems.map((pin) => (
            <button key={pin.id} className={"row" + (selectedId === pin.id ? " on" : "")} onClick={() => onOpenPin(pin)}>
              <span className="mk" style={{ ["--c" as string]: "#000" }}>●</span>
              <span className="row-main">
                <span className="row-name" style={{ display: "block" }}>{pin.name}</span>
                {pin.note && <span className="row-meta" style={{ display: "block" }}>{pin.note}</span>}
              </span>
            </button>
          ))}
        </section>
      )}
      <div style={{ height: 24 }} />
    </div>
  );
}

function Row({ place, state, on, onClick }: { place: Place; state?: PlaceState; on: boolean; onClick: () => void }) {
  const day = DAY_BY_KEY[place.day as DayKey];
  const st = state?.status && state.status !== "todo" ? STATUSES.find((s) => s.key === state.status) : null;
  return (
    <button className={"row" + (on ? " on" : "")} onClick={onClick} aria-current={on || undefined}>
      <span className={"mk" + (state?.visited ? " is-visited" : "")} style={{ ["--c" as string]: day.color }}>
        {day.glyph}
      </span>
      <span className="row-main">
        <span className="row-name" style={{ display: "block" }}>{place.name}</span>
        <span className="row-meta" style={{ display: "block" }}>
          {state?.appt ? `RDV ${state.appt}` : place.time}
        </span>
      </span>
      <span className="row-tags">
        {state?.favorite && <IStarFill aria-label="Favori" />}
        {st && <span className="dot" title={st.label} style={{ ["--c" as string]: st.color }} />}
      </span>
    </button>
  );
}
