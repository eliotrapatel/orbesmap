import { useState, useSyncExternalStore } from "react";
import type { Place, Trip } from "../data/types";
import { ai, AiError } from "../lib/ai";
import { buildLive, buildStable } from "../lib/carnet";
import { getLoc, startLocate, useLoc } from "../lib/locate";
import type { Pin } from "../lib/model";
import { getState, useStore } from "../lib/store";
import { useWeather, type Wx } from "../lib/weather";
import { IPin } from "./Icons";

type Ref = { kind: "place" | "pin"; id: string };
type Turn = { q: string; a: string; refs: Ref[]; at: number; err?: boolean; pending?: boolean };
const KEY = "orbes.ask.v1";
const SUGGESTIONS = [
  "On fait quoi demain ?",
  "Qu'est-ce qui est ouvert près de moi maintenant ?",
  "Quelles réservations me restent à faire ?",
  "Résume nos notes et nos coups de cœur",
  "Où était le cuir le moins cher ?",
  "Qu'est-ce qui ferme tôt cette semaine ?",
];

// ---------- conversation store (outside the panel: closing it during an answer loses nothing) ----------
const subs = new Set<() => void>();
const cache = new Map<string, Turn[]>();
function read(tripId: string): Turn[] {
  if (!cache.has(tripId)) {
    let t: Turn[] = [];
    try {
      t = JSON.parse(localStorage.getItem(`${KEY}.${tripId}`) || "[]");
    } catch {
      /* ignore */
    }
    // an answer still "pending" from an earlier session never came back
    cache.set(tripId, t.map((x) => (x.pending && Date.now() - x.at > 120_000 ? { ...x, pending: false, err: true, a: "Réponse perdue (app fermée pendant l'attente). Réessayez." } : x)));
  }
  return cache.get(tripId)!;
}
function write(tripId: string, turns: Turn[]) {
  const t = turns.slice(-30);
  cache.set(tripId, t);
  try {
    localStorage.setItem(`${KEY}.${tripId}`, JSON.stringify(t));
  } catch {
    /* storage full: kept in memory */
  }
  subs.forEach((f) => f());
}
function useTurns(tripId: string): Turn[] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => read(tripId),
  );
}

async function send(trip: Trip, question: string, wx: Wx | null) {
  const text = question.trim();
  const turns = read(trip.id);
  if (!text || turns.some((t) => t.pending)) return;
  const at = Date.now();
  write(trip.id, [...turns, { q: text, a: "", refs: [], at, pending: true }]);
  // "près de moi" without a position: ask for it (no prompt if already allowed)
  if (/près|proche|autour|ici/i.test(text) && getLoc().status === "off") startLocate(false, false);
  const replace = (t: Turn) => write(trip.id, read(trip.id).map((x) => (x.at === at ? t : x)));
  try {
    const s = getState();
    const loc = getLoc();
    const context = buildStable(trip, s.data, s.settings);
    const live = buildLive(trip, s.data, loc.fix, loc.stale, wx, { state: s.session ? s.sync : "local", pending: s.pending });
    const fmt = (ms: number) => new Intl.DateTimeFormat("fr-FR", { timeZone: trip.timezone, weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(ms);
    // only recent exchanges (the same day): older answers depended on another moment
    const history = turns.filter((t) => !t.err && !t.pending && Date.now() - t.at < 6 * 3600e3).slice(-6).map((t) => ({ q: t.q, a: t.a, at: fmt(t.at) }));
    const r = await ai<{ answer: string; refs: Ref[] }>("ask", { question: text, context, live, history }, 100_000);
    replace({ q: text, a: r.answer || "Pas de réponse.", refs: r.refs || [], at });
  } catch (e) {
    replace({ q: text, a: e instanceof AiError ? e.message : "La question n'a pas pu être envoyée. Réessayez.", refs: [], at, err: true });
  }
}

/** Light formatting, line by line: bullet lines become a list, other lines paragraphs; **bold** markers removed */
function Answer({ text }: { text: string }) {
  const lines = text.replace(/\*\*(.+?)\*\*/g, "$1").split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(<p key={out.length}>{para.join(" ")}</p>);
    if (list.length) out.push(<ul key={out.length}>{list.map((l, k) => <li key={k}>{l}</li>)}</ul>);
    para = [];
    list = [];
  };
  for (const raw of lines) {
    const l = raw.trim();
    const m = l.match(/^([-•*]|\d+[.)])\s+(.*)$/);
    if (!l) flush();
    else if (m) {
      if (para.length) {
        out.push(<p key={out.length}>{para.join(" ")}</p>);
        para = [];
      }
      list.push(m[2]);
    } else {
      if (list.length) {
        out.push(<ul key={out.length}>{list.map((x, k) => <li key={k}>{x}</li>)}</ul>);
        list = [];
      }
      para.push(l);
    }
  }
  flush();
  return <>{out}</>;
}

/** "Demander au carnet": read-only assistant that knows the whole notebook. */
export default function Ask({ trip, onOpenPlace, onOpenPin }: { trip: Trip; onOpenPlace: (p: Place) => void; onOpenPin: (p: Pin) => void }) {
  const pins = useStore((s) => s.data.pins);
  useLoc((s) => s.status);
  const wx = useWeather(trip.center[1], trip.center[0], trip.timezone);
  const turns = useTurns(trip.id);
  const [q, setQ] = useState("");
  const busy = turns.some((t) => t.pending);

  const ask = (question = q) => {
    if (!question.trim() || busy) return;
    setQ("");
    send(trip, question, wx);
  };

  // cited places: found by id in the programme or in my places (whatever "kind" says), no duplicates
  const resolve = (refs: Ref[]) => {
    const seen = new Set<string>();
    return refs
      .filter((r) => r && r.id && !seen.has(r.id) && (seen.add(r.id), true))
      .map((r) => {
        const place = trip.places.find((p) => p.id === r.id);
        if (place) return <button key={r.id} className="btn-sm" onClick={() => onOpenPlace(place)}><IPin /> {place.name}</button>;
        const pin = pins.find((p) => p.id === r.id);
        return pin ? <button key={r.id} className="btn-sm" onClick={() => onOpenPin(pin)}><IPin /> {pin.name}</button> : null;
      })
      .filter(Boolean)
      .slice(0, 8);
  };

  return (
    <div className="ask">
      <p className="ask-intro">
        Posez une question sur votre carnet : programme, horaires, réservations, vos notes, fournisseurs, check-list. L'assistant lit tout mais <b>ne modifie rien</b>.
      </p>
      {!turns.length && (
        <div className="ask-sugg">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="fchip" onClick={() => ask(s)} disabled={busy}>{s}</button>
          ))}
        </div>
      )}
      <div className="ask-thread">
        {turns.map((t) => {
          const refs = resolve(t.refs);
          return (
            <div key={t.at} className="ask-turn">
              <div className="ask-q">{t.q}</div>
              {t.pending ? (
                <div className="tr-loading"><span className="spin" /> Lecture du carnet… (vous pouvez fermer ce panneau)</div>
              ) : (
                <div className={"ask-a" + (t.err ? " err" : "")}>
                  <Answer text={t.a} />
                  {refs.length > 0 && <div className="ask-refs">{refs}</div>}
                  {t.err && (
                    <button className="btn-sm" onClick={() => { write(trip.id, read(trip.id).filter((x) => x.at !== t.at)); ask(t.q); }}>Réessayer</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. « Qu'avons-nous noté sur le Bund ? »" enterKeyHint="send" aria-label="Votre question" />
        <button className="btn primary" disabled={busy || !q.trim()}>Demander</button>
      </form>
      {turns.length > 0 && !busy && (
        <button className="btn-sm ask-clear" onClick={() => write(trip.id, [])}>Effacer la discussion</button>
      )}
      <p className="em-small">Chaque question envoie le carnet complet (notes, contacts et assurance compris) au service IA, en lecture seule. Environ 0,1 à 0,4 centime par question. Il faut du réseau (eSIM ou VPN en Chine).</p>
    </div>
  );
}
