// Simulation of the photo pass (api/_photos.ts, runPhotos and the "photos" actions of api/prepare.ts) with a fake
// database, a fake clock and fake Wikimedia / Openverse / OpenStreetMap / Storage services.
// Run from the repo:  node scripts/photos-sim.mjs
// Nothing leaves this computer (every service is replaced in memory). Exits with code 1 when a check fails.
// `node scripts/photos-sim.mjs --live` instead runs the lookups (no storage, no database) on real places with the real
// services, and prints what each would get.
import { register } from "node:module";
import { createHash } from "node:crypto";

// "./_photos.js" under api/ is read from its ".ts" (see scripts/prepare-sim.mjs)
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
const X = await import("../api/_photos.ts");

if (process.argv.includes("--live")) {
  await live();
  process.exit(0);
}

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
};
const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
const tick = () => new Promise((r) => setImmediate(r));
const SUPA = "https://test.supabase.co";
const sha = (s) => createHash("sha1").update(s).digest("hex").slice(0, 20);

// ---------- the fake world ----------
const T0 = Date.parse("2026-11-18T10:00:00Z");
function world(fx = {}) {
  const clock = { t: T0 };
  let seq = 0;
  const stamp = () => new Date(clock.t).toISOString().replace("Z", `${String(++seq).padStart(6, "0")}+00:00`);
  const trips = new Map();
  const places = new Map();
  const leases = new Map();
  const members = new Map();
  const store = new Map(); // bucket objects
  const log = { urls: [], nom: [], wmInflight: 0, wmMax: 0, sleeps: [], uploads: [], heads: [], downloads: [], patches: [], kicks: [], bucket: 0, member: [], firstPatchAt: null, lastCopyAt: 0, msgs: [] };
  let bucketMade = false;
  const json = (o, status = 200, headers = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
  // the Commons file fixtures: title → { w, h, mime, license, artist, licenseUrl }
  const files = fx.files || {};
  const thumbFor = (title, f, step) => {
    const name = encodeURIComponent(title.replace(/^File:/, "").replace(/ /g, "_"));
    if (f.w > step) return { thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/${step}px-${name}`, thumbwidth: step, thumbheight: Math.round((step * f.h) / f.w) };
    // not wider than the step: the API answers with the original (throttled) file
    return { thumburl: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${name}`, thumbwidth: f.w, thumbheight: f.h };
  };
  let wm429 = fx.wm429 ? [...fx.wm429] : [];
  async function fakeFetch(url, init = {}) {
    const u = new URL(String(url));
    const method = (init.method || "GET").toUpperCase();
    log.urls.push({ url: String(url), method, at: clock.t, host: u.host, body: init.body, headers: init.headers || {} });
    const isWm = /(^|\.)(wikimedia|wikipedia|wikidata)\.org$/.test(u.host) && u.host !== "upload.wikimedia.org";
    if (isWm) {
      log.wmInflight++;
      log.wmMax = Math.max(log.wmMax, log.wmInflight);
      await tick();
      await tick();
      log.wmInflight--;
      if (wm429.length) {
        const ra = wm429.shift();
        return new Response("", { status: 429, headers: { "retry-after": String(ra) } });
      }
    }
    if (u.host === "nominatim.openstreetmap.org") {
      log.nom.push(clock.t);
      if (fx.nomCost) clock.t += fx.nomCost;
      const q = u.searchParams.get("q");
      const hits = (fx.nom || {})[q] || [];
      return json(hits);
    }
    if (u.host === "www.wikidata.org") {
      const action = u.searchParams.get("action");
      if (action === "wbgetentities") {
        const ids = u.searchParams.get("ids").split("|");
        const out = {};
        for (const q of ids) {
          const e = (fx.ents || {})[q];
          if (!e) continue;
          out[q] = { claims: e.p18 ? { P18: [{ rank: "normal", mainsnak: { datavalue: { value: e.p18 } } }] } : {}, sitelinks: Object.fromEntries(Object.entries(e.sitelinks || {}).map(([k, v]) => [k, { title: v }])) };
        }
        return json({ entities: out });
      }
      if (action === "wbgetclaims") {
        const q = u.searchParams.get("entity");
        const prop = u.searchParams.get("property");
        const v = ((fx.claims || {})[q] || {})[prop];
        return json({ claims: v ? { [prop]: [{ rank: "normal", mainsnak: { datavalue: { value: v } } }] } : {} });
      }
    }
    if (u.host === "commons.wikimedia.org") {
      const p = new URLSearchParams(String(init.body || ""));
      const titles = (p.get("titles") || "").split("|").filter(Boolean);
      const step = Number(p.get("iiurlwidth"));
      if (![500, 960, 1280].includes(step)) return new Response("bad width", { status: 400 });
      const pages = titles.map((title) => {
        const f = files[title];
        if (!f) return { title, missing: true };
        return {
          title,
          imageinfo: [{
            width: f.w, height: f.h, mime: f.mime || "image/jpeg", url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/x`, descriptionurl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%3A/g, ":")}`,
            ...thumbFor(title, f, step),
            extmetadata: { LicenseShortName: { value: f.license ?? "CC BY-SA 4.0" }, LicenseUrl: { value: f.licenseUrl ?? "https://creativecommons.org/licenses/by-sa/4.0" }, Artist: { value: f.artist ?? "Someone" } },
          }],
        };
      });
      return json({ query: { pages } });
    }
    if (/\.wikipedia\.org$/.test(u.host)) {
      const lang = u.host.split(".")[0];
      const title = decodeURIComponent(u.pathname.split("/page/summary/")[1] || "").replace(/_/g, " ");
      const s = (fx.summaries || {})[`${lang}:${title}`];
      return s ? json(s) : json({ type: "https://mediawiki.org/wiki/HyperSwitch/errors/not_found" }, 404);
    }
    if (u.host === "api.openverse.org" && u.pathname === "/v1/images/") {
      if (fx.ov429) return new Response("", { status: 429 });
      const q = u.searchParams.get("q");
      return json({ results: (fx.ov || {})[q] || [] });
    }
    if (u.host === "upload.wikimedia.org" || (u.host === "api.openverse.org" && u.pathname.includes("/thumb"))) {
      log.downloads.push({ url: String(url), at: clock.t });
      if (fx.dlCost) clock.t += fx.dlCost;
      const redir = (fx.redirects || {})[String(url)];
      if (redir) return new Response("", { status: 302, headers: { location: redir } });
      return new Response(new Uint8Array(4000), { status: 200, headers: { "content-type": "image/jpeg", "content-length": "4000" } });
    }
    if (u.host === "test.supabase.co") {
      const path = u.pathname;
      if (path === "/storage/v1/bucket" && method === "POST") {
        log.bucket++;
        if (fx.bucketFails) return new Response("nope", { status: 500 });
        if (bucketMade) return new Response(JSON.stringify({ statusCode: "409", error: "Duplicate", message: "The resource already exists" }), { status: 400 });
        bucketMade = true;
        return json({ name: "place-photos" });
      }
      const m = /^\/storage\/v1\/object\/place-photos\/(.+)$/.exec(path);
      if (m && method === "HEAD") {
        log.heads.push({ path: m[1], at: clock.t });
        return new Response(null, { status: store.has(m[1]) ? 200 : 400 });
      }
      if (m && method === "POST") {
        if (log.firstPatchAt != null) log.msgs.push("upload after a place write");
        store.set(m[1], init.headers?.["content-type"]);
        log.uploads.push({ path: m[1], headers: init.headers, at: clock.t });
        log.lastCopyAt = clock.t;
        return json({ Key: m[1] });
      }
      if (path === "/rest/v1/rpc/is_member") {
        log.member.push(init.headers);
        return json(init.headers?.authorization === "Bearer member-token");
      }
    }
    return new Response("unknown host", { status: 599 });
  }
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
    async insertPlace() {},
    async patchPlace(tripId, id, data, updatedAt) {
      await tick();
      if (fx.onPatch) fx.onPatch(tripId, id);
      const r = places.get(tripId)?.get(id);
      if (!r || r.updatedAt !== updatedAt) {
        log.patches.push({ id, ok: false });
        return false;
      }
      if (log.firstPatchAt == null) log.firstPatchAt = clock.t;
      places.get(tripId).set(id, { data: clone(data), updatedAt: stamp() });
      log.patches.push({ id, ok: true });
      return true;
    },
    async getScratch() {
      return null;
    },
    async writeScratch() {
      return true;
    },
    async updateUsage() {},
    async deleteUsage() {},
    async profile() {
      return {};
    },
    async pushSubs() {
      return [];
    },
    async dropPushSub() {},
    async email() {
      return null;
    },
    async claimPhotos(tripId, hold, now) {
      await tick();
      const l = leases.get(tripId);
      if (l && l.hold && now - l.at < 6 * 60_000) return false;
      leases.set(tripId, { hold, at: now });
      return true;
    },
    async touchPhotos(tripId, hold, now) {
      const l = leases.get(tripId);
      if (l?.hold === hold) l.at = now;
    },
    async releasePhotos(tripId, hold, now, note) {
      const l = leases.get(tripId);
      if (l?.hold === hold) leases.set(tripId, { ...note, hold: null, at: now });
    },
  };
  let lastNom = -Infinity;
  const io = {
    fetch: fakeFetch,
    now: () => clock.t,
    async sleep(ms) {
      log.sleeps.push(ms);
      clock.t += ms;
      await tick();
    },
    log: (m) => log.msgs.push(m),
    supaUrl: SUPA,
    key: fx.key || `service-key-${Math.random()}`,
    async nomGate() {
      const slot = Math.max(clock.t, lastNom + 1100);
      lastNom = slot;
      if (slot > clock.t) clock.t = slot;
      await tick();
    },
  };
  const deps = {
    db,
    secret: P.deriveSecret("test-service-key"),
    now: () => clock.t,
    sleep: async () => tick(),
    log: (m) => log.msgs.push(m),
    ai: async () => {
      throw new Error("no ai here");
    },
    reserve: async () => ({ refused: "error" }),
    async verify(token) {
      return { "user-token": "user-1", "member-token": "user-2", "reader-token": "user-3" }[token] || null;
    },
    geocode: async () => null,
    kick: async () => true,
    async kickPhotos(tripId, hop) {
      log.kicks.push({ tripId, hop });
      return true;
    },
    async isMember(token) {
      const r = await fakeFetch(`${SUPA}/rest/v1/rpc/is_member`, { method: "POST", headers: { apikey: "anon-key", authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
      return (await r.json()) === true;
    },
    photoIo: io,
    pending: [],
    schedule(p) {
      deps.pending.push(p);
    },
  };
  return { clock, trips, places, leases, members, store, log, db, io, deps };
}
const drain = async (w) => {
  while (w.deps.pending.length) await w.deps.pending.shift();
};
function seed(w, id, list, extra = {}) {
  const t0 = T0 - 86_400_000;
  w.trips.set(id, { data: { title: "Shanghai", country: "cn", center: [121.47, 31.23], fieldsAt: { title: t0 }, updatedAt: t0, ...extra }, updatedAt: "2026-11-17T09:00:00.000000+00:00" });
  const m = new Map();
  list.forEach((p, i) => {
    const data = { name: p.name, nameCn: p.nameCn, lat: p.lat ?? 31.23 + i * 0.001, lng: p.lng ?? 121.47 + i * 0.001, type: p.type || "landmark", order: i * 10, ...(p.photo ? { photo: p.photo } : {}) };
    const fieldsAt = Object.fromEntries(Object.keys(data).map((k) => [k, p.fieldsAt?.[k] ?? t0]));
    m.set(p.id, { data: { ...data, fieldsAt, updatedAt: t0 }, updatedAt: `2026-11-17T09:00:00.${String(i).padStart(6, "0")}+00:00` });
  });
  w.places.set(id, m);
}
const nomHit = (lat, lng, qid, wp) => ({ lat: String(lat), lon: String(lng), extratags: { ...(qid ? { wikidata: qid } : {}), ...(wp ? { wikipedia: wp } : {}) } });
const photoOf = (w, trip, id) => w.places.get(trip).get(id).data.photo;
const OV1 = "11111111-2222-3333-4444-555555555555";

// ---------- 1. the rules ----------
console.log("1. The rules");
check(X.okTitle("File:Cartier Shanghai.jpg") && X.okTitle("File:Mapo tofu.jpg") && X.okTitle("File:Shanghai Planetarium.jpg"), "titles « Cartier Shanghai », « Mapo tofu », « Planetarium » accepted (whole words only)");
check(!X.okTitle("File:Shanghai montage.png") && !X.okTitle("File:Map of the Bund.png") && !X.okTitle("File:Shanghai_collage.jpg") && !X.okTitle("File:Logo ORBES.svg"), "titles « montage », « Map of », « collage », « Logo » refused");
check(X.okLicense("CC BY-SA 3.0 de") && X.okLicense("CC BY 4.0") && X.okLicense("CC0") && X.okLicense("Public domain") && X.okLicense("PD-US"), "licences CC BY(-SA) (ported), CC0, public domain accepted");
check(!X.okLicense("GFDL") && !X.okLicense("CC BY-NC 2.0") && !X.okLicense("CC BY-ND 4.0") && !X.okLicense("") && !X.okLicense("CC BY-SA 3.0 and GFDL"), "GFDL, NC, ND, empty, mixed refused (anchored)");
check(!X.okRatio(3300, 1000) && !X.okRatio(2240, 1000) && X.okRatio(2000, 1000) && !X.okRatio(500, 1000), "ratio kept within 0.6–2.2");
check(X.plain("<a href='x'>John &amp; Doe</a> &#233;&#x00e9;") === "John & Doe éé", "author: HTML stripped, entities decoded");
check(X.tokens("Yu Garden Shanghai", "Shanghai").join(",") === "garden" && X.tokens("Musée de l'Orangerie", "Paris").join(",") === "musee,orangerie", "Openverse: the place's significant words (city and short words aside)");
check(X.ovLicense("by-sa", "2.0") === "CC BY-SA 2.0" && X.ovLicense("cc0", "1.0") === "CC0" && X.ovLicense("pdm", "") === "Public domain", "Openverse licence labels");
const now0 = T0;
check(X.needsLookup(undefined, {}, now0) && !X.needsLookup({ v: 1, none: true, at: now0 - 86_400_000 }, {}, now0) && X.needsLookup({ v: 1, none: true, at: now0 - 31 * 86_400_000 }, {}, now0), "a « none » is looked up again after 30 days");
check(X.needsLookup({ v: 1, path: "c/x-500.jpg", thumb: "c/x-500.jpg", at: 100 }, { name: 200 }, now0) && !X.needsLookup({ v: 1, path: "c/x-500.jpg", thumb: "c/x-500.jpg", at: 300 }, { name: 200, lat: 1 }, now0), "a place renamed or moved after its photo is looked up again");

// ---------- 2. a whole pass ----------
console.log("2. A whole pass: Wikidata, Wikipedia, Openverse, sizes, refusals, the cover");
const FX = {
  nom: {
    Bund: [nomHit(31.2400, 121.4900, "Q1")],
    "Shanghai Museum": [nomHit(31.2280, 121.4750, "Q2", "en:Shanghai Museum")],
    "Yu Garden": [nomHit(31.2272, 121.4921, "Q3")],
    "Peace Hotel": [nomHit(31.2405, 121.4880, "Q5")],
    "Small Temple": [nomHit(31.2300, 121.4700, "Q6")],
    "Exact Tower": [nomHit(31.2300, 121.4700, "Q7")],
    "Tiny Shrine": [nomHit(31.2300, 121.4700, "Q8")],
    "Far Place": [nomHit(31.2800, 121.4700, "Q9")],
    "Cartier Shanghai": [nomHit(31.2300, 121.4700, "Q10")],
    "Map Spot": [nomHit(31.2300, 121.4700, "Q12")],
    Shanghai: [nomHit(31.2304, 121.4737, "Q8686")],
  },
  ents: {
    Q1: { p18: "Bund Shanghai.jpg" },
    Q2: { p18: "Shanghai Museum.jpg", sitelinks: { enwiki: "Shanghai Museum", frwiki: "Musée de Shanghai" } },
    Q3: { p18: "Yu Garden panorama.jpg" },
    Q5: { p18: "Peace Hotel.jpg" },
    Q6: { p18: "Small Temple.jpg" },
    Q7: { p18: "Exact Tower.jpg" },
    Q8: { p18: "Tiny Shrine.jpg" },
    Q9: { p18: "Far.jpg" },
    Q10: { p18: "Cartier Shanghai.jpg" },
    Q12: { p18: "Map of the Bund.png" },
  },
  claims: { Q8686: { P18: "Shanghai montage.png", P948: "Shanghai banner.jpg" } },
  files: {
    "File:Bund Shanghai.jpg": { w: 4000, h: 2667, artist: "<a href='//commons.wikimedia.org/wiki/User:J'>John &amp; Doe</a>", license: "CC BY-SA 4.0" },
    "File:Shanghai Museum.jpg": { w: 3000, h: 2000, license: "GFDL" },
    "File:Musee de Shanghai.jpg": { w: 2000, h: 1500, license: "CC BY 2.0", licenseUrl: "http://creativecommons.org/licenses/by/2.0" },
    "File:Yu Garden panorama.jpg": { w: 3300, h: 1000 },
    "File:Peace Hotel.jpg": { w: 1021, h: 700 },
    "File:Small Temple.jpg": { w: 640, h: 480 },
    "File:Exact Tower.jpg": { w: 1280, h: 960 },
    "File:Tiny Shrine.jpg": { w: 400, h: 300 },
    "File:Far.jpg": { w: 3000, h: 2000 },
    "File:Cartier Shanghai.jpg": { w: 2000, h: 1500, license: "CC BY-SA 3.0 de" },
    "File:Map of the Bund.png": { w: 2000, h: 1500, mime: "image/png" },
    "File:Shanghai montage.png": { w: 2000, h: 2000, mime: "image/png" },
    "File:Shanghai banner.jpg": { w: 2100, h: 300 },
  },
  summaries: {
    "en:Shanghai Museum": { type: "standard", originalimage: { source: "https://upload.wikimedia.org/wikipedia/en/a/ab/Shanghai_Museum_logo.jpg" } },
    "fr:Musée de Shanghai": { type: "standard", originalimage: { source: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Musee_de_Shanghai.jpg" } },
  },
  ov: {
    "Yu Garden Shanghai": [
      { id: "99999999-2222-3333-4444-555555555555", title: "Street at night", width: 1200, height: 800, thumbnail: "https://api.openverse.org/v1/images/9/thumb/", license: "by", license_version: "2.0" },
      { id: OV1, title: "Yu Garden, Shanghai (豫园)", width: 1024, height: 768, thumbnail: `https://api.openverse.org/v1/images/${OV1}/thumb/`, license: "by", license_version: "2.0", license_url: "https://creativecommons.org/licenses/by/2.0/", creator: "Ann", foreign_landing_url: "https://www.flickr.com/photos/x/1" },
    ],
    "Jia Jia Tang Bao Shanghai": [{ id: "22222222-2222-3333-4444-555555555555", title: "Dumplings", width: 1200, height: 800, thumbnail: "https://api.openverse.org/v1/images/2/thumb/", license: "by", license_version: "2.0" }],
  },
};
const PLACES = [
  { id: "p1", name: "Bund", type: "landmark", lat: 31.2401, lng: 121.4901 },
  { id: "p2", name: "Shanghai Museum", type: "musee", lat: 31.2281, lng: 121.4751 },
  { id: "p3", name: "Yu Garden", type: "jardin", lat: 31.2273, lng: 121.4922 },
  { id: "p4", name: "Jia Jia Tang Bao", nameCn: "佳家汤包", type: "restaurant", lat: 31.2350, lng: 121.4700 },
  { id: "p5", name: "Peace Hotel", type: "landmark", lat: 31.2406, lng: 121.4881 },
  { id: "p6", name: "Small Temple", type: "landmark", lat: 31.2301, lng: 121.4701 },
  { id: "p7", name: "Exact Tower", type: "landmark", lat: 31.2302, lng: 121.4702 },
  { id: "p8", name: "Tiny Shrine", type: "landmark", lat: 31.2303, lng: 121.4703 },
  { id: "p9", name: "Far Place", type: "landmark", lat: 31.2304, lng: 121.4704 },
  { id: "p10", name: "Cartier Shanghai", type: "luxe", lat: 31.2305, lng: 121.4705 },
  { id: "p11", name: "Map Spot", type: "landmark", lat: 31.2306, lng: 121.4706 },
];
{
  const w = world(FX);
  seed(w, "trip-p", PLACES);
  const before = w.places.get("trip-p").get("p1").data;
  const r = await P.runPhotos("trip-p", w.deps, {});
  check(r === "done", `the pass ends (${r})`);
  const p1 = photoOf(w, "trip-p", "p1");
  const base1 = `c/${sha("File:Bund Shanghai.jpg")}`;
  check(p1?.path === `${base1}-1280.jpg` && p1?.thumb === `${base1}-500.jpg`, `P18 accepted: large 1280, small 500, named by its source (${p1?.path})`);
  check(p1?.license === "CC BY-SA 4.0" && p1?.author === "John & Doe" && p1?.source === "wikidata" && p1?.qid === "Q1" && /^https:\/\/commons\.wikimedia\.org\/wiki\/File:Bund_Shanghai\.jpg$/.test(p1?.sourceUrl), "licence, author (HTML stripped), source and file page kept");
  const row1 = w.places.get("trip-p").get("p1").data;
  check(row1.fieldsAt.photo > before.fieldsAt.name && row1.updatedAt >= row1.fieldsAt.photo && p1.at === row1.fieldsAt.photo, "fieldsAt.photo and updatedAt bumped (the phones' merge keeps it)");
  const p2 = photoOf(w, "trip-p", "p2");
  check(p2?.source === "wikipedia" && p2?.key === "File:Musee de Shanghai.jpg" && p2?.licenseUrl === "https://creativecommons.org/licenses/by/2.0", "GFDL-only P18 refused → the Wikipedia summary's Commons file (licence link made https)");
  check(!w.log.urls.some((x) => /Shanghai_Museum_logo/.test(x.url)), "the summary's local /wikipedia/en/ file is never used");
  const p3 = photoOf(w, "trip-p", "p3");
  check(p3?.source === "openverse" && p3?.path === `o/${OV1}-500.jpg` && p3.path === p3.thumb && p3.author === "Ann" && p3.license === "CC BY 2.0" && p3.sourceUrl === "https://www.flickr.com/photos/x/1", "3.3 ratio refused → Openverse: the title naming the place, not the first result");
  check(photoOf(w, "trip-p", "p4")?.none === true, "nothing acceptable → { none: true } (Openverse title without the place's name refused)");
  const p5 = photoOf(w, "trip-p", "p5");
  check(/-960\.jpg$/.test(p5?.path) && /-500\.jpg$/.test(p5?.thumb), `1021 px wide → large from the 960 batch (${p5?.path})`);
  const p6 = photoOf(w, "trip-p", "p6");
  check(p6?.path === p6?.thumb && /-500\.jpg$/.test(p6?.path), "640 px wide → large = small (500)");
  const p7 = photoOf(w, "trip-p", "p7");
  check(/-960\.jpg$/.test(p7?.path), "exactly 1280 px wide → large from the 960 batch (the 1280 answer is the original)");
  check(photoOf(w, "trip-p", "p8")?.none === true, "400 px wide → refused");
  check(photoOf(w, "trip-p", "p9")?.none === true && !w.log.urls.some((x) => x.host === "www.wikidata.org" && /Q9\b/.test(decodeURIComponent(x.url))), "a hit 5 km away is dropped (its Wikidata id never asked)");
  check(photoOf(w, "trip-p", "p10")?.license === "CC BY-SA 3.0 de", "« Cartier Shanghai.jpg » with a ported licence accepted");
  check(photoOf(w, "trip-p", "p11")?.none === true, "« Map of the Bund.png » refused");
  const commonsCalls = w.log.urls.filter((x) => x.host === "commons.wikimedia.org");
  const widths = commonsCalls.map((x) => Number(new URLSearchParams(String(x.body)).get("iiurlwidth")));
  check(commonsCalls.every((x) => x.method === "POST") && widths.every((v) => [500, 960, 1280].includes(v)), `Commons: POSTs only, widths ${[...new Set(widths)].join("/")}`);
  check(commonsCalls.every((x) => new URLSearchParams(String(x.body)).get("titles").split("|").length <= 50), "Commons: ≤50 titles per request");
  const wbe = w.log.urls.filter((x) => /wbgetentities/.test(x.url));
  check(wbe.length === 1 && new URL(wbe[0].url).searchParams.get("ids").split("|").length <= 50, "Wikidata: one batched request (≤50 ids)");
  check(w.log.urls.filter((x) => /wbgetclaims/.test(x.url)).every((x) => !new URL(x.url).searchParams.get("property").includes("|")), "every wbgetclaims call carries one property");
  check(!w.log.urls.some((x) => /geosearch|list=geosearch/.test(x.url + String(x.body || ""))), "no Commons geosearch");
  check(w.log.urls.filter((x) => x.host !== "test.supabase.co").every((x) => (x.headers["user-agent"] || "") === X.UA), "every outside request carries the User-Agent with its contact URL");
  check(w.log.wmMax <= 3, `never more than 3 Wikimedia requests in flight (${w.log.wmMax})`);
  const gaps = w.log.nom.slice(1).map((t, i) => t - w.log.nom[i]);
  check(gaps.every((g) => g >= 1100), `Nominatim calls ≥1,100 ms apart (min ${Math.min(...gaps)} ms)`);
  check(w.log.urls.filter((x) => x.host === "nominatim.openstreetmap.org" && /extratags=1/.test(x.url) && /bounded=1/.test(x.url)).length >= PLACES.length, "Nominatim asked with extratags=1 inside a box around each place");
  check(w.log.urls.some((x) => x.host === "nominatim.openstreetmap.org" && new URL(x.url).searchParams.get("q") === "佳家汤包"), "no hit by its name → asked again by its Chinese name");
  check(w.log.downloads.every((d) => /^https:\/\/(upload\.wikimedia\.org|api\.openverse\.org)\//.test(d.url)) && !w.log.downloads.some((d) => /\/wikipedia\/commons\/a\/ab\/(Peace|Exact|Small)/.test(d.url)), "downloads: allow-listed hosts only, never a throttled original");
  check(w.log.heads.length > 0 && !w.log.urls.some((x) => /\/object\/public\//.test(x.url)), "the existence check uses the service route, never the public URL");
  check(w.log.uploads.every((u) => u.headers["x-upsert"] === "true" && u.headers["cache-control"] === "max-age=31536000" && u.headers.authorization && u.headers.apikey), "uploads: service key, upsert, cached a year");
  check(!w.log.msgs.includes("upload after a place write"), "every copy happens before the first place write (one write burst)");
  check(w.log.bucket === 1, "the bucket is made (once)");
  const cover = w.trips.get("trip-p").data.cover;
  check(cover?.from === "place" && cover?.placeId === "p1" && cover.path === p1.path, `montage P18 → P948 banner (7:1) refused → the first landmark's photo (${cover?.from}:${cover?.placeId})`);
  check(w.log.urls.some((x) => /property=P948/.test(x.url)), "the P948 banner was tried");
  check(w.trips.get("trip-p").data.fieldsAt.cover > 0, "the cover written with its fieldsAt");
  check(w.leases.get("trip-p")?.hold === null, "the lease is let go");
  check(w.log.kicks.length === 0, "nothing left over: no next call");

  // a second pass: nothing to write, nothing to upload
  const uploads = w.log.uploads.length;
  const patches = w.log.patches.length;
  const r2 = await P.runPhotos("trip-p", w.deps, {});
  check(r2 === "done" && w.log.uploads.length === uploads && w.log.patches.length === patches, "a second pass writes nothing and uploads nothing");

  // renamed after its photo → looked up again
  const m = w.places.get("trip-p");
  const r6 = m.get("p6");
  // renamed and moved on a phone: now the Bund (its photo already in the bucket)
  Object.assign(r6.data, { name: "Bund", lat: 31.2402, lng: 121.4902 });
  Object.assign(r6.data.fieldsAt, { name: w.clock.t + 10, lat: w.clock.t + 10, lng: w.clock.t + 10 });
  r6.updatedAt = "2026-11-18T11:00:00.000000+00:00";
  w.clock.t += 1000;
  const heads = w.log.heads.length;
  await P.runPhotos("trip-p", w.deps, {});
  check(photoOf(w, "trip-p", "p6")?.key === "File:Bund Shanghai.jpg" && w.log.heads.length > heads && w.log.uploads.length === uploads, "a place renamed after its photo is looked up again (the file already there is not copied again)");
}

// ---------- 3. the city's own photo; a 500 px city photo ----------
console.log("3. The cover: the city's photo, wide enough for the band");
{
  const w = world({
    nom: { Florence: [nomHit(43.7696, 11.2558, "Q2044")] },
    claims: { Q2044: { P18: "Firenze Duomo.jpg" } },
    files: { "File:Firenze Duomo.jpg": { w: 3000, h: 2000 } },
  });
  seed(w, "trip-f", [], { title: "Florence", country: "it", center: [11.2558, 43.7696] });
  await P.runPhotos("trip-f", w.deps, {});
  const c = w.trips.get("trip-f").data.cover;
  check(c?.from === "city" && /-1280\.jpg$/.test(c.path) && c.qid === "Q2044", "the city's P18 becomes the cover");
}
{
  const w = world({
    nom: { Florence: [nomHit(43.7696, 11.2558, "Q2044")], Uffizi: [nomHit(43.7678, 11.2553, "Q51252")] },
    claims: { Q2044: { P18: "Firenze small.jpg" } },
    ents: { Q51252: { p18: "Uffizi.jpg" } },
    files: { "File:Firenze small.jpg": { w: 700, h: 500 }, "File:Uffizi.jpg": { w: 2000, h: 1400 } },
  });
  seed(w, "trip-f", [{ id: "u1", name: "Uffizi", type: "musee", lat: 43.7679, lng: 11.2554 }], { title: "Florence", country: "it", center: [11.2558, 43.7696] });
  await P.runPhotos("trip-f", w.deps, {});
  const c = w.trips.get("trip-f").data.cover;
  check(c?.from === "place" && c.placeId === "u1", "a 500 px city photo is refused for the band → the museum's photo");
}
{
  const w = world({ nom: { Florence: [nomHit(45.0, 11.2558, "Q1")] } });
  seed(w, "trip-f", [], { title: "Florence", country: "it", center: [11.2558, 43.7696] });
  await P.runPhotos("trip-f", w.deps, {});
  check(w.trips.get("trip-f").data.cover?.none === true, "a city hit farther than 80 km is not the city; nothing else → cover « none »");
}

// ---------- 4. Wikimedia busy ----------
console.log("4. Wikimedia busy: a short wait, or the pass ends");
{
  const w = world({ ...FX, wm429: [2] });
  seed(w, "trip-p", [PLACES[0]]);
  await P.runPhotos("trip-p", w.deps, {});
  check(w.log.sleeps.includes(2000) && photoOf(w, "trip-p", "p1")?.path, "Retry-After: 2 → one 2,000 ms wait, then the photo");
}
{
  const w = world({ ...FX, wm429: [120] });
  seed(w, "trip-p", [PLACES[0], PLACES[3]]);
  await P.runPhotos("trip-p", w.deps, {});
  check(photoOf(w, "trip-p", "p1") === undefined && photoOf(w, "trip-p", "p4") === undefined, "Retry-After: 120 → the pass ends, the places stay unmarked (retried next time)");
}
{
  const w = world({ ...FX, ov429: true });
  seed(w, "trip-p", [PLACES[2]]);
  await P.runPhotos("trip-p", w.deps, {});
  check(photoOf(w, "trip-p", "p3") === undefined, "Openverse 429 → skipped, the place unmarked");
}

// ---------- 5. time budget, hops, write conflicts ----------
console.log("5. The time budget, the next call, conflicts");
{
  // each OpenStreetMap request costs 60 s: lookups stop at the budget, the rest stays unmarked, the next call is kicked
  const w = world({ ...FX, nomCost: 60_000 });
  seed(w, "trip-p", PLACES.slice(0, 6));
  const r = await P.runPhotos("trip-p", w.deps, { hop: 2 });
  const marked = PLACES.slice(0, 6).filter((p) => photoOf(w, "trip-p", p.id));
  check(marked.length === 0, `past the 170 s budget: nothing marked from a cut pass (${marked.length})`);
  check(r === "kicked" && w.log.kicks[0]?.hop === 3, `the next call is kicked (hop ${w.log.kicks[0]?.hop})`);
  const w2 = world({ ...FX, nomCost: 60_000 });
  seed(w2, "trip-p", PLACES.slice(0, 6));
  await P.runPhotos("trip-p", w2.deps, { hop: 5 });
  check(w2.log.kicks.length === 0, "hop 5: no further call");
}
{
  // each download costs 70 s: no copy starts after 270 s; places not copied stay unmarked; the next call is kicked
  const w = world({ ...FX, dlCost: 70_000 });
  const four = [PLACES[0], PLACES[4], PLACES[9], { id: "p12", name: "Exact Tower", lat: 31.2307, lng: 121.4707 }];
  seed(w, "trip-p", four);
  const t0 = w.clock.t;
  const r = await P.runPhotos("trip-p", w.deps, {});
  const starts = w.log.heads.filter((h) => /-500\./.test(h.path)).map((h) => h.at - t0);
  check(starts.every((s) => s <= 270_000), `no copy started after 270 s (${starts.map((s) => Math.round(s / 1000)).join(", ")} s)`);
  const unmarked = four.filter((p) => !photoOf(w, "trip-p", p.id));
  check(unmarked.length >= 1 && r === "kicked", `places not copied stay unmarked (${unmarked.length}) and the next call is kicked`);
}
{
  // a phone writes the place during the pass: read again and retried once; a place deleted meanwhile is not written
  let bumped = false;
  const fx = {
    ...FX,
    onPatch(tripId, id) {
      if (bumped || id !== "p1") return;
      bumped = true;
      const r = w.places.get(tripId).get("p1");
      r.updatedAt = "2026-11-18T12:00:00.000000+00:00";
      r.data.note = "changed on a phone";
      const d5 = w.places.get(tripId).get("p5");
      d5.data.deleted = true;
      d5.updatedAt = "2026-11-18T12:00:01.000000+00:00";
    },
  };
  const w = world(fx);
  seed(w, "trip-p", [PLACES[0], PLACES[4]]);
  await P.runPhotos("trip-p", w.deps, {});
  check(photoOf(w, "trip-p", "p1")?.path && w.places.get("trip-p").get("p1").data.note === "changed on a phone", "a conflicting write is read again and retried once (the phone's change kept)");
  check(!photoOf(w, "trip-p", "p5"), "a place deleted meanwhile is not written");
}
{
  // downloads: a redirect to another host is never followed
  const big = "File:Bund Shanghai.jpg";
  const name = encodeURIComponent(big.slice(5).replace(/ /g, "_"));
  const w = world({ ...FX, redirects: { [`https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${name}/500px-${name}`]: "https://evil.example/x.jpg" } });
  seed(w, "trip-p", [PLACES[0]]);
  await P.runPhotos("trip-p", w.deps, {});
  check(!w.log.urls.some((x) => x.host === "evil.example") && !photoOf(w, "trip-p", "p1"), "a redirect to another host is not followed (nothing written)");
}
{
  const w = world({ ...FX, bucketFails: true });
  seed(w, "trip-p", [PLACES[0]]);
  const r = await P.runPhotos("trip-p", w.deps, {});
  check(r === "error" && !photoOf(w, "trip-p", "p1") && w.log.urls.filter((x) => x.host !== "test.supabase.co").length === 0, "the bucket refused: nothing looked up, nothing written");
}

// ---------- 6. the actions ----------
console.log("6. The app's « photos » action and the internal call");
const req = (body, headers = {}) => new Request("https://orbesmap.vercel.app/api/prepare", { method: "POST", headers: { "content-type": "application/json", origin: "https://theorbes.com", ...headers }, body: JSON.stringify(body) });
{
  const w = world(FX);
  seed(w, "trip-p", [PLACES[0]]);
  w.members.set("trip-p:user-1", "editor");
  w.members.set("trip-p:user-3", "viewer");
  const r0 = await P.handle(req({ action: "photos", trip: "trip-p" }), w.deps);
  check(r0.status === 401, "no session → 401");
  const r1 = await P.handle(req({ action: "photos", trip: "trip-p" }, { authorization: "Bearer reader-token" }), w.deps);
  check(r1.status === 403 && w.deps.pending.length === 0, "a reader → 403");
  const r2 = await P.handle(req({ action: "photos", trip: "trip-p" }, { authorization: "Bearer user-token" }), w.deps);
  check(r2.status === 202, `an editor → 202 (${r2.status}), no draft needed`);
  await drain(w);
  check(!!photoOf(w, "trip-p", "p1")?.path, "and the pass runs");
}
{
  const w = world(FX);
  seed(w, "sha-2026", [PLACES[0]]);
  const r = await P.handle(req({ action: "photos", trip: "sha-2026" }, { authorization: "Bearer member-token" }), w.deps);
  check(r.status === 202, `a code trip, a member of the first space with no role → 202 (${r.status})`);
  check(w.log.member.length === 1 && w.log.member[0].apikey && w.log.member[0].authorization === "Bearer member-token", "is_member asked with the apikey and the user's own session");
  // a second call while the first holds its lease: that pass says busy
  const second = P.runPhotos("sha-2026", w.deps, {});
  await drain(w);
  check((await second) === "busy", "a second pass while the lease is held → busy");
  const r3 = await P.handle(req({ action: "photos", trip: "sha-2026" }, { authorization: "Bearer reader-token" }), w.deps);
  check(r3.status === 403, "a code trip, not a member → 403");
  const r4 = await P.handle(req({ action: "photos", trip: "nope" }, { authorization: "Bearer user-token" }), w.deps);
  check(r4.status === 409, "a trip not on the server yet → 409");
}
{
  const w = world(FX);
  seed(w, "trip-p", [PLACES[0]]);
  w.leases.set("trip-p", { hold: "someone", at: w.clock.t - 60_000 });
  check((await P.runPhotos("trip-p", w.deps, {})) === "busy", "a fresh lease held by another call → busy");
  w.leases.set("trip-p", { hold: "someone", at: w.clock.t - 7 * 60_000 });
  check((await P.runPhotos("trip-p", w.deps, {})) === "done", "a lease older than 6 minutes is taken over");
}
{
  const w = world(FX);
  seed(w, "trip-p", [PLACES[0]]);
  const bad = await P.handle(req({ action: "photos-run", trip: "trip-p", hop: 1 }, { "x-prep-key": "wrong" }), w.deps);
  check(bad.status === 403, "internal photos-run with a wrong secret → 403");
  const ok = await P.handle(req({ action: "photos-run", trip: "trip-p", hop: 1 }, { "x-prep-key": w.deps.secret }), w.deps);
  check(ok.status === 202, "with the right secret → 202");
  await drain(w);
  check(!!photoOf(w, "trip-p", "p1")?.path, "and the pass runs");
}
{
  // the real lease adapter: one atomic claim (POST ignore-duplicates, then a conditional PATCH)
  const sent = [];
  const f = async (url, init = {}) => {
    sent.push({ url: decodeURIComponent(String(url)), method: init.method || "GET", prefer: init.headers?.prefer || "", body: init.body ? JSON.parse(init.body) : null });
    if (init.method === "PATCH") return new Response(JSON.stringify([{ place_id: "trip-1" }]), { status: 200 });
    return new Response("", { status: 201 });
  };
  const db = P.restDb("test-service-key", f);
  const got = await db.claimPhotos("trip-1", "h1", 1763460000000);
  const [ins, patch] = sent;
  check(got === true && ins.method === "POST" && /resolution=ignore-duplicates/.test(ins.prefer) && ins.body.trip_id === "_photos" && ins.body.place_id === "trip-1", "the lease row is made with « on conflict do nothing » (trip « _photos »)");
  check(patch.method === "PATCH" && /or=\(data->>hold\.is\.null,data->>at\.lt\.1763459640000\)/.test(patch.url) && /return=representation/.test(patch.prefer) && patch.body.data.hold === "h1", "then taken only when free or stale (6 minutes)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

// ---------- live check (the real services, no storage, no database) ----------
async function live() {
  let last = 0;
  const io = {
    fetch,
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (m) => console.warn(m),
    supaUrl: "",
    key: "",
    async nomGate() {
      const slot = Math.max(Date.now(), last + 1100);
      last = slot;
      if (slot > Date.now()) await new Promise((r) => setTimeout(r, slot - Date.now()));
    },
  };
  const sets = [
    { city: "Shanghai", country: "cn", langs: ["en", "zh", "fr"], places: [["The Bund", 31.2400, 121.4900, "landmark"], ["Yu Garden", 31.2272, 121.4921, "jardin"], ["Shanghai Museum", 31.2281, 121.4755, "musee"], ["Jing'an Temple", 31.2236, 121.4454, "landmark"], ["Oriental Pearl Tower", 31.2397, 121.4998, "landmark"]] },
    { city: "Florence", country: "it", langs: ["en", "it", "fr"], places: [["Uffizi", 43.7678, 11.2553, "musee"], ["Ponte Vecchio", 43.7680, 11.2531, "landmark"], ["Boboli Gardens", 43.7625, 11.2485, "jardin"]] },
  ];
  for (const s of sets) {
    const ts = s.places.map(([name, lat, lng, type], i) => ({ id: `x${i}`, name, lat, lng, type }));
    const res = await X.lookupPlaces(ts, s, io, Date.now() + 170_000);
    for (const t of ts) {
      const r = res.get(t.id);
      console.log(`${s.city.padEnd(10)} ${t.name.padEnd(24)} ${typeof r === "object" ? `${r.source.padEnd(10)} ${r.license.padEnd(16)} ${r.largeW} ${r.key}` : r}`);
    }
    const c = await X.lookupCity({ name: s.city, country: s.country }, io);
    console.log(`${s.city.padEnd(10)} (city)                   ${typeof c === "object" ? `${c.license} ${c.largeW} ${c.key}` : c}`);
  }
}
