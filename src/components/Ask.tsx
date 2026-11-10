import { useEffect, useRef, useState } from "react";
import type { Place, Trip } from "../data/types";
import { ai, AiError } from "../lib/ai";
import { buildCarnet } from "../lib/carnet";
import { useLoc } from "../lib/locate";
import type { Pin } from "../lib/model";
import { useStore } from "../lib/store";
import { useWeather } from "../lib/weather";
import { IPin } from "./Icons";

type Ref = { kind: "place" | "pin"; id: string };
type Turn = { q: string; a: string; refs: Ref[]; at: number; err?: boolean };
const KEY = "orbes.ask.v1";
const SUGGESTIONS = [
  "On fait quoi demain ?",
  "Qu'est-ce qui est ouvert près de moi maintenant ?",
  "Quelles réservations me restent à faire ?",
  "Résume nos notes et nos coups de cœur",
  "Où était le cuir le moins cher ?",
  "Qu'est-ce qui ferme tôt cette semaine ?",
];

const readTurns = (tripId: string): Turn[] => {
  try {
    return JSON.parse(localStorage.getItem(`${KEY}.${tripId}`) || "[]");
  } catch {
    return [];
  }
};

/** Light formatting: paragraphs and "- " bullets */
function Answer({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((b, i) => {
        const lines = b.split("\n").filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*[-•]\s/.test(l)))
          return <ul key={i}>{lines.map((l, k) => <li key={k}>{l.replace(/^\s*[-•]\s/, "")}</li>)}</ul>;
        return <p key={i}>{lines.join(" ")}</p>;
      })}
    </>
  );
}

/** "Demander au carnet": read-only assistant that knows the whole notebook. */
export default function Ask({ trip, onOpenPlace, onOpenPin }: { trip: Trip; onOpenPlace: (p: Place) => void; onOpenPin: (p: Pin) => void }) {
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const fix = useLoc((s) => s.fix);
  const wx = useWeather(trip.center[1], trip.center[0], trip.timezone);
  const [turns, setTurns] = useState<Turn[]>(() => readTurns(trip.id));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(`${KEY}.${trip.id}`, JSON.stringify(turns.slice(-30)));
    } catch {
      /* storage full: keep in memory */
    }
    end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns, trip.id]);

  const ask = async (question = q) => {
    const text = question.trim();
    if (!text || busy) return;
    setQ("");
    setBusy(true);
    try {
      const context = buildCarnet(trip, data, settings, fix, wx);
      const history = turns.filter((t) => !t.err).slice(-6).map((t) => ({ q: t.q, a: t.a }));
      const r = await ai<{ answer: string; refs: Ref[] }>("ask", { question: text, context, history }, 90_000);
      setTurns((ts) => [...ts, { q: text, a: r.answer || "Pas de réponse.", refs: r.refs || [], at: Date.now() }]);
    } catch (e) {
      setTurns((ts) => [...ts, { q: text, a: e instanceof AiError ? e.message : "La question n'a pas pu être envoyée. Réessayez.", refs: [], at: Date.now(), err: true }]);
    } finally {
      setBusy(false);
    }
  };

  const refButton = (r: Ref, k: number) => {
    if (r.kind === "place") {
      const p = trip.places.find((x) => x.id === r.id);
      return p ? <button key={k} className="btn-sm" onClick={() => onOpenPlace(p)}><IPin /> {p.name}</button> : null;
    }
    const p = data.pins.find((x) => x.id === r.id);
    return p ? <button key={k} className="btn-sm" onClick={() => onOpenPin(p)}><IPin /> {p.name}</button> : null;
  };

  return (
    <div className="ask">
      <p className="ask-intro">
        Posez une question sur votre carnet : programme, horaires, réservations, vos notes et celles de votre père, fournisseurs, check-list. L'assistant lit tout mais <b>ne modifie rien</b>.
      </p>
      {!turns.length && (
        <div className="ask-sugg">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="fchip" onClick={() => ask(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      )}
      <div className="ask-thread">
        {turns.map((t) => (
          <div key={t.at} className="ask-turn">
            <div className="ask-q">{t.q}</div>
            <div className={"ask-a" + (t.err ? " err" : "")}>
              <Answer text={t.a} />
              {t.refs.length > 0 && <div className="ask-refs">{t.refs.slice(0, 8).map(refButton)}</div>}
            </div>
          </div>
        ))}
        {busy && <div className="tr-loading"><span className="spin" /> Lecture du carnet…</div>}
        <div ref={end} />
      </div>
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. « Qu'a noté papa sur le Bund ? »" enterKeyHint="send" aria-label="Votre question" />
        <button className="btn primary" disabled={busy || !q.trim()}>Demander</button>
      </form>
      {turns.length > 0 && (
        <button className="btn-sm ask-clear" onClick={() => setTurns([])}>Effacer la discussion</button>
      )}
      <p className="em-small">Chaque question envoie le carnet complet (notes, contacts et assurance compris) au service IA, en lecture seule. Environ 0,3 centime par question. Il faut du réseau (eSIM ou VPN en Chine).</p>
    </div>
  );
}
