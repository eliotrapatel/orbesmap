import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import App from "../../App";
import { supabase } from "../../lib/supabase";
import { defaultTripId, hasStoredSession, switchTrip, useStore, useTrips } from "../../lib/store";
import Onboarding from "./Onboarding";
import Trips from "./Trips";
import Welcome from "./Welcome";
import DraftScreen from "./DraftScreen";
import { homeOpenedFromTrip, openAdmin, openHome, openShare, useAdmin, useHome, useShare } from "./nav";
import ShareTrip from "./ShareTrip";
import ProScreen from "./ProScreen";
import AdminScreen from "./AdminScreen";
import Legal, { legalKind } from "./Legal";
import PublicTripPage from "./PublicTripPage";
import OrbitMark from "../OrbitMark";
import { takeRememberedCopy } from "../../lib/publicTrip";
import { track } from "../../lib/track";
import { getLang, t, useLang } from "../../lib/i18n";
import { EASE, fadeOut, ghostOut, reducedMotion } from "../ui";
import "../../styles/flow.css";


/**
 * Which screen: the welcome (nobody signed in on a new phone), the onboarding (first sign-in of an account),
 * "Mes voyages" (no trip yet, or opened from the trip menu), else the trip itself.
 * The two people of the first shared space go straight to their trips, as before.
 */
export default function Root() {
  const proAsk = useStore((s) => s.proAsk);
  // every screen reads its texts again when the language changes (the map app restarts in the new language)
  useLang();
  const signedIn = useStore((s) => !!s.session);
  useEffect(() => {
    if (signedIn) track("app_open");
  }, [signedIn]);
  const admin = useAdmin();
  // the legal pages have their own address and open without an account
  const params = new URLSearchParams(location.search);
  const legal = legalKind(params.get("p"));
  if (legal) return <Legal kind={legal} onClose={() => location.assign(location.pathname)} />;
  // a trip's public link (?t=…): its programme, without an account
  const slug = (params.get("t") || "").toLowerCase();
  if (/^[a-z0-9]{10,24}$/.test(slug))
    return (
      <>
        <PublicTripPage slug={slug} copyNow={params.get("copy") === "1"} />
        {proAsk && <Stage key="pro" kind="pro" overlay><ProScreen /></Stage>}
      </>
    );
  return (
    <>
      <Screen />
      {admin && <Stage key="admin" kind="admin" overlay><AdminScreen onClose={() => openAdmin(false)} /></Stage>}
      {proAsk && <Stage key="pro" kind="pro" overlay><ProScreen /></Stage>}
    </>
  );
}

// ---------- moving between screens ----------
// Each top-level screen is a Stage keyed by its kind: it comes in once when the kind changes (never on a re-render),
// and the screen it replaces fades out above it as a still copy (see ghostOut), so the two cross-fade.
// Going deeper (home → trip → share) the new screen rises slightly; coming back it settles from above.
type Kind = "splash" | "welcome" | "onboarding" | "trips" | "share" | "draft" | "app" | "pro" | "admin";
const DEPTH: Record<Kind, number> = { splash: 0, welcome: 1, onboarding: 2, trips: 3, draft: 4, app: 4, share: 5, pro: 6, admin: 6 };
let shown: Kind | null = null;

/** The screen inside a Stage (past the nested frames), looked up when needed: a screen may swap its own root while shown */
const screenOf = (box: HTMLElement | null) => {
  let el = box?.firstElementChild as HTMLElement | null;
  while (el?.classList.contains("fl-stage")) el = el.firstElementChild as HTMLElement | null;
  return el;
};

function Stage({ kind, overlay, children }: { kind: Kind; overlay?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // the frame itself never changes; the screen inside can (the trip list becomes the concierge, preparing becomes review…)
    const box = ref.current;
    const el = screenOf(box);
    const from = overlay ? null : shown;
    if (!overlay) shown = kind;
    const motion = !!el && !reducedMotion() && typeof el.animate === "function";
    // the very first screen of a visit takes over from the start-up mark: a fade, no move (the splash itself: nothing,
    // it is drawn exactly where the page's own mark was)
    if (motion && el && !overlay && !from && kind !== "splash") el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: EASE, fill: "backwards" });
    if (motion && el && (overlay || (from && from !== kind))) {
      const back = !overlay && from ? DEPTH[kind] < DEPTH[from] : false;
      const dy = overlay ? 18 : back ? -10 : 14;
      // the column moves (never the scrolling page itself, so fixed backgrounds stay put)
      const col = el.querySelector<HTMLElement>(":scope > .v3-col");
      // leaving the map (a live drawing no copy can hold): the black ground is there at once and only the content
      // settles, a deliberate cut rather than a dip to black
      const fromMap = from === "app" && !!col;
      (fromMap ? col : el).animate([{ opacity: 0 }, { opacity: 1 }], { duration: overlay ? 260 : 300, easing: EASE, fill: "backwards" });
      if (col) col.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: overlay ? 380 : 420, easing: EASE, fill: "backwards" });
    }
    return () => {
      // the screen shown now (not the one found on arrival); the map cannot be copied: the next screen covers it
      const cur = screenOf(box);
      if (!cur || cur.classList.contains("app")) return;
      ghostOut(cur, (copy) => fadeOut(copy, overlay ? 220 : 240, overlay ? "translateY(12px)" : "none"), { parent: cur.ownerDocument.body });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className="fl-stage">
      {children}
    </div>
  );
}

// "Mes voyages" opens again where it was left (a trip opened from far down the list, then back home)
let homeScroll = 0;
function rememberHomeScroll() {
  const el = document.querySelector<HTMLElement>(".fl-home > .v3");
  // only the list of trips (not the creation screens, which use the same page)
  if (el && el.querySelector(".v3-titlerow")) homeScroll = el.scrollTop;
}
function HomeScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (el && homeScroll && el.querySelector(".v3-titlerow")) el.scrollTop = homeScroll;
    return () => {
      rememberHomeScroll();
    };
  }, []);
  return (
    <div ref={ref} className="fl-stage fl-home">
      {children}
    </div>
  );
}

/** While the session loads: the start-up mark of the page stays exactly where it was; if the wait goes on, the name
 *  appears under it and a fine hairline draws itself once beneath the name (nothing turns, nothing loops) */
function Splash() {
  // a long wait (no network): say so instead of a silent screen
  const [slow, setSlow] = useState(false);
  // once the name and its line are fully drawn, the closing copy keeps them (a copy plays no drawing of its own)
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const tm = window.setTimeout(() => setSlow(true), 8000);
    const td = window.setTimeout(() => setDrawn(true), 2700);
    return () => {
      window.clearTimeout(tm);
      window.clearTimeout(td);
    };
  }, []);
  return (
    <div className={"v3 v3-splash fl-splash" + (drawn ? " fl-splash-drawn" : "")} aria-busy="true">
      <div className="fl-splash-mark">
        <OrbitMark size={34} title="ORBES Trips" />
        <span className="fl-splash-word" aria-hidden="true">ORBES Trips</span>
        <span className="fl-splash-rule" aria-hidden="true" />
      </div>
      {slow && <p className="v3-note fl-splash-slow" role="status">{t("Connexion en cours… Vérifiez votre réseau\u00a0: l'app s'ouvrira dès qu'il sera rétabli.")}</p>}
    </div>
  );
}

function Screen() {
  const authReady = useStore((s) => s.authReady);
  const session = useStore((s) => s.session);
  const member = useStore((s) => s.member);
  const profile = useStore((s) => s.profile);
  const tripId = useStore((s) => s.tripId);
  const allTrips = useStore((s) => s.trips);
  const trips = useTrips();
  const home = useHome();
  const share = useShare();
  const current = trips.some((t) => t.id === tripId);

  // the current trip is not one this account can open (another account's, or the shared space's): its first trip
  useEffect(() => {
    if (!current && trips.length) switchTrip(defaultTripId(trips));
  }, [current, trips]);
  const splash = <Stage key="splash" kind="splash"><Splash /></Stage>;

  // a phone that already holds trips opens on them at once (the session is checked in the background)
  // signed in on this phone: its trips open at once, even without network; signed out: only the sign-in
  if (supabase && !authReady && !(hasStoredSession && trips.length)) return splash;
  if (supabase && authReady && !session) return <Stage key="welcome" kind="welcome"><Welcome /></Stage>;
  if (session && member !== null && !profile.onboardedAt) return <Stage key="onboarding" kind="onboarding"><Onboarding /></Stage>;
  // "Copier ce voyage" asked before signing in: back to that programme, its copy sheet open
  if (session) {
    const pending = takeRememberedCopy();
    if (pending) {
      location.replace(`${location.pathname}?t=${encodeURIComponent(pending)}&copy=1`);
      return splash;
    }
  }
  // signed in, the account not known yet and nothing on this phone: wait (a second) instead of an empty home
  if (session && member === null && !trips.length) return splash;
  if (!trips.length || home || !current)
    return (
      <Stage key="trips" kind="trips">
        <HomeScroll>
          <Trips
            onOpen={(id) => {
              rememberHomeScroll();
              switchTrip(id);
              openHome(false);
            }}
            onClose={
              trips.length && current && home && homeOpenedFromTrip()
                ? () => {
                    rememberHomeScroll();
                    openHome(false);
                  }
                : undefined
            }
          />
        </HomeScroll>
      </Stage>
    );
  if (share && session) return <Stage key="share" kind="share"><ShareTrip onClose={() => openShare(false)} /></Stage>;
  // a new trip being prepared by the AI, or waiting to be confirmed
  const draft = (allTrips[tripId]?.draft as { status?: string } | undefined)?.status;
  if (draft === "preparing" || draft === "review") return <Stage key="draft" kind="draft"><DraftScreen onClose={() => openHome(true)} /></Stage>;
  return <Stage key="app" kind="app"><App key={getLang()} /></Stage>;
}
