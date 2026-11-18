// Simulation of the lot "gratuit-pro": the AI relay's booking (reserve_ai2 → reserve_ai → reserve_ai_call), its
// refusals, the cheaper provider above the free budget, the Claude cost, the free plan's rules (src/lib/planRules.ts)
// and static checks of supabase/saas-13.sql.
// Run from the repo:  node scripts/gratuit-pro-sim.mjs
// Nothing leaves this computer: Supabase, DeepSeek and Claude are replaced in memory. Exits with code 1 when a check fails.
import { register } from "node:module";
import { readFileSync } from "node:fs";

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

delete process.env.AI_FREE_MONTHLY_USD;
delete process.env.AI_FREE_SLOW_DAILY_CAP;
delete process.env.AI_FREE_DAILY_CAP;
delete process.env.AI_PRO_DAILY_CAP;
delete process.env.AI_GLOBAL_DAILY_CAP;
const AI = await import("../api/ai.ts");
const R = await import("../src/lib/planRules.ts");

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
};
const tick = async (n = 6) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};
const near = (a, b) => Math.abs(a - b) < 1e-9;

// ---------- the fake world ----------
/** `r2`: reserve_ai2's answer ({status, body} | "throw"); `r1`: reserve_ai's; `r0`: reserve_ai_call's */
function world({ r2, r1 = { status: 200, body: { id: 7 } }, r0 = { status: 200, body: 9 } } = {}) {
  const calls = { rpc: [], ds: 0, finish: [], claude: 0 };
  const res = (x) => new Response(JSON.stringify(x.body ?? {}), { status: x.status, headers: { "content-type": "application/json" } });
  const f = async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    if (u.includes("/rest/v1/rpc/")) {
      const fn = u.split("/rest/v1/rpc/")[1];
      calls.rpc.push({ fn, body });
      if (fn === "reserve_ai2") {
        if (r2 === "throw") throw new Error("network");
        return res(r2 || { status: 404, body: { code: "PGRST202" } });
      }
      if (fn === "reserve_ai") return res(r1);
      if (fn === "reserve_ai_call") return res(r0);
      if (fn === "finish_ai_call2") {
        calls.finish.push(body);
        return res({ status: 204 });
      }
      return res({ status: 200, body: null });
    }
    if (u.startsWith(AI.DS_URL)) {
      calls.ds++;
      return res({ status: 200, body: { choices: [{ message: { content: JSON.stringify({ translation: "你好", pinyin: "ni hao", note: "" }) } }], usage: { prompt_cache_miss_tokens: 100, completion_tokens: 20 } } });
    }
    throw new Error("unexpected fetch " + u);
  };
  return { f, calls };
}
/** A fake Claude: one paused turn (with a fallback model), then the answer */
function claude(calls, { pause = true } = {}) {
  let n = 0;
  return {
    beta: {
      messages: {
        create: async () => {
          calls.claude++;
          n++;
          const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 100, server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 } };
          if (pause && n === 1) return { stop_reason: "pause_turn", model: "claude-opus-5", content: [], usage };
          return { stop_reason: "end_turn", model: "claude-opus-5-5", content: [{ type: "text", text: JSON.stringify({ translation: "你好", pinyin: "ni hao", note: "" }) }], usage };
        },
      },
    },
  };
}
const ask = (w, env, client) =>
  AI.handle(
    new Request("https://orbesmap.vercel.app/api/ai", {
      method: "POST",
      headers: { authorization: "Bearer tok", "content-type": "application/json", origin: "https://theorbes.com" },
      body: JSON.stringify({ task: "interpret", text: "bonjour", from: "fr", trip: { id: "trip-1", title: "Rome" } }),
    }),
    { member: async () => true, fetch: w.f, env, client },
  );
const BOTH = { DEEPSEEK_API_KEY: "ds", ANTHROPIC_API_KEY: "cl" };

// ---------- 1. the booking and its refusals ----------
console.log("1. booking (api/ai.ts reserve / handle)");
{
  const w = world({ r2: { status: 200, body: { refused: "cap", scope: "account", plan: "free", limit: 25, slowed: false } } });
  const r = await ask(w, BOTH);
  const b = await r.json();
  check(r.status === 429 && b.error === "busy" && b.reason === "cap" && b.scope === "account" && b.plan === "free" && b.limit === 25 && b.pro === 400 && b.slowed === false, "free account at its limit: 429 with reason, scope, plan, limit, the Pro limit and slowed");
  check(b.message === "Limite du jour atteinte pour les demandes à l'IA. Elle repart dans les 24 heures.", "…and today's French message for older apps");
  const a = w.calls.rpc.find((x) => x.fn === "reserve_ai2")?.body;
  check(a && a.p_cap === 25 && a.p_pro_cap === 400 && a.p_global_cap === 1500 && a.p_budget === 1 && a.p_slow_cap === 5 && a.p_task === "interpret" && a.p_trip === "trip-1", "reserve_ai2 gets the caps, the budget 1 $ and the slow cap 5 by default");
  check(!w.calls.rpc.some((x) => x.fn === "reserve_ai"), "no second booking when reserve_ai2 answered");
}
{
  const w = world({ r2: { status: 200, body: { refused: "cap", scope: "account", plan: "free", limit: 5, slowed: true } } });
  const b = await (await ask(w, BOTH)).json();
  check(b.limit === 5 && b.slowed === true, "slowed above twice the budget: the effective limit (5) and slowed");
}
{
  const w = world({ r2: { status: 200, body: { refused: "cap", scope: "global" } } });
  const b = await (await ask(w, BOTH)).json();
  check(b.scope === "global" && b.reason === "cap" && b.plan === undefined, "the whole service's limit: scope global, no plan");
}
{
  const w = world({ r2: { status: 200, body: { refused: "manual" } } });
  const r = await ask(w, BOTH);
  const b = await r.json();
  check(r.status === 403 && b.error === "pro" && b.reason === "manual" && /créé à la main/.test(b.message), "a trip created by hand: 403 pro, reason manual");
  const m = await AI.reserve("tok", "day", "trip-1", world({ r2: { status: 200, body: { refused: "manual" } } }).f);
  check(m.refused === "prep" && m.why === "manual", "reserve() hands « manual » to api/prepare.ts as « prep » (today's values)");
}
{
  const w = world({ r2: { status: 200, body: { refused: "pro" } } });
  const r = await ask(w, BOTH);
  check(r.status === 403 && (await r.json()).reason === undefined, "a validated trip: 403 as today");
}
{
  const w = world();
  const r = await ask(w, BOTH);
  const a = w.calls.rpc.find((x) => x.fn === "reserve_ai")?.body;
  check(r.status === 200 && a && Object.keys(a).sort().join() === "p_cap,p_global_cap,p_pro_cap,p_task,p_trip" && a.p_cap === 25 && a.p_pro_cap === 400 && a.p_global_cap === 1500, "reserve_ai2 missing (404): today's reserve_ai with its exact 5 arguments");
}
for (const [what, r2] of [["500", { status: 500, body: { message: "boom" } }], ["an empty answer", { status: 200, body: {} }], ["a network error", "throw"]]) {
  const w = world({ r2 });
  const r = await ask(w, BOTH);
  check(r.status === 200 && w.calls.rpc.some((x) => x.fn === "reserve_ai"), `reserve_ai2 broken (${what}): today's reserve_ai answers`);
}
{
  const w = world({ r1: { status: 404, body: {} } });
  await ask(w, BOTH);
  const a = w.calls.rpc.find((x) => x.fn === "reserve_ai_call")?.body;
  check(a && a.p_cap === 40, "both missing: the lot 2 function with its cap of 40");
}
{
  const w = world({ r1: { status: 200, body: { refused: "cap" } } });
  const r = await ask(w, BOTH);
  const b = await r.json();
  check(r.status === 429 && b.scope === undefined && b.reason === undefined && R.refusal(b).kind === "old", "today's reserve_ai refusing the cap: the old answer, read as « old » by the app");
}

// ---------- 2. the cheaper provider and the Claude cost ----------
console.log("2. providers and cost");
{
  const w = world({ r2: { status: 200, body: { id: 11, cheap: true } } });
  const r = await ask(w, { ...BOTH, AI_PROVIDER: "claude" }, claude(world().calls));
  await tick();
  check(r.status === 200 && w.calls.ds === 1, "above the free budget: DeepSeek answers even with AI_PROVIDER=claude");
  check(w.calls.finish[0]?.p_detail?.provider === "deepseek", "…and the request is logged as DeepSeek");
}
{
  const w = world({ r2: { status: 200, body: { id: 12, cheap: true } } });
  const cl = claude(w.calls);
  const r = await ask(w, { ANTHROPIC_API_KEY: "cl", AI_PROVIDER: "claude" }, cl);
  check(r.status === 200 && w.calls.ds === 0 && w.calls.claude === 2, "above the budget without a DeepSeek key: Claude still answers (never a stop)");
}
{
  const w = world({ r2: { status: 200, body: { id: 13, cheap: false } } });
  const r = await ask(w, { ...BOTH, AI_PROVIDER: "claude" }, claude(w.calls));
  await tick();
  const fin = w.calls.finish[0];
  const d = fin?.p_detail || {};
  const one = (1000 * 4 + 100 * 5 + 500 * 0.2 + 200 * 20) / 1e6 + 2 * 0.01;
  const other = (1000 * 5 + 100 * 6.25 + 500 * 0.5 + 200 * 25) / 1e6 + 2 * 0.01;
  check(r.status === 200 && w.calls.claude === 2, "Claude: the paused turn is sent back, then answers");
  check(d.hit === 1000 && d.miss === 2200 && d.out === 400 && d.search === 4 && d.fetch === 2, "Claude tokens counted over both turns (cache read → hit, new + cache write → miss, searches, pages)");
  check(near(fin.p_usd, Math.round((one + other) * 1e6) / 1e6), `Claude cost priced by the model of each answer (${fin?.p_usd} $)`);
  check(d.model === "claude-opus-5-5" && d.provider === "claude", "the model logged is the one that answered last, not « claude »");
  check(fin.p_id === 13 && fin.p_ok === true, "the booked request gets its cost");
}
{
  const u = { hit: 0, miss: 0, out: 0, search: 0, fetch: 0, usd: 0 };
  const seen = { model: "" };
  AI.addClaudeUsage(u, { usage: { input_tokens: 1e6, output_tokens: 0 } }, seen);
  check(near(u.usd, 4) && seen.model === "claude-opus-5-5", "no model in the answer: priced as claude-opus-5-5 (4 $ / 1M input)");
  AI.addClaudeUsage(u, { model: "claude-unknown-9", usage: { output_tokens: 1e6, server_tool_use: null } });
  check(near(u.usd, 24), "an unknown model: claude-opus-5-5 prices (20 $ / 1M output), no crash on a missing tool count");
  AI.addClaudeUsage(u, { model: "claude-opus-4-8-20260101", usage: { input_tokens: 1e6 } });
  check(near(u.usd, 29), "a dated model name: its family's price (claude-opus-4-8: 5 $ / 1M input)");
}

{
  // api/prepare.ts hands the booking's `cheap` to runTask (checked in scripts/prepare-sim.mjs, section 15)
  const w = world();
  const cl = claude(w.calls, { pause: false });
  const env = { ...BOTH, AI_PROVIDER: "claude" };
  const body = { plan: "Florence, 3 jours", country: "it" };
  const a = await AI.runTask("essentials", body, { env, fetch: w.f, client: cl, cheap: true }).catch((e) => e);
  check(w.calls.ds >= 1 && w.calls.claude === 0 && a.provider === "deepseek", "server preparation above the free budget: DeepSeek answers even with AI_PROVIDER=claude");
  const b = await AI.runTask("essentials", body, { env, fetch: w.f, client: cl }).catch((e) => e);
  check(w.calls.claude === 1 && b.provider === "claude", "…without cheap: AI_PROVIDER=claude answers as today");
  const w2 = world();
  const c = await AI.runTask("essentials", body, { env: { ANTHROPIC_API_KEY: "cl", AI_PROVIDER: "claude" }, fetch: w2.f, client: claude(w2.calls, { pause: false }), cheap: true }).catch((e) => e);
  check(w2.calls.ds === 0 && w2.calls.claude === 1 && c.provider === "claude", "…cheap without a DeepSeek key: Claude still answers (never a stop)");
}

// ---------- 3. the free plan's rules ----------
console.log("3. src/lib/planRules.ts");
{
  const now = Date.parse("2026-11-18T10:00:00Z");
  check(R.passUntil("2027-03-10", now) === "2027-04-09", "Pass: a trip far ahead → its end + 30 days");
  check(R.passUntil("2026-11-15", now) === "2027-01-17", "Pass: a trip just ended → at least 60 days from now");
  check(R.passUntil("2028-06-01", now) === "2027-11-18", "Pass: dates shifted far → at most 365 days from now");
  check(R.passUntil(null, now) === "2027-01-17" && R.passUntil("garbage", now) === "2027-01-17", "Pass: no (valid) end date → 60 days");
  check(R.nextMonthStart(now) === "2026-12-01", "quota back on 1 December from 18 November");
  check(R.nextMonthStart(Date.parse("2026-12-31T23:30:00Z")) === "2027-01-01", "…on 1 January from 31 December");
  const free = { pro: false, prepLeft: 0, proTrips: ["t-pass"] };
  check(R.tripPro(null, "x", false) === true, "plan unknown → Pro (nothing blocked by mistake)");
  check(R.tripPro({ ...free, pro: true }, "x", false) === true, "a Pro account → every trip");
  check(R.tripPro(free, "sha-2026", true) === true, "a code trip (Shanghai) → Pro for anyone");
  check(R.tripPro(free, "t-pass", false) === true && R.tripPro(free, "t-other", false) === false, "a free account: Pro only on its Pro trip (Pass or Pro owner)");
  check(R.quota({ ...free, pro: true }, now) === null && R.quota(null, now) === null, "no quota line for Pro or an unknown plan");
  const q = R.quota(free, now);
  check(q && q.left === false && q.back === "2026-12-01", "quota used → back on the 1st");
  check(R.quota({ ...free, prepLeft: 1 }, now)?.left === true, "quota left");
  check(R.parsePublicSlug("https://theorbes.com/maps?t=ab12cd34ef56") === "ab12cd34ef56", "slug from a theorbes.com link");
  check(R.parsePublicSlug("orbesmap.vercel.app/?t=AB12CD34EF56&copy=1") === "ab12cd34ef56", "slug from an orbesmap link without https, in capitals");
  check(R.parsePublicSlug("  ab12cd34ef56 ") === "ab12cd34ef56", "a bare slug");
  check(R.parsePublicSlug("https://orbesmap.vercel.app/p/ab12cd34ef56") === "ab12cd34ef56", "slug from the public link /p/<slug> (lot acquisition)");
  check(R.parsePublicSlug("https://orbesmap.vercel.app/p/AB12CD34EF56?src=public&by=ab12cd34") === "ab12cd34ef56", "…and from the shared link /p/<slug>?src=public&by=…");
  check(R.parsePublicSlug("https://evil.example/p/ab12cd34ef56") === null && R.parsePublicSlug("https://orbesmap.vercel.app/p/short") === null, "/p/ on another site, or a short slug → null");
  check(R.parsePublicSlug("https://evil.example/?t=ab12cd34ef56") === null && R.parsePublicSlug("hello") === null && R.parsePublicSlug("") === null, "another site, a word or nothing → null");
  check(R.refusal({ error: "busy", reason: "cap", scope: "account", plan: "free", limit: 25, pro: 400 }).kind === "free-cap", "refusal: the free account's limit");
  check(R.refusal({ error: "busy", reason: "cap", scope: "account", plan: "pro", limit: 400 }).kind === "pro-cap", "refusal: a Pro account's limit (no Pro screen)");
  check(R.refusal({ error: "busy", reason: "cap", scope: "global" }).kind === "global", "refusal: the whole service");
  check(R.refusal({ error: "busy", message: "Trop de demandes" }).kind === "old", "refusal: no scope → « old », today's behaviour");
  check(R.refusal({ error: "pro", reason: "manual" }).kind === "manual" && R.refusal(null).kind === "other", "refusal: manual; nothing → other");
  const s = R.refusal({ error: "busy", reason: "cap", scope: "account", plan: "free", limit: 5, pro: 400, slowed: true });
  check(s.limit === 5 && s.pro === 400 && s.slowed === true, "refusal carries the numbers and slowed");
}

// ---------- 4. supabase/saas-13.sql, read ----------
console.log("4. supabase/saas-13.sql (static)");
{
  const sql = readFileSync(new URL("../supabase/saas-13.sql", import.meta.url), "utf8");
  const code = sql.replace(/--[^\n]*/g, "");
  check(/^\s*begin;/m.test(code) && /^\s*commit;/m.test(code) && code.indexOf("begin;") < code.indexOf("commit;"), "one transaction (begin … commit)");
  check(code.indexOf("create table if not exists public.trip_grants") > -1 && code.indexOf("create table if not exists public.trip_grants") < code.indexOf("create or replace function public.trip_pro"), "trip_grants is created before trip_pro reads it");
  const tables = [...code.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
  check(tables.length > 0 && tables.every((t) => code.includes(`alter table public.${t} enable row level security`)), `RLS on every new table (${tables.join(", ")})`);
  const policies = [...code.matchAll(/create policy "([^"]+)" on public\.(\w+)/g)];
  check(policies.every((m) => code.indexOf(`drop policy if exists "${m[1]}" on public.${m[2]}`) > -1 && code.indexOf(`drop policy if exists "${m[1]}" on public.${m[2]}`) < m.index), "each policy is dropped first (safe to run twice)");
  const fns = [...code.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
  check(fns.every((f) => code.includes(`revoke all on function public.${f}(`) && code.includes(`grant execute on function public.${f}(`)), `revoke + grant for each function (${fns.length})`);
  check(fns.every((f) => new RegExp(`function public\\.${f}\\([^$]*?set search_path = public`, "s").test(code)), "every function sets search_path = public");
  check(/t in \('sha-2026', 'gz-2026'\)/.test(code.slice(code.indexOf("function public.trip_pro"))), "trip_pro keeps Shanghai and Guangzhou hard-coded");
  const r2 = code.slice(code.indexOf("function public.reserve_ai2"), code.indexOf("$$;", code.indexOf("function public.reserve_ai2")));
  check(/can_read_trip\(t\)/.test(r2), "reserve_ai2 only counts the trip for one of its travellers (can_read_trip)");
  check(!/'budget'\)/.test(r2) && !/refused', 'budget'/.test(r2), "no hard stop on the budget");
  check(/if not pro and coalesce\(p_budget, 0\) > 0/.test(r2), "the budget only applies when not Pro (members, admins, Pro, Pro trips: never)");
  check(/'outline', 'essentials', 'day', 'adjust', 'extract', 'intake', 'concierge'/.test(r2), "the trip preparation and creation are never slowed");
  check(/p_task = 'outline' and not own/.test(r2) && /trip_locked\(p_trip\)/.test(r2), "the « prep » and « pro » refusals are today's (own Pro, trip_locked)");
  const forbidden = ["track_event", "my_plan", "trip_locked", "upsert_place", "admin_user", "admin_funnel", "admin_overview", "admin_accounts", "is_pro", "is_pro_user"];
  check(forbidden.every((f) => !new RegExp(`function public\\.${f}\\(`).test(code)), "does not redefine track_event, my_plan, trip_locked, upsert_place, the admin's other functions, is_pro");
  check(!/function public\.reserve_ai\(/.test(code), "does not redefine the 5-argument reserve_ai");
  check(!/drop table|drop function|truncate/i.test(code), "no drop table, drop function or truncate");
  const mtp = code.slice(code.indexOf("function public.my_trip_passes"), code.indexOf("$$;", code.indexOf("function public.my_trip_passes")));
  check(/case when g\.trip_id is not null then g\.payer else o\.user_id end = auth\.uid\(\)/.test(mtp) && /p\.id = case when g\.trip_id is not null then g\.payer else o\.user_id end/.test(mtp), "a Pass names its payer only: an admin's Pass (no payer) shows no « offert par » and is nobody's « mine »");
  const grant = code.slice(code.indexOf("function public.admin_grant_trip_pass"), code.indexOf("$$;", code.indexOf("function public.admin_grant_trip_pass")));
  check(/who := coalesce\(p_payer, \(select w\.user_id from public\.trip_members w where w\.trip_id = p_trip and w\.role = 'owner'/.test(grant) && /values \(who, 'pass_granted'/.test(grant) && /values \(who, 'pass_removed'/.test(grant), "the admin's Pass events go to the payer, else to the trip's owner");
  const atp = readFileSync(new URL("../src/components/v3/AdminTripPass.tsx", import.meta.url), "utf8");
  check(/adminGrantTripPass\(tripId, null,/.test(atp) && !/payer/.test(atp.slice(atp.indexOf("export function AdminTripPass"), atp.indexOf("export function AdminTripPass") + 120)), "the admin's screen gives a Pass with no payer");
  check(/delete from public\.trip_grants where trip_id = p_trip/.test(code) && (code.match(/delete from/g) || []).length === 1, "the only delete: the admin removing a Pass");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
