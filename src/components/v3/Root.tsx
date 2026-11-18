import { useEffect, useState } from "react";
import App from "../../App";
import { supabase } from "../../lib/supabase";
import { defaultTripId, hasLocalData, switchTrip, useStore, useTrips } from "../../lib/store";
import Onboarding from "./Onboarding";
import Trips from "./Trips";
import Welcome from "./Welcome";
import DraftScreen from "./DraftScreen";
import { openAdmin, openHome, openShare, useAdmin, useHome, useShare } from "./nav";
import ShareTrip from "./ShareTrip";
import ProScreen from "./ProScreen";
import AdminScreen from "./AdminScreen";
import Legal, { legalKind } from "./Legal";


/**
 * Which screen: the welcome (nobody signed in on a new phone), the onboarding (first sign-in of an account),
 * "Mes voyages" (no trip yet, or opened from the trip menu), else the trip itself.
 * The two people of the first shared space go straight to their trips, as before.
 */
export default function Root() {
  const proAsk = useStore((s) => s.proAsk);
  const admin = useAdmin();
  // the legal pages have their own address and open without an account
  const legal = legalKind(new URLSearchParams(location.search).get("p"));
  if (legal) return <Legal kind={legal} onClose={() => location.assign(location.pathname)} />;
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
  if (supabase && !authReady && !hasLocalData && !trips.length) return splash;
  if (supabase && authReady && !session && !hasLocalData) return <Welcome />;
  if (session && member === false && !profile.onboardedAt) return <Onboarding />;
  // signed in, the account not known yet and nothing on this phone: wait (a second) instead of an empty home
  if (session && member === null && !trips.length) return splash;
  if (!trips.length || home || !current)
    return (
      <Trips
        onOpen={(id) => {
          switchTrip(id);
          openHome(false);
        }}
        onClose={trips.length && current ? () => openHome(false) : undefined}
      />
    );
  if (share && session) return <ShareTrip onClose={() => openShare(false)} />;
  // a new trip being prepared by the AI, or waiting to be confirmed
  const draft = (allTrips[tripId]?.draft as { status?: string } | undefined)?.status;
  if (draft === "preparing" || draft === "review") return <DraftScreen onClose={() => openHome(true)} />;
  return <App />;
}
