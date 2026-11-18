import { track } from "../../lib/track";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MutableRefObject, type ReactNode } from "react";
import { ai, AiError, imageToBase64, type ExtractResult, type FixedItem, type IntakeResult } from "../../lib/ai";
import { dayCount, newTripRecord, searchCities, timezoneFor, type Destination } from "../../lib/newTrip";
import { geocode } from "../../lib/placeSearch";
import { createTrip, currentAuthor, getState, switchTrip, useStore, requestPro } from "../../lib/store";
import type { Draft } from "../../lib/draft";
import { INTERESTS, PACES } from "./Onboarding";
import Shell from "./Shell";
import { locale, t } from "../../lib/i18n";
import { CcArrow, CcBack, CcBed, CcCheck, CcClose, CcImg, CcLink, CcPin, CcPlane, CcPlus, CcSearch, CcSpark } from "./ConciergeIcons";
import "../../styles/creation.css";

export type Card<T> = T & { keep: boolean };
export type Wiz = {
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
  /** leisure or business (Pro) */
  mode?: "leisure" | "business";
  /** the first names of who travels with the account's owner (written into the trip's travellers) */
  travellers?: string[];
  /** the draft came from the concierge: its conversation is done with once the trip exists */
  from?: "concierge";
  /** the furthest step reached: every step up to it can be reopened from the step bar */
  maxStep?: number;
  /** the text of « Ce que vous savez déjà » as last sorted (never sorted twice) */
  sortedKnow?: string;
};
export const WIZARD_KEY = "orbes.wizard.v1";
/** The concierge's saved conversation (read here for the choice screen, cleared when its trip is created from the form) */
export const CONCIERGE_KEY = "orbes.concierge.v1";
const KEY = WIZARD_KEY;
// the way chosen last time (concierge or form), on this device; kept under "orbes.wizard." so signing out clears it
const LAST_KEY = "orbes.wizard.last";
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const WD = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const STEP_NAMES = ["Où", "Quand", "Vos infos", "Programme"];
const MAX_DAYS = 60;
const dayList = (start: string, end: string) => {
  if (!start || !end || end < start) return [];
  const n = Math.min(MAX_DAYS, dayCount(start, end));
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.parse(start + "T12:00:00Z") + i * 864e5);
    return { iso: d.toISOString().slice(0, 10), label: `${t(WD[d.getUTCDay()])} ${d.getUTCDate()} ${t(MONTHS[d.getUTCMonth()])}` };
  });
};

// ---------- shared with the concierge and the choice screen ----------

/** Something was entered in the form (an untouched form is not a draft) */
export function wizHasContent(w: Partial<Wiz> | null | undefined): boolean {
  return !!w && (!!w.cities?.length || !!w.start || !!w.know?.trim() || !!w.places?.length || !!w.fixed?.length || !!w.wishes?.length || !!w.flights?.length || !!w.hotelName?.trim() || !!w.travellers?.length);
}
/** The form's saved draft, if anything was entered in it */
export function wizardDraft(): Wiz | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    return saved?.step && wizHasContent(saved) ? (saved as Wiz) : null;
  } catch {
    return null;
  }
}
export function clearWizardDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
/** The way chosen last time ("concierge" or "form"), remembered on this device only */
export function lastWay(): "concierge" | "form" | null {
  try {
    const v = localStorage.getItem(LAST_KEY);
    return v === "concierge" || v === "form" ? v : null;
  } catch {
    return null;
  }
}
export function rememberWay(k: "concierge" | "form") {
  try {
    localStorage.setItem(LAST_KEY, k);
  } catch {
    /* ignore */
  }
}

export const URL_RE = /https?:\/\/[^\s<>"']+/g;
/** A link as the mockup shows it: the service's coloured tile, the title, the source underneath */
export function linkCard(u: string): { tile: "lg-x" | "lg-m" | "lg-s"; title: string; small: string } {
  let h = u;
  let path = "";
  try {
    const x = new URL(u);
    h = x.hostname.replace(/^www\./, "");
    path = decodeURIComponent(x.pathname + x.search).replace(/\/$/, "");
  } catch {
    /* keep the text */
  }
  if (/(^|\.)xiaohongshu\.com$|(^|\.)xhslink\.com$/.test(h)) return { tile: "lg-x", title: t("Lien Xiaohongshu"), small: h };
  if (/^maps\.google\.|^maps\.app\.goo\.gl$|^goo\.gl$/.test(h) || (/^google\./.test(h) && path.startsWith("/maps"))) return { tile: "lg-m", title: t("Liste Google Maps"), small: h };
  return { tile: "lg-s", title: h, small: path.length > 42 ? `${path.slice(0, 41)}…` : path };
}
/** The coloured tile of a link card */
export function LinkTile({ tile }: { tile: "lg-x" | "lg-m" | "lg-s" }) {
  return <span className={"lg " + tile}>{tile === "lg-x" ? "小红书" : tile === "lg-m" ? <CcPin className="cc-ic s" /> : <CcLink className="cc-ic s" />}</span>;
}

/** The on-screen keyboard: the page is fitted to what stays visible, so the bottom action sits right above the keys */
export function useKeyboardFit(selector: string) {
  useEffect(() => {
    const vv = window.visualViewport;
    const el = document.querySelector<HTMLElement>(selector);
    if (!vv || !el) {
      return;
    }
    const fit = () => {
      if (window.innerHeight - vv.height > 80) {
        el.style.top = `${vv.offsetTop}px`;
        el.style.height = `${vv.height}px`;
        el.style.bottom = "auto";
        el.classList.add("kb-open");
      } else {
        el.style.top = "";
        el.style.height = "";
        el.style.bottom = "";
        el.classList.remove("kb-open");
      }
    };
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    fit();
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      el.style.top = "";
      el.style.height = "";
      el.style.bottom = "";
      el.classList.remove("kb-open");
    };
  }, [selector]);
}

/** Online or not, kept up to date */
export function useOnline(): boolean {
  const [on, setOn] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return on;
}

// ---------- dates ----------

const pad = (n: number) => String(n).padStart(2, "0");
const todayIso = () => {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
};
const utc = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 12));
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
function fmt(iso: string, o: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale(), { ...o, timeZone: "UTC" }).format(utc(iso));
  } catch {
    return iso;
  }
}
/** "24–29 nov." (English "24–29 Nov"), "30 mars – 2 avr." */
export function rangeShort(start: string, end: string): string {
  if (!start || !end) return "";
  if (start.slice(0, 7) === end.slice(0, 7)) return `${+start.slice(8, 10)}–${fmt(end, { day: "numeric", month: "short" })}`;
  return `${fmt(start, { day: "numeric", month: "short" })} – ${fmt(end, { day: "numeric", month: "short" })}`;
}
const flightLine = (f: ExtractResult["flights"][number]) => `${f.code} · ${f.from} → ${f.to}`;
const flightWhen = (iso: string) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${fmt(iso.slice(0, 10), { weekday: "short", day: "numeric", month: "short" })}${iso.slice(11, 16) ? ` · ${iso.slice(11, 16)}` : ""}` : "");

/** The account owner's first name, the first of the trip's travellers */
function ownerFirstName(): string {
  const n = String(getState().profile.name || "").trim();
  return n.split(/\s+/)[0] || currentAuthor() || "";
}

// ---------- the form ----------

type StepProps = { w: Wiz; set: (p: Partial<Wiz>) => void; go: (step: number) => void; nextRef: MutableRefObject<() => void>; sorter: Sorter };

// ---------- sorting « Ce que vous savez déjà » ----------

type Shot = { id: string; url: string; state: "wait" | "read" | "ok" | "err" };
type Sorter = {
  shots: Shot[];
  busy: boolean;
  progress: { i: number; of: number } | null;
  msg: string | null;
  err: string | null;
  /** adds captures (read by the sorting going on, or by a new one) */
  add: (files: File[]) => void;
  /** sorts the text not sorted yet and the captures not read yet (failed ones are read again) */
  run: () => Promise<boolean>;
};
/** The text written since the last sorting, if any */
const pendingText = (w: Wiz) => {
  const k = w.know.trim();
  return k && k !== (w.sortedKnow || "").trim() ? k : "";
};
/** Sorting lives with the form, not with its step: it goes on when the person moves to the next step, and what it
 *  finds is merged into the draft as it is at that moment (never into an older copy) */
function useSorter(wRef: MutableRefObject<Wiz>, setW: (f: (x: Wiz) => Wiz) => void): Sorter {
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ i: number; of: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // the captures not read yet (a failed one stays here, to be read again)
  const files = useRef(new Map<string, File>());
  const running = useRef(false);
  const urls = useRef<string[]>([]);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => {
    ctl.current?.abort();
    urls.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  const mark = (ids: string[], state: Shot["state"]) => setShots((s) => s.map((x) => (ids.includes(x.id) ? { ...x, state } : x)));
  const merge = (r: IntakeResult, extra?: Partial<Wiz>) => setW((x) => {
    const places = [...x.places];
    const fixed = [...x.fixed];
    const wishes = [...x.wishes];
    const flights = [...x.flights];
    let hotelName = x.hotelName;
    let hotelAddress = x.hotelAddress;
    for (const f of r.flights || []) if (f.code && !flights.some((y) => y.code === f.code && y.departAt === f.departAt)) flights.push(f);
    if (r.hotel?.name && !hotelName) {
      hotelName = r.hotel.name;
      hotelAddress = r.hotel.address || r.hotel.addressCn || "";
    }
    for (const p of r.places || []) if (p.name && !places.some((y) => y.name.toLowerCase() === p.name.toLowerCase())) places.push({ ...p, keep: true });
    for (const f of r.fixed || []) if (f.name && !fixed.some((y) => y.name === f.name && y.date === f.date)) fixed.push({ ...f, keep: true });
    for (const y of r.wishes || []) if (y && !wishes.some((z) => z.text === y)) wishes.push({ text: y, keep: true });
    return { ...x, places, fixed, wishes, flights: flights.sort((a, b) => (a.departAt || "").localeCompare(b.departAt || "")), hotelName, hotelAddress, ...extra };
  });
  const run = async (): Promise<boolean> => {
    // a sorting is going on: the new captures are read by it
    if (running.current) return true;
    running.current = true;
    setBusy(true);
    setErr(null);
    setMsg(null);
    ctl.current = new AbortController();
    const signal = ctl.current.signal;
    const tried = new Set<string>();
    let textTried = false;
    let done = 0;
    let failure: unknown = null;
    const notes: string[] = [];
    const left = () => ({
      text: textTried ? "" : pendingText(wRef.current),
      ids: [...files.current.keys()].filter((id) => !tried.has(id)),
    });
    try {
      for (let l = left(); l.text || l.ids.length; l = left()) {
        setProgress({ i: done + 1, of: done + (l.text ? 1 : 0) + l.ids.length });
        const id = l.text ? "" : l.ids[0];
        try {
          if (l.text) {
            textTried = true;
            const r = await ai<IntakeResult>("intake", { text: l.text }, 290_000, signal);
            merge(r, { sortedKnow: l.text });
            if (r.summary) notes.push(r.summary);
          } else {
            tried.add(id);
            mark([id], "read");
            const r = await ai<IntakeResult>("intake", { image: await imageToBase64(files.current.get(id)!, 1600, 0.8) }, 290_000, signal);
            files.current.delete(id);
            mark([id], "ok");
            merge(r);
            if (r.summary) notes.push(r.summary);
          }
          done++;
        } catch (e) {
          if (signal.aborted) return false;
          failure = e;
          break;
        }
      }
      // what could not be read says so, and « Trier » reads it again
      if (failure) mark([...files.current.keys()], "err");
      if (failure && !done) {
        setErr(failure instanceof AiError ? failure.message : t("Le tri a échoué. Réessayez."));
        return false;
      }
      if (failure) setErr(failure instanceof AiError ? t("{msg} (le reste est gardé)", { msg: failure.message }) : t("Une partie n'a pas pu être triée (le reste est gardé)."));
      if (done) setMsg(notes.filter(Boolean).join(" · ") || t("C'est noté."));
      return true;
    } finally {
      running.current = false;
      ctl.current = null;
      if (!signal.aborted) {
        setBusy(false);
        setProgress(null);
      }
    }
  };
  const add = (list: File[]) => {
    const fresh = list.map((f) => {
      const id = Math.random().toString(36).slice(2, 10);
      const url = URL.createObjectURL(f);
      urls.current.push(url);
      files.current.set(id, f);
      return { id, url, state: "wait" as const };
    });
    setShots((s) => [...s, ...fresh]);
  };
  return { shots, busy, progress, msg, err, add, run };
}

/** "Créer un voyage" in 4 steps: where, when (+ bookings read from a confirmation), what you already know, the ideal programme.
 *  Every change is kept on this device as it is made: closing, going back or leaving the app loses nothing. */
export default function CreateWizard({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const profile = useStore((s) => s.profile);
  const [w, setW] = useState<Wiz>(() => wizardDraft() || {
    step: 1, cities: [], start: "", end: "", hotelName: "", hotelAddress: "", flights: [], know: "", places: [], fixed: [], wishes: [],
    pace: (profile.pace as string) || "balanced", interests: (profile.interests as string[]) || [], dayWishes: {},
    mode: profile.travel === "business" ? "business" : "leisure", travellers: [],
  });
  const [dir, setDir] = useState<1 | -1>(1);
  const nextRef = useRef<() => void>(() => undefined);
  const wRef = useRef(w);
  wRef.current = w;
  const sorter = useSorter(wRef, setW);
  useKeyboardFit(".v3.cr-wiz");
  // kept on this device as soon as something is entered (an untouched form leaves no draft behind)
  useEffect(() => {
    try {
      if (wizHasContent(w)) localStorage.setItem(KEY, JSON.stringify(w));
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, [w]);
  // each step starts at its top
  useEffect(() => {
    document.querySelector(".v3.cr-wiz")?.scrollTo({ top: 0 });
  }, [w.step]);
  const set = (p: Partial<Wiz>) => setW((x) => ({ ...x, ...p }));
  const go = (step: number) => {
    setDir(step >= w.step ? 1 : -1);
    setW((x) => ({ ...x, step, maxStep: Math.max(x.maxStep || x.step, step) }));
  };
  const hasContent = wizHasContent(w);
  const datesOk = !!w.start && !!w.end && w.end >= w.start && dayCount(w.start, w.end) <= MAX_DAYS;
  // a step can be reopened once reached, as long as the steps before it hold
  const reachable = (n: number) => n !== w.step && n <= Math.max(w.maxStep || w.step, w.step) && (n <= 1 || w.cities.length > 0) && (n <= 2 || datesOk);
  const title = w.step === 1 || !w.cities.length
    ? t("Nouveau voyage")
    : [w.cities.map((c) => c.name).join(" · "), w.step > 2 ? rangeShort(w.start, w.end) : ""].filter(Boolean).join(" · ");
  const closeBtn = <button className="v3-tool" onClick={onCancel} aria-label={t("Fermer (le brouillon est gardé)")}><CcClose /></button>;
  const top = (
    <div className="cr-top">
      <div className="cr-head">
        {w.step > 1 ? <button className="v3-tool" onClick={() => go(w.step - 1)} aria-label={t("Retour")}><CcBack /></button> : closeBtn}
        <div className="cr-ttl">
          <b>{title}</b>
          <small>
            <span className="cr-n">{w.step}/4</span>
            {hasContent && <span className="cr-saved"><i className="cr-dot" />{t("Brouillon enregistré")}</span>}
          </small>
        </div>
        {w.step > 1 ? closeBtn : <span className="v3-tool ghost" />}
      </div>
      <ol className="cr-stepper" aria-label={t("Étape {n} sur {of}", { n: w.step, of: 4 })}>
        {STEP_NAMES.map((s, i) => {
          const n = i + 1;
          const cls = n === w.step ? "on" : n < w.step || reachable(n) ? "done" : "";
          return (
            <li key={s} className={cls} aria-current={n === w.step ? "step" : undefined}>
              {reachable(n) ? <button type="button" onClick={() => go(n)}>{t(s)}</button> : <span>{t(s)}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
  // Enter continues from a field (Ctrl or Cmd + Enter from a text area); fields that use Enter themselves say so
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    const el = e.target as HTMLElement;
    if (el.dataset.enter === "own") return;
    const field = el.tagName === "TEXTAREA" ? e.metaKey || e.ctrlKey : el.tagName === "INPUT" && (el as HTMLInputElement).type !== "file";
    if (!field) return;
    e.preventDefault();
    nextRef.current();
  };
  const props = { w, set, go, nextRef, sorter };
  return (
    <Shell ring={false} top={top} className="cr-wiz">
      <div key={w.step} className="cr-step" style={{ "--dx": `${dir * 28}px` } as CSSProperties} onKeyDown={onKey}>
        {w.step === 1 ? <Where {...props} />
          : w.step === 2 ? <When {...props} />
            : w.step === 3 ? <Know {...props} />
              : <Programme {...props} onCreated={(id) => { clearWizardDraft(); onCreated(id); }} />}
      </div>
    </Shell>
  );
}

/** The bottom action: stays in reach (above the keys, inside the safe area), with what is missing said just above it */
function Foot({ hint, children, line }: { hint?: string | null; line?: ReactNode; children: ReactNode }) {
  return (
    <div className="cr-foot">
      {hint ? <p className="cr-hint" role="alert">{hint}</p> : line ? <p className="cr-line">{line}</p> : null}
      {children}
    </div>
  );
}

function Where({ w, set, go, nextRef }: StepProps) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Destination[]>([]);
  const [phase, setPhase] = useState<"idle" | "loading" | "done">("idle");
  const [hint, setHint] = useState<string | null>(null);
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  const s = q.trim();
  useEffect(() => {
    if (s.length < 2 || !online) {
      setRes([]);
      setPhase(s.length < 2 ? "idle" : "done");
      return;
    }
    const c = new AbortController();
    setPhase("loading");
    const tm = window.setTimeout(async () => {
      const r = await searchCities(s, c.signal);
      if (!c.signal.aborted) {
        setRes(r);
        setPhase("done");
      }
    }, 350);
    return () => {
      window.clearTimeout(tm);
      c.abort();
    };
  }, [s, online]);
  const has = (r: Destination) => w.cities.some((c) => c.name === r.name && c.country === r.country);
  const add = (r: Destination) => {
    if (!has(r)) set({ cities: [...w.cities, r] });
    setQ("");
    setHint(null);
    input.current?.focus();
  };
  const next = () => {
    if (!w.cities.length) {
      setHint(s.length >= 2 && res.length ? t("Choisissez une ville dans la liste.") : t("Ajoutez au moins une ville pour continuer."));
      input.current?.focus();
      return;
    }
    go(2);
  };
  useEffect(() => {
    nextRef.current = next;
  });
  return (
    <>
      <div className="cr-body">
        <h1 className="v3-d cr-h">{t("Où allez-vous ?")}</h1>
        <p className="v3-lead cr-lead">{t("Une ou plusieurs villes. La première est la base du voyage.")}</p>
        <label className="v3-field cr-search">
          <CcSearch className="cc-ic mute" />
          <span className="sr">{t("Ajouter une ville")}</span>
          <input ref={input} value={q} data-enter="own" autoFocus={!w.cities.length} enterKeyHint={s.length >= 2 ? "search" : "next"}
            onChange={(e) => { setQ(e.target.value); setHint(null); }} placeholder={w.cities.length ? t("Ajouter une autre ville") : t("Ajouter une ville")} autoComplete="off" autoCapitalize="words" spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQ("");
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              if (s.length >= 2 && res[0]) add(res[0]);
              else if (!s) next();
            }} />
          {q && <button type="button" className="cr-clear" onClick={() => { setQ(""); input.current?.focus(); }} aria-label={t("Effacer")}><CcClose className="cc-ic s" /></button>}
        </label>

        {s.length >= 2 && (
          <div className="cr-results" aria-live="polite">
            {phase === "loading" && !res.length && (
              <>
                <div className="cr-skel" aria-hidden="true"><i /><i /></div>
                <div className="cr-skel" aria-hidden="true"><i /><i /></div>
                <p className="sr">{t("Recherche…")}</p>
              </>
            )}
            {!online && <p className="cr-empty">{t("Pas de connexion. La recherche reprendra dès le retour du réseau.")}</p>}
            {online && phase === "done" && !res.length && <p className="cr-empty">{t("Aucune ville pour « {q} ». Essayez un autre nom, ou en anglais.", { q: s })}</p>}
            {res.length > 0 && (
              <ul className="cr-list">
                {res.map((r, i) => (
                  <li key={`${r.name}-${r.lat}-${r.lng}`} style={{ "--i": i } as CSSProperties}>
                    <button type="button" className={"cr-res" + (has(r) ? " on" : "")} onClick={() => add(r)}>
                      <span className="t"><b>{r.name}</b><small>{r.countryName || ""}</small></span>
                      {i === 0 && !has(r) && <kbd className="cr-kbd" aria-hidden="true">↵</kbd>}
                      <span className="pl">{has(r) ? <CcCheck className="cc-ic s" /> : <CcPlus className="cc-ic s" />}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {w.cities.length > 0 && (
          <>
            <p className="v3-lbl cr-sec">{w.cities.length > 1 ? t("{n} villes", { n: w.cities.length }) : t("Votre destination")}</p>
            <ol className="cr-cities">
              {w.cities.map((c, i) => (
                <li key={`${c.name}-${c.lat}-${c.lng}`} className="cr-city">
                  <span className="n">{i + 1}</span>
                  {i === 0 ? (
                    <span className="t"><b>{c.name}</b><small>{c.countryName || ""}</small></span>
                  ) : (
                    <button type="button" className="t" onClick={() => set({ cities: [c, ...w.cities.filter((_, k) => k !== i)] })} aria-label={t("Faire de {name} la base du voyage", { name: c.name })}>
                      <b>{c.name}</b><small>{c.countryName || ""}</small>
                    </button>
                  )}
                  {i === 0 && <span className="v3-tag dim">{t("Base")}</span>}
                  <button type="button" className="x" onClick={() => set({ cities: w.cities.filter((_, k) => k !== i) })} aria-label={t("Retirer {name}", { name: c.name })}><CcClose className="cc-ic s" /></button>
                </li>
              ))}
            </ol>
            {w.cities.length > 1 && <p className="v3-note">{t("Touchez une ville pour en faire la base du voyage.")}</p>}
          </>
        )}
      </div>
      <div className="v3-spacer" />
      <Foot hint={hint}>
        <button className={"v3-btn" + (w.cities.length ? "" : " cr-off")} aria-disabled={!w.cities.length} onClick={next}>
          {t("Continuer")}{w.cities.length > 1 ? ` · ${t("{n} villes", { n: w.cities.length })}` : ""}<CcArrow />
        </button>
      </Foot>
    </>
  );
}

/** A month at a time, Monday first: a touch for the arrival, a touch for the departure (flights marked in gold) */
function RangeCalendar({ start, end, marks, onPick }: { start: string; end: string; marks: Set<string>; onPick: (iso: string) => void }) {
  const today = todayIso();
  const [view, setView] = useState(() => (start || today).slice(0, 7));
  const [slide, setSlide] = useState(0);
  const [hover, setHover] = useState("");
  // a date found on a booking shows its month
  useEffect(() => {
    if (start && start.slice(0, 7) !== view && (!end || end.slice(0, 7) !== view)) setView(start.slice(0, 7));
  }, [start]); // eslint-disable-line react-hooks/exhaustive-deps
  const y = +view.slice(0, 4);
  const m = +view.slice(5, 7);
  const first = new Date(Date.UTC(y, m - 1, 1, 12));
  const lead = (first.getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0, 12)).getUTCDate();
  const month = (() => {
    try {
      return new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric", timeZone: "UTC" }).format(first);
    } catch {
      return view;
    }
  })();
  const heads = useMemo(() => Array.from({ length: 7 }, (_, i) => fmt(isoOf(new Date(Date.UTC(2024, 0, 1 + i, 12))), { weekday: "narrow" })), []);
  const move = (k: number) => {
    setSlide(k);
    setView(isoOf(new Date(Date.UTC(y, m - 1 + k, 1, 12))).slice(0, 7));
  };
  const until = end || (start && hover > start ? hover : "");
  return (
    <div className="cr-cal">
      <div className="cr-cal-h">
        <button type="button" className="cr-cal-nav" onClick={() => move(-1)} aria-label={t("Mois précédent")}><CcBack className="cc-ic s" /></button>
        <b aria-live="polite">{month}</b>
        <button type="button" className="cr-cal-nav" onClick={() => move(1)} aria-label={t("Mois suivant")}><CcBack className="cc-ic s flip" /></button>
      </div>
      <div className="cr-cal-w" aria-hidden="true">{heads.map((h, i) => <span key={i}>{h}</span>)}</div>
      <div key={view} className="cr-cal-g" style={{ "--dx": `${slide * 22}px` } as CSSProperties} onMouseLeave={() => setHover("")}>
        {Array.from({ length: lead }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: count }, (_, i) => {
          const iso = `${view}-${pad(i + 1)}`;
          const s = iso === start;
          const e = !!end && iso === end;
          const inside = !!start && !!until && iso > start && iso < until;
          const cls = [s && "s", (e || (!end && iso === until && !!start)) && "e", s && (iso === end || !until) && "one", inside && "in", !end && inside && "pv", iso < today && "past", iso === today && "today", marks.has(iso) && "fl"].filter(Boolean).join(" ");
          return (
            <button key={iso} type="button" className={cls} aria-pressed={s || e} onClick={() => onPick(iso)} onMouseEnter={() => setHover(iso)}
              aria-label={`${fmt(iso, { weekday: "long", day: "numeric", month: "long" })}${s ? ` · ${t("Arrivée")}` : e ? ` · ${t("Départ")}` : ""}`}>
              {i + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function When({ w, set, go, nextRef }: StepProps) {
  const [paste, setPaste] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [got, setGot] = useState<string | null>(null);
  const [hotelRead, setHotelRead] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (shotUrl) URL.revokeObjectURL(shotUrl); }, [shotUrl]);
  const n = w.start && w.end && w.end >= w.start ? dayCount(w.start, w.end) : 0;
  const marks = useMemo(() => new Set(w.flights.flatMap((f) => [f.departAt, f.arriveAt].filter(Boolean).map((x) => x.slice(0, 10)))), [w.flights]);
  const read = async (img?: File): Promise<boolean> => {
    if (!paste.trim() && !img) return true;
    setBusy(true);
    setErr(null);
    setGot(null);
    if (img) setShotUrl(URL.createObjectURL(img));
    try {
      const image = img ? await imageToBase64(img, 1600, 0.8) : undefined;
      const r = await ai<ExtractResult>("extract", { text: img ? "" : paste.trim(), image }, 100_000);
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
        setHotelRead(true);
      }
      if (r.fixed?.length) patch.fixed = [...w.fixed, ...r.fixed.map((f) => ({ ...f, keep: true }))];
      set(patch);
      if (!img) setPaste("");
      const parts = [
        r.flights?.length ? (r.flights.length > 1 ? t("{n} vols", { n: r.flights.length }) : t("1 vol")) : "",
        r.hotel?.name ? t("1 hôtel") : "",
        r.fixed?.length ? (r.fixed.length > 1 ? t("{n} réservations", { n: r.fixed.length }) : t("1 réservation")) : "",
      ].filter(Boolean);
      if (parts.length) setGot(t("Lu : {what}.", { what: parts.join(" · ") }));
      else setErr(t("Rien de lisible : collez le texte de la confirmation ou une capture plus nette."));
      return true;
    } catch (e) {
      setErr(e instanceof AiError ? e.message : t("La lecture a échoué. Réessayez."));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const pick = (iso: string) => {
    setHint(null);
    if (!w.start || w.end) set({ start: iso, end: "" });
    else if (iso < w.start) set({ start: iso });
    else set({ end: iso });
  };
  const missing = !w.start ? t("Touchez la date d'arrivée sur le calendrier.") : !w.end ? t("Touchez la date de départ.") : n > MAX_DAYS ? t("{n} jours au plus pour un voyage.", { n: MAX_DAYS }) : null;
  const next = async () => {
    if (busy) return;
    if (missing) {
      setHint(missing);
      return;
    }
    if (await read()) go(3);
  };
  useEffect(() => {
    nextRef.current = () => void next();
  });
  const onPaste = (e: React.ClipboardEvent) => {
    const img = Array.from(e.clipboardData?.files || []).find((f) => f.type.startsWith("image/"));
    if (img) {
      e.preventDefault();
      void read(img);
    }
  };
  const sum = n > 0
    ? <><b>{fmt(w.start, { weekday: "short", day: "numeric", month: "short" })} → {fmt(w.end, { weekday: "short", day: "numeric", month: "short" })}</b><span>{n > 1 ? t("{n} jours", { n }) : t("{n} jour", { n })}{n > 1 ? ` · ${n - 1 > 1 ? t("{n} nuits", { n: n - 1 }) : t("1 nuit")}` : ""}</span></>
    : w.start ? <><b>{t("Arrivée le {d}", { d: fmt(w.start, { weekday: "short", day: "numeric", month: "short" }) })}</b><span>{t("Touchez la date de départ.")}</span></>
      : <span>{t("Touchez la date d'arrivée, puis celle du départ.")}</span>;
  return (
    <>
      <div className="cr-body">
        <h1 className="v3-d cr-h">{t("Quand partez-vous ?")}</h1>
        <div className="v3-glass cr-calbox">
          <RangeCalendar start={w.start} end={w.end} marks={marks} onPick={pick} />
          <p className={"cr-sum" + (n > 0 ? " ok" : "")} aria-live="polite">{sum}</p>
        </div>
        <button type="button" className="cr-textlink" onClick={() => setManual((v) => !v)} aria-expanded={manual}>{manual ? t("Masquer la saisie") : t("Saisir les dates au clavier")}</button>
        {manual && (
          <div className="v3-dates cr-manual">
            <label className="v3-field col"><span>{t("Arrivée")}</span><input type="date" value={w.start} onChange={(e) => { setHint(null); set({ start: e.target.value, end: !w.end || w.end < e.target.value ? e.target.value : w.end }); }} /></label>
            <label className="v3-field col"><span>{t("Départ")}</span><input type="date" value={w.end} min={w.start || undefined} onChange={(e) => { setHint(null); set({ end: e.target.value }); }} /></label>
          </div>
        )}

        <p className="v3-lbl cr-sec">{t("Réservations")} <span className="cr-opt">{t("facultatif")}</span></p>
        <div className={"cr-drop" + (busy ? " busy" : "")}>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} onPaste={onPaste} rows={2} placeholder={t("Collez une confirmation de vol, d'hôtel ou de restaurant")} aria-label={t("Confirmation à lire")} />
          <div className="cr-drop-bar">
            <button type="button" className="cr-tool" onClick={() => file.current?.click()} disabled={busy}><CcImg className="cc-ic s" />{t("Une capture")}</button>
            <span className="v3-grow" />
            {(paste.trim() || busy) && <button type="button" className="v3-chip on cr-read" disabled={busy || !paste.trim()} onClick={() => void read()}>{busy ? t("Lecture…") : t("Lire")}</button>}
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f0 = e.target.files?.[0]; e.target.value = ""; if (f0) void read(f0); }} />
        </div>
        {(busy || got) && (
          <div className={"cr-reading" + (busy ? " busy" : " done")} role="status">
            {shotUrl && <img src={shotUrl} alt="" />}
            <span>{busy ? t("Lecture de la réservation…") : got}</span>
            {!busy && <CcCheck className="cc-ic s" />}
          </div>
        )}
        {err && <p className="v3-err">{err}</p>}
        {w.flights.map((f, i) => (
          <div key={`${f.code}${f.departAt}`} className="cr-x">
            <span className="ico"><CcPlane className="cc-ic s" /></span>
            <span className="t"><b>{flightLine(f)}</b><small>{[flightWhen(f.departAt), f.arriveAt && t("Arrivée {d}", { d: f.departAt && f.departAt.slice(0, 10) === f.arriveAt.slice(0, 10) ? f.arriveAt.slice(11, 16) : flightWhen(f.arriveAt) })].filter(Boolean).join(" · ")}</small></span>
            <span className="v3-tag ok">{t("Extrait")}</span>
            <button type="button" className="x" aria-label={`${t("Retirer")} : ${f.code}`} onClick={() => set({ flights: w.flights.filter((_, k) => k !== i) })}><CcClose className="cc-ic s" /></button>
          </div>
        ))}
        <div className="cr-hotel">
          <p className="v3-lbl cr-sec"><CcBed className="cc-ic s" />{t("Hôtel")} {hotelRead && w.hotelName ? <span className="v3-tag ok">{t("Extrait")}</span> : <span className="cr-opt">{t("facultatif")}</span>}</p>
          <label className="v3-field">
            <span className="sr">{t("Hôtel")}</span>
            <input value={w.hotelName} onChange={(e) => set({ hotelName: e.target.value })} placeholder={t("Hôtel (nom)")} autoComplete="off" />
          </label>
          <label className="v3-field">
            <span className="sr">{t("Adresse de l'hôtel")}</span>
            <input value={w.hotelAddress} onChange={(e) => set({ hotelAddress: e.target.value })} placeholder={t("Adresse de l'hôtel (si vous l'avez)")} autoComplete="off" />
          </label>
        </div>
      </div>
      <div className="v3-spacer" />
      <Foot hint={hint}>
        <button className={"v3-btn" + (missing ? " cr-off" : "")} aria-disabled={!!missing || busy} disabled={busy} onClick={() => void next()}>
          {busy ? t("Lecture…") : <>{t("Continuer")}{n > 0 && !missing ? ` · ${n > 1 ? t("{n} jours", { n }) : t("{n} jour", { n })}` : ""}<CcArrow /></>}
        </button>
      </Foot>
    </>
  );
}

function Know({ w, set, go, nextRef, sorter }: StepProps) {
  const { shots, busy, progress, msg, err } = sorter;
  const file = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  // the links written or pasted show at once, before anything is sorted
  const links = useMemo(() => [...new Set(w.know.match(URL_RE) || [])].slice(0, 8), [w.know]);
  const pending = !!pendingText(w);
  const unread = shots.filter((x) => x.state === "err").length;
  // sorting never holds the form: Continue moves on at once and the sorting goes on behind (step 4 says so)
  const next = () => {
    if (!busy && pending && !err) void sorter.run();
    go(4);
  };
  useEffect(() => {
    nextRef.current = next;
  });
  const addFiles = (list: File[]) => {
    const picked = list.filter((f) => f.type.startsWith("image/")).slice(0, 3);
    if (!picked.length) return;
    sorter.add(picked);
    void sorter.run();
  };
  const toggle = <K extends "places" | "fixed" | "wishes">(k: K, i: number) => set({ [k]: (w[k] as Card<object>[]).map((x, j) => (j === i ? { ...x, keep: !x.keep } : x)) } as Partial<Wiz>);
  const kept = w.places.filter((p) => p.keep).length + w.fixed.filter((f) => f.keep).length + w.wishes.filter((x) => x.keep).length;
  return (
    <>
      <div className="cr-body">
        <h1 className="v3-d cr-h">{t("Ce que vous savez déjà")}</h1>
        <p className="v3-lead cr-lead">{t("Collez tout en vrac : texte, liens (Xiaohongshu, listes Google Maps, articles), captures, réservations, envies. L'IA trie.")}</p>
        <div className={"cr-drop big" + (busy ? " busy" : "")} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files || [])); }}>
          <textarea ref={area} value={w.know} onChange={(e) => set({ know: e.target.value })} rows={5} aria-label={t("Ce que vous savez déjà")}
            onPaste={(e) => { const imgs = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/")); if (imgs.length) { e.preventDefault(); addFiles(imgs); } }}
            placeholder={t("ex. Un marché le samedi matin, un restaurant réservé mercredi à 19 h, le musée à ne pas manquer. https://…")} />
          <div className="cr-drop-bar">
            <button type="button" className="cr-tool" onClick={() => area.current?.focus()}><CcLink className="cc-ic s" />{t("Lien")}</button>
            <button type="button" className="cr-tool" onClick={() => file.current?.click()}><CcImg className="cc-ic s" />{t("Captures")}</button>
            <span className="v3-grow" />
            {(pending || busy || unread > 0) && <button type="button" className="v3-chip on cr-read" disabled={busy} onClick={() => void sorter.run()}>{busy ? t("Tri en cours…") : t("Trier")}</button>}
          </div>
          <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { const picked = Array.from(e.target.files || []); e.target.value = ""; addFiles(picked); }} />
        </div>
        {(links.length > 0 || shots.length > 0) && (
          <div className="cr-att">
            {links.map((u) => {
              const l = linkCard(u);
              return (
                <span key={u} className="cr-src">
                  <LinkTile tile={l.tile} />
                  <span className="tx"><b>{l.title}</b><small>{pending ? t("À trier") : t("Trié")}</small></span>
                </span>
              );
            })}
            {shots.map((s, i) => (
              <span key={s.id} className={"cr-src shot " + s.state}>
                <img src={s.url} alt="" />
                <span className="tx"><b>{t("Capture {n}", { n: i + 1 })}</b><small>{s.state === "wait" ? t("En attente") : s.state === "read" ? t("Lecture…") : s.state === "ok" ? t("Lue") : t("Non lue")}</small></span>
              </span>
            ))}
          </div>
        )}
        {busy && progress && (
          <div className="cr-reading busy" role="status">
            <span>{progress.of > 1 ? t("Lecture {i} sur {of}…", progress) : t("Lecture en cours…")} {t("Vous pouvez continuer : le tri se poursuit pendant l'étape suivante.")}</span>
          </div>
        )}
        {w.know.length > 11000 && <p className="v3-note">{t("Texte très long : seuls les 12 000 premiers caractères seront lus.")}</p>}
        {msg && !busy && <div className="cr-reading done" role="status"><span>{msg}</span><CcCheck className="cc-ic s" /></div>}
        {err && <p className="v3-err">{err}</p>}
        {err && w.know.trim() && <p className="v3-note">{t("Vous pouvez continuer sans trier : votre texte sera transmis tel quel à la préparation.")}</p>}
        {unread > 0 && !busy && <p className="v3-note">{t("Les captures non lues ne sont pas transmises. Touchez « Trier » pour les relire.")}</p>}

        {w.places.length > 0 && <p className="v3-lbl cr-sec">{t("Lieux")} <span className="cr-opt">{(() => { const n = w.places.filter((p) => p.keep).length; return n > 1 ? t("{n} gardés", { n }) : t("{n} gardé", { n }); })()}</span></p>}
        {w.places.map((p, i) => (
          <button key={`p${i}`} className={"cr-card" + (p.keep ? " on" : "")} onClick={() => toggle("places", i)} aria-pressed={p.keep}>
            <span className="t"><b>{p.name}</b><small>{[p.city, p.why].filter(Boolean).join(" · ")}</small></span>
            {p.mustSee && <span className="v3-tag gold">{t("Incontournable")}</span>}
            <span className="ck"><CcCheck className="cc-ic s" /></span>
          </button>
        ))}
        {w.fixed.length > 0 && <p className="v3-lbl cr-sec">{t("Réservations et rendez-vous")}</p>}
        {w.fixed.map((f, i) => (
          <button key={`f${i}`} className={"cr-card" + (f.keep ? " on" : "")} onClick={() => toggle("fixed", i)} aria-pressed={f.keep}>
            <span className="t"><b>{f.name}</b><small>{[f.date && fmt(f.date, { weekday: "short", day: "numeric", month: "short" }), f.time && `${f.time}${f.endTime ? `–${f.endTime}` : ""}`, f.notes].filter(Boolean).join(" · ")}</small></span>
            <span className="v3-tag gold">{f.kind === "reservation" || f.kind === "billet" ? t("Réservé") : t("Fixe")}</span>
            <span className="ck"><CcCheck className="cc-ic s" /></span>
          </button>
        ))}
        {w.wishes.length > 0 && <p className="v3-lbl cr-sec">{t("Envies")}</p>}
        {w.wishes.map((x, i) => (
          <button key={`w${i}`} className={"cr-card" + (x.keep ? " on" : "")} onClick={() => toggle("wishes", i)} aria-pressed={x.keep}>
            <span className="t">{x.text}</span>
            <span className="ck"><CcCheck className="cc-ic s" /></span>
          </button>
        ))}
        {(w.places.length > 0 || w.fixed.length > 0 || w.wishes.length > 0) && <p className="v3-note">{t("Touchez une carte pour la retirer du voyage.")}</p>}
      </div>
      <div className="v3-spacer" />
      <Foot>
        <button className={"v3-btn" + (kept || w.know.trim() || shots.length ? "" : " ghost")} onClick={next}>
          {busy ? t("Continuer pendant le tri") : err && pending ? t("Continuer sans trier") : kept || w.know.trim() || shots.length ? t("Continuer") : t("Passer cette étape")}<CcArrow />
        </button>
      </Foot>
    </>
  );
}

function Programme({ w, set, nextRef, sorter, onCreated }: StepProps & { onCreated: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [allInterests, setAllInterests] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const days = dayList(w.start, w.end);
  const plan = useStore((s) => s.plan);
  const profile = useStore((s) => s.profile);
  const canBusiness = !plan || plan.pro;
  const business = w.mode === "business" && canBusiness;
  const owner = ownerFirstName();
  const people = w.travellers || [];
  const fromProfile = Array.isArray(profile.interests) && (profile.interests as string[]).length > 0 && [...(profile.interests as string[])].sort().join() === [...w.interests].sort().join();
  // the interests: those of the profile and those chosen, a few others, the rest one touch away (fixed while the step is open)
  const [firstInterests] = useState(() => {
    const mine = new Set([...((Array.isArray(profile.interests) ? profile.interests : []) as string[]), ...w.interests]);
    const others = INTERESTS.filter((x) => !mine.has(x)).slice(0, Math.max(3, 8 - mine.size));
    return new Set([...mine, ...others]);
  });
  const interests = allInterests ? INTERESTS : INTERESTS.filter((x) => firstInterests.has(x));
  const moreInterests = INTERESTS.length - interests.length;
  const go = async () => {
    if (busy || !w.cities.length) return;
    setBusy(true);
    setErr(null);
    try {
      const id = await createTripFromWizard(w, business);
      onCreated(id);
    } catch {
      setErr(t("Le voyage n'a pas pu être créé. Réessayez."));
      setBusy(false);
    }
  };
  useEffect(() => {
    nextRef.current = () => undefined;
  });
  const addPerson = () => {
    const n = name.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!n) return;
    const k = n.toLowerCase();
    if (k !== owner.toLowerCase() && !people.some((p) => p.toLowerCase() === k) && people.length < 19) set({ travellers: [...people, n] });
    setName("");
  };
  const fixedOn = (iso: string) => w.fixed.filter((f) => f.keep && (f.date || "").slice(0, 10) === iso);
  const n = days.length;
  const line = [w.cities.map((c) => c.name).join(" · "), rangeShort(w.start, w.end), n > 1 ? t("{n} jours", { n }) : t("{n} jour", { n }), people.length ? t("{n} voyageurs", { n: people.length + 1 }) : ""].filter(Boolean).join(" · ");
  return (
    <>
      <div className="cr-body">
        <h1 className="v3-d cr-h">{t("Votre programme idéal")}</h1>
        <p className="v3-lead cr-lead">{t("Tout est prérempli. Changez seulement ce qui ne vous ressemble pas.")}</p>

        <p className="v3-lbl cr-sec">{t("Qui part avec vous ?")} <span className="cr-opt">{t("facultatif")}</span></p>
        <div className="cr-people">
          <span className="cr-person me"><span className="ini" aria-hidden="true">{(owner || "·").charAt(0).toUpperCase()}</span>{owner || t("Vous")}</span>
          {people.map((p) => (
            <span key={p} className="cr-person">
              <span className="ini" aria-hidden="true">{p.charAt(0).toUpperCase()}</span>{p}
              <button type="button" onClick={() => set({ travellers: people.filter((x) => x !== p) })} aria-label={t("Retirer {name}", { name: p })}><CcClose className="cc-ic s" /></button>
            </span>
          ))}
          <form className="cr-person add" onSubmit={(e) => { e.preventDefault(); addPerson(); }}>
            <input value={name} onChange={(e) => setName(e.target.value)} data-enter="own" placeholder={t("Prénom")} aria-label={t("Prénom du compagnon")} autoComplete="off" autoCapitalize="words" maxLength={40} enterKeyHint="done" />
            <button type="submit" disabled={!name.trim()} aria-label={t("Ajouter")}><CcPlus className="cc-ic s" /></button>
          </form>
        </div>
        <p className="v3-note">{t("Leurs prénoms suffisent. Vous pourrez les inviter pendant la préparation.")}</p>

        <p className="v3-lbl cr-sec">{t("Type de voyage")}</p>
        <div className="v3-seg" role="radiogroup" aria-label={t("Type de voyage")}>
          <button role="radio" aria-checked={!business} className={!business ? "on" : ""} onClick={() => set({ mode: "leisure" })}>{t("Loisirs")}</button>
          <button role="radio" aria-checked={business} className={business ? "on" : ""} onClick={() => (canBusiness ? set({ mode: "business" }) : requestPro("business"))}>{t("Affaires")} <span className="pro-tag">PRO</span></button>
        </div>
        {business && <p className="v3-note">{t("Fournisseurs, rendez-vous, dépenses par fournisseur et comptes-rendus.")}</p>}

        <p className="v3-lbl cr-sec">{t("Rythme")}</p>
        <div className="v3-seg" role="radiogroup" aria-label={t("Rythme")}>
          {PACES.map((p) => <button key={p.key} role="radio" aria-checked={w.pace === p.key} className={w.pace === p.key ? "on" : ""} onClick={() => set({ pace: p.key })}>{t(p.label)}</button>)}
        </div>
        {PACES.find((p) => p.key === w.pace) && <p className="v3-note" key={w.pace}>{t(PACES.find((p) => p.key === w.pace)!.note)}</p>}

        <p className="v3-lbl cr-sec">{t("Centres d'intérêt")} {fromProfile ? <span className="v3-tag dim">{t("depuis votre profil")}</span> : null}</p>
        <div className="v3-chips cr-chips">
          {interests.map((x) => {
            const on = w.interests.includes(x);
            return <button key={x} aria-pressed={on} className={"v3-chip" + (on ? " on" : "")} onClick={() => set({ interests: on ? w.interests.filter((i) => i !== x) : [...w.interests, x] })}>{t(x)}</button>;
          })}
          {moreInterests > 0 && <button type="button" className="v3-chip cr-more" onClick={() => setAllInterests(true)} aria-expanded={false}><CcPlus className="cc-ic s" />{t("{n} de plus", { n: moreInterests })}</button>}
        </div>

        <p className="v3-lbl cr-sec">{t("Souhaits par jour")} <span className="cr-opt">{t("facultatif")}</span></p>
        <ul className="cr-wish">
          {days.map((d, i) => {
            const fx = fixedOn(d.iso);
            const tag = i === 0 ? t("Arrivée") : i === days.length - 1 ? t("Départ") : fx.length ? t("Fixe") : "";
            return (
              <li key={d.iso}>
                <label>
                  <span className="dd">{d.label}{tag && <small>{tag}</small>}</span>
                  <input value={w.dayWishes[d.iso] || ""} onChange={(e) => set({ dayWishes: { ...w.dayWishes, [d.iso]: e.target.value } })} data-enter="own"
                    placeholder={fx.length ? fx.map((f) => `${f.name}${f.time ? ` ${f.time}` : ""}`).join(" · ") : t("Libre, l'IA propose")} enterKeyHint={i < days.length - 1 ? "next" : "done"}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      const nextInput = (e.currentTarget.closest("li")?.nextElementSibling?.querySelector("input")) as HTMLInputElement | null;
                      if (nextInput) nextInput.focus();
                      else e.currentTarget.blur();
                    }} />
                </label>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="v3-spacer" />
      <Foot hint={err} line={sorter.busy ? <><i className="cr-dot live" />{t("Tri de vos infos en cours")} · {line}</> : line}>
        <button className="v3-btn" disabled={busy || !days.length} onClick={() => void go()}>{busy ? t("Création…") : <><CcSpark />{t("Préparer mon voyage")}</>}</button>
      </Foot>
    </>
  );
}

/** Creates the trip from what was gathered (by the form or the concierge) and opens it; its preparation starts at once */
export async function createTripFromWizard(w: Wiz, business: boolean): Promise<string> {
  const base = w.cities[0];
  // the hotel on the map: its address, else the city
  let hotelLL: [number, number] = [base.lng, base.lat];
  if (w.hotelAddress.trim() || w.hotelName.trim()) {
    const box: [number, number, number, number] = [base.lng - 0.6, base.lat - 0.6, base.lng + 0.6, base.lat + 0.6];
    const g = (w.hotelAddress.trim() && (await geocode(w.hotelAddress.trim(), box, new AbortController().signal, base.country || ""))) || (w.hotelName.trim() && (await geocode(`${w.hotelName.trim()} ${base.name}`, box, new AbortController().signal, base.country || "")));
    if (g) hotelLL = g.ll;
  }
  const rec = newTripRecord({ dest: base, start: w.start, end: w.end, hotel: w.hotelName });
  // the flight that lands at the start of the trip (arrival) and the one that leaves at its end (departure);
  // connections stay in the text given to the AI
  const day = (iso: string) => (iso || "").slice(0, 10);
  const arr = [...w.flights].filter((f) => f.arriveAt && day(f.arriveAt) <= w.start).sort((a, b) => b.arriveAt.localeCompare(a.arriveAt))[0] || w.flights.find((f) => day(f.arriveAt) === w.start);
  const dep = [...w.flights].filter((f) => f !== arr && f.departAt && day(f.departAt) >= w.end).sort((a, b) => a.departAt.localeCompare(b.departAt))[0];
  const flights = [arr && { f: arr, kind: "arrival" as const, at: arr.arriveAt }, dep && { f: dep, kind: "departure" as const, at: dep.departAt }]
    .filter((x): x is { f: ExtractResult["flights"][number]; kind: "arrival" | "departure"; at: string } => !!x && !!x.at)
    .map(({ f, kind, at }) => ({ code: f.code, airline: f.airline, from: f.from, to: f.to, fromCity: f.fromCity, toCity: f.toCity, terminal: f.terminal || undefined, departAt: f.departAt || undefined, arriveAt: f.arriveAt || undefined, kind, at }));
  const flightsText = w.flights.map((f) => `${f.code} ${f.from}→${f.to} départ ${f.departAt} arrivée ${f.arriveAt}`).join(" ; ");
  const draft: Draft = {
    flightsText,
    status: "preparing",
    cities: w.cities.map((c) => ({ name: c.name, lat: c.lat, lng: c.lng, country: c.country })),
    hotelText: [w.hotelName, w.hotelAddress].filter(Boolean).join(", "),
    pace: w.pace,
    interests: w.interests,
    // what was typed stays as said (the cards are what the AI understood of it)
    wishes: w.wishes.filter((x) => x.keep).map((x) => x.text).concat(w.know.trim() ? [`En vrac : ${w.know.trim().slice(0, 1500)}`] : [])
      .concat(business ? ["Voyage d'affaires : rendez-vous avec des fournisseurs, usines, salons et marchés de gros ; garder des créneaux pour les rendez-vous."] : []),
    dayWishes: w.dayWishes,
    places: w.places.filter((p) => p.keep).map(({ keep: _k, ...p }) => p),
    fixed: w.fixed.filter((f) => f.keep).map(({ keep: _k, ...f }) => f),
    days: {},
  };
  // who travels: the owner first, then the companions named (nothing written when nobody was named)
  const owner = ownerFirstName();
  const seen = new Set<string>();
  const travellers = [owner, ...(w.travellers || [])].map((x) => (x || "").trim()).filter((x) => {
    const k = x.toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 20);
  const id = createTrip({
    ...rec,
    mode: business ? "business" : undefined,
    title: w.cities.map((c) => c.name).join(" · "),
    timezone: timezoneFor(base.country, base.lng),
    hotel: { name: w.hotelName.trim() || "Hôtel à préciser", lat: hotelLL[1], lng: hotelLL[0] },
    zones: w.cities.map((c) => ({ label: c.name, center: [c.lng, c.lat], zoom: 12 })),
    flights,
    ...((w.travellers || []).some((x) => x.trim()) ? { travellers } : {}),
    draft,
  });
  switchTrip(id);
  // one step per trip, whether it was made with the form or with the concierge
  track("trip_created", w.from === "concierge" ? "concierge" : null, id);
  // the concierge's conversation this draft came from is done with
  if (w.from === "concierge") {
    try {
      localStorage.removeItem(CONCIERGE_KEY);
    } catch {
      /* ignore */
    }
  }
  return id;
}
