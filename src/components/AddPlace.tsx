import { useEffect, useMemo, useRef, useState } from "react";
import type { Trip } from "../data/types";
import { km } from "../lib/geo";
import { useLoc } from "../lib/locate";
import { findExisting, placeSearch, runPlaceSearch, stopPlaceSearch, usePlaceSearch, type Found } from "../lib/placeSearch";
import { fmtDistance } from "../lib/route";
import { useStore } from "../lib/store";
import { ICamera, ICheck } from "./Icons";
import { Modal } from "./ui";

export type { Found };

const EXAMPLES = ["Un bar à cocktails calme près du Bund", "Où acheter du beau cuir à Jing'an", "Dim sum ouvert après 22h", "Speak Low"];

export default function AddPlace({ trip, onClose, onAdd, onOpenExisting }: { trip: Trip; onClose: () => void; onAdd: (list: Found[]) => void; onOpenExisting: (e: NonNullable<Found["existing"]>) => void }) {
  const fix = useLoc((s) => s.fix);
  const pins = useStore((s) => s.data.pins);
  const states = useStore((s) => s.data.places);
  const st = usePlaceSearch();
  const [text, setText] = useState("");
  const [shot, setShot] = useState<File | null>(null);
  const [nearMe, setNearMe] = useState(false);
  const [now, setNow] = useState(Date.now());
  const file = useRef<HTMLInputElement>(null);

  // the search lives outside this window: closing it keeps the search running
  useEffect(() => {
    placeSearch.setOpen(true);
    return () => placeSearch.setOpen(false);
  }, []);
  // results of another trip (switched meanwhile) are dropped; a day key of another trip falls back to "Pistes"
  useEffect(() => {
    if (st.res && st.tripId && st.tripId !== trip.id) placeSearch.reset();
    if (!trip.days.some((d) => d.key === st.day)) placeSearch.setDay(trip.days.some((d) => d.key === "ideas") ? "ideas" : trip.days[trip.days.length - 1].key);
  }, [trip.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!st.busy) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [st.busy]);

  const find = (q = text) => {
    if (st.busy || (!q.trim() && !shot)) return;
    runPlaceSearch({ trip, pins, text: q, shot, near: nearMe && fix ? { lat: fix.lat, lng: fix.lng } : undefined });
  };
  const secs = Math.max(0, Math.round((now - st.startedAt) / 1000));
  const days = trip.days.filter((d) => d.key !== "base");
  // "already on the map" is recomputed live (my father may have added it meanwhile)
  const res = useMemo(
    () => (st.res ? { ...st.res, items: st.res.items.map((f) => ({ ...f, existing: findExisting(f, trip, pins, states) })) } : null),
    [st.res, trip, pins, states],
  );
  const chosen = res ? res.items.filter((_, i) => st.picked.includes(i)) : [];
  const from = fix || trip.hotel;
  const xhs = /xhslink|xiaohongshu/i.test(text);

  return (
    <Modal title="Ajouter un lieu" intro={res ? undefined : "Lien, nom ou envie : l'app trouve le lieu ou vous propose des adresses."} onClose={onClose} className="modal-ap">
      {!res ? (
        <form onSubmit={(e) => { e.preventDefault(); find(); }} className="ap-form">
          <textarea
            className="input"
            rows={3}
            value={text}
            enterKeyHint="search"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                find();
              }
            }}
            placeholder="ex. « un rooftop pour le coucher du soleil », « Speak Low », ou un lien"
            aria-label="Lien, nom ou description"
            disabled={st.busy}
          />
          {!st.busy && (
            <div className="ap-examples" aria-label="Exemples">
              {EXAMPLES.map((x) => (
                <button type="button" key={x} className="fchip" onClick={() => { setText(x); find(x); }}>{x}</button>
              ))}
            </div>
          )}
          <div className="em-actions">
            <button type="button" className="btn-sm" onClick={() => file.current?.click()} disabled={st.busy}><ICamera /> {shot ? "Capture ajoutée ✓" : "Capture d'écran"}</button>
            {shot && !st.busy && <button type="button" className="btn-sm" onClick={() => setShot(null)}>Retirer</button>}
            {fix && (
              <label className="ap-near">
                <input type="checkbox" checked={nearMe} onChange={(e) => setNearMe(e.target.checked)} disabled={st.busy} /> Près de moi
              </label>
            )}
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { setShot(e.target.files?.[0] || null); e.target.value = ""; }} />
          {xhs && <p className="tr-hint">Les liens Xiaohongshu ne s'ouvrent souvent qu'avec l'app : une capture du post marche mieux.</p>}
          {st.busy && (
            <div className="tr-loading">
              <span className="spin" /> {secs < 45 ? "Recherche sur le web" : "Vérification des adresses"}… {secs} s
              <small>Vous pouvez fermer cette fenêtre (gardez l'app ouverte) : vous serez prévenu quand c'est prêt.</small>
            </div>
          )}
          {st.err && !st.busy && <p className="tr-err">{st.err}</p>}
          <div className="btn-row ap-foot">
            {st.busy ? (
              <button type="button" className="btn" onClick={stopPlaceSearch}>Arrêter</button>
            ) : (
              <button type="button" className="btn" onClick={onClose}>Fermer</button>
            )}
            <button type="submit" className="btn primary" disabled={st.busy || (!text.trim() && !shot)}>{st.busy ? "Recherche…" : "Trouver"}</button>
          </div>
        </form>
      ) : (
        <>
          {res.message && <p className="ap-msg">{res.message}</p>}
          <div className="ap-list">
            {res.items.map((p, i) => {
              const on = st.picked.includes(i);
              const canPick = res.kind !== "precise";
              const dist = p.ll ? fmtDistance(km(from, { lat: p.ll[1], lng: p.ll[0] }) * 1000) : null;
              return (
                <div
                  key={i}
                  className={"ap-item" + (on ? " on" : "") + (p.existing ? " dup" : "")}
                  role={canPick ? "checkbox" : undefined}
                  aria-checked={canPick ? on : undefined}
                  tabIndex={canPick ? 0 : undefined}
                  onClick={() => canPick && placeSearch.toggle(i)}
                  onKeyDown={(e) => {
                    if (canPick && (e.key === " " || e.key === "Enter")) {
                      e.preventDefault();
                      placeSearch.toggle(i);
                    }
                  }}
                >
                  {res.kind !== "precise" && <span className="ck-box">{on && <ICheck />}</span>}
                  <span className="ap-main">
                    <span className="ap-title">
                      <b>{p.name}</b>
                      {p.nameCn && <span className="zh" lang="zh-CN">{p.nameCn}</span>}
                      {p.confidence !== "haute" && <em className="ap-badge">à vérifier</em>}
                    </span>
                    {(p.why || p.desc) && <span className="ap-why">{p.why || p.desc}</span>}
                    <span className="ap-meta">
                      {p.existing && <em className="ap-dup">Peut-être déjà sur la carte : {p.existing.name} · </em>}
                      {dist ? `${dist} ${fix ? "de vous" : "de l'hôtel"}` : p.hint ? "Position approximative : à placer à la main" : "Position à placer à la main"}
                      {p.price ? ` · ${p.price}` : ""}
                    </span>
                    {p.existing && (
                      <span className="em-actions" style={{ marginTop: 4 }}>
                        <button type="button" className="btn-sm" onClick={(e) => { e.stopPropagation(); onOpenExisting(p.existing!); }}>Voir {p.existing.name}</button>
                        {res.kind === "precise" && !on && <button type="button" className="btn-sm" onClick={(e) => { e.stopPropagation(); placeSearch.toggle(i); }}>Ajouter quand même</button>}
                      </span>
                    )}
                    {p.source && (
                      <a className="ap-src" href={p.source} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>
                        Voir la source › {(() => { try { return new URL(p.source).hostname.replace(/^www\./, ""); } catch { return ""; } })()}
                      </a>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="ap-foot">
            <label className="ap-day">
              <span>Ranger dans</span>
              <select className="input" value={st.day} onChange={(e) => placeSearch.setDay(e.target.value)}>
                {days.map((d) => <option key={d.key} value={d.key}>{d.dates?.[0] ? `${d.short} · ${d.theme}` : d.title}</option>)}
              </select>
            </label>
            <div className="btn-row">
              <button type="button" className="btn" onClick={() => placeSearch.reset()}>Autre recherche</button>
              <button
                type="button"
                className="btn primary"
                disabled={!chosen.length}
                onClick={() => {
                  onAdd(chosen.map((c) => ({ ...c, day: st.day })));
                  // places saved now leave the list; those to place by hand stay until placed
                  placeSearch.removeItems(chosen.filter((c) => c.ll).map((c) => c.name));
                }}
              >
                {!chosen.length
                  ? res.kind === "precise" ? "Déjà sur la carte ?" : "Cochez des lieux"
                  : chosen.length === 1 ? (chosen[0].ll ? "Ajouter sur la carte" : "Placer sur la carte") : `Ajouter les ${chosen.length} lieux`}
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
