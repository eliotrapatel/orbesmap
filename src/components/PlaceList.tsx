import { useRef } from "react";
import { STATUSES, TYPE_LABEL } from "../data/trip";
import type { Place, PlaceType, Trip } from "../data/types";
import type { Pin, PlaceState } from "../lib/model";
import { countable, dayStops, isHotel, nextStop } from "../lib/plan";
import { fmtMin, phase } from "../lib/time";
import { km } from "../lib/geo";
import { liveStatus } from "../lib/hours";
import { notesText } from "../lib/notes";
import { fmtDistance } from "../lib/route";
import { useLoc } from "../lib/locate";
import { IStar, IStarFill } from "./Icons";
import RemovedList from "./RemovedList";
import { t } from "../lib/i18n";
import { votesOf } from "../lib/social";
import { PhThumb } from "./PlacePhoto";

export type Filter = { types: Set<PlaceType>; fav: boolean; todo: boolean; near?: boolean; added?: boolean };

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
    ? [{ day: { key: "near", title: t("Autour de moi"), theme: t("Du plus proche au plus loin"), color: "#5aa7ff", glyph: "•" } as Trip["days"][number], items: places.filter((p) => !isHotel(trip, p)).sort((a, b) => dist(a)! - dist(b)!) }]
    : trip.days
        .map((d) => {
          const items = places.filter((p) => p.day === d.key);
          // a planned day reads in time order (places added or moved in the app take their slot); other groups keep their order
          if (!d.scheduled) return { day: d, items };
          const order = new Map(dayStops(trip, d.key, states).map((p, i) => [p.id, i]));
          return { day: d, items: items.slice().sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) };
        })
        .filter((g) => g.items.length);
  const q = query.trim().toLowerCase();
  const pinItems = pins.filter((p) => !q || p.name.toLowerCase().includes(q) || notesText((states as Record<string, Record<string, unknown>>)[`_pin:${p.id}`], p.note).toLowerCase().includes(q));
  const types = [...new Set(trip.places.map((p) => p.type))].filter((t) => t !== "hotel" && t !== "transport" && t !== "ajout");
  const hasAdded = trip.places.some((p) => p.added);
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
        <button className="next has-ph" onClick={() => onOpen(nx.place)}>
          <span className="next-txt">
            <span className="label">{ph === "during" ? t("Prochain arrêt") : t("Premier arrêt")}</span>
            <b>{nx.place.name}</b>
            <small>
              {nx.day.title}
              {nx.when != null ? `, ${fmtMin(nx.when)}` : ""} · {t(TYPE_LABEL[nx.place.type] || "")}
            </small>
          </span>
          <PhThumb photo={nx.place.photo} label={(nx.place.name[0] || "·").toUpperCase()} size={52} />
        </button>
      )}
      <div className="filters" role="group" aria-label={t("Filtres")}>
        {fix && (
          <button className={"fchip" + (filter.near ? " on" : "")} aria-pressed={!!filter.near} onClick={() => onFilter({ ...filter, near: !filter.near })}>
            {t("Autour de moi")}
          </button>
        )}
        <button className={"fchip" + (filter.fav ? " on" : "")} aria-pressed={filter.fav} onClick={() => onFilter({ ...filter, fav: !filter.fav })}>
          <IStar /> {t("Favoris")}
        </button>
        <button className={"fchip" + (filter.todo ? " on" : "")} aria-pressed={filter.todo} onClick={() => onFilter({ ...filter, todo: !filter.todo })}>
          {t("Pas encore vus")}
        </button>
        {hasAdded && (
          <button className={"fchip" + (filter.added ? " on" : "")} aria-pressed={!!filter.added} onClick={() => onFilter({ ...filter, added: !filter.added })}>
            {t("Mes ajouts")}
          </button>
        )}
        {types.map((ty) => (
          <button key={ty} className={"fchip" + (filter.types.has(ty) ? " on" : "")} aria-pressed={filter.types.has(ty)} onClick={() => toggleType(ty)}>
            {t(TYPE_LABEL[ty] || ty)}
          </button>
        ))}
      </div>
      <div className="progress" style={{ padding: "0 18px 6px" }} aria-label={t("{n} lieux visités sur {total}", { n: visited, total: all.length })}>
        <span className="num">
          {t("{n} / {total} visités", { n: visited, total: all.length })}
        </span>
        <div className="bar">
          <span style={{ width: `${all.length ? (visited / all.length) * 100 : 0}%` }} />
        </div>
      </div>

      {!groups.length && !pinItems.length && (
        <div className="empty">
          <b>{t("Aucun lieu")}</b>
          {t("Changez la recherche ou les filtres.")}
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
                <PhThumb photo={p.photo} label={(p.name[0] || "·").toUpperCase()} size={40} />
                <span className="row-main">
                  <span className="row-name">{p.name}</span>
                  <span className="row-meta">
                    {s?.appt ? t("RDV {appt}", { appt: s.appt }) : [p.time, t(TYPE_LABEL[p.type] || p.type), !p.time && p.added ? p.why || p.desc || p.added.note : ""].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="row-tags">
                  {p.added && <span className="row-new" title={t("Ajouté dans l'app")}>{t("Ajout")}</span>}
                  {s?.favorite && <IStarFill aria-label={t("Favori")} />}
                  {(() => {
                    const v = votesOf(s as Record<string, unknown> | undefined);
                    const net = v.up.length - v.down.length;
                    return v.up.length || v.down.length ? <span className={"row-vote" + (net < 0 ? " neg" : "")} title={t("{up} pour · {down} contre", { up: v.up.length, down: v.down.length })}>{net > 0 ? `+${net}` : net}</span> : null;
                  })()}
                  {st && <span className="sdot" title={t(st.label)} style={{ ["--c" as string]: st.color }} />}
                  {ls && ls.tone === "bad" && <span className="row-closed">{t("Fermé")}</span>}
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
            <span className="label">{t("Mes lieux")}</span>
            <span>{t("Ajoutés sur la carte")}</span>
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
      {!near && <RemovedList trip={trip} />}
      <div style={{ height: 20 }} />
    </div>
  );
}
