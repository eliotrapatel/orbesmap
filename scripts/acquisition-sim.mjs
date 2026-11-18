// Simulation of the lot « acquisition » (R07 · R08 · R10 · R14) with fake browsers, a fake Supabase and a fake clock.
// Run from the repo:  node scripts/acquisition-sim.mjs
// Nothing leaves this computer: every service is replaced in memory. Exits with code 1 when a check fails.
import { register } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import vm from "node:vm";

// Vercel runs the functions as ES modules, which need the full name ("./x.js", compiled from api/x.ts): here a ".js"
// under api/ is read from its ".ts" (same loader as scripts/prepare-sim.mjs)
register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith("./") || spec.startsWith("../")) && spec.endsWith(".js") && ctx.parentURL && ctx.parentURL.includes("/api/")) {
    return next(spec.replace(/\\.js$/, ".ts"), ctx);
  }
  return next(spec, ctx);
}`),
  import.meta.url,
);

const ROOT = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
};
const section = (s) => console.log(`\n${s}`);

// ---------------------------------------------------------------- R08: the redirect script of index.html
section("R08 · theorbes.com/maps → orbesmap.vercel.app (index.html)");
const html = read("index.html");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] || "";
check(script.includes("orbesmap.vercel.app"), "the redirect script is in index.html, before the app");

class Store {
  constructor(o = {}, throws = false) {
    this.m = new Map(Object.entries(o));
    this.throws = throws;
  }
  get length() {
    if (this.throws) throw new Error("SecurityError");
    return this.m.size;
  }
  key(i) {
    if (this.throws) throw new Error("SecurityError");
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k) {
    if (this.throws) throw new Error("SecurityError");
    return this.m.has(k) ? this.m.get(k) : null;
  }
  setItem(k, v) {
    if (this.throws) throw new Error("SecurityError");
    this.m.set(k, String(v));
  }
  removeItem(k) {
    this.m.delete(k);
  }
}
/** Runs the script in a fake page; returns where it went and what it kept */
function page(url, { local = {}, session = {}, standalone = false, referrer = "", throws = false } = {}) {
  const u = new URL(url);
  const out = { replaced: null, state: null, local: new Store(local, throws), session: new Store(session) };
  const location = {
    hostname: u.hostname,
    pathname: u.pathname,
    search: u.search,
    hash: u.hash,
    replace: (to) => (out.replaced = to),
  };
  const ctx = {
    location,
    URLSearchParams,
    URL,
    history: { state: null, replaceState: (_s, _t, to) => (out.state = to) },
    localStorage: out.local,
    sessionStorage: out.session,
    navigator: { standalone },
    matchMedia: (q) => ({ matches: standalone && q.includes("standalone") }),
    document: { referrer },
  };
  ctx.window = ctx;
  let threw = false;
  try {
    vm.runInNewContext(script, ctx);
  } catch {
    threw = true;
  }
  out.threw = threw;
  return out;
}
{
  const a = page("https://theorbes.com/maps?t=abcdefghijkl&src=wa#x", { referrer: "https://l.instagram.com/", local: { "orbes.vid": "1234abcd-ffff", "orbes.lang": "en" } });
  const to = a.replaced ? new URL(a.replaced) : null;
  check(!!to && to.origin === "https://orbesmap.vercel.app" && to.pathname === "/", "a visitor with nothing kept is sent to orbesmap.vercel.app");
  check(to?.searchParams.get("t") === "abcdefghijkl" && to?.searchParams.get("src") === "wa" && to?.hash === "#x", "the query (?t=, ?src=) and the # are kept");
  check(to?.searchParams.get("_from") === "maps" && to?.searchParams.get("_ref") === "l.instagram.com", "the redirect and the original referrer go with it");
  check(to?.searchParams.get("_vid") === "1234abcd-ffff" && to?.searchParams.get("_lang") === "en", "the visitor id and the language go with it (never an e-mail)");
  const self = page("https://theorbes.com/maps", { referrer: "https://theorbes.com/" });
  check(self.replaced && !new URL(self.replaced).searchParams.has("_ref"), "theorbes.com itself is not sent as a referrer");
  check(!!page("https://www.theorbes.com/maps").replaced, "www.theorbes.com too");
}
const stays = [
  ["signed in", { local: { "orbes.auth": "{}" } }],
  ["unsent changes", { local: { "orbes.outbox.v2": "[]" } }],
  ["a copy waiting", { local: { "orbes.copy": "abcdefghijkl" } }],
  ["an intent waiting", { local: { "orbes.intent": "{}" } }],
  ["data of the June 2026 version", { local: { gz_fv: "[]" } }],
  ["a Supabase key", { local: { "sb-x-auth-token": "{}" } }],
  ["any other orbes.* key", { local: { "orbes.settings": "{}" } }],
  ["storage that throws", { throws: true }],
  ["opened from the home screen", { standalone: true }],
];
for (const [what, o] of stays) {
  const r = page("https://theorbes.com/maps", o);
  check(!r.replaced && !r.threw, `stays on theorbes.com: ${what}`);
}
for (const q of ["#access_token=x&refresh_token=y", "?code=abc", "?reset=1", "#type=recovery&access_token=x", "#error=access_denied&error_code=otp_expired", "?token_hash=x&type=signup"]) {
  const r = page(`https://theorbes.com/maps${q}`);
  check(!r.replaced && !r.threw, `stays on theorbes.com: coming back from an e-mail link (${q})`);
}
for (const host of ["https://orbesmap.vercel.app/", "http://localhost:5178/", "https://orbesmap-git-x.vercel.app/?t=abcdefghijkl"]) {
  const r = page(host);
  check(!r.replaced && !r.state && !r.threw, `never redirected: ${new URL(host).host}`);
}
{
  const r = page("https://orbesmap.vercel.app/?t=abcdefghijkl&_from=maps&_ref=l.instagram.com&_vid=1234abcd-ffff&_lang=en&src=wa#trip", { local: {} });
  check(r.state === "/?t=abcdefghijkl&src=wa#trip", "arrival: the four parameters leave the address, the rest stays");
  check(r.local.getItem("orbes.vid") === "1234abcd-ffff" && r.local.getItem("orbes.lang") === "en", "arrival: visitor id and language kept on the new address");
  check(r.session.getItem("orbes.ref") === "l.instagram.com" && r.session.getItem("orbes.from") === "maps", "arrival: referrer and redirect kept for this opening");
  const own = page("https://orbesmap.vercel.app/?_vid=bbbbbbbb-1111&_lang=fr", { local: { "orbes.vid": "aaaaaaaa-0000", "orbes.lang": "en" } });
  check(own.local.getItem("orbes.vid") === "aaaaaaaa-0000" && own.local.getItem("orbes.lang") === "en" && own.state === "/", "arrival: an id or a language already there is never replaced");
  const bad = page("https://orbesmap.vercel.app/?_ref=%3Cscript%3E&_vid=x&_lang=de", {});
  check(!bad.session.getItem("orbes.ref") && !bad.local.getItem("orbes.vid") && !bad.local.getItem("orbes.lang") && !bad.threw, "arrival: odd values are ignored");
}

// ---------------------------------------------------------------- events: names routed to track_step, then track_event
section("Events · track_step (saas-15.sql) with track_event as before");
const SQL15 = existsSync(new URL("supabase/saas-15.sql", ROOT)) ? read("supabase/saas-15.sql") : "";
const sqlNames = [...SQL15.matchAll(/\('([a-z_]+)', 'acquisition'\)/g)].map((m) => m[1]).sort();
const clientNames = JSON.parse(/STEP_NAMES: readonly string\[\] = (\[[^\]]*\])/.exec(read("src/lib/track.ts"))?.[1] || "[]").sort();
const T = await import("../api/track.ts");
const apiNames = [...T.STEP_NAMES].sort();
check(sqlNames.length === 8 && JSON.stringify(sqlNames) === JSON.stringify(clientNames) && JSON.stringify(sqlNames) === JSON.stringify(apiNames), "the same 8 names in the SQL file, the app and api/track.ts");
const stepType = /export type Step =([\s\S]*?);\n/.exec(read("src/lib/track.ts"))?.[1] || "";
check(clientNames.every((n) => stepType.includes(`"${n}"`)), "every name is a Step of the app");
async function route(name, missing) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const fn = String(url).split("/rpc/")[1];
    const args = JSON.parse(init.body);
    calls.push({ fn, n: Object.keys(args).length });
    return new Response(null, { status: missing.includes(`${fn}:${Object.keys(args).length}`) || missing.includes(fn) ? 404 : 204 });
  };
  try {
    await T.POST(new Request("https://orbesmap.vercel.app/api/track", { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone)" }, body: JSON.stringify({ name, detail: "x", visitor: "v" }) }));
  } finally {
    globalThis.fetch = realFetch;
  }
  return calls.map((c) => `${c.fn}:${c.n}`).join(" → ");
}
check((await route("check_email_shown", [])) === "track_step:11", "a name of the lot goes to track_step");
check((await route("check_email_shown", ["track_step"])) === "track_step:11 → track_event:11", "before saas-15.sql: track_event (shared names with the lot « mesure » still recorded)");
check((await route("app_redirect", ["track_step", "track_event:11"])) === "track_step:11 → track_event:11 → track_event:6", "before saas-8.sql too: the short track_event, as today");
check((await route("visit", [])) === "track_event:11", "any other name: track_event, as today");
check((await route("visit", ["track_event:11"])) === "track_event:11 → track_event:6", "any other name before saas-8.sql: as today");

// ---------------------------------------------------------------- R07: the « Vérifiez vos e-mails » screen
section("R07 · mailbox buttons and the 60 s before « Renvoyer »");
const C = await import("../src/lib/confirmData.ts");
const ids = (e, apple = false) => C.mailersFor(e, apple).map((m) => m.id).join(",");
check(ids("a@gmail.com") === "gmail" && ids("a@googlemail.com") === "gmail", "Gmail for a Gmail address");
check(ids("a@outlook.fr") === "outlook" && ids("a@hotmail.com") === "outlook" && ids("a@live.co.uk") === "outlook" && ids("a@msn.com") === "outlook", "Outlook for Outlook / Hotmail / Live / MSN");
check(ids("a@icloud.com", true) === "mail,icloud" && ids("a@me.com") === "icloud", "iCloud (and Mail on an iPhone)");
check(ids("a@yahoo.fr") === "yahoo", "Yahoo Mail for Yahoo");
check(ids("a@orange.fr") === "gmail,outlook" && ids("a@orange.fr", true) === "gmail,outlook,mail", "an unknown domain: Gmail + Outlook (+ Mail on an iPhone)");
check(C.resendLeft(0, Date.now()) === 0 && C.resendLeft(1000, 1000) === 60 && C.resendLeft(1000, 19_500) === 42 && C.resendLeft(1000, 61_000) === 0, "« Renvoyer dans 42 s », then the button works again");

section("R07 · the single reminder of the cron (api/_confirm.ts)");
const R = await import("../api/_confirm.ts");
/** A fake world: accounts, the alert log, Supabase's resend answers, a clock */
function remindWorld({ at = "2026-11-18T10:05:00Z", users = [], sql = true, resend = () => 200, elapsed = 1000, claims = [] } = {}) {
  const now = new Date(at);
  const log = new Map(claims.map((c) => [c.key, c.at]));
  const calls = { sent: [], events: [], admin: 0, sql: 0 };
  const deps = {
    now,
    elapsed: () => elapsed,
    listSql: async () => {
      calls.sql++;
      return sql ? users.filter((u) => !u.email_confirmed_at) : "missing";
    },
    listAdmin: async (page) => {
      calls.admin++;
      return page === 1 ? users : [];
    },
    claims: async () => [...log.entries()].filter(([k]) => k.startsWith("confirm:")).map(([key, a]) => ({ key, at: a })),
    claim: async (k) => (log.has(k) ? false : (log.set(k, now.toISOString()), true)),
    unclaim: async (k) => void log.delete(k),
    resend: async (email) => {
      const st = resend(email);
      if (st >= 200 && st < 300) calls.sent.push(email);
      return st;
    },
    log: async (id, d) => void calls.events.push(`${id}:${d}`),
  };
  return { deps, log, calls, now };
}
const hoursAgo = (now, h) => new Date(Date.parse(now) - h * 3600e3).toISOString();
const NOW = "2026-11-18T10:05:00Z"; // 11:05 in Paris (winter)
const acct = (id, h, o = {}) => ({ id, email: `${id}@x.fr`, created_at: hoursAgo(NOW, h), confirmation_sent_at: hoursAgo(NOW, h), ...o });
{
  const w = remindWorld({ users: [acct("a", 1.5), acct("b", 3), acct("c", 40), acct("d", 5, { email_confirmed_at: hoursAgo(NOW, 4) }), acct("e", 5, { confirmation_sent_at: hoursAgo(NOW, 1) })] });
  const r = await R.confirmReminders(w.deps);
  check(r.sent === 1 && w.calls.sent.join() === "b@x.fr", "only the account created 2–36 h ago, never confirmed, last e-mail > 2 h ago");
  check(w.calls.events.join() === "b:reminder", "the reminder is recorded for that account (confirm_resent reminder)");
  const again = await R.confirmReminders(w.deps);
  check(again.sent === 0 && w.calls.sent.length === 1, "never twice: the next run sends nothing");
}
{
  const many = Array.from({ length: 9 }, (_, i) => acct(`u${i}`, 3 + i));
  const w = remindWorld({ users: many });
  const r1 = await R.confirmReminders(w.deps);
  check(r1.sent === 2, "at most 2 per run");
  for (const k of [...w.log.keys()]) w.log.set(k, hoursAgo(NOW, 0.5));
  w.log.set("confirm:old1", hoursAgo(NOW, 0.2));
  w.log.set("confirm:old2", hoursAgo(NOW, 0.2));
  w.log.set("confirm:old3", hoursAgo(NOW, 0.2));
  const r2 = await R.confirmReminders(w.deps);
  check(r2.sent === 1, "at most 6 per hour (5 in the last hour: one more)");
  const order = remindWorld({ users: [acct("young", 3), acct("old", 30)] });
  await R.confirmReminders(order.deps);
  check(order.calls.sent[0] === "old@x.fr", "the oldest sign-up first");
}
{
  let n = 0;
  const w = remindWorld({ users: [acct("a", 3), acct("b", 4)], resend: () => (++n === 1 ? 429 : 200) });
  const r = await R.confirmReminders(w.deps);
  check(r.sent === 0 && !w.log.has("confirm:b") && !w.log.has("confirm:a"), "Supabase answers 429: the claim is given back and the run stops");
  const r2 = await R.confirmReminders(w.deps);
  check(r2.sent === 2, "…and the next run sends it");
  const f = remindWorld({ users: [acct("a", 3)], resend: () => 422 });
  const rf = await R.confirmReminders(f.deps);
  check(rf.failed === 1 && f.log.has("confirm:a") && f.calls.events.join() === "a:reminder_failed", "another refusal: recorded, never tried again");
  const z = remindWorld({ users: [acct("a", 3)], resend: () => 0 });
  await R.confirmReminders(z.deps);
  check(!z.log.has("confirm:a"), "no answer at all: given back for a later run");
}
for (const [at, ok, what] of [
  ["2026-11-18T07:59:00Z", false, "8:59 in Paris (winter): nothing"],
  ["2026-11-18T08:00:00Z", true, "9:00 in Paris (winter): sent"],
  ["2026-11-18T19:00:00Z", false, "20:00 in Paris (winter): nothing"],
  ["2026-07-15T06:59:00Z", false, "8:59 in Paris (summer): nothing"],
  ["2026-07-15T07:00:00Z", true, "9:00 in Paris (summer): sent"],
  ["2026-07-15T17:59:00Z", true, "19:59 in Paris (summer): sent"],
]) {
  const u = { id: "a", email: "a@x.fr", created_at: hoursAgo(at, 3), confirmation_sent_at: hoursAgo(at, 3) };
  const w = remindWorld({ at, users: [u] });
  const r = await R.confirmReminders(w.deps);
  check((r.sent === 1) === ok, what);
}
{
  const w = remindWorld({ users: [acct("a", 3)], sql: false });
  const r = await R.confirmReminders(w.deps);
  check(r.sent === 1 && w.calls.admin === 1, "before saas-15.sql: the Auth admin API, filtered the same way");
  const late = remindWorld({ at: "2026-11-18T10:25:00Z", users: [acct("a", 3)], sql: false });
  const rl = await R.confirmReminders(late.deps);
  check(rl.sent === 0 && late.calls.admin === 0, "…read only at the first run of each hour");
  const conf = remindWorld({ users: [acct("a", 3, { email_confirmed_at: hoursAgo(NOW, 1) })], sql: false });
  check((await R.confirmReminders(conf.deps)).sent === 0, "…never a confirmed account");
  const slow = remindWorld({ users: [acct("a", 3)], elapsed: 41_000 });
  const rs = await R.confirmReminders(slow.deps);
  check(rs.sent === 0 && slow.calls.sql === 0, "the run has used 40 s: nothing is read or sent");
}
{
  // the cron itself: a failing reminder never stops the alerts (the call is in its own try/catch, after the e-mails)
  const cron = read("api/cron.ts");
  const iReturn = cron.indexOf("sent.returns = await welcomeBack");
  const iRemind = cron.indexOf("confirmReminders(reminderDeps(");
  const block = cron.slice(cron.lastIndexOf("try {", iRemind), iRemind);
  check(iReturn > 0 && iRemind > iReturn && block.length < 40, "the reminder runs after the alerts and the welcome-back e-mails, inside its own try/catch");
  check(/redirect_to=\$\{encodeURIComponent\(`\$\{APP_URL\}\/`\)\}/.test(cron) && /type: "signup"/.test(cron), "the same « Confirm signup » e-mail, back to orbesmap.vercel.app");
  check(!/autoconfirm|email_confirm:\s*true|confirm_email/i.test(cron + read("api/_confirm.ts")), "nothing confirms an account: the confirmation stays on");
}

// ---------------------------------------------------------------- texts: every new French text has its English
section("Texts · English for every t(\"…\") added by this lot");
{
  const { execSync } = await import("node:child_process");
  const EN = {};
  for (const f of readdirSync(new URL("src/i18n/en/", ROOT))) Object.assign(EN, (await import(new URL(`src/i18n/en/${f}`, ROOT))).default);
  let diff = "";
  try {
    const base = execSync("git merge-base HEAD refonte", { cwd: ROOT, encoding: "utf8" }).trim();
    diff = execSync(`git diff ${base} -- src`, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  } catch {
    diff = "";
  }
  const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
  const found = new Set();
  for (const m of added.matchAll(/\bt\("((?:[^"\\]|\\.)*)"/g)) found.add(JSON.parse(`"${m[1]}"`));
  // the mailbox labels are given to t() from confirmData.ts
  for (const m of read("src/lib/confirmData.ts").matchAll(/label: "([^"]+)"/g)) found.add(m[1]);
  const missing = [...found].filter((k) => !(k in EN));
  check(found.size > 0 && missing.length === 0, `${found.size} new texts, each with its English${missing.length ? ` — missing: ${missing.join(" | ")}` : ""}`);
}

// ---------------------------------------------------------------- the end
console.log(`\n${passed} ok, ${failed} failed`);
if (failed) process.exit(1);
