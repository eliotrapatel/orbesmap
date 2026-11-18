// Simulation of the measure lot (R03 + R11): the source of a link (src/lib/source.ts), api/track.ts and its chain of
// database versions, the tagged links of api/prepare.ts and api/cron.ts, and a reading of supabase/saas-12.sql.
// Run from the repo:  node scripts/mesure-sim.mjs
// Nothing leaves this computer (fetch is replaced in memory). Exits with code 1 when a check fails.
import { register } from "node:module";
import fs from "node:fs";

// "./x.js" under api/ is read from its ".ts" (see scripts/prepare-sim.mjs)
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

process.env.SUPABASE_SERVICE_ROLE_KEY = "";
const S = await import("../src/lib/source.ts");
const T = await import("../api/track.ts");
const P = await import("../api/prepare.ts");
const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
};

// ---------- 1. the source of a link ----------
console.log("1. readLanding, tagUrl, tagAppLinks");
{
  const l = S.readLanding("?t=abcdefghij&src=Email_Day&by=ab12cd34ef");
  check(l.src === "email_day" && l.by === "ab12cd34ef", "a channel and a sharer are read (lowercase)");
  check(S.readLanding("?src=a@b.com&by=ab12cd34ef").src === null, "an e-mail as channel is refused");
  check(S.readLanding("?src=invite&by=eliot.rapatel@gmail.com").by === null, "an e-mail as sharer is refused");
  check(S.readLanding("?src=invite&by=eliotrapatel").by === null, "a plain name as sharer is refused (no digit)");
  check(S.readLanding("?src=invite&by=ab12").by === null && S.readLanding("?src=invite&by=ab12cd34ef56gh78ij").by === null, "a sharer too short or too long is refused");
  check(S.readLanding("?src=<script>").src === null && S.readLanding("?src=e").src === null && S.readLanding(`?src=${"a".repeat(25)}`).src === null, "special characters, too short, too long: refused");
  check(S.readLanding("?by=ab12cd34ef").by === null, "a sharer without a channel is not kept");
  check(S.readLanding("").src === null && S.readLanding("?t=abc").src === null, "no source: nothing");
  check(S.withoutSource("?t=abcdefghij&src=public&by=ab12cd34ef") === "?t=abcdefghij", "the address keeps ?t= without src and by");
  check(S.withoutSource("?src=email_day") === "" && S.withoutSource("?join=xyz&src=invite") === "?join=xyz" && S.withoutSource("?code=abc") === "?code=abc", "only src and by are taken out (?join=, Supabase's code= stay)");

  check(S.tagUrl("https://theorbes.com/maps?t=abcdefghij", "public", "ab12cd34ef") === "https://theorbes.com/maps?t=abcdefghij&src=public&by=ab12cd34ef", "public link: added after ?t=");
  check(S.tagUrl("https://orbesmap.vercel.app", "invite") === "https://orbesmap.vercel.app/?src=invite", "bare domain: « / » then ?src=");
  check(S.tagUrl("https://orbesmap.vercel.app/#sha-2026", "email_day") === "https://orbesmap.vercel.app/?src=email_day#sha-2026", "before the #trip");
  check(S.tagUrl("https://orbesmap.vercel.app/?join=abc#t1", "invite", "ab12cd34ef") === "https://orbesmap.vercel.app/?join=abc&src=invite&by=ab12cd34ef#t1", "an existing query (?join=) is kept");
  check(S.tagUrl("https://orbesmap.vercel.app/?join=abc&src=invite", "whatsapp") === "https://orbesmap.vercel.app/?join=abc&src=invite", "a link that already says its channel is never tagged twice");
  check(S.tagUrl("https://theorbes.com/maps?t=abcdefghij", "public", null) === "https://theorbes.com/maps?t=abcdefghij&src=public", "no sharer code yet: the channel alone");
  check(S.tagUrl("https://theorbes.com/maps?t=abcdefghij", "public", "Eliot Rapatel") === "https://theorbes.com/maps?t=abcdefghij&src=public", "a name is never put in a link");
  check(S.tagUrl("https://x.test/a", "BAD CHANNEL!") === "https://x.test/a", "an invalid channel leaves the link as it is");

  // the real invitation messages, French and English
  const enLib = read("src/i18n/en/lib.ts");
  const fr = "Eliot vous invite à rejoindre le voyage « Shanghai » sur ORBES Trips. Ouvrez https://orbesmap.vercel.app et connectez-vous avec cette adresse e-mail : le voyage apparaîtra dans « Mes voyages ».";
  const enMsg = /"\{inviter\} invited you[^"]+"/.exec(enLib)?.[0].slice(1, -1).replace("{inviter}", "Eliot").replace("{title}", "Shanghai");
  const tf = S.tagAppLinks(fr, "invite", "ab12cd34ef");
  check(tf === fr.replace("https://orbesmap.vercel.app", "https://orbesmap.vercel.app/?src=invite&by=ab12cd34ef"), "French invitation: only the link changes");
  check(!!enMsg && S.tagAppLinks(enMsg, "whatsapp", null) === enMsg.replace("https://orbesmap.vercel.app", "https://orbesmap.vercel.app/?src=whatsapp"), "English invitation: only the link changes");
  check(S.tagAppLinks("rien à changer", "invite") === "rien à changer", "a message without the link is unchanged");
  const shareSrc = read("src/lib/share.ts");
  check(/tagAppLinks\(/.test(shareSrc) && /inviteMessage\(tripTitle, inviter, "whatsapp"\)/.test(shareSrc), "share.ts: invitation tagged « invite », WhatsApp « whatsapp »");
  check(/shareUrl = \(slug: string\) => tagUrl\(linkUrl\(slug\), "public", refCode\(\)\)/.test(read("src/lib/publicTrip.ts")), "publicTrip.ts: the shared public link says « public » and its sharer");
  check(/navigator\.share\(\{ title, text, url: sent \}\)/.test(read("src/components/v3/ShareTrip.tsx")) && /writeText\(sent\)/.test(read("src/components/v3/ShareTrip.tsx")), "ShareTrip: shares and copies the tagged link, shows the short one");
}

// ---------- 2. api/track.ts and the versions of track_event ----------
console.log("2. api/track.ts: 13 → 11 → 6 arguments");
{
  const realFetch = globalThis.fetch;
  const run = async (body, statuses) => {
    const sent = [];
    let i = 0;
    globalThis.fetch = async (url, init) => {
      sent.push({ url: String(url), args: JSON.parse(init.body), auth: init.headers.authorization });
      const st = statuses[Math.min(i++, statuses.length - 1)];
      if (st === "throw") throw new Error("network");
      return new Response(st === 204 ? null : "{}", { status: st });
    };
    const req = new Request("https://orbesmap.vercel.app/api/track", { method: "POST", headers: { "content-type": "application/json", origin: "https://theorbes.com", "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", "x-vercel-ip-city": "Paris", "x-vercel-ip-country": "FR" }, body: typeof body === "string" ? body : JSON.stringify(body) });
    let res;
    try {
      res = await T.POST(req);
    } catch (e) {
      res = { status: `threw ${e}` };
    }
    return { res, sent };
  };
  const step = { name: "visit", detail: null, device: "phone", ref: null, visitor: "v-1", trip: null };
  let r = await run(step, [204]);
  check(r.res.status === 204 && r.sent.length === 1 && Object.keys(r.sent[0].args).length === 11 && !("p_src" in r.sent[0].args), "no source: the 11-argument version, as today");
  r = await run({ ...step, src: "email_day", by: "ab12cd34ef" }, [204]);
  check(r.sent.length === 1 && Object.keys(r.sent[0].args).length === 13 && r.sent[0].args.p_src === "email_day" && r.sent[0].args.p_by === "ab12cd34ef" && r.sent[0].args.p_city === "Paris", "with a source: the 13-argument version (city kept)");
  r = await run({ ...step, src: "invite" }, [404, 204]);
  check(r.sent.length === 2 && Object.keys(r.sent[1].args).length === 11, "before saas-12.sql (404): the same step without its source");
  r = await run({ ...step, src: "invite" }, [404, 404, 204]);
  check(r.sent.length === 3 && Object.keys(r.sent[2].args).length === 6, "before saas-8.sql (404, 404): the first version");
  r = await run({ ...step, src: "invite" }, ["throw", 204]);
  check(r.res.status === 204 && r.sent.length === 2 && Object.keys(r.sent[1].args).length === 11, "network error on the full version: sent again without source");
  r = await run(step, ["throw"]);
  check(r.res.status === 204, "network down: still 204, never throws");
  r = await run("{not json", [204]);
  check(r.res.status === 204 && r.sent.length === 0, "invalid JSON: 204, nothing sent");
  r = await run("null", [204]);
  check(r.res.status === 204 && r.sent.length === 0, "JSON null: 204, nothing sent");
  r = await run({ ...step, src: "x".repeat(200), by: "y".repeat(200) }, [204]);
  check(r.sent[0].args.p_src.length === 24 && r.sent[0].args.p_by.length === 16, "long values are cut before the database checks them");
  globalThis.fetch = realFetch;
}

// ---------- 3. the « ready » notification and e-mail ----------
console.log("3. api/prepare.ts sendReady: tagged links");
{
  const pushed = [];
  const mailed = [];
  const db = { profile: async () => ({ name: "Eliot", lang: "fr" }), pushSubs: async () => [{ endpoint: "e", p256dh: "p", auth: "a" }], dropPushSub: async () => {}, email: async () => "e@x.test" };
  const deps = { db, push: async (_s, payload) => void pushed.push(payload), mail: async (to, subject, html, text) => (mailed.push({ html, text }), true) };
  check((await P.sendReady(deps, "trip-1", { title: "Florence" }, "user-1")) === "push", "a phone: notification");
  check(pushed[0]?.url === "https://orbesmap.vercel.app/?src=push_ready#trip-1", "notification link: src=push_ready, #trip kept");
  const noPhone = { ...deps, db: { ...db, pushSubs: async () => [] } };
  check((await P.sendReady(noPhone, "trip-1", { title: "Florence" }, "user-1")) === "mail", "no phone: e-mail");
  check(mailed[0]?.html.includes('href="https://orbesmap.vercel.app/?src=email_ready#trip-1"') && mailed[0]?.text.includes("https://orbesmap.vercel.app/?src=email_ready#trip-1"), "e-mail link (button and text): src=email_ready, #trip kept");
}

// ---------- 4. api/cron.ts ----------
console.log("4. api/cron.ts: e-mail links tagged, notification links unchanged");
{
  const c = read("api/cron.ts");
  check(/const mailUrl = `\$\{APP_URL\}\/\?src=email_day#\$\{trip\.id\}`/.test(c) && /<a href="\$\{mailUrl\}"/.test(c) && /closedNames\.join\(", "\)\) : "", mailUrl\]/.test(c), "day e-mail: button and text say src=email_day");
  check(/const url = `\$\{APP_URL\}\/#\$\{trip\.id\}`;/.test(c) && /tag: `day-\$\{trip\.id\}` \}\)/.test(c) && /url, tag: `day-/.test(c) && /url, tag: `stop-/.test(c), "day and stop notifications keep the plain link (no reload of an open app)");
  check(/const tripUrl = `\$\{APP_URL\}\/\?src=email_back#\$\{trip\.id\}`/.test(c) && /const nextUrl = `\$\{APP_URL\}\/\?src=email_back`/.test(c) && /<a href="\$\{nextUrl\}"/.test(c), "back-home e-mail: both links say src=email_back");
}

// ---------- 5. supabase/saas-12.sql, read ----------
console.log("5. supabase/saas-12.sql");
{
  const sql = read("supabase/saas-12.sql");
  const track = read("src/lib/track.ts");
  const stepType = /export type Step =([\s\S]*?);\n/.exec(track)[1];
  const steps = [...stepType.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const fn13 = sql.slice(sql.indexOf("create or replace function public.track_event(p_name text, p_detail text, p_device text, p_ref text, p_visitor text, p_trip text,\n                                              p_city text, p_country text, p_region text, p_os text, p_browser text,\n                                              p_src text, p_by text)"));
  const list = /array\[([\s\S]*?)\]\);/.exec(fn13)?.[1] || "";
  const listed = new Set([...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  const missingSql = steps.filter((s) => !listed.has(s));
  check(steps.length >= 60 && missingSql.length === 0, `every step of the app is accepted by the server (${steps.length} names)${missingSql.length ? `; missing: ${missingSql.join(", ")}` : ""}`);
  const asked = "create_started first_day_opened paywall_closed landing_cta public_link_created public_cta_clicked trip_shared_whatsapp onboarding_done signup_submitted email_confirmed prep_started prep_ready prep_failed invite_accepted check_email_shown confirm_resent quota_seen manual_trip_created validate_explained trip_pass_granted ai_budget_hit landing_destination invite_email_sent reminder_sent offline_ready offline_reminder_sent".split(" ");
  check(asked.every((n) => steps.includes(n) && listed.has(n)), "the 26 names the other lots will send: in the app's list and the server's");
  check(/to_regclass\('public\.event_names'\)/.test(fn13) && /execute 'select exists \(select 1 from public\.event_names where name = \$1\)'/.test(fn13), "names registered by other lots in event_names are accepted too (when that table exists)");
  check(/>= 5000/.test(fn13) && />= 500000/.test(fn13) && /interval '13 months' order by id limit 100/.test(fn13), "same limits and same 13-month cleaning as saas-11.sql");
  check(/p_name in \('email_confirmed', 'invite_accepted'\) and auth\.uid\(\) is null then return/.test(fn13), "steps written once: never from a device not signed in");
  check(/if b = auth\.uid\(\) then b := null/.test(fn13), "nobody counts as their own sharer");
  // the older versions: same signatures and defaults, calling the full one
  check(/create or replace function public\.track_event\(p_name text, p_detail text default null, p_device text default null, p_ref text default null,\s*p_visitor text default null, p_trip text default null\)/.test(sql), "6-argument version: same parameter names and defaults as saas-5/6");
  check((sql.match(/perform public\.track_event\(/g) || []).length === 2, "the 11 and 6 versions call the full one (one list)");
  for (const sig of ["text, text, text, text, text, text", "text, text, text, text, text, text, text, text, text, text, text", "text, text, text, text, text, text, text, text, text, text, text, text, text"])
    check(sql.includes(`revoke all on function public.track_event(${sig}) from public;`) && sql.includes(`grant execute on function public.track_event(${sig}) to anon, authenticated;`), `track_event(${sig.split(",").length} args): revoke / grant`);
  // idempotent, nothing removed
  check(!/create table (?!if not exists)/i.test(sql) && !/create (unique )?index (?!if not exists)/i.test(sql), "every table and index: if not exists");
  check(!/add column (?!if not exists)/i.test(sql), "every column: add column if not exists");
  const policies = [...sql.matchAll(/create policy "([^"]+)" on ([\w.]+)/g)];
  check(policies.length > 0 && policies.every(([, name, table]) => sql.includes(`drop policy if exists "${name}" on ${table};`)), "every policy dropped first");
  const tables = [...sql.matchAll(/create table if not exists ([\w.]+)/g)].map((m) => m[1]);
  check(tables.length === 1 && tables.every((tb) => sql.includes(`alter table ${tb} enable row level security;`)), "row level security on every new table");
  check(/drop trigger if exists trip_members_invite_accepted on public\.trip_members;/.test(sql), "trigger dropped first");
  check(!/drop table|drop function|truncate/i.test(sql), "no table or function dropped");
  check((sql.match(/delete from/gi) || []).length === 1, "no delete besides the 13-month cleaning");
  check(!/accept_invites|function public\.admin_user\(|function public\.admin_funnel\(/.test(sql.replace(/^--.*$/gm, "")), "accept_invites, admin_user, admin_funnel untouched");
  // every function: security definer with search_path, revoke and grant as the earlier files
  const fns = [...sql.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)/g)];
  for (const [, name] of fns) {
    if (name === "public.track_event" || name === "public.log_invite_accepted") continue;
    check(sql.includes(`revoke all on function ${name}(`), `${name}: revoke`);
  }
  for (const name of ["public.admin_cohorts", "public.admin_channels", "public.admin_user_sources"]) {
    const body = sql.slice(sql.indexOf(`create or replace function ${name}(`));
    check(/if not public\.is_admin\(\) then raise exception 'admin only' using errcode = '42501'/.test(body.slice(0, 1500)) && sql.includes(`grant execute on function ${name}(`) && new RegExp(`revoke all on function ${name.replace(".", "\\.")}\\([^)]*\\) from public, anon;`).test(sql), `${name}: admin only, revoke from public/anon, grant to authenticated`);
  }
  check(/revoke all on function public\.m_validated_at\(uuid\) from public, anon, authenticated;/.test(sql) && /revoke all on function public\.m_ready_at\(uuid\) from public, anon, authenticated;/.test(sql), "internal helpers: nobody calls them directly");
  check(/revoke all on function public\.my_ref_code\(\) from public, anon;/.test(sql) && /grant execute on function public\.my_ref_code\(\) to authenticated;/.test(sql), "my_ref_code: signed-in accounts only");
  check(/exception when others then\s*null;\s*end;\s*return new;/.test(sql), "the invitation trigger never refuses a join (errors ignored, row unchanged)");
  check(/new\.user_id is distinct from auth\.uid\(\) or new\.role = 'owner'/.test(sql), "the owner's own row, or a row added by someone else (or the SQL editor): nothing written");
  check(/'Lancez d''abord supabase\/saas-11\.sql, puis ce fichier\.'/.test(sql) && !/saas-1[345]/.test(sql.replace(/^--.*$/gm, "")), "needs only saas-11.sql (no other new file)");
  const ins = sql.match(/insert into public\.events[\s\S]*?;/g) || [];
  check(ins.length >= 3 && ins.every((x) => /on conflict do nothing/.test(x)), "every write into events: on conflict do nothing (a step written once is never doubled)");
}

// ---------- 6. the app's steps ----------
console.log("6. The app's steps (R03 clean-up)");
{
  const has = (f, re) => re.test(read(f));
  check(has("src/components/v3/AuthBox.tsx", /track\("signup_email"\)/) && has("src/components/v3/AuthBox.tsx", /track\("signup_submitted"\)/) && !has("src/components/v3/AuthBox.tsx", /track\("signup_done"\)/), "AuthBox: signup_email (attempt), signup_submitted (accepted)");
  check(has("src/components/v3/Onboarding.tsx", /track\("onboarding_done"\)/) && !has("src/components/v3/Onboarding.tsx", /signup_done/), "Onboarding: onboarding_done instead of a second signup_done");
  check(!has("src/components/v3/Concierge.tsx", /track\("trip_created"/) && has("src/components/v3/CreateWizard.tsx", /track\("trip_created", w\.from === "concierge" \? "concierge" : null, id\)/), "one trip_created per trip (the concierge's detail kept)");
  check(has("src/lib/publicTrip.ts", /track\("public_link_created"/) && has("src/components/v3/PublicTripPage.tsx", /track\("public_cta_clicked", "brand_cta"\)/) && !has("src/lib/publicTrip.ts", /"link_opened"/) && !has("src/components/v3/PublicTripPage.tsx", /"link_opened"/), "link_opened split in public_link_created / public_cta_clicked");
  check(has("src/components/v3/Trips.tsx", /track\("create_started", quota \? "quota" : null\)/), "create_started before the quota");
  check(has("src/App.tsx", /trackOnce\("first_day_opened", trip\.id, d, trip\.id\)/), "first_day_opened once per trip");
  check(has("src/components/v3/ProScreen.tsx", /track\("paywall_closed", why\); closePro\(\);/), "paywall_closed on the ✕ of the Pro screen");
  check(has("src/components/v3/Welcome.tsx", /track\("landing_cta", m\)/), "landing_cta on the landing's buttons");
  check(has("src/components/v3/InviteTravellers.tsx", /onClick=\{\(\) => track\("trip_shared_whatsapp", "invite", trip\.id\)\}/), "trip_shared_whatsapp sent at last");
  const tr = read("src/lib/track.ts");
  check(/const SOURCED = new Set<Step>\(\["visit", "app_open", "public_view"\]\)/.test(tr) && /history\.replaceState\(history\.state, ""/.test(tr), "track.ts: the source goes with visit / app_open / public_view and leaves the address");
  check(/rpc\("track_event", \{ p_name: body\.name, p_detail: body\.detail, p_device: body\.device, p_ref: body\.ref, p_visitor: body\.visitor, p_trip: body\.trip \}\)/.test(tr), "track.ts: the direct fallback (6 arguments) unchanged");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
