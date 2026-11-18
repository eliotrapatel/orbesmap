// The decisions of the invitation check at sign-in (lot cycle, R09), pure (no import), so scripts/offline-sim.mjs runs
// them under node. lib/join.ts does the calls and the waiting.

const DAY = 864e5;

/**
 * Whether the check runs for this account, and how long the screen may wait for it (splash):
 * - runs once per account and opening, with an invitation link on this device, or for a brand-new account (< 7 days)
 *   not onboarded yet (another device, no link);
 * - waits 6 s with a link, 1.5 s for an account of less than a day, never for an onboarded account without a link,
 *   never without network.
 */
export function gateDecision(o: { uid: string; ran: string; token: string | null; onboarded: boolean; age: number; online: boolean; startedAt: number | null; now: number }): { wants: boolean; limit: number; hold: boolean } {
  const wants = !!o.uid && o.ran !== o.uid && (!!o.token || (!o.onboarded && o.age < 7 * DAY));
  const limit = !o.online ? 0 : o.token ? 6000 : !o.onboarded && o.age < DAY ? 1500 : 0;
  const hold = wants && limit > 0 && o.now - (o.startedAt ?? o.now) < limit;
  return { wants, limit, hold };
}

/** What the answer of invite_claim leads to: the trip to open, and whether the link on this device is forgotten */
export function claimOutcome(r: { trip?: string; reason?: string } | null, token: string | null): { open: string | null; forget: boolean; otherEmail: boolean } {
  if (r?.trip) return { open: r.trip, forget: true, otherEmail: false };
  if (token) return { open: null, forget: true, otherEmail: r?.reason === "other_email" };
  return { open: null, forget: false, otherEmail: false };
}
