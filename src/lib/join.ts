// An invited person signs in (lot cycle, R09): the trip they were invited to opens at once, before the taste
// questions (asked at the next opening instead). With the invitation link on this device, or, on another device, the
// newest invitation of the confirmed address (supabase/saas-14.sql invite_claim). Accounts already onboarded never
// wait; a brand-new account waits at most 1.5 s for the answer (6 s with a link). Before saas-14: nothing happens.
import { useEffect, useState, useSyncExternalStore } from "react";
import { supabase } from "./supabase";
import { pull, switchTrip, toast, tripIds, useStore } from "./store";
import { acceptInvites } from "./share";
import { forgetJoin, joinToken } from "./entry";
import { openHome } from "../components/v3/nav";
import { t } from "./i18n";

const DEFER_KEY = "orbes.join.defer";
/** The onboarding waits for the next opening of the app: a trip was just opened from an invitation */
export function onboardingDeferred(): boolean {
  try {
    return sessionStorage.getItem(DEFER_KEY) === "1";
  } catch {
    return false;
  }
}
function defer() {
  try {
    sessionStorage.setItem(DEFER_KEY, "1");
  } catch {
    /* ignore: the onboarding shows as today */
  }
}

let ran = "";
let busy = "";
const started: Record<string, number> = {};
let version = 0;
const subs = new Set<() => void>();
const notify = () => {
  version++;
  subs.forEach((f) => f());
};
const waitFor = (ok: () => boolean, ms: number) =>
  new Promise<void>((resolve) => {
    const end = Date.now() + ms;
    const step = () => (ok() || Date.now() > end ? resolve() : window.setTimeout(step, 200));
    step();
  });

async function runJoin(uid: string, token: string | null) {
  busy = uid;
  notify();
  try {
    if (!supabase) return;
    await acceptInvites();
    const { data, error } = await supabase.rpc("invite_claim", { p_token: token });
    // saas-14 not run yet (or no network): nothing changes
    if (error) return;
    const r = (data || {}) as { trip?: string; reason?: string };
    if (r.trip) {
      defer();
      forgetJoin();
      await pull().catch(() => undefined);
      await waitFor(() => tripIds().includes(r.trip!), 8000);
      switchTrip(r.trip);
      openHome(false);
    } else if (token) {
      if (r.reason === "other_email") toast(t("Cette invitation concerne une autre adresse e-mail."));
      forgetJoin();
    }
  } catch {
    /* offline: tried again at the next opening */
  } finally {
    ran = uid;
    busy = "";
    notify();
  }
}

/** Runs the invitation check for the signed-in account; true while the screen should wait for it (splash) */
export function useJoinGate(): boolean {
  const session = useStore((s) => s.session);
  const onboarded = useStore((s) => !!s.profile.onboardedAt);
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => {
        subs.delete(f);
      };
    },
    () => version,
  );
  const [, force] = useState(0);
  const uid = session?.user.id || "";
  const token = uid ? joinToken() : null;
  const created = Date.parse(session?.user.created_at || "");
  const age = Number.isFinite(created) ? Date.now() - created : Infinity;
  const wants = !!uid && ran !== uid && (!!token || (!onboarded && age < 7 * 864e5));
  // without network nothing is held (the check runs again at the next opening)
  const online = typeof navigator === "undefined" || navigator.onLine !== false;
  const limit = !online ? 0 : token ? 6000 : !onboarded && age < 864e5 ? 1500 : 0;
  if (wants && limit && started[uid] == null) started[uid] = Date.now();
  const hold = wants && limit > 0 && Date.now() - (started[uid] ?? 0) < limit;
  useEffect(() => {
    if (!wants || busy === uid) return;
    void runJoin(uid, token);
  }, [uid, wants]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!hold) return;
    const tm = window.setTimeout(() => force((x) => x + 1), Math.max(50, limit - (Date.now() - (started[uid] ?? 0)) + 30));
    return () => window.clearTimeout(tm);
  }, [hold]); // eslint-disable-line react-hooks/exhaustive-deps
  return hold;
}
