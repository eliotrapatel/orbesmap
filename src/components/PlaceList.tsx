import { STATUSES, TYPE_LABEL } from "../data/trip";
import type { Place, PlaceType, Trip } from "../data/types";
import type { Pin, PlaceState } from "../lib/model";
import { countable, isHotel, nextStop } from "../lib/plan";
import { fmtMin, phase } from "../lib/time";
import { IStar, IStarFill } from "./Icons";

export type Filter = { types: Set<PlaceType>; fav: boolean; todo: boolean };

interface Props {
  trip: Trip;
  places: Place[];
  states: Record<string, PlaceState>;
  pins: Pin[];
  selectedId: string | null;
  query: string;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onOpen: (p: Place) => void;
  onOpenPin: (p: Pin) => void;
}

export default function PlaceList({ trip, places, states, pins, selectedId, query, filter, onFilter, onOpen, onOpenPin }: Props) {
  const all = countable(trip);
  const visited = all.filter((p) => states[p.id]?.visited).length;
  const groups = trip.days.map((d) => ({ day: d, items: places.filter((p) => p.day === d.key) })).filter((g) => g.items.length);
  const q = query.trim().toLowerCase();
  const pinItems = pins.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.note || "").toLowerCase().includes(q));
  const types = [...new Set(trip.places.map((p) => p.type))].filter((t) => t !== "hotel" && t !== "transport");
  const ph = phase(trip);
  const nx = ph !== "after" ? nextStop(trip, states) : null;
  const toggleType = (t: PlaceType) => {
    const s = new Set(filter.types);
    if (s.has(t)) s.delete(t);
    else s.add(t);
    onFilter({ ...filter, types: s });
  };

  return (
    <div>
      {nx && (
        <button className="next" onClick={() => onOpen(nx.place)}>
          <span className="label">{ph === "during" ? "Prochain arrêt" : "Premier arrêt"}</span>
          <b>{nx.place.name}</b>
          <small>
            {nx.day.title}
            {nx.when != null ? `, ${fmtMin(nx.when)}` : ""} · {TYPE_LABEL[nx.place.type] || ""}
          </small>
        </button>
      )}
      <div className="filters" role="group" aria-label="Filtres">
        <button className={"fchip" + (filter.fav ? " on" : "")} aria-pressed={filter.fav} onClick={() => onFilter({ ...filter, fav: !filter.fav })}>
          <IStar /> Favoris
        </button>
        <button className={"fchip" + (filter.todo ? " on" : "")} aria-pressed={filter.todo} onClick={() => onFilter({ ...filter, todo: !filter.todo })}>
          Pas encore vus
        </button>
        {types.map((t) => (
          <button key={t} className={"fchip" + (filter.types.has(t) ? " on" : "")} aria-pressed={filter.types.has(t)} onClick={() => toggleType(t)}>
            {TYPE_LABEL[t] || t}
          </button>
        ))}
      </div>
      <div className="progress" style={{ padding: "0 18px 6px" }} aria-label={`${visited} lieux visités sur ${all.length}`}>
        <span className="num">
          {visited} / {all.length} visités
        </span>
        <div className="bar">
          <span style={{ width: `${all.length ? (visited / all.length) * 100 : 0}%` }} />
        </div>
      </div>

      {!groups.length && !pinItems.length && (
        <div className="empty">
          <b>Aucun lieu</b>
          Changez la recherche ou les filtres.
        </div>
      )}

      {groups.map(({ day, items }) => (
        <section key={day.key}>
          <div className="group-h">
            <span className="label">{day.title}</span>
            <span>{day.theme}</span>
            <em>{items.length}</em>
          </div>
          {items.map((p) => {
            const s = states[p.id];
            const st = s?.status && s.status !== "todo" ? STATUSES.find((x) => x.key === s.status) : null;
            const hotel = isHotel(trip, p);
            return (
              <button key={p.id} className={"row" + (selectedId === p.id ? " on" : "")} onClick={() => onOpen(p)} aria-current={selectedId === p.id || undefined}>
                <span className={"mk" + (hotel ? " mk-hotel" : "") + (s?.visited && !hotel ? " is-visited" : "")} style={{ ["--c" as string]: day.color, width: hotel ? 28 : 24, height: hotel ? 28 : 24 }}>
                  {hotel ? "H" : day.glyph}
                </span>
                <span className="row-main">
                  <span className="row-name">{p.name}</span>
                  <span className="row-meta">{s?.appt ? `RDV ${s.appt}` : `${p.time} · ${TYPE_LABEL[p.type] || p.type}`}</span>
                </span>
                <span className="row-tags">
                  {s?.favorite && <IStarFill aria-label="Favori" />}
                  {st && <span className="sdot" title={st.label} style={{ ["--c" as string]: st.color }} />}
                </span>
              </button>
            );
          })}
        </section>
      ))}

      {pinItems.length > 0 && (
        <section>
          <div className="group-h">
            <span className="label">Mes lieux</span>
            <span>Ajoutés sur la carte</span>
            <em>{pinItems.length}</em>
          </div>
          {pinItems.map((pin) => (
            <button key={pin.id} className={"row" + (selectedId === pin.id ? " on" : "")} onClick={() => onOpenPin(pin)}>
              <span className="mk" style={{ ["--c" as string]: "#f6f2ea", width: 24, height: 24 }}>
                ●
              </span>
              <span className="row-main">
                <span className="row-name">{pin.name}</span>
                {pin.note && <span className="row-meta">{pin.note}</span>}
              </span>
            </button>
          ))}
        </section>
      )}
      <div style={{ height: 20 }} />
    </div>
  );
}
