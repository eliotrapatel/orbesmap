import { useRef, useState } from "react";
import type { Trip } from "../data/types";
import { ai, AiError, imageToBase64, type PlaceItem, type PlacesResult } from "../lib/ai";
import { km, toWgs } from "../lib/geo";
import { useLoc } from "../lib/locate";
import { fmtDistance } from "../lib/route";
import { ICamera, ICheck } from "./Icons";
import { Modal } from "./ui";

export type Found = PlaceItem & { ll: [number, number] | null; day: string };

/** Free geocoder (OpenStreetMap) for when the AI found an address but no reliable coordinates. */
async function geocode(q: string, center: [number, number]): Promise<[number, number] | null> {
  if (q.trim().length < 2) return null;
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), 6000);
  try {
    const vb = `${center[0] - 0.7},${center[1] + 0.7},${center[0] + 0.7},${center[1] - 0.7}`;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh,en&countrycodes=cn&viewbox=${vb}&bounded=1&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
    const j = await r.json();
    const hit = j[0];
    // a whole city / district is not a place: let the user put the pin instead
    if (!hit || ["city", "state", "county", "district", "suburb", "province", "region", "country"].includes(hit.addresstype)) return null;
    return [+hit.lon, +hit.lat];
  } catch {
    return null;
  } finally {
    window.clearTimeout(t);
  }
}

/** WGS-84 position of a found place: from the AI's coordinates (converted), else from its address on OpenStreetMap. */
async function locate(p: PlaceItem, trip: Trip): Promise<[number, number] | null> {
  const far = (ll: [number, number]) => Math.abs(ll[1] - trip.center[1]) > 3 || Math.abs(ll[0] - trip.center[0]) > 3;
  if (p.coordSystem !== "none" && p.lat && p.lng) {
    const w = toWgs(p.lat, p.lng, p.coordSystem);
    const ll: [number, number] = [w.lng, w.lat];
    if (!far(ll)) return ll;
  }
  return (await geocode(p.addressCn, trip.center)) || (p.nameCn ? await geocode(p.nameCn, trip.center) : null);
}

const EXAMPLES = ["un bar à cocktails calme près du Bund", "où acheter du beau cuir à Jing'an", "dim sum ouvert après 22h", "Speak Low"];

export default function AddPlace({ trip, onClose, onAdd }: { trip: Trip; onClose: () => void; onAdd: (list: Found[]) => void }) {
  const fix = useLoc((s) => s.fix);
  const [text, setText] = useState("");
  const [shot, setShot] = useState<File | null>(null);
  const [nearMe, setNearMe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ kind: "precise" | "suggestions"; message: string; items: Found[] } | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [day, setDay] = useState("ideas");
  const file = useRef<HTMLInputElement>(null);

  const find = async () => {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const url = text.match(/https?:\/\/\S+/)?.[0] || "";
      const rest = url ? text.replace(url, "").trim() : text.trim();
      const image = shot ? await imageToBase64(shot, 1600, 0.8) : undefined;
      const near = nearMe && fix ? { lat: fix.lat, lng: fix.lng, label: "ma position actuelle" } : undefined;
      const known = trip.places.filter((p) => p.type !== "transport" && p.type !== "hotel").map((p) => p.name);
      const r = await ai<PlacesResult>("place", { url, text: rest, image, near, known }, 280_000);
      const places = (r.places || []).filter((p) => p.name || p.nameCn).slice(0, 6);
      if (r.kind === "not_found" || !places.length) {
        setErr(r.message || "Rien trouvé. Essayez avec plus de détails, un nom précis ou une capture d'écran.");
        return;
      }
      const items = await Promise.all(places.map(async (p) => ({ ...p, ll: await locate(p, trip), day })));
      const kind = r.kind === "precise" && items.length === 1 ? "precise" : "suggestions";
      setRes({ kind, message: r.message, items });
      setPicked(new Set(kind === "precise" ? [0] : []));
    } catch (e) {
      setErr(e instanceof AiError ? e.message : "La recherche a échoué. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (i: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const days = trip.days.filter((d) => d.key !== "base");
  const chosen = res ? res.items.filter((_, i) => picked.has(i)) : [];
  const from = fix || trip.hotel;

  return (
    <Modal
      title="Ajouter un lieu"
      intro="Collez un lien (Xiaohongshu, Dianping, Instagram, article), écrivez le nom d'un lieu, ou décrivez ce que vous cherchez : l'app trouve le lieu, ou vous propose plusieurs adresses."
      onClose={onClose}
    >
      {!res ? (
        <form onSubmit={(e) => { e.preventDefault(); if (!busy) find(); }}>
          <label className="field">
            <span>Lien, nom ou description</span>
            <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="ex. « un bar à cocktails calme près du Bund », « Speak Low », ou un lien" />
          </label>
          <div className="ap-examples">
            {EXAMPLES.map((x) => (
              <button type="button" key={x} className="fchip" onClick={() => setText(x)}>{x}</button>
            ))}
          </div>
          <div className="em-actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn-sm" onClick={() => file.current?.click()}><ICamera /> {shot ? "Capture ajoutée ✓" : "Ajouter une capture d'écran"}</button>
            {shot && <button type="button" className="btn-sm" onClick={() => setShot(null)}>Retirer</button>}
            {fix && (
              <label className="ap-near">
                <input type="checkbox" checked={nearMe} onChange={(e) => setNearMe(e.target.checked)} /> Près de moi
              </label>
            )}
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { setShot(e.target.files?.[0] || null); e.target.value = ""; }} />
          <p className="tr-hint" style={{ marginTop: 10 }}>Les liens Xiaohongshu ne s'ouvrent souvent qu'avec l'app : une capture du post marche mieux.</p>
          {busy && <div className="tr-loading"><span className="spin" /> Recherche sur le web (souvent 20 à 90 s)…</div>}
          {err && <p className="tr-err">{err}</p>}
          <div className="btn-row">
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn primary" disabled={busy || (!text.trim() && !shot)}>{busy ? "Recherche…" : "Trouver"}</button>
          </div>
        </form>
      ) : (
        <div>
          {res.message && <p className="ap-msg">{res.message}</p>}
          <div className="ap-list">
            {res.items.map((p, i) => {
              const on = picked.has(i);
              return (
                <button key={i} type="button" className={"ap-item" + (on ? " on" : "")} aria-pressed={on} onClick={() => (res.kind === "precise" ? null : toggle(i))}>
                  {res.kind !== "precise" && <span className="ck-box">{on && <ICheck />}</span>}
                  <span className="ap-main">
                    <b>{p.name}</b>
                    {p.nameCn && <span className="zh" lang="zh-CN">{p.nameCn}</span>}
                    {p.why && <span className="ap-why">{p.why}</span>}
                    {p.desc && <span className="ap-desc">{p.desc}</span>}
                    <span className="ap-meta">
                      {p.ll ? `À ${fmtDistance(km(from, { lat: p.ll[1], lng: p.ll[0] }) * 1000)} ${fix ? "de vous" : "de l'hôtel"}` : "Position à placer à la main"}
                      {p.price ? ` · ${p.price}` : ""}
                      {p.hours ? ` · ${p.hours}` : ""}
                      {` · fiabilité ${p.confidence}`}
                    </span>
                    {(p.addressCn || p.address) && <span className="ap-addr">{p.address}{p.addressCn ? ` · ${p.addressCn}` : ""}</span>}
                    {p.source && (
                      <a className="ap-src" href={p.source} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>source</a>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <label className="field">
            <span>Ranger dans</span>
            <select className="input" value={day} onChange={(e) => setDay(e.target.value)}>
              {days.map((d) => <option key={d.key} value={d.key}>{d.dates?.[0] ? `${d.short} · ${d.theme}` : d.title}</option>)}
            </select>
          </label>
          {chosen.length > 1 && chosen.some((c) => !c.ll) && <p className="tr-hint">Les lieux sans position seront à placer un par un : ajoutez-les seuls.</p>}
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setRes(null)}>Chercher autre chose</button>
            <button
              type="button"
              className="btn primary"
              disabled={!chosen.length}
              onClick={() => onAdd(chosen.map((c) => ({ ...c, day })))}
            >
              {res.kind === "precise"
                ? chosen[0]?.ll ? "Ajouter sur la carte" : "Placer sur la carte"
                : chosen.length > 1 ? `Ajouter les ${chosen.length} lieux` : chosen.length === 1 ? "Ajouter ce lieu" : "Cochez des lieux"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
