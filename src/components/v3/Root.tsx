import { useEffect, useState } from "react";
import App from "../../App";
import { supabase } from "../../lib/supabase";
import { defaultTripId, hasLocalData, switchTrip, useStore, useTrips } from "../../lib/store";
import Onboarding from "./Onboarding";
import Trips from "./Trips";
import Welcome from "./Welcome";
import { openHome, useHome } from "./nav";


/**
 * Which screen: the welcome (nobody signed in on a new phone), the onboarding (first sign-in of an account),
 * "Mes voyages" (no trip yet, or opened from the trip menu), else the trip itself.
 * The two people of the first shared space go straight to their trips, as before.
 */
export default function Root() {
  const authReady = useStore((s) => s.authReady);
  const session = useStore((s) => s.session);
  const member = useStore((s) => s.member);
  const profile = useStore((s) => s.profile);
  const tripId = useStore((s) => s.tripId);
  const trips = useTrips();
  const home = useHome();
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
  return <App />;
}
