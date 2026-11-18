// Simulation of the server preparation (api/prepare.ts) with a fake database, a fake AI and a fake OpenStreetMap.
// Run from the repo:  node scripts/prepare-sim.mjs
// Nothing leaves this computer: every service is replaced in memory. Exits with code 1 when a check fails.
import { register } from "node:module";

// Vercel runs the functions as ES modules, which need the full name: "./ai.js" (compiled from api/ai.ts). Here, the
// sources are read directly, so a ".js" under api/ is read from its ".ts". A name without its extension still fails,
// as it would on Vercel.
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
const P = await import("../api/prepare.ts");
const { TaskFailure } = await import("../api/ai.ts");

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
};
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const tick = () => new Promise((r) => setImmediate(r));

// ---------- the fake world ----------
function world(opts = {}) {
  const clock = { t: Date.parse("2026-11-18T10:00:00Z") };
  let seq = 0;
  const stamp = () => new Date(clock.t).toISOString().replace("Z", `${String(++seq).padStart(6, "0")}+00:00`);
  const trips = new Map();
  const places = new Map(); // trip → Map(id → {data, updatedAt})
  const scratch = new Map();
  const usage = new Map();
  const members = new Map();
  const subs = new Map();
  const calls = { ai: [], geocode: 0, push: [], mail: [], kicks: [], photoKicks: [], reserve: [], inserts: 0 };
  let usageId = 100;
  const db = {
    async getTrip(id) {
      await tick();
      const r = trips.get(id);
      return r ? { data: clone(r.data), updatedAt: r.updatedAt } : null;
    },
    async patchTrip(id, data, updatedAt) {
      await tick();
      const r = trips.get(id);
      if (!r || r.updatedAt !== updatedAt) return false;
      trips.set(id, { data: clone(data), updatedAt: stamp() });
      return true;
    },
    async role(tripId, userId) {
      return members.get(`${tripId}:${userId}`) || null;
    },
    async listPlaces(tripId) {
      await tick();
      return [...(places.get(tripId) || new Map()).entries()].map(([id, r]) => ({ id, data: clone(r.data), updatedAt: r.updatedAt }));
    },
    async insertPlace(tripId, id, data) {
      await tick();
      calls.inserts++;
      if (!places.has(tripId)) places.set(tripId, new Map());
      // on conflict do nothing (the primary key is trip_id, place_id)
      if (places.get(tripId).has(id)) return;
      if (opts.insertFails && opts.insertFails.times > 0 && !opts.insertFails.after) {
        opts.insertFails.times--;
        throw new Error("db 500 /rest/v1/places");
      }
      places.get(tripId).set(id, { data: clone(data), updatedAt: stamp() });
      // written, then the call is cut before it notes it
      if (opts.insertFails && opts.insertFails.times > 0 && opts.insertFails.after) {
        opts.insertFails.times--;
        throw new Error("call cut after the insert");
      }
    },
    async patchPlace(tripId, id, data, updatedAt) {
      await tick();
      const r = places.get(tripId)?.get(id);
      if (!r || r.updatedAt !== updatedAt) return false;
      places.get(tripId).set(id, { data: clone(data), updatedAt: stamp() });
      return true;
    },
    async getScratch(tripId) {
      await tick();
      return clone(scratch.get(tripId) || null);
    },
    async writeScratch(tripId, s, expect) {
      await tick();
      const cur = scratch.get(tripId);
      if (expect && (!cur || cur.run !== expect.run || (cur.v || 0) !== expect.v)) return false;
      scratch.set(tripId, clone(s));
      if (opts.afterWrite) await opts.afterWrite(s);
      return true;
    },
    async updateUsage(id, detail) {
      const r = usage.get(id);
      if (r) Object.assign(r, detail, { settled: (r.settled || 0) + 1 });
    },
    async deleteUsage(ids) {
      for (const id of ids) usage.delete(id);
    },
    async profile() {
      return { lang: opts.lang || "fr", name: "Eliot" };
    },
    async pushSubs(userId) {
      return subs.get(userId) || [];
    },
    async dropPushSub() {},
    async email() {
      return "test@example.com";
    },
  };
  const fixtures = opts.fixtures || {};
  const deps = {
    db,
    secret: P.deriveSecret("test-service-key"),
    now: () => clock.t,
    sleep: async () => tick(),
    log: () => {},
    async ai(task, body) {
      calls.ai.push({ task, body });
      if (opts.duringAi) await opts.duringAi(task, body);
      clock.t += task === "outline" ? 20_000 : 60_000;
      if (opts.slowAi) await new Promise((r) => setTimeout(r, 15));
      const f = opts.fail?.[task];
      if (f && f.times > 0) {
        f.times--;
        throw new TaskFailure(f.kind, { hit: 1, miss: 2, out: 3, search: 0, fetch: 0, usd: 0.001 }, "deepseek", "deepseek-flash", 1000);
      }
      const usage1 = { hit: 10, miss: 20, out: 30, search: 1, fetch: 1, usd: 0.0123 };
      if (task === "outline") {
        const dates = String(body.days).split(", ").map((x) => x.slice(0, 10));
        return { out: { days: dates.map((date, i) => ({ date, theme: `Thème ${i + 1}`, area: "Centro", include: [], fixed: [] })), notes: "" }, usage: usage1, provider: "deepseek", model: "deepseek-flash", ms: 1200 };
      }
      if (task === "essentials") {
        return { out: { lang: { code: "it", name: "italien", speech: "it-IT" }, checklist: [{ text: "Passeport", due: "", group: "Formalités" }], phrases: [{ title: "Politesse", items: [{ local: "Grazie", romanized: "", fr: "Merci" }] }], emergency: [{ label: "Urgences", number: "112", note: "" }], consulate: { name: "Consulat", address: "", phone: "", emergency: "", website: "" }, practical: [{ title: "Monnaie", text: "Euro" }] }, usage: usage1, provider: "deepseek", model: "deepseek-flash", ms: 1200 };
      }
      const date = /Date : (\d{4}-\d{2}-\d{2})/.exec(String(body.day))[1];
      const n = fixtures.perDay ?? 3;
      const v = (fixtures.version || 1);
      return {
        out: {
          theme: `Jour ${date}`,
          places: Array.from({ length: n }, (_, i) => ({
            name: `Lieu ${date} ${i + 1} v${v}`, nameCn: "", address: i === 2 ? "introuvable" : `Via ${i} OK`, addressCn: "",
            lat: i === 0 ? 43.77 : 0, lng: i === 0 ? 11.25 : 0, coordSystem: i === 0 ? "WGS84" : "none",
            type: i === 1 ? "inconnu" : "musee", start: `${9 + i * 2}:00`, end: `${10 + i * 2}:30`, desc: "Une description.", why: "Pour vous.", tip: "", metro: "", website: "https://example.com", source: "notalink", fixed: false, confidence: "haute",
          })),
        },
        usage: usage1, provider: "deepseek", model: "deepseek-flash", ms: 1200,
      };
    },
    async reserve(token, task) {
      calls.reserve.push(task);
      if (token !== "user-token") return { refused: "auth" };
      if (opts.refuse?.[task]) return { refused: opts.refuse[task] };
      if (opts.capAfter != null && calls.reserve.length > opts.capAfter) return { refused: "cap" };
      const id = ++usageId;
      usage.set(id, { id, task, usd: 0, ok: true });
      return { id };
    },
    async verify(token) {
      return token === "user-token" ? "user-1" : null;
    },
    async geocode(q) {
      calls.geocode++;
      clock.t += 1100;
      return /OK/.test(q) ? [11.26, 43.78] : null;
    },
    async push(sub, payload) {
      calls.push.push(payload);
    },
    async mail(to, subject) {
      calls.mail.push(subject);
      return true;
    },
    async kick(tripId) {
      calls.kicks.push(tripId);
      return true;
    },
    // the photo pass (api/_photos.ts, checked in scripts/photos-sim.mjs): only its start is recorded here
    async kickPhotos(tripId, hop) {
      calls.photoKicks.push({ tripId, hop, status: trips.get(tripId)?.data.draft?.status, lease: !!trips.get(tripId)?.data.draft?.lease });
      return true;
    },
    pending: [],
    schedule(p) {
      deps.pending.push(p);
    },
  };
  return { clock, trips, places, scratch, usage, members, subs, calls, deps, db };
}

function seedTrip(w, id = "trip-1", n = 3) {
  const dates = Array.from({ length: n }, (_, i) => `2026-11-${String(22 + i).padStart(2, "0")}`);
  const days = [
    { key: "base", short: "Hôtel", title: "Hôtel", theme: "Base du séjour", scheduled: false },
    ...dates.map((d, i) => ({ key: `d${i + 1}`, short: `Jour ${22 + i}`, title: `Jour ${i + 1}`, theme: i === 0 ? "Arrivée" : "", dates: [d], scheduled: true })),
    { key: "ideas", short: "Pistes", title: "Pistes", theme: "", scheduled: false },
  ];
  const t0 = w.clock.t - 1000;
  const data = {
    title: "Florence", country: "it", hotel: { name: "Brunelleschi" }, flights: [], days,
    draft: { status: "preparing", cities: [{ name: "Florence", lat: 43.7696, lng: 11.2558, country: "it" }], pace: "balanced", interests: ["art"], wishes: [], dayWishes: {}, places: [], fixed: [] },
    fieldsAt: { title: t0, days: t0, draft: t0 }, updatedAt: t0,
  };
  w.trips.set(id, { data, updatedAt: "2026-11-18T09:00:00.000000+00:00" });
  w.members.set(`${id}:user-1`, "owner");
  return dates;
}

const req = (body, headers = {}) => new Request("https://orbesmap.vercel.app/api/prepare", { method: "POST", headers: { "content-type": "application/json", origin: "https://theorbes.com", ...headers }, body: JSON.stringify(body) });
const ctx = { who: { name: "Eliot", lang: "fr" }, trip: { id: "trip-1", title: "Florence", dates: "22 – 24 novembre 2026" }, lang: null };
const user = (body) => req(body, { authorization: "Bearer user-token" });

/** Lets the scheduled work and the chained calls run until nothing is left (lost kicks can be simulated) */
async function drain(w, { dropKicks = 0, max = 60, soft = false } = {}) {
  for (let i = 0; i < max; i++) {
    while (w.deps.pending.length) await w.deps.pending.shift();
    if (!w.calls.kicks.length) return;
    const trip = w.calls.kicks.shift();
    if (dropKicks > 0) {
      dropKicks--;
      continue;
    }
    const r = await P.handle(req({ action: "run", trip }, { "x-prep-key": w.deps.secret }), w.deps);
    if (r.status !== 202) throw new Error(`internal run refused ${r.status}`);
  }
  if (!soft) throw new Error("drain did not settle");
}
const draft = (w, id = "trip-1") => w.trips.get(id).data.draft;
const livePlaces = (w, id = "trip-1") => [...(w.places.get(id) || new Map()).entries()].filter(([, r]) => r.data.deleted !== true);

// ---------- 1. a full run, to the review ----------
console.log("1. Full run: outline, essentials, three days, review, notice");
{
  const w = world();
  w.subs.set("user-1", [{ endpoint: "https://push.example/1", p256dh: "k", auth: "a" }]);
  const dates = seedTrip(w);
  const r = await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  check(r.status === 200, `start answers 200 (${r.status})`);
  check(draft(w).lease?.by === "server", "the draft carries the server's lease right after the start");
  await drain(w);
  const d = draft(w);
  check(d.status === "review", `status review (${d.status})`);
  check(!d.lease && !d.error, "no lease and no error at the end");
  check(Array.isArray(d.outline) && d.outline.length === 3 && d.essentials === true, "outline and essentials saved in the draft");
  check(dates.every((x) => d.days[x] === "done"), "every day marked done");
  const data = w.trips.get("trip-1").data;
  check(data.days.find((x) => x.key === "d2").theme === "Thème 2" && data.days.find((x) => x.key === "d1").theme === "Thème 1", "days get the outline's themes");
  check(data.lang?.code === "it" && data.checklist?.[0]?.id === "c1" && data.phrases?.[0]?.items?.[0]?.zh === "Grazie" && data.emergency?.numbers?.length === 1, "essentials mapped like the app (lang, checklist ids, phrases, emergency)");
  check(["draft", "days", "lang", "checklist", "phrases", "practical", "emergency"].every((k) => data.fieldsAt[k] > 0), "every key written by the server has its fieldsAt");
  const pl = livePlaces(w);
  check(pl.length === 9, `9 places written (${pl.length})`);
  const onMap = pl.filter(([, x]) => x.data.day !== "ideas");
  const ideas = pl.filter(([, x]) => x.data.day === "ideas");
  check(onMap.length === 6 && ideas.length === 3, `6 on the map, 3 in « Pistes » (${onMap.length}/${ideas.length})`);
  const [id0, p0] = onMap.find(([, x]) => x.data.name.endsWith("1 v1"));
  const x = p0.data;
  check(/^[0-9a-f-]{36}$/.test(id0), "place id in the app's uuid format");
  check(x.origin === "added" && x.order > 1e12 && x.fromDraft && x.slot === "9h–10h30" && x.duration === 90 && x.type === "musee" && x.website === "https://example.com" && x.source === "" && x.enrichConfidence === "haute", "place record shaped like createPlace (origin, order, slot, duration, type, links, fromDraft)");
  check(Object.keys(x).filter((k) => k !== "fieldsAt" && k !== "updatedAt").every((k) => x.fieldsAt[k] === x.updatedAt), "each field of the place has its fieldsAt");
  const i0 = ideas[0][1].data;
  check(i0.toPlace && i0.slot === "" && i0.lng === 11.2558, "a place without a position goes to « Pistes » at the city, with its slot noted");
  check(pl.some(([, p]) => p.data.type === "lifestyle"), "an unknown kind becomes lifestyle");
  check(w.calls.ai.length === 5, `5 AI requests (${w.calls.ai.length})`);
  check(w.calls.ai.every((c) => c.body.who?.name === "Eliot" && c.body.task), "every AI request carries the app's context");
  check(w.calls.reserve.join(",") === "outline,essentials,day,day,day", `bookings in order (${w.calls.reserve.join(",")})`);
  check([...w.usage.values()].length === 5 && [...w.usage.values()].every((u) => u.ok === true && u.usd > 0 && u.provider === "deepseek" && u.trip_id === "trip-1"), "every booking settled with its cost and detail");
  check(w.calls.push.length === 1 && w.calls.push[0].title === "Votre voyage est prêt" && w.calls.push[0].url.endsWith("/#trip-1"), "one notification, in French, opening the trip");
  check(w.calls.mail.length === 0, "no e-mail when a phone got the notification");
  check(w.scratch.get("trip-1").done === true && w.scratch.get("trip-1").bookings.length === 0, "scratch closed, no booking left");
  // a late duplicate call after the end changes nothing and never notifies twice
  const again = await P.runUnit("trip-1", w.deps);
  check(again === "no-scratch" && w.calls.push.length === 1, `a late call does nothing (${again})`);
  check(w.calls.photoKicks.length === 1 && w.calls.photoKicks[0].tripId === "trip-1" && w.calls.photoKicks[0].hop === 0 && w.calls.photoKicks[0].status === "review" && !w.calls.photoKicks[0].lease, `the photo pass is started once, at the end, once the trip is ready (review, no lease) (${w.calls.photoKicks.length})`);

  // ---------- 5. regenerate one day ----------
  console.log("5. Regenerate one day from the review");

  const before = livePlaces(w).filter(([, p]) => p.data.fromDraft === dates[1]).map(([id]) => id);
  const r5 = await P.handle(user({ action: "day", trip: "trip-1", date: dates[1], ctx }), { ...w.deps, ai: (t, b) => (t === "day" ? w.deps.ai(t, b).then((o) => ({ ...o, out: { ...o.out, places: o.out.places.map((p) => ({ ...p, name: p.name.replace("v1", "v2") })) } })) : w.deps.ai(t, b)) });
  check(r5.status === 200, `day answers 200 (${r5.status})`);
  check(draft(w).status === "preparing" && draft(w).days[dates[1]] === undefined, "the day is open again, status preparing");
  await drain(w);
  check(draft(w).status === "review" && draft(w).days[dates[1]] === "done", "back to the review with the day done");
  const all = [...w.places.get("trip-1").entries()];
  check(before.every((id) => w.places.get("trip-1").get(id).data.deleted === true && w.places.get("trip-1").get(id).data.fieldsAt.deleted > 0), "previous places of that day deleted (deleted + fieldsAt)");
  const now2 = all.filter(([, p]) => p.data.fromDraft === dates[1] && p.data.deleted !== true);
  check(now2.length === 3, `3 new places for that day (${now2.length})`);
  check(livePlaces(w).filter(([, p]) => p.data.fromDraft === dates[0]).length === 3, "the other days keep their places");
  check(w.calls.push.length === 1, "no notification for one day prepared again");
  check(w.calls.photoKicks.length === 2, `the day prepared again starts the photo pass for its new places (${w.calls.photoKicks.length})`);
  check([...w.usage.values()].length === 6, "one more booking, settled");
}

// ---------- 2. interrupted between two steps, restarted by the cron ----------
console.log("2. A lost call between two steps: the cron restarts it");
{
  const w = world();
  w.subs.set("user-1", []);
  seedTrip(w);
  await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  await drain(w, { dropKicks: 1 });
  const mid = draft(w);
  check(mid.status === "preparing" && !!mid.outline && !mid.essentials, "stopped after the outline (the next call was lost)");
  check(P.staleRuns([...w.trips].map(([id, r]) => ({ id, data: r.data })), w.clock.t).length === 0, "not restarted while the lease is fresh");
  w.clock.t += 7 * 60_000;
  const stale = P.staleRuns([...w.trips].map(([id, r]) => ({ id, data: r.data })), w.clock.t);
  check(stale.length === 1 && stale[0] === "trip-1", "seen as stopped after 6 minutes");
  const fakeFetch = async (url, init) => P.handle(new Request(url, init), w.deps);
  const n = await P.kickStale([...w.trips].map(([id, r]) => ({ id, data: r.data })), "test-service-key", fakeFetch, w.clock.t);
  check(n === 1, "the cron's restart is accepted (internal secret)");
  await drain(w);
  check(draft(w).status === "review" && Object.values(draft(w).days).every((x) => x === "done"), "the preparation finishes after the restart");
  check(w.calls.ai.filter((c) => c.task === "outline").length === 1, "the outline is not asked twice");
  check(w.calls.mail.length === 1 && w.calls.push.length === 0, "no phone subscribed: one e-mail instead");
  const bad = await P.handle(req({ action: "run", trip: "trip-1" }, { "x-prep-key": "wrong" }), w.deps);
  check(bad.status === 403, "an internal call with a wrong secret is refused");
}

// ---------- 3. two calls at the same time ----------
console.log("3. Two calls at once: one runner");
{
  const w = world({ slowAi: true });
  seedTrip(w);
  await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  // the start's own run, plus two more calls at the same moment
  const own = w.deps.pending.shift();
  const [a, b, c] = await Promise.all([own, P.runUnit("trip-1", w.deps), P.runUnit("trip-1", w.deps)]);
  check([a, b, c].filter((x) => x === "busy").length === 2, `one call works, the others leave (${a}, ${b}, ${c})`);
  check(w.calls.ai.filter((c) => c.task === "outline").length === 1, "the outline is asked once");
}

// ---------- 4. the daily cap ----------
console.log("4. Daily cap and refusals");
{
  const w = world({ refuse: { outline: "cap" } });
  seedTrip(w);
  const r = await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  const body = await r.json();
  check(r.status === 429 && body.error === "busy", `refused with 429 (${r.status})`);
  check(draft(w).error === "Limite du jour atteinte pour les demandes à l'IA. Elle repart dans les 24 heures." && !draft(w).lease, "the draft says why, no lease");
  check(w.calls.ai.length === 0 && w.usage.size === 0, "no AI request, no booking left");
}
{
  const w = world({ refuse: { outline: "prep" } });
  seedTrip(w);
  const r = await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  const body = await r.json();
  check(r.status === 403 && body.error === "pro" && /voyage offert/.test(body.message), "the free trip of the month already used: « pro » refusal");
}
{
  // the cap reached after three bookings: the run goes as far as it can, then stops with the cap's message
  const w = world({ capAfter: 3 });
  seedTrip(w);
  const r = await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  check(r.status === 200, "started with what could be booked");
  await drain(w);
  const d = draft(w);
  check(d.status === "preparing" && /Limite du jour/.test(d.error || "") && !d.lease, `stopped with the cap's message (${d.error})`);
  check(Object.values(d.days || {}).filter((x) => x === "done").length === 1, "one day prepared before the cap");
  check([...w.usage.values()].every((u) => u.settled), "no unused booking left");
}

// ---------- 6. a wish while it runs ----------
console.log("6. Wishes");
{
  const w = world();
  const dates = seedTrip(w);
  await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  const r1 = await P.handle(user({ action: "wish", trip: "trip-1", text: "Un rooftop un soir", ctx }), w.deps);
  const r2 = await P.handle(user({ action: "wish", trip: "trip-1", text: "Plus calme", date: dates[2], ctx }), w.deps);
  check(r1.status === 200 && r2.status === 200, "wishes accepted");
  await drain(w);
  check(draft(w).wishes.includes("Un rooftop un soir") && draft(w).dayWishes[dates[2]] === "Plus calme", "merged into the draft (trip and day)");
  const last = w.calls.ai.filter((c) => c.task === "day").pop();
  check(/Plus calme/.test(last.body.day) && /rooftop/.test(last.body.plan.wishes), "read by the days prepared after it");
  check(draft(w).status === "review", "the run still ends in the review");
}

// ---------- 7. stop and see what is ready; a passing failure ----------
console.log("7. Stop halfway; a failure tried again");
{
  const w = world({ fail: { outline: { kind: "busy", times: 1 } } });
  seedTrip(w);
  await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  await drain(w, { max: 2, soft: true });
  check(w.calls.ai.filter((c) => c.task === "outline").length === 2 && !!draft(w).outline, "the outline failed once, then worked on the same booking");
  const r = await P.handle(user({ action: "review", trip: "trip-1" }), w.deps);
  check(r.status === 200 && draft(w).status === "review" && !draft(w).lease, "« Arrêter et voir les jours prêts »: review, no lease");
  await drain(w);
  const left = [...w.usage.values()];
  check(left.every((u) => u.settled), `unused bookings deleted (${left.length} kept, all used)`);
  check(w.scratch.get("trip-1").done === true, "scratch closed");
  const r2 = await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  check(r2.status === 200 && draft(w).status === "preparing", "the missing days can be prepared again from the review");
  await drain(w);
  check(draft(w).status === "review" && Object.values(draft(w).days).every((x) => x === "done"), "and they are");
}

// ---------- 8. access ----------
console.log("8. Access");
{
  const w = world();
  seedTrip(w);
  w.members.set("trip-1:user-1", "viewer");
  const r = await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  check(r.status === 403, "a viewer cannot start it");
  const r2 = await P.handle(req({ action: "start", trip: "trip-1" }, { authorization: "Bearer nope" }), w.deps);
  check(r2.status === 401, "an expired session is refused");
  const r3 = await P.handle(user({ action: "start", trip: "trip-unknown", ctx }), w.deps);
  check(r3.status === 409, "a trip not on the server yet: 409 (the app asks again)");
}
{
  // two starts at the same time: one books
  const w = world();
  seedTrip(w);
  const [a, b] = await Promise.all([P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps), P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps)]);
  const ja = await a.json();
  const jb = await b.json();
  check(a.status === 200 && b.status === 200 && [ja.running, jb.running].filter(Boolean).length === 1, "two starts at once: one books, the other sees it running");
  check(w.calls.reserve.length === 5, `booked once (${w.calls.reserve.length})`);
  await drain(w);
  check(draft(w).status === "review", "and the run ends normally");
}
{
  // English account: the notice in English
  const w = world({ lang: "en" });
  w.subs.set("user-1", [{ endpoint: "https://push.example/1", p256dh: "k", auth: "a" }]);
  seedTrip(w);
  await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  await drain(w);
  check(w.calls.push[0]?.title === "Your trip is ready" && w.calls.push[0].body === "Florence: your itinerary is waiting.", "the notice follows the account's language");
}

// ---------- 9. « stop » while a day's AI request is running ----------
console.log("9. Stop during a day's research, then start again at once");
{
  let w;
  let fired = false;
  let runB = null;
  w = world({
    async duringAi(task) {
      if (task !== "day" || fired) return;
      fired = true;
      // the traveller taps « Arrêter et voir les jours prêts », then « Préparer les jours manquants », while this
      // request is still on its way
      const r1 = await P.handle(user({ action: "review", trip: "trip-1" }), w.deps);
      check(r1.status === 200, "review accepted during the request");
      const r2 = await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
      check(r2.status === 200, "start accepted right after");
      runB = w.scratch.get("trip-1").run;
    },
  });
  seedTrip(w);
  await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  const runA = w.scratch.get("trip-1").run;
  await drain(w);
  const sc = w.scratch.get("trip-1");
  check(runB && runB !== runA && sc.run === runB, "the first run never wrote over the new one's scratch");
  check(sc.done === true && sc.bookings.length === 0 && !sc.inflight, "the new run closed its scratch at the end");
  check(draft(w).status === "review" && Object.values(draft(w).days).every((x) => x === "done"), "the new run prepared every day");
  const rows = [...w.usage.values()];
  check(rows.length === w.calls.ai.length, `one booking row per AI request sent (${rows.length} rows, ${w.calls.ai.length} requests)`);
  check(rows.every((u) => u.settled === 1 && u.usd > 0), "every request sent is settled once, with its cost (none unbooked, none lost)");
  const firstDay = rows.find((u) => u.task === "day" && u.id === Math.min(...rows.filter((x) => x.task === "day").map((x) => x.id)));
  check(!!firstDay && firstDay.ok === true, "the request running during the stop kept its booking and its cost");
  check(w.calls.ai.filter((c) => c.task === "outline").length === 1, "the outline is not asked again");
  const ids = new Set(rows.map((u) => u.id));
  check(ids.size === rows.length, "no booking used twice");
}

// ---------- 10. cut between a place's write and its note ----------
console.log("10. A call cut right after writing a place: no duplicate");
{
  const w = world({ insertFails: { times: 1, after: true } });
  seedTrip(w, "trip-1", 2);
  await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  await drain(w, { soft: true });
  check(draft(w).status === "preparing" && draft(w).lease?.hold == null, "the failing call let the lease go");
  w.clock.t += 7 * 60_000;
  const fakeFetch = async (url, init) => P.handle(new Request(url, init), w.deps);
  await P.kickStale([...w.trips].map(([id, r]) => ({ id, data: r.data })), "test-service-key", fakeFetch, w.clock.t);
  await drain(w);
  const pl = livePlaces(w);
  const names = pl.map(([, p]) => p.data.name);
  check(draft(w).status === "review", "the preparation finishes after the restart");
  check(pl.length === 6 && new Set(names).size === names.length, `6 places, no duplicate (${pl.length})`);
  check(w.calls.inserts === 7, `the replayed write was ignored by the database (${w.calls.inserts} writes for 6 rows)`);
}

// ---------- 11. a step failing again and again ----------
console.log("11. A step that keeps failing stops the preparation");
{
  const w = world({ insertFails: { times: 99 } });
  seedTrip(w, "trip-1", 2);
  await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  await drain(w, { soft: true });
  for (let i = 0; i < 5 && draft(w).lease; i++) {
    w.clock.t += 2 * 60_000;
    await P.runUnit("trip-1", w.deps);
  }
  const d = draft(w);
  check(d.error === "La préparation s'est arrêtée. Elle reprendra à la prochaine ouverture." && !d.lease, `stopped with a message after ${3} failures (${d.error})`);
  check(w.scratch.get("trip-1").done === true && [...w.usage.values()].every((u) => u.settled), "scratch closed, unused bookings deleted");
  check(P.staleRuns([...w.trips].map(([id, r]) => ({ id, data: r.data })), w.clock.t + 3600_000).length === 0, "the cron no longer picks it");
}

// ---------- 12. a restart without the traveller's context ----------
console.log("12. A restart sent while another trip is open keeps the traveller's context");
{
  const w = world();
  seedTrip(w);
  await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  await drain(w, { dropKicks: 1 });
  w.clock.t += 7 * 60_000;
  const r = await P.handle(user({ action: "start", trip: "trip-1", ctx: { who: {}, trip: {}, lang: null } }), w.deps);
  check(r.status === 200, "restart accepted");
  check(typeof (await r.clone().json()).now === "number", "every answer carries the server's clock");
  await drain(w);
  check(w.calls.ai.filter((c) => c.task === "day").every((c) => c.body.who?.name === "Eliot"), "the days are asked with the traveller's profile");
  check(w.calls.reserve.length === 5, `the bookings of the first start are used, none booked again (${w.calls.reserve.length})`);
}

// ---------- 13. the cron's order ----------
console.log("13. The cron restarts the oldest first");
{
  const mk = (id, at) => ({ id, data: { draft: { status: "preparing", lease: { by: "server", at, hold: null } } } });
  const now = Date.parse("2026-11-18T12:00:00Z");
  const got = P.staleRuns([mk("c", now - 20 * 60_000), mk("a", now - 90 * 60_000), mk("d", now - 60_000), mk("b", now - 50 * 60_000), mk("e", now - 10 * 60_000)], now);
  check(got.join(",") === "a,b,c", `oldest three first (${got.join(",")})`);
}

// ---------- 14. the real database adapter (PostgREST requests, sealed scratch) ----------
console.log("14. The database adapter: sealed scratch, conditional writes, idempotent places");
{
  const sent = [];
  let stored = null;
  const fakeFetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    sent.push({ url: u, method: init.method || "GET", prefer: init.headers?.prefer || "", body: init.body ? JSON.parse(init.body) : null });
    if (u.includes("/place_states") && (init.method || "GET") === "GET") return new Response(JSON.stringify(stored ? [{ data: stored }] : []), { status: 200 });
    if (u.includes("/place_states") && init.method === "POST") {
      stored = JSON.parse(init.body).data;
      return new Response("", { status: 201 });
    }
    if (u.includes("/place_states") && init.method === "PATCH") {
      const run = /data->>run=eq\.([^&]+)/.exec(u)?.[1];
      const v = /data->>v=eq\.(\d+)/.exec(u)?.[1];
      if (!stored || stored.run !== run || String(stored.v) !== v) return new Response("[]", { status: 200 });
      stored = JSON.parse(init.body).data;
      return new Response(JSON.stringify([{ place_id: "trip-1" }]), { status: 200 });
    }
    return new Response("", { status: 201 });
  };
  const db = P.restDb("test-service-key", fakeFetch);
  const sc = { run: "run-1", user: "user-1", ctx: { who: { name: "Eliot", budget: "élevé" } }, bookings: [{ id: 7, task: "day" }], spent: {}, attempts: {}, errored: [], only: null, capHit: null, pending: null, inflight: null, notified: null, done: false, at: 1, v: 1 };
  check((await db.writeScratch("trip-1", sc, null)) === true, "a new run's scratch is written");
  check(!JSON.stringify(stored).includes("Eliot") && stored.run === "run-1" && stored.v === 1 && typeof stored.enc === "string", "stored sealed: only its run and version in clear");
  const back = await db.getScratch("trip-1");
  check(back?.ctx?.who?.name === "Eliot" && back.v === 1 && back.bookings[0].id === 7, "read back whole");
  check((await db.writeScratch("trip-1", { ...sc, v: 2 }, { run: "run-1", v: 1 })) === true, "a write over the version read is accepted");
  check((await db.writeScratch("trip-1", { ...sc, v: 2 }, { run: "run-1", v: 1 })) === false, "a write over an older version is refused");
  check((await db.writeScratch("trip-1", { ...sc, v: 3 }, { run: "run-0", v: 2 })) === false, "a write from another run is refused");
  check(P.restDb("another-key", fakeFetch) && (await P.restDb("another-key", fakeFetch).getScratch("trip-1")) === null, "unreadable with another key");
  await db.insertPlace("trip-1", "p-1", { name: "x" }, "user-1");
  const ins = sent.find((x) => x.url.includes("/rest/v1/places") && x.method === "POST");
  check(!!ins && ins.url.includes("on_conflict=trip_id,place_id") && /resolution=ignore-duplicates/.test(ins.prefer), "a place is added with « on conflict do nothing »");
}

// ---------- 15. the account's path: preparation started, ready, failed (supabase/saas-5.sql events) ----------
console.log("15. The account's path: prep_started, prep_ready, prep_failed");
{
  const withEvents = (w) => {
    const events = [];
    w.db.event = async (userId, name, detail, tripId) => {
      await tick();
      events.push({ userId, name, detail, tripId });
    };
    return events;
  };
  {
    const w = world();
    const ev = withEvents(w);
    seedTrip(w);
    await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
    await drain(w);
    const started = ev.filter((e) => e.name === "prep_started");
    const ready = ev.filter((e) => e.name === "prep_ready");
    check(started.length === 1 && started[0].detail === "new" && started[0].userId === "user-1" && started[0].tripId === "trip-1", "prep_started once at the start (new), for who started it");
    check(ready.length === 1 && /^\d+$/.test(ready[0].detail || "") && Number(ready[0].detail) > 0, `prep_ready once, with the seconds since the start (${ready[0]?.detail})`);
    check(!ev.some((e) => e.name === "prep_failed"), "no prep_failed on a run that went well");
    await P.runUnit("trip-1", w.deps);
    check(ev.filter((e) => e.name === "prep_ready").length === 1, "a late call never sends prep_ready again");
    // one day prepared again: day_redone (the app's), not a preparation of its own
    const dates = Object.keys(draft(w).days);
    await P.handle(user({ action: "day", trip: "trip-1", date: dates[1], ctx }), w.deps);
    await drain(w);
    check(ev.filter((e) => e.name === "prep_started").length === 1 && ev.filter((e) => e.name === "prep_ready").length === 1 && !ev.some((e) => e.name === "prep_failed"), "a day prepared again sends none of them");
  }
  {
    // the daily cap reached after three bookings: the run stops → prep_failed « cap »
    const w = world({ capAfter: 3 });
    const ev = withEvents(w);
    seedTrip(w);
    await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
    await drain(w);
    const f = ev.filter((e) => e.name === "prep_failed");
    check(f.length === 1 && f[0].detail === "cap" && !ev.some((e) => e.name === "prep_ready"), `cap reached: prep_failed « cap » once (${f.map((x) => x.detail).join(",")})`);
  }
  {
    // the outline refused by the AI: the run stops → prep_failed « ai »
    const w = world({ fail: { outline: { kind: "refusal", times: 1 } } });
    const ev = withEvents(w);
    seedTrip(w);
    await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
    await drain(w);
    const f = ev.filter((e) => e.name === "prep_failed");
    check(f.length === 1 && f[0].detail === "ai", `the outline failed: prep_failed « ai » (${f.map((x) => x.detail).join(",")})`);
  }
  {
    // one day could not be prepared: the run ends with days missing → prep_failed « days »
    const w = world({ fail: { day: { kind: "refusal", times: 1 } } });
    const ev = withEvents(w);
    seedTrip(w);
    await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
    await drain(w);
    const f = ev.filter((e) => e.name === "prep_failed");
    check(f.length === 1 && f[0].detail === "days" && !ev.some((e) => e.name === "prep_ready"), `days missing at the end: prep_failed « days » (${f.map((x) => x.detail).join(",")})`);
    // started again by the same person: « resume »
    await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
    await drain(w);
    // (the first run ended: the start makes a new one)
    check(ev.filter((e) => e.name === "prep_started").map((e) => e.detail).join(",") === "new,new", `started again: a second prep_started (${ev.filter((e) => e.name === "prep_started").map((e) => e.detail).join(",")})`);
    check(draft(w).status === "review" && ev.filter((e) => e.name === "prep_ready").length === 1, "then ready: prep_ready once");
  }
  {
    // the steps table failing: the preparation goes on exactly as before
    const w = world();
    w.db.event = async () => {
      throw new Error("db 500 /rest/v1/events");
    };
    seedTrip(w);
    const r = await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
    await drain(w);
    check(r.status === 200 && draft(w).status === "review" && w.calls.push.length + w.calls.mail.length === 1, `steps that cannot be written never stop the preparation (${r.status}, ${draft(w).status}, ${w.calls.push.length + w.calls.mail.length} notice)`);
  }
  {
    // a database without « event » (the tests above, any other Db): to the end as before
    const w = world();
    seedTrip(w);
    await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
    await drain(w);
    check(!("event" in w.db) && draft(w).status === "review", "a database without event goes to the end as before");
  }
  {
    // the real adapter: one POST to /rest/v1/events with the service key, a cleaned detail, never throwing
    const sent = [];
    const db = P.restDb("test-service-key", async (url, init = {}) => {
      sent.push({ url: String(url), init });
      return new Response("", { status: 201 });
    });
    await db.event("user-1", "prep_ready", "42", "trip-1");
    const x = sent[0];
    const b = x ? JSON.parse(x.init.body) : {};
    check(!!x && x.url.endsWith("/rest/v1/events") && x.init.method === "POST" && x.init.headers.prefer === "return=minimal" && x.init.headers.authorization === "Bearer test-service-key" && !!x.init.signal, "adapter: POST /rest/v1/events, service key, 3 s limit");
    check(b.user_id === "user-1" && b.name === "prep_ready" && b.detail === "42" && b.trip_id === "trip-1" && Object.keys(b).length === 4, "adapter: only the account, the name, the detail and the trip");
    await db.event("user-1", "prep_failed", "a b<c>!", "trip-1");
    check(JSON.parse(sent[1].init.body).detail === "abc", "adapter: the detail is cleaned like track_event");
    const bad = P.restDb("k", async () => {
      throw new Error("network");
    });
    let threw = false;
    await bad.event("user-1", "prep_started", "new", "trip-1").catch(() => (threw = true));
    check(!threw, "adapter: a network error never throws");
  }
}

console.log("16. Above the free monthly budget (the booking says cheap): every task of the run asks the cheaper provider");
{
  const w = world();
  seedTrip(w);
  const book = w.deps.reserve;
  const ai = w.deps.ai;
  const asked = [];
  w.deps.reserve = async (...a) => {
    const b = await book(...a);
    return "id" in b ? { ...b, cheap: true } : b;
  };
  w.deps.ai = (task, body, o) => {
    asked.push({ task, cheap: o?.cheap === true });
    return ai(task, body);
  };
  const r = await P.handle(user({ action: "start", trip: "trip-1", ctx }), w.deps);
  await drain(w);
  check(r.status === 200 && draft(w).status === "review", `the run goes to the review (${draft(w).status})`);
  check(asked.length === 5 && asked.every((x) => x.cheap), `outline, essentials and each day asked with cheap (${asked.map((x) => `${x.task}:${x.cheap}`).join(", ")})`);
  const again = [];
  w.deps.reserve = book;
  w.deps.ai = (task, body, o) => {
    again.push(o?.cheap === true);
    return ai(task, body);
  };
  const dates = Object.keys(draft(w).days);
  const r2 = await P.handle(user({ action: "day", trip: "trip-1", date: dates[0], ctx }), w.deps);
  await drain(w);
  check(r2.status === 200 && again.length === 1 && again[0] === false, "a booking without cheap: today's provider (no cheap flag)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
