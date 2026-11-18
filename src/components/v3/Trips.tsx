import { useEffect, useMemo, useRef, useState } from "react";
import type { Trip } from "../../data/types";
import { createTrip, getState, requestPro, switchTrip, useStore, useTrips } from "../../lib/store";
import { dateLabel, dayCount, newTripRecord, searchCities, type Destination } from "../../lib/newTrip";
import { daysLeft, phase } from "../../lib/time";
import { coordText, recapDue } from "../../lib/recap";
import { coverMissing, isRef } from "../../lib/photoData";
import { askPhotos, canAskPhotos } from "../../lib/placePhotos";
import { Ph } from "../PlacePhoto";
import TripHero from "./TripHero";
import OrbitMark from "../OrbitMark";
import Shell, { Steps } from "./Shell";
import CreateWizard from "./CreateWizard";
import Concierge, { CreateChooser } from "./Concierge";
import { track } from "../../lib/track";
import AccountScreen from "./AccountScreen";
import { SyncBadge } from "../Account";
import { IClose } from "../Icons";
import { t } from "../../lib/i18n";
import { entryHas, takeEntry } from "../../lib/entry";

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? t("Bonsoir") : h < 18 ? t("Bonjour") : t("Bonsoir");
};

/** "Mes voyages": the account's trips, the one to come first; a first-time account sees where to start */
export default function Trips({ onOpen, onClose }: { onOpen: (id: string) => void; onClose?: () => void }) {
  const trips = useTrips();
  const profile = useStore((s) => s.profile);
  const email = useStore((s) => s.session?.user.email) || "";
  const [creating, setCreatingRaw] = useState<false | "choose" | "form" | "concierge">(false);
  const [menu, setMenu] = useState(false);
  const avatar = useRef<HTMLButtonElement>(null);
  const pro = useStore((s) => !!s.plan?.pro);
  // a free account prepares one trip per month with the AI: the next one asks for Pro
  const setCreating = (v: boolean) => {
    const p = getState().plan;
    if (v && p && !p.pro && p.prepLeft <= 0) return requestPro("prep");
    setCreatingRaw(v ? "choose" : false);
  };
  const name = (profile.name as string) || "";
  const initial = (name || email || "·").slice(0, 1).toUpperCase();
  const sorted = useMemo(() => {
    const rank = (t: Trip) => ({ during: 0, before: 1, after: 2 })[phase(t)];
    return [...trips].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)));
  }, [trips]);
  const [hero, ...rest] = sorted;
  // no trip to come or under way: "Où allez-vous ensuite ?" comes first; the trip just ended keeps its recap on top
  // (for RECAP_DAYS after its end), older ones join the past trips
  const between = !!hero && phase(hero) === "after";
  const showHero = !!hero && (!between || recapDue(hero));
  const others = between && !showHero ? sorted : rest;
  // up to 3 listed trips without a photo that this account may ask for: asked once from the server (askPhotos
  // throttles each trip)
  const roles = useStore((s) => s.roles);
  const member = useStore((s) => s.member);
  const coverless = useMemo(() => trips.filter((x) => coverMissing(x.cover) && canAskPhotos(x)).slice(0, 3), [trips, roles, member]); // eslint-disable-line react-hooks/exhaustive-deps
  // a link from a cycle e-mail: "?new=1" opens the creation (same rule as the button), "?booking=" the account and its bookings
  useEffect(() => {
    if (entryHas("booking")) setMenu(true);
    else if (takeEntry("new")) setCreating(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const coverlessKey = coverless.map((x) => x.id).join(",");
  useEffect(() => {
    if (!coverlessKey) return;
    const tm = window.setTimeout(() => coverless.forEach((x) => void askPhotos(x, true)), 4000);
    return () => window.clearTimeout(tm);
  }, [coverlessKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (creating === "choose") return <CreateChooser onCancel={() => setCreating(false)} onPick={(k) => { track("tool_opened", `create_${k}`); setCreatingRaw(k); }} />;
  if (creating === "concierge") return <Concierge onCancel={() => setCreating(false)} onForm={() => setCreatingRaw("form")} onCreated={(id) => { setCreating(false); onOpen(id); }} />;
  if (creating) return <CreateWizard onCancel={() => setCreating(false)} onCreated={(id) => { setCreating(false); onOpen(id); }} />;

  const top = (
    <div className="v3-bar">
      <OrbitMark size={20} title="ORBES Trips" />
      <span className="v3-grow" />
      {onClose && <button className="v3-tool" onClick={onClose} aria-label={t("Revenir à la carte")}><IClose width={18} height={18} /></button>}
      <button ref={avatar} type="button" className={"v3-av ac-av" + (pro ? " is-pro" : "")} aria-label={t("Mon compte")} aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu(true)}>{initial}</button>
      {/* the account as its own screen over the trips: room for the plan, alerts, bookings, password and privacy */}
      {menu && (
        <AccountScreen
          status={<SyncBadge />}
          onClose={() => {
            setMenu(false);
            avatar.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );

  if (!trips.length)
    return (
      <Shell top={top} className="v3-empty">
        {/* no illustration: one confident line in the display face, what it takes, and the way in */}
        <div className="hx-empty">
          <p className="v3-lbl">{greeting()}{name ? ` ${name}` : ""}</p>
          <h1 className="v3-d hx-empty-h">{t("Votre premier voyage commence\u00a0ici.")}</h1>
          <p className="v3-lead">{t("Une destination et des dates suffisent. Le reste se construit avec vous.")}</p>
          <button className="v3-btn" onClick={() => setCreating(true)}>{t("＋ Créer un voyage")}</button>
        </div>
        <div className="v3-spacer" />
      </Shell>
    );

  return (
    <Shell ring={false} top={top}>
      <p className="v3-lbl" style={{ marginTop: 14 }}>{greeting()}{name ? ` ${name}` : ""}</p>
      <div className="v3-titlerow">
        <h1 className="v3-d v3-h2" style={{ margin: 0 }}>{t("Mes voyages")}</h1>
        <span>{trips.length}</span>
      </div>
      {showHero && hero && <TripHero trip={hero} onOpen={onOpen} />}
      {between && (
        <section className="v3-hero-next" aria-label={t("Prochain voyage")}>
          <h2 className="v3-d">{t("Où allez-vous ensuite ?")}</h2>
          <p className="v3-lead">{t("Une destination et des dates suffisent. Le reste se construit avec vous.")}</p>
          <button className="v3-btn" onClick={() => setCreating(true)}>{t("＋ Créer un voyage")}</button>
        </section>
      )}
      {others.length > 0 && (
        <>
          <p className="v3-lbl" style={{ marginTop: 26 }}>{between ? t("Voyages passés") : t("Autres voyages")}</p>
          <div className={"v3-grid" + (others.length === 1 ? " one" : "")}>{others.map((t) => <TripCard key={t.id} t={t} onOpen={onOpen} />)}</div>
        </>
      )}
      {!between && <button className="v3-btn ghost" style={{ marginTop: 18 }} onClick={() => setCreating(true)}>{t("＋ Créer un voyage")}</button>}
      <div style={{ height: 24 }} />
    </Shell>
  );
}

function TripCard({ t: trip, onOpen }: { t: Trip; onOpen: (id: string) => void }) {
  const ph = phase(trip);
  const d = daysLeft(trip);
  const n = trip.days.filter((x) => x.scheduled).reduce((k, x) => k + (x.dates?.length || 0), 0);
  const draft = (useStore((s) => s.trips[trip.id])?.draft as { status?: string } | undefined)?.status;
  // the trip's photo (NUIT); without one, or if it fails to load, the boarding pass (code, coordinates, a hairline)
  const [failed, setFailed] = useState(false);
  const cover = isRef(trip.cover) && !failed ? trip.cover : null;
  const tags = (
    <span className="v3-tags">
      {draft && draft !== "done" ? (
        <span className="v3-tag dim">{draft === "preparing" ? t("En préparation") : t("À valider")}</span>
      ) : (
        <span className={"v3-tag " + (ph === "during" ? "ok" : ph === "before" ? "gold" : "dim")}>{ph === "during" ? t("En cours") : ph === "before" ? (d > 0 ? t("J–{d}", { d }) : t("Moins de 24 h")) : t("Passé")}</span>
      )}
    </span>
  );
  return (
    <button className={"v3-trip" + (cover ? " has-ph" : " ph-none-trip")} onClick={() => onOpen(trip.id)}>
      {cover ? (
        <span className="v3-trip-art has-ph" aria-hidden="true">
          <Ph photo={cover} size="l" onFail={() => setFailed(true)}><i className="ph-scrim" /></Ph>
        </span>
      ) : (
        <span className="v3-trip-art" aria-hidden="true" />
      )}
      <span className="v3-trip-over">
        {cover ? (
          tags
        ) : (
          <>
            <span className="ph-nt-head">
              {tags}
              <span className="ph-nt-code">
                <b className="v3-d">{trip.code.split(" ")[0]}</b>
                <span className="ph-coord">{coordText(trip.center)}</span>
              </span>
            </span>
            <span className="ph-nt-line" />
          </>
        )}
        <span className="v3-grow" />
        <span className="v3-trip-name">
          <span>
            <b className="v3-d">{trip.title}</b>
            <small>{dateLabel(trip.start, trip.end)}{n ? ` · ${n > 1 ? t("{n} jours", { n }) : t("{n} jour", { n })}` : ""}</small>
          </span>
        </span>
      </span>
    </button>
  );
}

/** Creating a trip: where, then when (+ the hotel if known). The AI preparation comes with the next steps. */
export function CreateTrip({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState(1);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Destination[]>([]);
  const [searching, setSearching] = useState(false);
  const [dest, setDest] = useState<Destination | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [hotel, setHotel] = useState("");
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (dest && q === dest.name) return;
    ctl.current?.abort();
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const c = new AbortController();
    ctl.current = c;
    setSearching(true);
    const t = window.setTimeout(async () => {
      const r = await searchCities(q, c.signal);
      if (!c.signal.aborted) {
        setResults(r);
        setSearching(false);
      }
    }, 400);
    return () => {
      window.clearTimeout(t);
      c.abort();
    };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = start && end && end >= start ? dayCount(start, end) : 0;
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={step === 1 ? onCancel : () => setStep(1)} aria-label={step === 1 ? t("Fermer") : t("Retour")}>{step === 1 ? "✕" : "‹"}</button>
      <Steps n={step} of={2} />
    </div>
  );

  if (step === 1)
    return (
      <Shell ring={false} top={top}>
        <p className="v3-lbl" style={{ marginTop: 22 }}>{t("Nouveau voyage")}</p>
        <h1 className="v3-d v3-h2">{t("Où allez-vous ?")}</h1>
        <label className="v3-field" style={{ marginTop: 16 }}>
          <span className="sr">{t("Ville")}</span>
          <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setDest(null); }} placeholder={t("Une ville : Tokyo, Rome, Lisbonne…")} autoComplete="off" />
        </label>
        <ul className="v3-results" aria-live="polite">
          {searching && !results.length && <li className="v3-note">{t("Recherche…")}</li>}
          {results.map((r) => (
            <li key={`${r.name}-${r.lat}`}>
              <button className={"v3-res" + (dest === r ? " on" : "")} onClick={() => { setDest(r); setQ(r.name); setResults([r]); }}>
                <b>{r.name}</b>
                <small>{r.countryName || ""}</small>
                <span className="v3-ck">{dest === r ? "✓" : "＋"}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="v3-spacer" />
        <button className="v3-btn" disabled={!dest} onClick={() => setStep(2)}>{t("Continuer")}</button>
      </Shell>
    );

  return (
    <Shell ring={false} top={top}>
      <p className="v3-lbl" style={{ marginTop: 22 }}>{dest?.name}</p>
      <h1 className="v3-d v3-h2">{t("Quand partez-vous ?")}</h1>
      <div className="v3-dates">
        <label className="v3-field col"><span>{t("Arrivée")}</span><input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (!end || end < e.target.value) setEnd(e.target.value); }} /></label>
        <label className="v3-field col"><span>{t("Départ")}</span><input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      {n > 0 && <p className="v3-note">{n > 1 ? t("{n} jours sur place", { n }) : t("{n} jour sur place", { n })}{n > 60 ? t(" (60 au maximum)") : ""}</p>}
      <p className="v3-lbl" style={{ marginTop: 22 }}>{t("Hôtel (si vous le connaissez)")}</p>
      <label className="v3-field" style={{ marginTop: 8 }}>
        <span className="sr">{t("Hôtel")}</span>
        <input value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder={t("Nom de l'hôtel")} />
      </label>
      <div className="v3-spacer" />
      <button
        className="v3-btn"
        disabled={!dest || !n}
        onClick={() => {
          if (!dest || !n) return;
          const id = createTrip(newTripRecord({ dest, start, end, hotel }));
          switchTrip(id);
          onCreated(id);
        }}
      >
        {t("Créer le voyage")}
      </button>
    </Shell>
  );
}
