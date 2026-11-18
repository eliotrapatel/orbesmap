import { useEffect } from "react";
import App from "../../App";
import { supabase } from "../../lib/supabase";
import { hasLocalData, switchTrip, useStore, useTrips } from "../../lib/store";
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
    if (!current && trips.length) switchTrip(trips[0].id);
  }, [current, trips]);

  if (supabase && !authReady) return <div className="v3 v3-splash" aria-busy="true" />;
  if (supabase && !session && !hasLocalData) return <Welcome />;
  if (session && member === false && !profile.onboardedAt) return <Onboarding />;
  // signed in, the account not known yet and nothing on this phone: wait (a second) instead of an empty home
  if (session && member === null && !trips.length) return <div className="v3 v3-splash" aria-busy="true" />;
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
