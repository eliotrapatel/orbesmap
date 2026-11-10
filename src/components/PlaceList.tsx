import { useRef } from "react";
import { STATUSES, TYPE_LABEL } from "../data/trip";
import type { Place, PlaceType, Trip } from "../data/types";
import type { Pin, PlaceState } from "../lib/model";
import { countable, isHotel, nextStop } from "../lib/plan";
import { fmtMin, phase } from "../lib/time";
import { km } from "../lib/geo";
import { liveStatus } from "../lib/hours";
import { fmtDistance } from "../lib/route";
import { useLoc } from "../lib/locate";
import { IStar, IStarFill } from "./Icons";

export type Filter = { types: Set<PlaceType>; fav: boolean; todo: boolean; near?: boolean };

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
  const fix = useLoc((s) => s.fix);
  // sort and distances use an anchor that only moves every ~25 m, so rows don't jump under the finger
  const anchor = useRef<{ lat: number; lng: number } | null>(null);
  if (!fix) anchor.current = null;
  else if (!anchor.current || km(anchor.current, fix) * 1000 > 25) anchor.current = { lat: fix.lat, lng: fix.lng };
  const a = anchor.current;
  const dist = (p: { lat: number; lng: number }) => (a ? km(a, p) * 1000 : null);
  const near = !!(filter.near && fix);
  const dayOf = (k: string) => trip.days.find((d) => d.key === k)!;
  const groups = near
    ? [{ day: { key: "near", title: "Autour de moi", theme: "Du plus proche au plus loin", color: "#5aa7ff", glyph: "•" } as Trip["days"][number], items: places.filter((p) => !isHotel(trip, p)).sort((a, b) => dist(a)! - dist(b)!) }]
    : trip.days.map((d) => ({ day: d, items: places.filter((p) => p.day === d.key) })).filter((g) => g.items.length);
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
        {fix && (
          <button className={"fchip" + (filter.near ? " on" : "")} aria-pressed={!!filter.near} onClick={() => onFilter({ ...filter, near: !filter.near })}>
            Autour de moi
          </button>
        )}
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
            const pd = near ? dayOf(p.day) : day;
            const ls = ph === "during" ? liveStatus(trip.hours?.[p.id], trip.timezone) : null;
            const d = dist(p);
            return (
              <button key={p.id} className={"row" + (selectedId === p.id ? " on" : "")} onClick={() => onOpen(p)} aria-current={selectedId === p.id || undefined}>
                <span className={"mk" + (hotel ? " mk-hotel" : "") + (s?.visited && !hotel ? " is-visited" : "")} style={{ ["--c" as string]: pd.color, width: hotel ? 28 : 24, height: hotel ? 28 : 24 }}>
                  {hotel ? "H" : pd.glyph}
                </span>
                <span className="row-main">
                  <span className="row-name">{p.name}</span>
                  <span className="row-meta">{s?.appt ? `RDV ${s.appt}` : `${p.time} · ${TYPE_LABEL[p.type] || p.type}`}</span>
                </span>
                <span className="row-tags">
                  {s?.favorite && <IStarFill aria-label="Favori" />}
                  {st && <span className="sdot" title={st.label} style={{ ["--c" as string]: st.color }} />}
                  {ls && ls.tone === "bad" && <span className="row-closed">Fermé</span>}
                  {d != null && <span className="row-dist">{fmtDistance(d)}</span>}
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
                {(() => {
                  const x = (states as Record<string, Record<string, unknown>>)[`_pin:${pin.id}`] || {};
                  const dd = trip.days.find((d) => d.key === x.day);
                  const meta = [dd?.dates?.[0] ? dd.short : dd?.title, (x.why as string) || (x.desc as string) || pin.note].filter(Boolean).join(" · ");
                  return meta ? <span className="row-meta">{meta}</span> : null;
                })()}
              </span>
              {fix && <span className="row-tags"><span className="row-dist">{fmtDistance(dist(pin)!)}</span></span>}
            </button>
          ))}
        </section>
      )}
      <div style={{ height: 20 }} />
    </div>
  );
}
