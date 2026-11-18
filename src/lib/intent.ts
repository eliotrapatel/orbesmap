// The intent of a visitor (lot acquisition): kept on this device and in the account's metadata (Supabase Auth only,
// no table, works before any SQL file). See intentData.ts for what an intent is.
import type { Session } from "@supabase/supabase-js";
import { intentKey, parseIntent, usableIntent, type Intent } from "./intentData";
import { supabase } from "./supabase";

const DEVICE_KEY = "orbes.intent";
const USED_KEY = "orbes.intent.used";
const today = () => new Date().toISOString().slice(0, 10);

/** Keeps the intent on this device (the account gets it at sign-up) */
export function saveDeviceIntent(i: Intent) {
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(i));
  } catch {
    /* ignore */
  }
}
export function deviceIntent(): Intent | null {
  try {
    return parseIntent(JSON.parse(localStorage.getItem(DEVICE_KEY) || "null"));
  } catch {
    return null;
  }
}
export function accountIntent(session: Session | null | undefined): Intent | null {
  return parseIntent(session?.user?.user_metadata?.intent);
}

function usedHere(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(USED_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
/** Already used on this device (marked before the account's metadata was updated) */
export const usedOnDevice = (i: Intent) => usedHere().includes(intentKey(i));

/**
 * Marks the intent used: first on this device (synchronous, survives a reload or an update cut by leaving the page),
 * then on the account. The account keeps it (with `used`): the sign-up stays credited to the shared trip.
 * Resolves once the account is updated, or failed (never throws).
 */
export function markIntentUsed(i: Intent, session: Session | null | undefined): Promise<void> {
  try {
    const keys = [...usedHere().filter((k) => k !== intentKey(i)), intentKey(i)].slice(-10);
    localStorage.setItem(USED_KEY, JSON.stringify(keys));
    const dev = deviceIntent();
    if (dev && intentKey(dev) === intentKey(i)) localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* ignore */
  }
  const acc = accountIntent(session);
  if (!supabase || !session || !acc || intentKey(acc) !== intentKey(i) || acc.used) return Promise.resolve();
  return supabase.auth.updateUser({ data: { intent: { ...acc, used: Date.now() } } }).then(
    () => undefined,
    () => undefined,
  );
}

/** The usable intent of a kind: the account's first, else this device's; never one already used here */
export function takeIntent(session: Session | null | undefined, kind: Intent["kind"]): { intent: Intent; from: "account" | "device" } | null {
  const now = Date.now();
  const acc = usableIntent(accountIntent(session), now, today(), "account");
  if (acc && acc.kind === kind && !usedOnDevice(acc)) return { intent: acc, from: "account" };
  const dev = usableIntent(deviceIntent(), now, today(), "device");
  if (dev && dev.kind === kind && !usedOnDevice(dev)) return { intent: dev, from: "device" };
  return null;
}
