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

// ---------------------------------------------------------------- the end
console.log(`\n${passed} ok, ${failed} failed`);
if (failed) process.exit(1);
