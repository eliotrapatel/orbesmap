import "../../styles/retention.css";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addInbound, alertPrefs, attachToNewTrip, detectedTrip, disablePush, dismissInbound, enablePush, inboundAddress, inboundItems, pushBlocker, pushEnabled, setAlertPrefs, type DetectedTrip, type InboundItem } from "../../lib/alerts";
import { t } from "../../lib/i18n";
import { dateLabel, searchCities, type Destination } from "../../lib/newTrip";
import { currentTrip, getState, requestPro, toast, updateProfile, useStore } from "../../lib/store";
import { track } from "../../lib/track";
import CreateWizard, { WIZARD_KEY, type Wiz } from "./CreateWizard";
import { openHome } from "./nav";

// ---------- a new trip announced by a forwarded booking (lot retention) ----------
// The bookings inbox (old app's account) shows these offers itself; the alerts block shows them only when the inbox is
// not on screen, so an offer never appears twice.
let inboxOn = 0;
const inboxSubs = new Set<() => void>();
const inboxMounted = (d: number) => {
  inboxOn += d;
  inboxSubs.forEach((f) => f());
};
const useInboxOn = () =>
  useSyncExternalStore(
    (f) => {
      inboxSubs.add(f);
      return () => {
        inboxSubs.delete(f);
      };
    },
    () => inboxOn > 0,
  );

/** "Lisbonne, 12 – 19 mars 2027" */
const whereWhen = (d: DetectedTrip) => {
  const dates = dateLabel(d.start, d.end && d.end >= d.start ? d.end : d.start);
  return d.city ? `${d.city}, ${dates}` : dates;
};
/** What a booking holds, one short part each (a flight, the hotel, a booking) */
type Part = { kind: "flight" | "hotel" | "fixed"; text: string };
const bookingParts = (it: InboundItem): Part[] => {
  const x = it.extracted || {};
  return [
    ...(x.flights || []).map((f): Part => ({ kind: "flight", text: `${f.code} ${f.from} → ${f.to}` })),
    ...(x.hotel?.name ? [{ kind: "hotel", text: x.hotel.name } as Part] : []),
    ...(x.fixed || []).map((f): Part => ({ kind: "fixed", text: `${f.name}${f.date ? ` (${f.date}${f.time ? ` ${f.time}` : ""})` : ""}` })),
  ];
};
/** What a booking holds, one short line each */
const bookingLines = (it: InboundItem) => bookingParts(it).map((p) => p.text);
// line icons of a booking's parts (24 grid, 1.6 stroke)
const ico = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const PART_ICON: Record<Part["kind"], ReactNode> = {
  flight: <svg {...ico}><path d="M2.5 15.5 21 8.5c.6-.2 1 .5.5.9L14 15l-1 5-2-1 .5-3.5-4 1.5-1.5 2-1.5-.5.5-2.5-2.5-.5Z" /></svg>,
  hotel: <svg {...ico}><path d="M4 20V5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5V20M14 10h4.5a1.5 1.5 0 0 1 1.5 1.5V20M3 20h18" /><path d="M8 8h2M8 12h2M8 16h2" /></svg>,
  fixed: <svg {...ico}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>,
};

/** Fills the trip creation form with the booking: destination, dates, flights, hotel, bookings. False = not opened. */
async function prefillWizard(it: InboundItem): Promise<boolean> {
  const d = detectedTrip(it);
  if (!d) return false;
  // the free trip of the month already used: the Pro screen, as from "Créer un voyage"
  const plan = getState().plan;
  if (plan && !plan.pro && plan.prepLeft <= 0) {
    requestPro("prep");
    return false;
  }
  try {
    const cur = JSON.parse(localStorage.getItem(WIZARD_KEY) || "null") as Partial<Wiz> | null;
    if (cur?.step && (cur.cities?.length || cur.start) && !confirm(t("Un voyage est déjà en cours de création. Le remplacer par celui-ci ?"))) return false;
  } catch {
    /* no draft */
  }
  let city: Destination | undefined;
  if (d.city) {
    city = (await searchCities(d.country ? `${d.city}, ${d.country}` : d.city))[0];
    if (!city && d.country) city = (await searchCities(d.city))[0];
  }
  const x = it.extracted || {};
  const profile = getState().profile;
  const w: Wiz = {
    // the city found: straight to the dates and bookings, to check them; else the city to pick first
    step: city ? 2 : 1,
    cities: city ? [city] : [],
    start: d.start,
    end: d.end && d.end >= d.start ? d.end : d.start,
    hotelName: x.hotel?.name || "",
    hotelAddress: x.hotel?.address || x.hotel?.addressCn || "",
    flights: (x.flights || []).filter((f) => f.code),
    know: "",
    places: [],
    fixed: (x.fixed || []).filter((f) => f.name).map((f) => ({ ...f, keep: true })),
    wishes: [],
    pace: (profile.pace as string) || "balanced",
    interests: (profile.interests as string[]) || [],
    dayWishes: {},
    mode: profile.travel === "business" ? "business" : "leisure",
  };
  try {
    localStorage.setItem(WIZARD_KEY, JSON.stringify(w));
  } catch {
    /* the form opens empty */
  }
  return true;
}

/** "Créer ce voyage": the creation form, filled from the booking, over the current screen; the booking joins the new trip */
function useTripFromBooking(onDone: (id: number) => void): { busy: number | null; start: (it: InboundItem) => void; overlay: ReactNode } {
  const [open, setOpen] = useState<InboundItem | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const start = (it: InboundItem) => {
    setBusy(it.id);
    void prefillWizard(it)
      .then((go) => {
        if (!go) return;
        track("tool_opened", "next_trip");
        setOpen(it);
      })
      .finally(() => setBusy(null));
  };
  const overlay = open
    ? createPortal(
        <div className="rt-wizard">
          <CreateWizard
            onCancel={() => setOpen(null)}
            onCreated={(id) => {
              const it = open;
              setOpen(null);
              onDone(it.id);
              const trip = currentTrip();
              if (trip.id === id) void attachToNewTrip(it, trip).catch(() => undefined);
              openHome(false);
            }}
          />
        </div>,
        document.body,
      )
    : null;
  return { busy, start, overlay };
}

/** The new trips announced by forwarded bookings, in the alerts block (account menu) */
function NextTrips() {
  const inboxShown = useInboxOn();
  // a trip created or changed (from another booking, or by hand) can cover an offer's dates: it is then no longer offered
  useStore((s) => s.trips);
  const [items, setItems] = useState<InboundItem[]>([]);
  useEffect(() => {
    void inboundItems().then(setItems, () => setItems([]));
  }, []);
  const flow = useTripFromBooking((id) => setItems((xs) => xs.filter((y) => y.id !== id)));
  const offers = inboxShown ? [] : items.filter((it) => detectedTrip(it)).slice(0, 3);
  return (
    <>
      {offers.map((it) => {
        const lines = bookingLines(it);
        return (
          <div key={it.id} className="rt-next">
            <span className="rt-next-k">{t("Nouveau voyage détecté")}</span>
            <b className="rt-next-t">{whereWhen(detectedTrip(it)!)}</b>
            {lines.length > 0 && <small className="rt-next-s">{lines.slice(0, 3).join(" · ")}</small>}
            <div className="rt-next-row">
              <button type="button" className="v3-chip on" disabled={flow.busy !== null} onClick={() => flow.start(it)}>{flow.busy === it.id ? t("Préparation…") : t("Créer ce voyage")}</button>
              <button type="button" className="v3-chip" disabled={flow.busy === it.id} onClick={async () => { await dismissInbound(it.id); setItems((xs) => xs.filter((y) => y.id !== it.id)); }}>{t("Ignorer")}</button>
            </div>
          </div>
        );
      })}
      {flow.overlay}
    </>
  );
}

/** Alerts (morning e-mail, notifications on this phone) and the address to forward bookings to */
export function AlertsBlock() {
  useStore((s) => s.profile.alerts);
  const optOut = useStore((s) => s.profile.partnerOptOut === true);
  const prefs = alertPrefs();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    void pushEnabled().then(setOn, () => setOn(false));
    void inboundAddress().then(setAddr, () => setAddr(null));
  }, []);
  const blocker = pushBlocker();
  const togglePush = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (on) {
        await disablePush();
        setOn(false);
      } else {
        await enablePush();
        setOn(true);
        toast(t("Notifications activées sur ce téléphone"));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="alerts-block">
      <NextTrips />
      <span className="v3-lbl">{t("Alertes")}</span>
      <label className="alerts-row">
        <span className="v3-grow"><b>{t("E-mail du matin")}</b><small>{t("Chaque jour du voyage vers 7 h 30 : la journée, les horaires, les lieux fermés.")}</small></span>
        <input type="checkbox" checked={prefs.email} onChange={(e) => setAlertPrefs({ email: e.target.checked })} />
      </label>
      <div className="alerts-row">
        <span className="v3-grow"><b>{t("Notifications sur ce téléphone")}</b><small>{blocker || t("Le résumé du matin et un rappel 30 minutes avant chaque lieu.")}</small></span>
        {!blocker && <button type="button" className="v3-chip" disabled={busy || on === null} onClick={() => void togglePush()}>{on ? t("Désactiver") : t("Activer")}</button>}
      </div>
      {err && <p className="v3-err">{err}</p>}
      <label className="alerts-row">
        <span className="v3-grow"><b>{t("Offres de nos partenaires")}</b><small>{t("Des offres choisies d'après vos voyages et vos dépenses (hôtels, activités, transport, assurance…). Décochez pour ne plus en recevoir et ne plus figurer dans les données partagées avec nos partenaires.")}</small></span>
        <input type="checkbox" checked={!optOut} onChange={(e) => updateProfile({ partnerOptOut: !e.target.checked, partnerOptOutAt: Date.now() })} />
      </label>
      {addr && (
        <div className="alerts-inbound">
          <b>{t("Transférez vos réservations")}</b>
          <small>{t("Envoyez à cette adresse vos confirmations de vol, d'hôtel ou de réservation : elles arrivent dans le voyage, prêtes à être ajoutées.")}</small>
          <button type="button" className="pub-link-url" onClick={() => navigator.clipboard?.writeText(addr).then(() => toast(t("Adresse copiée")), () => undefined)}>{addr}</button>
        </div>
      )}
    </div>
  );
}

/**
 * Bookings received by e-mail. In a trip (its "Compte" panel): to add to the open trip. On "Mes voyages" (`home`): a
 * booking that announces a new trip is created from here; the others are added from the trip they belong to.
 * `empty`: what shows once loaded with nothing waiting.
 */
export function InboundInbox({ home, empty }: { home?: boolean; empty?: ReactNode } = {}) {
  const [items, setItems] = useState<InboundItem[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const tripId = useStore((s) => s.tripId);
  const tripTitle = useStore((s) => s.trips[s.tripId]?.title as string | undefined);
  // a trip created or changed can cover a "new trip" offer's dates: the booking then shows as one to add
  useStore((s) => s.trips);
  useEffect(() => {
    let alive = true;
    void inboundItems().then(
      (xs) => {
        if (alive) setItems(xs);
      },
      () => {
        if (alive) setItems([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [tripId]);
  // this inbox shows the new-trip offers itself (see NextTrips)
  useEffect(() => {
    inboxMounted(1);
    return () => {
      inboxMounted(-1);
    };
  }, []);
  const drop = (id: number) => setItems((xs) => (xs || []).filter((y) => y.id !== id));
  const flow = useTripFromBooking(drop);
  if (items === null) return <p className="ac-inbox-wait">{t("Recherche des réservations reçues…")}</p>;
  if (!items.length) return <>{empty}{flow.overlay}</>;
  return (
    <div className="ac-inbox">
      <p className="ac-inbox-h">{items.length > 1 ? t("{n} réservations reçues", { n: items.length }) : t("1 réservation reçue")}</p>
      {items.map((it) => {
        const parts = bookingParts(it);
        const next = detectedTrip(it);
        return (
          <article key={it.id} className={"ac-bk" + (next ? " is-next" : "")}>
            {next && (
              <span className="ac-bk-next">
                <span className="ac-bk-k">{t("Nouveau voyage détecté")}</span>
                <b className="v3-d">{whereWhen(next)}</b>
              </span>
            )}
            <b className="ac-bk-t">{it.subject || t("Sans objet")}</b>
            {it.from_addr && <small className="ac-bk-from">{it.from_addr}</small>}
            {parts.length ? (
              <ul className="ac-bk-parts">
                {parts.map((p, i) => <li key={i}>{PART_ICON[p.kind]}<span>{p.text}</span></li>)}
              </ul>
            ) : (
              <p className="ac-bk-none">{t("Rien de reconnu dans cet e-mail.")}</p>
            )}
            {home && !next && parts.length > 0 && <p className="ac-bk-none">{t("Ouvrez le voyage concerné pour l'ajouter.")}</p>}
            <div className="ac-bk-act">
              {next && <button type="button" className="v3-chip on" disabled={flow.busy !== null || busy === it.id} onClick={() => flow.start(it)}>{flow.busy === it.id ? t("Préparation…") : t("Créer ce voyage")}</button>}
              {/* a booking outside all the trips is never added to the open trip by mistake: only "Créer ce voyage" */}
              {!next && !home && (
                <button
                  type="button"
                  className="v3-chip on"
                  disabled={busy === it.id || !parts.length}
                  onClick={async () => {
                    setBusy(it.id);
                    try {
                      const r = await addInbound(it, currentTrip());
                      toast(r.manual.length ? t("{n} ajouté(s) · à placer à la main : {list}", { n: r.added, list: r.manual.join(", ") }) : t("{n} ajouté(s) au voyage", { n: r.added }));
                      drop(it.id);
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === it.id ? t("Ajout…") : tripTitle ? t("Ajouter à {trip}", { trip: tripTitle }) : t("Ajouter au voyage")}
                </button>
              )}
              <button type="button" className="v3-chip" disabled={busy === it.id} onClick={async () => { await dismissInbound(it.id); drop(it.id); }}>{t("Ignorer")}</button>
            </div>
          </article>
        );
      })}
      {flow.overlay}
    </div>
  );
}
