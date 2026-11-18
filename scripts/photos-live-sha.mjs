// Live check of the place-photo lookup (api/_photos.ts lookupPlaces) on every place of the Shanghai trip (sha-2026,
// src/data/trips/sha2026.ts), with the real OpenStreetMap / Wikipedia / Wikidata / Commons / Openverse services and the
// app's User-Agent. Nothing is stored (no bucket, no database). Run from the repo:  node scripts/photos-live-sha.mjs
// Options: --budget=<seconds> (default 900: the whole trip in one pass; production gives 170 s per call),
//          --production (as production chains it: 60 places and 170 s per call, the rest in the next call),
//          --only=<id,id> (some places only), --trace (every request), --json (the table as JSON).
import { register } from "node:module";

// "./_photos.js" under api/ is read from its ".ts"; the trip's extensionless imports ("../types") from theirs
register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL && ctx.parentURL.includes("/api/") && spec.endsWith(".js")) return next(spec.replace(/\\.js$/, ".ts"), ctx);
  if ((spec.startsWith("./") || spec.startsWith("../")) && !/\\.[a-z]+$/i.test(spec)) return next(spec + ".ts", ctx);
  return next(spec, ctx);
}`),
  import.meta.url,
);

const X = await import("../api/_photos.ts");
const { SHA2026 } = await import("../src/data/trips/sha2026.ts");

const arg = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=")[1] || d;
const budget = Number(arg("budget", "900")) * 1000;
const only = new Set(arg("only", "").split(",").filter(Boolean));

let last = 0;
const trace = process.argv.includes("--trace");
const io = {
  async fetch(url, init) {
    const t = Date.now();
    try {
      const r = await fetch(url, init);
      if (trace) console.warn(`  [${r.status} ${Date.now() - t} ms] ${decodeURIComponent(String(url)).slice(0, 220)}`);
      return r;
    } catch (e) {
      if (trace) console.warn(`  [ERR ${Date.now() - t} ms ${e.message}] ${decodeURIComponent(String(url)).slice(0, 220)}`);
      throw e;
    }
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (m) => console.warn(`  [log] ${m}`),
  supaUrl: "",
  key: "",
  async nomGate() {
    const slot = Math.max(Date.now(), last + 1100);
    last = slot;
    if (slot > Date.now()) await new Promise((r) => setTimeout(r, slot - Date.now()));
  },
};

const ctx = { city: "Shanghai", country: "cn", langs: ["en", "fr"] };
const ts = SHA2026.places.filter((p) => !only.size || only.has(p.id)).map((p) => ({ id: p.id, name: p.name, nameCn: p.nameCn, addressCn: p.cn, lat: p.lat, lng: p.lng, type: p.type }));
const t0 = Date.now();
let res;
if (process.argv.includes("--production")) {
  // as production runs it: 60 places per call, 170 s of lookups each, the places left (« retry ») in the next call,
  // 6 calls at most (the first and PHOTO_HOPS = 5 more)
  res = new Map();
  for (let call = 1; call <= 6; call++) {
    const todo = ts.filter((t) => !res.has(t.id) || res.get(t.id) === "retry").slice(0, 60);
    if (!todo.length) break;
    const c0 = Date.now();
    const r = await X.lookupPlaces(todo, ctx, io, c0 + 170_000);
    for (const [id, v] of r) res.set(id, v);
    const vals = [...r.values()];
    console.log(`call ${call}: ${todo.length} looked up in ${Math.round((Date.now() - c0) / 1000)} s → ${vals.filter((v) => typeof v === "object").length} found, ${vals.filter((v) => v === "none").length} none, ${vals.filter((v) => v === "retry").length} retry`);
  }
} else res = await X.lookupPlaces(ts, ctx, io, t0 + budget);
const secs = Math.round((Date.now() - t0) / 1000);

const byType = new Map();
const rows = [];
for (const t of ts) {
  const r = res.get(t.id);
  const ok = typeof r === "object";
  const k = byType.get(t.type) || { n: 0, hit: 0 };
  k.n++;
  if (ok) k.hit++;
  byType.set(t.type, k);
  rows.push({ id: t.id, type: t.type, name: t.name, variants: X.nameVariants(t, ctx.city).join(" | "), result: ok ? r.source : r, via: ok ? r.via || "" : "", file: ok ? r.key : "", license: ok ? r.license : "", largeW: ok ? r.largeW : "" });
}
for (const r of rows) {
  console.log(`\n${r.id} [${r.type}] ${r.name}`);
  console.log(`   variants: ${r.variants}`);
  console.log(`   ${r.result === "none" || r.result === "retry" ? r.result : `${r.result} · ${r.file} · ${r.license} · ${r.largeW}px\n   via ${r.via}`}`);
}
const hits = rows.filter((r) => r.file).length;
console.log(`\n== ${hits}/${rows.length} places with a photo (${Math.round((100 * hits) / rows.length)} %) in ${secs} s`);
for (const [type, k] of [...byType].sort((a, b) => b[1].n - a[1].n)) console.log(`   ${type.padEnd(12)} ${k.hit}/${k.n}`);
const src = {};
for (const r of rows) src[r.result] = (src[r.result] || 0) + 1;
console.log(`   by source: ${Object.entries(src).map(([k, v]) => `${k} ${v}`).join(", ")}`);
if (process.argv.includes("--json")) console.log(JSON.stringify(rows));
