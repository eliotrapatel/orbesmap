import { useRef, useState } from "react";
import type { Trip } from "../data/types";
import { ai, AiError, imageToBase64, type PlaceResult } from "../lib/ai";
import { toWgs } from "../lib/geo";
import { ICamera } from "./Icons";
import { Modal } from "./ui";

export type Found = PlaceResult & { ll: [number, number] | null; day: string };

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

export default function AddPlace({ trip, onClose, onAdd }: { trip: Trip; onClose: () => void; onAdd: (f: Found) => void }) {
  const [text, setText] = useState("");
  const [shot, setShot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<Found | null>(null);
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
      const r = await ai<PlaceResult>("place", { url, text: rest, image }, 200_000);
      if (!r.found) {
        setErr(r.message || "Lieu introuvable. Essayez avec une capture d'écran du post.");
        return;
      }
      let ll: [number, number] | null = null;
      if (r.coordSystem !== "none" && r.lat && r.lng) {
        const w = toWgs(r.lat, r.lng, r.coordSystem);
        ll = [w.lng, w.lat];
      }
      // sanity: inside China and near the trip, else try the address on OpenStreetMap
      const far = (p: [number, number]) => Math.abs(p[1] - trip.center[1]) > 3 || Math.abs(p[0] - trip.center[0]) > 3;
      if (!ll || far(ll)) ll = (await geocode(r.addressCn, trip.center)) || (r.nameCn ? await geocode(r.nameCn, trip.center) : null);
      setRes({ ...r, ll, day });
    } catch (e) {
      setErr(e instanceof AiError ? e.message : "La recherche a échoué. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  const days = trip.days.filter((d) => d.key !== "base");
  return (
    <Modal title="Ajouter un lieu depuis un lien" intro="Collez un lien Xiaohongshu, Dianping, Instagram ou un article, ou ajoutez une capture d'écran. L'app trouve l'adresse en chinois et place le lieu sur la carte." onClose={onClose}>
      {!res ? (
        <form onSubmit={(e) => { e.preventDefault(); if (!busy) find(); }}>
          <label className="field">
            <span>Lien ou texte</span>
            <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="https://www.xiaohongshu.com/… ou le nom du lieu" />
          </label>
          <div className="em-actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn-sm" onClick={() => file.current?.click()}><ICamera /> {shot ? "Capture ajoutée ✓" : "Ajouter une capture d'écran"}</button>
            {shot && <button type="button" className="btn-sm" onClick={() => setShot(null)}>Retirer</button>}
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { setShot(e.target.files?.[0] || null); e.target.value = ""; }} />
          <p className="tr-hint" style={{ marginTop: 10 }}>Les liens Xiaohongshu ne s'ouvrent souvent qu'avec l'app : une capture du post marche mieux.</p>
          {busy && <div className="tr-loading"><span className="spin" /> Recherche du lieu sur le web (souvent 20 à 60 s)…</div>}
          {err && <p className="tr-err">{err}</p>}
          <div className="btn-row">
            <button type="button" className="btn" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn primary" disabled={busy || (!text.trim() && !shot)}>Trouver</button>
          </div>
        </form>
      ) : (
        <div>
          <div className="card em-card">
            <h4>{res.name}</h4>
            {res.nameCn && <p lang="zh-CN" className="zh">{res.nameCn}</p>}
            <p>{res.address}</p>
            {res.addressCn && <p lang="zh-CN" className="zh">{res.addressCn}</p>}
            {res.desc && <p className="em-small">{res.desc}</p>}
            {res.hours && <p className="em-small">Horaires : {res.hours}</p>}
            <p className="em-small">
              Fiabilité : {res.confidence}
              {res.source && <> · <a href={res.source} target="_blank" rel="noopener">source</a></>}
            </p>
            {!res.ll && <p className="tr-err">Position introuvable : après « Ajouter », touchez la carte à l'endroit du lieu.</p>}
          </div>
          <label className="field">
            <span>Ranger dans</span>
            <select className="input" value={day} onChange={(e) => setDay(e.target.value)}>
              {days.map((d) => <option key={d.key} value={d.key}>{d.dates?.[0] ? `${d.short} · ${d.theme}` : d.title}</option>)}
            </select>
          </label>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setRes(null)}>Chercher autre chose</button>
            <button type="button" className="btn primary" onClick={() => onAdd({ ...res, day })}>{res.ll ? "Ajouter sur la carte" : "Placer sur la carte"}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
