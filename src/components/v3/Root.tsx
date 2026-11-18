import { useEffect, useState } from "react";
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
import { takeRememberedCopy } from "../../lib/publicTrip";
import { track } from "../../lib/track";
import { getLang, useLang } from "../../lib/i18n";


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
        {proAsk && <ProScreen />}
      </>
    );
  const screen = <Screen />;
  return (
    <>
      {screen}
      {admin && <AdminScreen onClose={() => openAdmin(false)} />}
      {proAsk && <ProScreen />}
    </>
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
  // a long wait (no network): say so instead of a black screen
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 8000);
    return () => window.clearTimeout(t);
  }, []);
  const splash = (
    <div className="v3 v3-splash" aria-busy="true">
      {slow && <p className="v3-note" style={{ textAlign: "center", padding: 24 }}>Connexion en cours… Vérifiez le réseau, l'app s'ouvrira dès qu'elle sera rétablie.</p>}
    </div>
  );

  // a phone that already holds trips opens on them at once (the session is checked in the background)
  // signed in on this phone: its trips open at once, even without network; signed out: only the sign-in
  if (supabase && !authReady && !(hasStoredSession && trips.length)) return splash;
  if (supabase && authReady && !session) return <Welcome />;
  if (session && member !== null && !profile.onboardedAt) return <Onboarding />;
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
      <Trips
        onOpen={(id) => {
          switchTrip(id);
          openHome(false);
        }}
        onClose={trips.length && current && home && homeOpenedFromTrip() ? () => openHome(false) : undefined}
      />
    );
  if (share && session) return <ShareTrip onClose={() => openShare(false)} />;
  // a new trip being prepared by the AI, or waiting to be confirmed
  const draft = (allTrips[tripId]?.draft as { status?: string } | undefined)?.status;
  if (draft === "preparing" || draft === "review") return <DraftScreen onClose={() => openHome(true)} />;
  return <App key={getLang()} />;
}
