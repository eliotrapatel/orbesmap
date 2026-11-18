// The single reminder of a sign-up never confirmed (lot acquisition, R07), run by api/cron.ts after the alerts.
// Who: an account created 2 to 36 hours ago that never confirmed its address, whose last confirmation e-mail left more
// than 2 hours ago. What: the same « Confirm signup » e-mail of Supabase Auth, sent again (in the account's language,
// from the existing template). When: between 9:00 and 20:00 Paris time. Never twice: a key `confirm:<user>` is claimed in
// alert_log before sending (the log keeps 30 days, longer than the 36-hour window). Supabase's e-mail limit is shared
// with sign-ups and forgotten passwords: at most 2 per run and 4 per hour (Supabase's own limit with an e-mail provider
// is 30 per hour by default, so 26 stay for sign-ups and passwords), and the run stops at the first 429 or the first
// call that gets no answer. An account invited or created by hand is never reminded (it never asked for the e-mail).
// The confirmation stays ON: nothing here confirms an account.
// The database and the clock are given by the caller (the offline simulation replaces them: scripts/acquisition-sim.mjs).

export type Unconfirmed = { id: string; email: string; created_at: string; confirmation_sent_at?: string | null; email_confirmed_at?: string | null; invited_at?: string | null };
export type ConfirmDeps = {
  now: Date;
  /** ms since the cron run started (the reminder only goes while the run has time left) */
  elapsed: () => number;
  /** rpc unconfirmed_signups (saas-15.sql); "missing" before that file */
  listSql: () => Promise<Unconfirmed[] | "missing">;
  /** before saas-15.sql, read the Auth admin API (true only when CONFIRM_REMINDER_ADMIN=1 on Vercel): off, nothing is
   *  sent before that file, as today */
  adminFallback?: boolean;
  /** the Auth admin API, one page of 200 accounts (fallback before saas-15.sql) */
  listAdmin: (page: number) => Promise<Unconfirmed[]>;
  /** the keys `confirm:*` of alert_log, with when they were claimed */
  claims: () => Promise<{ key: string; at: string }[]>;
  claim: (key: string) => Promise<boolean>;
  unclaim: (key: string) => Promise<void>;
  /** POST /auth/v1/resend; the HTTP status (0: no answer, or none within 8 s) */
  resend: (email: string) => Promise<number>;
  /** one row in public.events for the account (confirm_resent reminder / reminder_failed) */
  log: (userId: string, detail: "reminder" | "reminder_failed") => Promise<void>;
};

export const REMIND = { minHours: 2, maxHours: 36, quietHours: 2, perRun: 2, perHour: 4, from: 9 * 60, to: 20 * 60, budgetMs: 40_000, adminPages: 3 };

/** Minutes since midnight in Paris */
export function parisMinutes(now: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return Number(p.hour) * 60 + Number(p.minute);
}

/** The accounts due for their reminder, oldest first */
export function dueAccounts(list: Unconfirmed[], now: Date): Unconfirmed[] {
  const t = now.getTime();
  return list
    .filter((u) => {
      if (!u?.id || !u.email || u.email_confirmed_at || u.invited_at) return false;
      const created = Date.parse(u.created_at);
      if (!Number.isFinite(created)) return false;
      const age = (t - created) / 3600e3;
      if (age < REMIND.minHours || age > REMIND.maxHours) return false;
      // someone who just touched « Renvoyer l'e-mail » does not get a second one right away
      const last = u.confirmation_sent_at ? Date.parse(u.confirmation_sent_at) : NaN;
      return !Number.isFinite(last) || (t - last) / 3600e3 >= REMIND.quietHours;
    })
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
}

export async function confirmReminders(d: ConfirmDeps): Promise<{ sent: number; failed: number; skipped?: string }> {
  if (d.elapsed() > REMIND.budgetMs) return { sent: 0, failed: 0, skipped: "time" };
  const min = parisMinutes(d.now);
  if (min < REMIND.from || min >= REMIND.to) return { sent: 0, failed: 0, skipped: "night" };
  let list = await d.listSql();
  if (list === "missing") {
    if (!d.adminFallback) return { sent: 0, failed: 0, skipped: "missing" };
    // before saas-15.sql: the Auth admin API, read only at the first run of each hour (the cron runs every 10 minutes)
    if (min % 60 >= 10) return { sent: 0, failed: 0, skipped: "hourly" };
    const all: Unconfirmed[] = [];
    for (let page = 1; page <= REMIND.adminPages; page++) {
      const rows = await d.listAdmin(page);
      all.push(...rows);
      if (rows.length < 200) break;
    }
    list = all;
  }
  const due = dueAccounts(list, d.now);
  if (!due.length) return { sent: 0, failed: 0 };
  const log = await d.claims();
  const done = new Set(log.map((r) => r.key));
  const hourAgo = d.now.getTime() - 3600e3;
  const lastHour = log.filter((r) => Date.parse(r.at) > hourAgo).length;
  let budget = Math.min(REMIND.perRun, REMIND.perHour - lastHour);
  let sent = 0;
  let failed = 0;
  let tries = 0;
  for (const u of due) {
    if (budget <= 0 || tries >= REMIND.perRun * 2 || d.elapsed() > REMIND.budgetMs) break;
    const key = `confirm:${u.id}`;
    if (done.has(key)) continue;
    // claimed before sending: two runs at the same time never send it twice
    if (!(await d.claim(key))) continue;
    tries++;
    const status = await d.resend(u.email).catch(() => 0);
    if (status === 429) {
      // Supabase's e-mail limit is reached (nothing was sent): the claim is given back, tried again on a later run,
      // nothing more now
      await d.unclaim(key).catch(() => undefined);
      break;
    }
    if (status === 0) {
      // no answer (network, or none within 8 s): the e-mail may have left, so the claim is kept (never twice) and
      // nothing more is tried now
      failed++;
      await d.log(u.id, "reminder_failed").catch(() => undefined);
      break;
    }
    if (status >= 200 && status < 300) {
      sent++;
      budget--;
      await d.log(u.id, "reminder").catch(() => undefined);
    } else {
      // another refusal (the account confirmed meanwhile, an invalid address…): never tried again
      failed++;
      await d.log(u.id, "reminder_failed").catch(() => undefined);
    }
  }
  return { sent, failed };
}
