// Checks the offline pack's plan (src/lib/packPlan.ts) and the entry keys of an address (src/lib/entryKeys.ts), no
// browser needed:  node scripts/offline-sim.mjs   (Node 22.6+ strips the TypeScript types on import). Exit 1 on failure.
import { haversine, legacyPack, legsFor, MAX_LEGS, packSummary, parseRouteKey, phaseUpdate, readStatus, routeKey, sliceFromFix, WALK_MAX_M } from "../src/lib/packPlan.ts";
import { readEntry, withoutKeys, ENTRY_KEYS } from "../src/lib/entryKeys.ts";

let ok = 0;
let ko = 0;
const check = (cond, name) => {
  if (cond) ok++;
  else ko++;
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
};

// Shanghai: the hotel on the Bund, a few places around (all within 4 km), one far away (Suzhou, ~85 km)
const hotel = { lat: 31.2400, lng: 121.4900 };
const A = { lat: 31.2304, lng: 121.4737 };
const B = { lat: 31.2222, lng: 121.4581 };
const C = { lat: 31.2165, lng: 121.4365 };
const SUZHOU = { lat: 31.2989, lng: 120.5853 };

console.log("Routes of each day");
{
  const legs = legsFor([{ key: "d1", stops: [A, B, C] }], hotel);
  const car = legs.filter((l) => l.mode === "car");
  check(car.length === 4, "hotel → A → B → C → hotel: 4 driving routes");
  check(car[0].from.lat === hotel.lat && car[0].to.lat === A.lat && car[3].to.lat === hotel.lat, "in the day's order, back to the hotel");
  const walk = legs.filter((l) => l.mode === "walk");
  check(walk.every((l) => haversine(l.from, l.to) <= WALK_MAX_M) && walk.length > 0, "walking only for hops up to 4 km");
}
{
  const legs = legsFor([{ key: "d1", stops: [A, SUZHOU] }], hotel);
  const far = legs.filter((l) => l.to.lat === SUZHOU.lat);
  check(far.length === 1 && far[0].mode === "car", "a far hop: driving only");
}
{
  const legs = legsFor([{ key: "d1", stops: [A, B] }, { key: "d2", stops: [A, B] }], hotel);
  const keys = legs.map((l) => l.key);
  check(new Set(keys).size === keys.length, "the same route on two days: kept once");
}
{
  check(legsFor([{ key: "d1", stops: [] }], hotel).length === 0, "an empty day: no route");
  const legs = legsFor([{ key: "d1", stops: [A, B, C] }], null);
  check(legs.filter((l) => l.mode === "car").length === 2, "no hotel: stop to stop only");
  const same = legsFor([{ key: "d1", stops: [A, { lat: A.lat + 0.0001, lng: A.lng }] }], null);
  check(same.length === 0, "two stops at the same place: no route");
  const bad = legsFor([{ key: "d1", stops: [A, { lat: 0, lng: 0 }, { lat: NaN, lng: 3 }, B] }], null);
  check(bad.filter((l) => l.mode === "car").length === 1, "places without coordinates are skipped");
}
{
  const many = Array.from({ length: 60 }, (_, d) => ({ key: `d${d}`, stops: Array.from({ length: 6 }, (_, i) => ({ lat: 31.2 + d * 0.01 + i * 0.002, lng: 121.4 + i * 0.003 })) }));
  check(legsFor(many, hotel).length === MAX_LEGS, `at most ${MAX_LEGS} routes`);
}
{
  const k = routeKey("walk", A, B);
  const p = parseRouteKey(k);
  check(p && p.mode === "walk" && p.from.lat === +A.lat.toFixed(5) && p.to.lng === +B.lng.toFixed(5), "a route's stored name reads back");
  check(parseRouteKey("https://x") === null, "anything else is not a route name");
}

console.log("A stored route from where the traveller stands");
{
  const coords = [[hotel.lng, hotel.lat], [121.484, 31.236], [121.478, 31.233], [A.lng, A.lat]];
  const near = { lat: 31.2345, lng: 121.481 };
  const s = sliceFromFix(coords, near);
  check(!!s && s.coords[0][0] === near.lng && s.coords[0][1] === near.lat, "near the route: starts at the traveller");
  check(!!s && s.coords[s.coords.length - 1][1] === A.lat && s.left < s.total && s.off < 300, "ends at the place, shorter than the whole route");
  check(sliceFromFix(coords, { lat: 31.26, lng: 121.52 }) === null, "too far from it (> 300 m): not used");
  check(sliceFromFix([[1, 2]], near) === null, "a route of one point: not used");
}

console.log("Complete or not");
{
  const base = { map: { expected: 500, missing: 0 }, routes: { total: 10, have: 10, failed: 0 }, photos: { total: 20, have: 20 }, trip: true, cards: { have: 0, total: 8 } };
  check(packSummary(base).complete, "map, routes, photos and trip: complete");
  check(!packSummary({ ...base, map: { expected: 500, missing: 3 } }).complete, "tiles missing: not complete");
  check(!packSummary({ ...base, map: null }).complete, "no map: not complete");
  check(!packSummary({ ...base, routes: { total: 10, have: 7, failed: 0 } }).complete, "routes missing: not complete");
  check(packSummary({ ...base, routes: { total: 10, have: 8, failed: 2 } }).complete, "routes known impossible count as done (an estimate shows)");
  check(!packSummary({ ...base, photos: { total: 20, have: 19 } }).complete, "a photo missing: not complete");
  check(packSummary({ ...base, photos: null }).complete, "photos not kept in this browser: not counted");
  check(!packSummary({ ...base, trip: false }).complete, "the trip not on this phone: not complete");
  check(packSummary({ ...base, cards: { have: 0, total: 0 } }).complete, "no driver cards: never makes it incomplete");
}

console.log("Status kept on the phone");
{
  const legacy = readStatus({ state: "ready", done: 474, total: 474, bytes: 57e6, at: 1, points: 68 });
  check(legacy.state === "ready" && legacyPack(legacy), "a status from before the pack: the map is ready, routes and photos to add");
  const pack = readStatus({ state: "ready", done: 1, total: 1, bytes: 1, trip: "t1", phase: "routes" });
  check(!legacyPack(pack) && pack.phase === undefined, "the phase never survives a restart");
  check(readStatus({ state: "running", done: 3 }).state === "none" && readStatus(null).state === "none", "anything but a ready map reads as none");
  const during = { state: "ready", done: 1, total: 1, bytes: 1, trip: "t1", phase: "routes" };
  const after = phaseUpdate(during, { state: "error", error: "x", routes: { done: 1, total: 4, failed: 1 } });
  check(after.state === "ready" && !after.error && after.routes.failed === 1, "a route failing never turns the map's state into an error");
  const ph = phaseUpdate({ ...during, phase: "photos" }, { photos: null, state: "none" });
  check(ph.state === "ready" && ph.photos === null, "a photo failing never touches the map");
}

console.log("Entry keys of an address");
{
  const q = "?src=email_back&new=1&by=abc&t=xyz&booking=12&offline=1";
  check(withoutKeys(q, ENTRY_KEYS) === "?src=email_back&by=abc&t=xyz", "the cycle's keys leave, src / by / t stay in order");
  check(withoutKeys("?new=1", ENTRY_KEYS) === "", "nothing left: no question mark");
  check(withoutKeys("?code=abc&new=1", ENTRY_KEYS) === "?code=abc", "Supabase's code stays");
  const e = readEntry("?new=1&booking=42&offline=1&join=abcdefghijklmnopqrstuvwx");
  check(e.new && e.booking === 42 && e.offline && e.join === "abcdefghijklmnopqrstuvwx", "new, booking, offline and join read");
  const bad = readEntry("?new=yes&booking=1x&join=short");
  check(!bad.new && bad.booking === null && bad.join === null, "malformed values ignored");
  check(withoutKeys("?join=abcdefghijklmnopqrstuvwx&src=invite", ["join"]) === "?src=invite", "the invitation token leaves once remembered, src stays");
}

console.log(`\n${ok} passed, ${ko} failed`);
process.exit(ko ? 1 : 0);
