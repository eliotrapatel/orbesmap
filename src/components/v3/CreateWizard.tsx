import { useEffect, useRef, useState } from "react";
import { ai, AiError, imageToBase64, type ExtractResult, type FixedItem, type IntakeResult } from "../../lib/ai";
import { dayCount, newTripRecord, searchCities, timezoneFor, type Destination } from "../../lib/newTrip";
import { geocode } from "../../lib/placeSearch";
import { createTrip, switchTrip, useStore } from "../../lib/store";
import type { Draft } from "../../lib/draft";
import { INTERESTS, PACES } from "./Onboarding";
import Shell from "./Shell";

type Card<T> = T & { keep: boolean };
type Wiz = {
  step: number;
  cities: Destination[];
  start: string;
  end: string;
  hotelName: string;
  hotelAddress: string;
  flights: ExtractResult["flights"];
  know: string;
  places: Card<IntakeResult["places"][number]>[];
  fixed: Card<FixedItem>[];
  wishes: Card<{ text: string }>[];
  pace: string;
  interests: string[];
  dayWishes: Record<string, string>;
};
const KEY = "orbes.wizard.v1";
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const WD = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const dayList = (start: string, end: string) => {
  if (!start || !end || end < start) return [];
  const n = Math.min(60, dayCount(start, end));
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.parse(start + "T12:00:00Z") + i * 864e5);
    return { iso: d.toISOString().slice(0, 10), label: `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}` };
  });
};
const flightLine = (f: ExtractResult["flights"][number]) => `${f.code} · ${f.from} → ${f.to}${f.departAt ? ` · ${f.departAt.slice(8, 10)}/${f.departAt.slice(5, 7)} ${f.departAt.slice(11, 16)}` : ""}`;

/** "Créer un voyage" in 4 steps: where, when (+ bookings read from a confirmation), what you already know, the ideal programme */
export default function CreateWizard({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const profile = useStore((s) => s.profile);
  const [w, setW] = useState<Wiz>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved?.step) return saved;
    } catch {
      /* ignore */
    }
    return {
      step: 1, cities: [], start: "", end: "", hotelName: "", hotelAddress: "", flights: [], know: "", places: [], fixed: [], wishes: [],
      pace: (profile.pace as string) || "balanced", interests: (profile.interests as string[]) || [], dayWishes: {},
    };
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(w));
    } catch {
      /* ignore */
    }
  }, [w]);
  const set = (p: Partial<Wiz>) => setW((x) => ({ ...x, ...p }));
  const close = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    onCancel();
  };
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={w.step === 1 ? close : () => set({ step: w.step - 1 })} aria-label={w.step === 1 ? "Fermer" : "Retour"}>{w.step === 1 ? "✕" : "‹"}</button>
      <div className="v3-stepper">
        {["Où", "Quand", "Vos infos", "Programme"].map((s, i) => <span key={s} className={i + 1 === w.step ? "on" : i + 1 < w.step ? "done" : ""}>{s}</span>)}
      </div>
    </div>
  );
  if (w.step === 1) return <Where w={w} set={set} top={top} />;
  if (w.step === 2) return <When w={w} set={set} top={top} />;
  if (w.step === 3) return <Know w={w} set={set} top={top} />;
  return <Programme w={w} set={set} top={top} onCreated={(id) => { try { localStorage.removeItem(KEY); } catch { /* ignore */ } onCreated(id); }} />;
}

type StepProps = { w: Wiz; set: (p: Partial<Wiz>) => void; top: React.ReactNode };

function Where({ w, set, top }: StepProps) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Destination[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) {
      setRes([]);
      return;
    }
    const c = new AbortController();
    setBusy(true);
    const t = window.setTimeout(async () => {
      const r = await searchCities(q, c.signal);
      if (!c.signal.aborted) {
        setRes(r);
        setBusy(false);
      }
    }, 400);
    return () => {
      window.clearTimeout(t);
      c.abort();
    };
  }, [q]);
  return (
    <Shell ring={false} top={top}>
      <h1 className="v3-d v3-h2" style={{ marginTop: 22 }}>Où allez-vous ?</h1>
      <p className="v3-lead" style={{ marginTop: 10 }}>Une ou plusieurs villes. La première est la base du voyage.</p>
      <label className="v3-field" style={{ marginTop: 16 }}>
        <span className="sr">Ajouter une ville</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ajouter une ville" autoComplete="off" />
      </label>
      {w.cities.length > 0 && (
        <div className="v3-chips" style={{ marginTop: 12 }}>
          {w.cities.map((c, i) => (
            <button key={`${c.name}${i}`} className="v3-chip on" onClick={() => set({ cities: w.cities.filter((_, k) => k !== i) })} aria-label={`Retirer ${c.name}`}>
              {i === 0 ? "◉ " : ""}{c.name} ✕
            </button>
          ))}
        </div>
      )}
      <ul className="v3-results">
        {busy && !res.length && <li className="v3-note">Recherche…</li>}
        {res.map((r) => (
          <li key={`${r.name}-${r.lat}`}>
            <button className="v3-res" onClick={() => { if (!w.cities.some((c) => c.name === r.name && c.country === r.country)) set({ cities: [...w.cities, r] }); setQ(""); setRes([]); }}>
              <b>{r.name}</b><small>{r.countryName || ""}</small><span className="v3-ck">＋</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="v3-spacer" />
      <button className="v3-btn" disabled={!w.cities.length} onClick={() => set({ step: 2 })}>Continuer{w.cities.length > 1 ? ` · ${w.cities.length} villes` : ""}</button>
    </Shell>
  );
}

function When({ w, set, top }: StepProps) {
  const [paste, setPaste] = useState("");
  const [shot, setShot] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const n = w.start && w.end && w.end >= w.start ? dayCount(w.start, w.end) : 0;
  const read = async () => {
    setBusy(true);
    setErr(null);
    try {
      const image = shot ? await imageToBase64(shot, 1600, 0.8) : undefined;
      const r = await ai<ExtractResult>("extract", { text: paste.trim(), image }, 100_000);
      const flights = [...w.flights, ...(r.flights || []).filter((f) => f.code && !w.flights.some((x) => x.code === f.code && x.departAt === f.departAt))].sort((a, b) => (a.departAt || "").localeCompare(b.departAt || ""));
      const patch: Partial<Wiz> = { flights };
      // dates from the flights when not set: arrival of the first, departure of the last
      if (!w.start && flights[0]?.arriveAt) patch.start = flights[0].arriveAt.slice(0, 10);
      if (!w.end && flights.length > 1 && flights[flights.length - 1].departAt) patch.end = flights[flights.length - 1].departAt.slice(0, 10);
      if (r.hotel?.name && !w.hotelName) {
        patch.hotelName = r.hotel.name;
        patch.hotelAddress = r.hotel.address || r.hotel.addressCn;
        if (!patch.start && !w.start && r.hotel.checkIn) patch.start = r.hotel.checkIn;
        if (!patch.end && !w.end && r.hotel.checkOut) patch.end = r.hotel.checkOut;
      }
      if (r.fixed?.length) patch.fixed = [...w.fixed, ...r.fixed.map((f) => ({ ...f, keep: true }))];
      set(patch);
      setPaste("");
      setShot(null);
      if (!r.flights?.length && !r.hotel?.name && !r.fixed?.length) setErr("Rien de lisible : collez le texte de la confirmation ou une capture plus nette.");
    } catch (e) {
      setErr(e instanceof AiError ? e.message : "La lecture a échoué. Réessayez.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell ring={false} top={top}>
      <h1 className="v3-d v3-h2" style={{ marginTop: 22 }}>Quand partez-vous ?</h1>
      <div className="v3-dates">
        <label className="v3-field col"><span>Arrivée</span><input type="date" value={w.start} onChange={(e) => set({ start: e.target.value, end: !w.end || w.end < e.target.value ? e.target.value : w.end })} /></label>
        <label className="v3-field col"><span>Départ</span><input type="date" value={w.end} min={w.start || undefined} onChange={(e) => set({ end: e.target.value })} /></label>
      </div>
      {n > 0 && <p className="v3-note">{n} jour{n > 1 ? "s" : ""} sur place</p>}

      <p className="v3-lbl" style={{ marginTop: 22 }}>Réservations</p>
      <div className="v3-paste">
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} placeholder="Collez une confirmation de vol, d'hôtel ou de restaurant" aria-label="Confirmation à lire" />
        <div className="v3-paste-bar">
          <button type="button" className="v3-chip" onClick={() => file.current?.click()}>{shot ? "Capture ajoutée ✓" : "＋ Capture"}</button>
          <span className="v3-grow" />
          <button type="button" className="v3-chip on" disabled={busy || (!paste.trim() && !shot)} onClick={() => void read()}>{busy ? "Lecture…" : "Lire"}</button>
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { setShot(e.target.files?.[0] || null); e.target.value = ""; }} />
      </div>
      {err && <p className="v3-err">{err}</p>}
      {w.flights.map((f, i) => (
        <div key={i} className="v3-xchip"><span>✈</span><span className="v3-grow">{flightLine(f)}</span><button aria-label="Retirer" onClick={() => set({ flights: w.flights.filter((_, k) => k !== i) })}>✕</button></div>
      ))}
      <label className="v3-field" style={{ marginTop: 10 }}>
        <span className="sr">Hôtel</span>
        <input value={w.hotelName} onChange={(e) => set({ hotelName: e.target.value })} placeholder="Hôtel (nom)" />
      </label>
      <label className="v3-field" style={{ marginTop: 8 }}>
        <span className="sr">Adresse de l'hôtel</span>
        <input value={w.hotelAddress} onChange={(e) => set({ hotelAddress: e.target.value })} placeholder="Adresse de l'hôtel (si vous l'avez)" />
      </label>
      <div className="v3-spacer" />
      <button className="v3-btn" disabled={!n} onClick={() => set({ step: 3 })}>Continuer</button>
    </Shell>
  );
}

function Know({ w, set, top }: StepProps) {
  const [shots, setShots] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const sort = async () => {
    setBusy(true);
    setErr(null);
    try {
      const results: IntakeResult[] = [];
      if (w.know.trim()) results.push(await ai<IntakeResult>("intake", { text: w.know.trim() }, 290_000));
      for (const f of shots) results.push(await ai<IntakeResult>("intake", { image: await imageToBase64(f, 1600, 0.8) }, 290_000));
      const places = [...w.places];
      const fixed = [...w.fixed];
      const wishes = [...w.wishes];
      for (const r of results) {
        for (const p of r.places || []) if (p.name && !places.some((x) => x.name.toLowerCase() === p.name.toLowerCase())) places.push({ ...p, keep: true });
        for (const f of r.fixed || []) if (f.name && !fixed.some((x) => x.name === f.name && x.date === f.date)) fixed.push({ ...f, keep: true });
        for (const t of r.wishes || []) if (t && !wishes.some((x) => x.text === t)) wishes.push({ text: t, keep: true });
      }
      set({ places, fixed, wishes });
      setShots([]);
      setMsg(results.map((r) => r.summary).filter(Boolean).join(" · ") || "C'est noté.");
    } catch (e) {
      setErr(e instanceof AiError ? e.message : "Le tri a échoué. Réessayez.");
    } finally {
      setBusy(false);
    }
  };
  const toggle = <K extends "places" | "fixed" | "wishes">(k: K, i: number) => set({ [k]: (w[k] as Card<object>[]).map((x, j) => (j === i ? { ...x, keep: !x.keep } : x)) } as Partial<Wiz>);
  const kept = w.places.filter((p) => p.keep).length + w.fixed.filter((f) => f.keep).length + w.wishes.filter((x) => x.keep).length;
  return (
    <Shell ring={false} top={top}>
      <h1 className="v3-d v3-h2" style={{ marginTop: 22 }}>Ce que vous savez déjà</h1>
      <p className="v3-lead" style={{ marginTop: 10 }}>Collez tout en vrac : texte, liens (Xiaohongshu, listes Google Maps, articles), captures, réservations, envies. L'IA trie.</p>
      <div className="v3-paste" style={{ marginTop: 14 }}>
        <textarea value={w.know} onChange={(e) => set({ know: e.target.value })} rows={6} placeholder="ex. Le Bund de nuit, des xiaolongbao près de Yuyuan. Restaurant réservé mercredi 19 h. https://…" aria-label="Ce que vous savez déjà" />
        <div className="v3-paste-bar">
          <button type="button" className="v3-chip" onClick={() => file.current?.click()} disabled={shots.length >= 3}>＋ Capture{shots.length ? ` (${shots.length})` : ""}</button>
          <span className="v3-grow" />
          <button type="button" className="v3-chip on" disabled={busy || (!w.know.trim() && !shots.length)} onClick={() => void sort()}>{busy ? "Tri en cours…" : "Trier"}</button>
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setShots((s) => [...s, f].slice(0, 3)); e.target.value = ""; }} />
      </div>
      {busy && <p className="v3-note">L'IA lit vos liens et vos captures… jusqu'à 2 minutes.</p>}
      {msg && !busy && <p className="v3-note">{msg}</p>}
      {err && <p className="v3-err">{err}</p>}
      {w.places.length > 0 && <p className="v3-lbl" style={{ marginTop: 18 }}>Lieux</p>}
      {w.places.map((p, i) => (
        <button key={`p${i}`} className={"v3-card" + (p.keep ? " on" : "")} onClick={() => toggle("places", i)} aria-pressed={p.keep}>
          <span className="v3-grow"><b>{p.mustSee && "★ "}{p.name}</b><small>{[p.city, p.why].filter(Boolean).join(" · ")}</small></span>
          <span className="v3-ck">{p.keep ? "✓" : ""}</span>
        </button>
      ))}
      {w.fixed.length > 0 && <p className="v3-lbl" style={{ marginTop: 18 }}>Réservations et rendez-vous</p>}
      {w.fixed.map((f, i) => (
        <button key={`f${i}`} className={"v3-card" + (f.keep ? " on" : "")} onClick={() => toggle("fixed", i)} aria-pressed={f.keep}>
          <span className="v3-grow"><b>{f.name}</b><small>{[f.date, f.time && `${f.time}${f.endTime ? `–${f.endTime}` : ""}`, f.notes].filter(Boolean).join(" · ")}</small></span>
          <span className="v3-tag gold">Fixe</span><span className="v3-ck">{f.keep ? "✓" : ""}</span>
        </button>
      ))}
      {w.wishes.length > 0 && <p className="v3-lbl" style={{ marginTop: 18 }}>Envies</p>}
      {w.wishes.map((x, i) => (
        <button key={`w${i}`} className={"v3-card" + (x.keep ? " on" : "")} onClick={() => toggle("wishes", i)} aria-pressed={x.keep}>
          <span className="v3-grow">{x.text}</span><span className="v3-ck">{x.keep ? "✓" : ""}</span>
        </button>
      ))}
      <div className="v3-spacer" />
      <button className="v3-btn" onClick={() => set({ step: 4 })}>{kept || w.know.trim() ? "Continuer" : "Passer cette étape"}</button>
    </Shell>
  );
}

function Programme({ w, set, top, onCreated }: StepProps & { onCreated: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const days = dayList(w.start, w.end);
  const go = async () => {
    if (busy || !w.cities.length) return;
    setBusy(true);
    const base = w.cities[0];
    // the hotel on the map: its address, else the city
    let hotelLL: [number, number] = [base.lng, base.lat];
    if (w.hotelAddress.trim() || w.hotelName.trim()) {
      const box: [number, number, number, number] = [base.lng - 0.6, base.lat - 0.6, base.lng + 0.6, base.lat + 0.6];
      const g = (w.hotelAddress.trim() && (await geocode(w.hotelAddress.trim(), box, new AbortController().signal, base.country || ""))) || (w.hotelName.trim() && (await geocode(`${w.hotelName.trim()} ${base.name}`, box, new AbortController().signal, base.country || "")));
      if (g) hotelLL = g.ll;
    }
    const rec = newTripRecord({ dest: base, start: w.start, end: w.end, hotel: w.hotelName });
    const flights = w.flights.map((f, i) => ({
      code: f.code, airline: f.airline, from: f.from, to: f.to, fromCity: f.fromCity, toCity: f.toCity, terminal: f.terminal || undefined,
      departAt: f.departAt || undefined, arriveAt: f.arriveAt || undefined,
      kind: i === w.flights.length - 1 && w.flights.length > 1 ? "departure" : "arrival",
      at: i === w.flights.length - 1 && w.flights.length > 1 ? f.departAt || f.arriveAt : f.arriveAt || f.departAt,
    }));
    const draft: Draft = {
      status: "preparing",
      cities: w.cities.map((c) => ({ name: c.name, lat: c.lat, lng: c.lng, country: c.country })),
      hotelText: [w.hotelName, w.hotelAddress].filter(Boolean).join(", "),
      pace: w.pace,
      interests: w.interests,
      wishes: w.wishes.filter((x) => x.keep).map((x) => x.text).concat(w.know.trim() && !w.places.length && !w.wishes.length ? [w.know.trim().slice(0, 1500)] : []),
      dayWishes: w.dayWishes,
      places: w.places.filter((p) => p.keep).map(({ keep: _k, ...p }) => p),
      fixed: w.fixed.filter((f) => f.keep).map(({ keep: _k, ...f }) => f),
      days: {},
    };
    const id = createTrip({
      ...rec,
      title: w.cities.map((c) => c.name).join(" · "),
      timezone: timezoneFor(base.country, base.lng),
      hotel: { name: w.hotelName.trim() || "Hôtel à préciser", lat: hotelLL[1], lng: hotelLL[0] },
      zones: w.cities.map((c) => ({ label: c.name, center: [c.lng, c.lat], zoom: 12 })),
      flights: flights.filter((f) => f.at),
      draft,
    });
    switchTrip(id);
    onCreated(id);
  };
  return (
    <Shell ring={false} top={top}>
      <h1 className="v3-d v3-h2" style={{ marginTop: 22 }}>Votre programme idéal</h1>
      <p className="v3-lbl" style={{ marginTop: 18 }}>Rythme</p>
      <div className="v3-seg" role="radiogroup" aria-label="Rythme">
        {PACES.map((p) => <button key={p.key} role="radio" aria-checked={w.pace === p.key} className={w.pace === p.key ? "on" : ""} onClick={() => set({ pace: p.key })}>{p.label}</button>)}
      </div>
      <p className="v3-lbl" style={{ marginTop: 18 }}>Centres d'intérêt {w.interests.length ? <span className="v3-tag dim">depuis votre profil</span> : null}</p>
      <div className="v3-chips" style={{ marginTop: 10 }}>
        {INTERESTS.map((x) => {
          const on = w.interests.includes(x);
          return <button key={x} aria-pressed={on} className={"v3-chip" + (on ? " on" : "")} onClick={() => set({ interests: on ? w.interests.filter((i) => i !== x) : [...w.interests, x] })}>{x}</button>;
        })}
      </div>
      <p className="v3-lbl" style={{ marginTop: 18 }}>Souhaits par jour (facultatif)</p>
      <div className="v3-wish">
        {days.map((d, i) => (
          <label key={d.iso} className="v3-wishrow">
            <span>{d.label}{i === 0 ? <small>Arrivée</small> : i === days.length - 1 ? <small>Départ</small> : null}</span>
            <input value={w.dayWishes[d.iso] || ""} onChange={(e) => set({ dayWishes: { ...w.dayWishes, [d.iso]: e.target.value } })} placeholder="Libre, l'IA propose" />
          </label>
        ))}
      </div>
      <div className="v3-spacer" />
      <button className="v3-btn" disabled={busy || !days.length} onClick={() => void go()}>{busy ? "Création…" : "✦ Préparer mon voyage"}</button>
    </Shell>
  );
}
