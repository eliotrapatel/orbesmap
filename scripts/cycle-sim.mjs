// Simulation of the cycle's messages (api/_cycle.ts runCycle) and of the invitation e-mails (api/mail.ts) with a fake
// database, a fake Resend, fake phones and a fake clock. Run from the repo:  node scripts/cycle-sim.mjs
// Nothing leaves this computer: every service is replaced in memory. Exits with code 1 when a check fails.
import { register } from "node:module";
import { readFileSync, readdirSync } from "node:fs";

// api/ imports carry ".js" (Vercel ES modules): here the sources are read from their ".ts"
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
const C = await import("../api/_cycle.ts");
const M = await import("../api/mail.ts");

let failed = 0;
let passed = 0;
const check = (ok, what) => {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
};
const SECRET = C.deriveUnsub("service-key-for-the-sim");
const H = 3600_000;
const D = 24 * H;

// ---------- the fake world ----------
// 2026-11-18 10:00 UTC = 11:00 in Paris (inside the e-mail and notification windows)
const T0 = Date.parse("2026-11-18T10:00:00Z");
function world(o = {}) {
  const w = {
    now: o.now ?? T0,
    ready: o.ready ?? true,
    log: new Map(),
    optout: new Set(o.optout || []),
    people: {},
    trips: o.trips || [],
    members: {}, // trip → [{uid, role, pro, offline_full, bookings}]
    pending: {}, // trip → [emails]
    invites: [],
    bookings: [],
    userTrips: {},
    firstTrip: [],
    quota: [],
    returnAt: {},
    events: [],
    mails: [],
    pushes: [],
    mailOk: true,
    gone: new Set(),
    mailsToday: 0, // e-mails sent today before the sim (the log's own e-mail rows are added)
    throwIn: o.throwIn || null,
  };
  const person = (uid) => {
    const p = w.people[uid];
    return p ? { user_id: uid, email: p.email, lang: p.lang || "fr", name: p.name || "", alerts: p.alerts || {}, tips: p.tips !== false, opted_out: w.optout.has(p.email), phones: w.gone.has(uid) ? (p.phones || 0) : p.phones || 0 } : null;
  };
  const tipsOk = (uid) => {
    const p = person(uid);
    return p && p.alerts.email !== false && p.tips && !p.opted_out;
  };
  w.deps = {
    async ready() {
      if (w.throwIn === "ready") throw new Error("boom");
      return w.ready;
    },
    async claim(row) {
      if (w.log.has(row.key)) return false;
      w.log.set(row.key, { ...row, at: w.now });
      return true;
    },
    async release(key) {
      w.log.delete(key);
    },
    async logRow(key) {
      return w.log.get(key) || null;
    },
    async setChannel(key, channel) {
      const r = w.log.get(key);
      if (r) r.channel = channel;
    },
    async lastTipsAt(uid, email) {
      let last = null;
      for (const r of w.log.values()) if (r.channel === "email" && r.tips && ((uid && r.user_id === uid) || (email && r.email === email))) last = Math.max(last ?? 0, r.at);
      if (uid && w.returnAt[uid]) last = Math.max(last ?? 0, w.returnAt[uid]);
      return last;
    },
    async mailsToday() {
      // as the real count: e-mail rows only (channel "none" markers are not e-mails)
      return w.mailsToday + [...w.log.values()].filter((r) => r.channel === "email").length;
    },
    // the SQL filters (supabase/saas-14.sql), modelled: not sent before, tips rules
    async firstTrip(limit) {
      return w.firstTrip.filter((u) => !w.log.has(`first_trip:${u}`) && tipsOk(u)).slice(0, limit).map((u) => person(u));
    },
    async quota(limit) {
      const m = new Date(w.now).toISOString().slice(0, 7);
      return w.quota.filter((u) => !w.log.has(`quota:${u}:${m}`) && tipsOk(u)).slice(0, limit).map((u) => person(u));
    },
    async tripPeople(trip) {
      if (w.throwIn === "tripPeople") throw new Error("db down");
      return (w.members[trip] || []).map((m) => ({ ...person(m.uid), role: m.role, pro: !!m.pro, offline_full: !!m.offline_full, bookings: m.bookings || 0 }));
    },
    async pendingInvites(trip) {
      return (w.pending[trip] || []).length;
    },
    async person(uid) {
      return person(uid);
    },
    async bookings() {
      return w.bookings.filter((b) => b.status === "new" && !b.trip_id);
    },
    async userTrips(uid) {
      return w.userTrips[uid] || [];
    },
    async invitesToRemind(fromIso, toIso) {
      return w.invites.filter((i) => i.sent_at && i.sent_at >= fromIso && i.sent_at <= toIso && !i.reminded_at && !i.accepted_at && !i.claimed_at);
    },
    async invitePending(trip, email) {
      return (w.pending[trip] || []).includes(email);
    },
    async invitesJoined() {
      return w.invites.filter((i) => i.accepted_at && !i.inviter_notified_at && i.invited_by);
    },
    async patchInvite(id, patch) {
      Object.assign(w.invites.find((i) => i.id === id), patch);
    },
    async optedOut(email) {
      return w.optout.has(email);
    },
    async event(row) {
      w.events.push(row);
    },
    async mail(m) {
      if (!w.mailOk) return false;
      w.mails.push(m);
      return true;
    },
    async push(uid, payload) {
      const p = w.people[uid];
      const n = w.gone.has(uid) ? 0 : p?.phones || 0;
      if (n) w.pushes.push({ uid, ...payload });
      return n;
    },
  };
  w.run = (extra = {}) => C.runCycle(w.deps, { trips: w.trips, now: new Date(w.now), deadline: Date.now() + 60_000, secret: SECRET, canMail: true, canPush: true, ...extra });
  return w;
}
const trip = (id, start, extra = {}) => ({ id, data: { title: `Voyage ${id}`, start, end: start, timezone: "Europe/Paris", ...extra } });
const mailsTo = (w, email) => w.mails.filter((m) => m.to === email);
const evs = (w, name, detail) => w.events.filter((e) => e.name === name && (detail == null || e.detail === detail));

// ---------- 1. safety ----------
console.log("Safety");
{
  const w = world({ ready: false });
  w.people.u1 = { email: "a@x.fr" };
  w.firstTrip = ["u1"];
  const r = await w.run();
  check(w.mails.length === 0 && w.pushes.length === 0, "saas-14 not run: nothing sent");
  check(r.warnings.includes("cycle: saas-14.sql not run"), "saas-14 not run: a warning, no error");
}
{
  const w = world({ throwIn: "ready" });
  let threw = false;
  try {
    const r = await w.run();
    check(r.skipped === "no-sql", "the probe failing counts as not run");
  } catch {
    threw = true;
  }
  check(!threw, "the probe failing never throws");
}
{
  const w = world();
  w.people.u1 = { email: "a@x.fr" };
  w.firstTrip = ["u1"];
  const r = await w.run({ pause: true });
  check(r.skipped === "pause" && w.mails.length === 0, "CYCLE_PAUSE=1: nothing sent");
}
{
  const w = world();
  w.people.u1 = { email: "a@x.fr" };
  w.firstTrip = ["u1"];
  w.mailsToday = 150;
  const r = await w.run({ dayCap: 150 });
  check(w.mails.length === 0 && r.warnings.some((x) => x.includes("daily")), "CYCLE_DAY_CAP reached: no e-mail");
}
{
  const w = world();
  w.people.u1 = { email: "a@x.fr" };
  w.firstTrip = ["u1"];
  await w.run({ deadline: Date.now() - 1 });
  check(w.mails.length === 0, "past the deadline: nothing started");
}
{
  // a failing section never stops the others
  const w = world({ throwIn: "tripPeople", trips: [trip("t1", "2026-11-20")] });
  w.people.u1 = { email: "a@x.fr" };
  w.firstTrip = ["u1"];
  const r = await w.run();
  check(mailsTo(w, "a@x.fr").length === 1 && r.warnings.some((x) => x.startsWith("cycle j")), "a section failing: a warning, the next sections still run");
}
{
  // the cron calls the cycle after every alert, inside its own try/catch
  const src = readFileSync(new URL("../api/cron.ts", import.meta.url), "utf8");
  const iBack = src.indexOf("sent.returns = await welcomeBack(");
  const iCycle = src.indexOf("await runCycle(");
  const before = src.slice(0, iCycle);
  check(iBack > 0 && iCycle > iBack, "cron: the cycle runs after the alerts and the welcome back");
  check(before.lastIndexOf("try {") > iBack && src.slice(iCycle).indexOf("catch (e)") > 0, "cron: the cycle is inside its own try/catch");
  check(/\?new=1&src=email_back/.test(src) && !/href="\$\{APP_URL\}\/"/.test(src), "cron: the welcome back's next-trip link opens the creation");
}

// ---------- 2. J+3 without a trip ----------
console.log("First trip (J+3)");
{
  const w = world();
  w.people.u1 = { email: "a@x.fr", name: "Anne Martin" };
  w.firstTrip = ["u1"];
  await w.run();
  const m = mailsTo(w, "a@x.fr");
  check(m.length === 1 && m[0].subject === "Préparez votre premier voyage", "sent once, in French");
  check(m[0].html.includes("?new=1&amp;src=email_first") || m[0].html.includes("?new=1&src=email_first"), "the button opens the creation");
  check(!!m[0].headers?.["List-Unsubscribe"] && m[0].headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click", "one-click unsubscribe headers");
  check(m[0].html.includes("Bonjour Anne,"), "first name only");
  check(evs(w, "reminder_sent", "first_trip").length === 1, "event reminder_sent / first_trip");
  w.now += 3 * D;
  await w.run();
  check(mailsTo(w, "a@x.fr").length === 1, "never twice (next runs)");
}
{
  const w = world({ now: Date.parse("2026-11-18T06:00:00Z") }); // 07:00 Paris
  w.people.u1 = { email: "a@x.fr" };
  w.firstTrip = ["u1"];
  await w.run();
  check(w.mails.length === 0, "not before 10:00 Paris");
  w.now = Date.parse("2026-11-18T19:00:00Z"); // 20:00 Paris
  await w.run();
  check(w.mails.length === 0, "not after 19:30 Paris");
}
{
  const w = world();
  w.people.u1 = { email: "a@x.fr", lang: "en" };
  w.firstTrip = ["u1"];
  await w.run();
  check(mailsTo(w, "a@x.fr")[0]?.subject === "Plan your first trip", "in the account's language (English)");
}
{
  const w = world();
  w.people.u1 = { email: "a@x.fr" };
  w.firstTrip = ["u1"];
  w.mailOk = false;
  await w.run();
  check(!w.log.has("first_trip:u1"), "Resend refusing: the message is not noted (sent at a later run)");
}

// ---------- 3. J-3 and J-2 ----------
console.log("Before the trip (J-3, J-2)");
const j2trip = (extra) => trip("t2", "2026-11-20", extra);
const j3trip = (extra) => trip("t3", "2026-11-21", extra);
{
  const w = world({ trips: [j2trip({ draft: { status: "review" } })] });
  w.people.own = { email: "own@x.fr", phones: 0 };
  w.people.ed = { email: "ed@x.fr", phones: 1 };
  w.members.t2 = [{ uid: "own", role: "owner", pro: true }, { uid: "ed", role: "editor", pro: false, bookings: 2 }];
  w.pending.t2 = ["late@x.fr"];
  await w.run();
  const own = mailsTo(w, "own@x.fr")[0];
  const ed = mailsTo(w, "ed@x.fr")[0];
  check(!!own && own.subject === "Voyage t2 · départ dans 2 jours", "J-2 sent for a trip still in review");
  check(own.text.includes("Le voyage attend encore votre validation.") && own.text.includes("1 voyageur invité n'a pas encore rejoint"), "owner: review and invitations lines");
  check(own.text.includes("Installez l'app") && own.text.includes("Préparez le hors ligne"), "owner: install (no phone) and offline (Pro, no J-3 push) lines");
  check(!!ed && !ed.text.includes("validation") && !ed.text.includes("voyageur invité") && ed.text.includes("2 réservations reçues"), "editor: no owner lines, its bookings line");
  check(!ed.text.includes("Préparez le hors ligne"), "never the offline line for a free account");
  check(own.html.includes("?src=email_j2#t2"), "the button opens the trip");
  check(evs(w, "reminder_sent", "j2").length === 2, "event reminder_sent / j2");
}
{
  const w = world({ trips: [j2trip()] });
  w.people.ed = { email: "ed@x.fr", phones: 1 };
  w.members.t2 = [{ uid: "ed", role: "editor", pro: false }];
  await w.run();
  check(w.mails.length === 0, "J-2: nothing true to say, no e-mail");
}
{
  const w = world({ trips: [trip("sha-2026", "2026-11-20"), j2trip({ deleted: true }), trip("t4", "2026-11-20", { draft: { status: "preparing" } }), trip("t5", "2026-11-20", { archived: true })] });
  w.people.own = { email: "own@x.fr", phones: 0 };
  for (const id of ["sha-2026", "t2", "t4", "t5"]) w.members[id] = [{ uid: "own", role: "owner", pro: true }];
  await w.run();
  check(w.mails.length === 0, "J-2: code trips, deleted, preparing and archived trips skipped");
}
{
  const w = world({ trips: [j2trip()] });
  w.people.own = { email: "own@x.fr", phones: 0, tips: false };
  w.people.ed = { email: "ed@x.fr", phones: 0, alerts: { email: false, push: true } };
  w.people.op = { email: "op@x.fr", phones: 0 };
  w.optout.add("op@x.fr");
  w.members.t2 = [{ uid: "own", role: "owner" }, { uid: "ed", role: "editor" }, { uid: "op", role: "editor" }];
  await w.run();
  check(w.mails.length === 0, "tips switch off, e-mails off, address opted out: no J-2");
}
{
  const w = world({ trips: [j2trip()] });
  w.people.own = { email: "own@x.fr", phones: 0 };
  w.members.t2 = [{ uid: "own", role: "owner" }];
  w.returnAt.own = w.now - 20 * H;
  await w.run();
  check(w.mails.length === 0, "a \"Bon retour\" e-mail less than 48 h ago blocks a tips e-mail");
  w.returnAt.own = w.now - 50 * H;
  await w.run();
  check(w.mails.length === 1, "after 48 h it goes");
}
{
  // J-3: Pro not ready → notification; ready → nothing; free → nothing (flag off) / the Pro text (flag on)
  const w = world({ trips: [j3trip()] });
  w.people.pro = { email: "pro@x.fr", phones: 1 };
  w.people.ready = { email: "ready@x.fr", phones: 1 };
  w.people.free = { email: "free@x.fr", phones: 1 };
  w.people.nophone = { email: "np@x.fr", phones: 0 };
  w.members.t3 = [{ uid: "pro", role: "owner", pro: true }, { uid: "ready", role: "editor", pro: true, offline_full: true }, { uid: "free", role: "editor" }, { uid: "nophone", role: "editor", pro: true }];
  await w.run();
  check(w.pushes.length === 1 && w.pushes[0].uid === "pro" && w.pushes[0].title === "Votre voyage n'est pas encore hors ligne", "J-3: only the Pro traveller whose pack is not ready");
  check(w.pushes[0].url.includes("?offline=1&src=push_offline#t3"), "J-3: the link opens the offline card");
  check(evs(w, "offline_reminder_sent", "push").length === 1, "event offline_reminder_sent / push");
  await w.run();
  check(w.pushes.length === 1, "J-3: never twice");
  // the next day (J-2): the one without a phone gets the offline line by e-mail, the one notified does not
  w.now += D;
  w.trips = [trip("t3", "2026-11-21")];
  await w.run();
  const np = mailsTo(w, "np@x.fr")[0];
  const pro = mailsTo(w, "pro@x.fr")[0];
  check(!!np && np.text.includes("Préparez le hors ligne"), "no phone: the offline line comes in the J-2 e-mail");
  check(!pro || !pro.text.includes("Préparez le hors ligne"), "J-3 notification sent: no offline line in J-2");
  const w2 = world({ trips: [j3trip()] });
  w2.people.free = { email: "free@x.fr", phones: 1 };
  w2.members.t3 = [{ uid: "free", role: "owner" }];
  await w2.run({ offlineFree: true });
  check(w2.pushes.length === 1 && w2.pushes[0].body.includes("fait partie de Pro") && evs(w2, "offline_reminder_sent", "free").length === 1, "OFFLINE_REMINDER_FREE=1: free travellers get the Pro text");
}
{
  // every phone gone: kept as handled, the J-2 e-mail carries the line
  const w = world({ trips: [j3trip()] });
  w.people.pro = { email: "pro@x.fr", phones: 1 };
  w.gone.add("pro");
  w.members.t3 = [{ uid: "pro", role: "owner", pro: true }];
  await w.run();
  check(w.log.get("j3:pro:t3")?.channel === "none", "J-3 to phones all gone: noted (channel none, not an e-mail) for the J-2 e-mail");
}

// ---------- 4. the 48 h rule, the trip of the month, bookings ----------
console.log("Trip of the month, bookings, 48 h rule");
{
  const w = world({ now: Date.parse("2026-12-01T10:00:00Z"), trips: [trip("t6", "2026-12-03")] });
  w.people.u1 = { email: "a@x.fr", phones: 0 };
  w.members.t6 = [{ uid: "u1", role: "owner" }];
  w.quota = ["u1"];
  w.bookings = [{ id: 7, user_id: "u1", status: "new", trip_id: null, received_at: "2026-11-30T10:00:00Z", extracted: { detected: { start: "2027-01-10", end: "2027-01-15", city: "Lisbonne" } } }];
  await w.run();
  check(w.mails.length === 1 && w.mails[0].subject.includes("départ dans 2 jours"), "J-2 wins the 48 h rule over the trip of the month and the booking");
  w.now += 49 * H;
  await w.run();
  check(w.mails.length === 2, "the next tips e-mail waits 48 h");
}
{
  const w = world({ now: Date.parse("2026-12-01T10:00:00Z") });
  w.people.u1 = { email: "a@x.fr" };
  w.quota = ["u1"];
  await w.run();
  const m = mailsTo(w, "a@x.fr")[0];
  check(!!m && m.subject === "Votre voyage préparé de décembre est disponible", "the 1st: the trip of the month (month in words)");
  check(evs(w, "reminder_sent", "quota").length === 1 && w.log.has("quota:u1:2026-12"), "noted per UTC month");
  const w2 = world({ now: Date.parse("2026-12-02T10:00:00Z") });
  w2.people.u1 = { email: "a@x.fr" };
  w2.quota = ["u1"];
  await w2.run();
  check(w2.mails.length === 0, "not on another day");
}
{
  const book = (id, d) => ({ id, user_id: "u1", status: "new", trip_id: null, received_at: "2026-11-17T10:00:00Z", extracted: { detected: d } });
  const w = world();
  w.people.u1 = { email: "a@x.fr", phones: 1 };
  w.bookings = [book(7, { start: "2027-01-10", end: "2027-01-15", city: "Lisbonne" })];
  await w.run();
  check(w.pushes.length === 1 && w.pushes[0].title === "Nouveau voyage détecté : Lisbonne, 10 – 15 janv. 2027" && w.pushes[0].url.includes("?booking=7&src=push_booking"), "booking: a notification with the form's link");
  await w.run();
  check(w.pushes.length === 1 && w.mails.length === 0, "booking: once per item");
  const w2 = world();
  w2.people.u1 = { email: "a@x.fr", phones: 0 };
  w2.bookings = [book(8, { start: "2027-01-10", city: "Porto" })];
  await w2.run();
  check(w2.mails.length === 1 && w2.mails[0].html.includes("?booking=8&amp;src=email_booking"), "booking without a phone: by e-mail");
  const w3 = world();
  w3.people.u1 = { email: "a@x.fr", phones: 1 };
  w3.userTrips.u1 = [{ start: "2027-01-11", end: "2027-01-14" }];
  w3.bookings = [book(9, { start: "2027-01-10", end: "2027-01-15", city: "Lisbonne" })];
  await w3.run();
  check(w3.pushes.length === 0 && w3.mails.length === 0 && w3.log.has("booking:9"), "booking now covered by a trip: never sent");
  check(w3.log.get("booking:9")?.channel === "none", "booking covered: noted with channel none (never counted as an e-mail)");
  const w4 = world();
  w4.people.u1 = { email: "a@x.fr", phones: 1 };
  w4.bookings = [book(10, { start: "2026-11-01", end: "2026-11-05" })];
  await w4.run();
  check(w4.pushes.length === 0 && w4.log.has("booking:10"), "booking already past: never sent");
}

// ---------- 5. invitations ----------
console.log("Invitations (reminder, inviter told)");
const inv = (o) => ({ id: 1, token: "abcdefghijklmnopqrstuvwx", trip_id: "t9", email: "guest@y.fr", invited_by: "own", lang: "fr", sent_at: new Date(T0 - 3.5 * D).toISOString(), reminded_at: null, accepted_at: null, accepted_user: null, claimed_at: null, inviter_notified_at: null, send_count: 1, ...o });
{
  const w = world({ trips: [trip("t9", "2026-12-20", { end: "2026-12-27" })] });
  w.people.own = { email: "own@x.fr", name: "Eliot R" };
  w.pending.t9 = ["guest@y.fr"];
  w.invites = [inv()];
  await w.run();
  const m = mailsTo(w, "guest@y.fr")[0];
  check(!!m && m.subject === "Rappel : « Voyage t9 » vous attend" && m.text.includes("Eliot vous a invité il y a 3 jours"), "reminder after 3 days, with the inviter's first name");
  check(m.html.includes("?join=abcdefghijklmnopqrstuvwx&amp;src=invite_reminder"), "reminder: the private link");
  check(evs(w, "invite_email_sent", "invite_reminder").length === 1 && w.invites[0].reminded_at, "event invite_email_sent / invite_reminder, noted");
  await w.run();
  check(mailsTo(w, "guest@y.fr").length === 1, "reminder: once");
  // invited again (a new link, the row reset by api/mail): its own reminder
  w.now = T0 + 4 * D; // past the 48 h between two tips e-mails
  Object.assign(w.invites[0], { token: "zyxwvutsrqponmlkjihgfedc", sent_at: new Date(w.now - 3.5 * D).toISOString(), reminded_at: null });
  await w.run();
  check(mailsTo(w, "guest@y.fr").length === 2 && mailsTo(w, "guest@y.fr")[1].html.includes("?join=zyxwvutsrqponmlkjihgfedc"), "invited again with a new link: a second reminder");
}
{
  // a reminder already noted (a run that stopped before marking the row): never read again, nothing sent
  const w = world({ trips: [trip("t9", "2026-12-20", { end: "2026-12-27" })] });
  w.people.own = { email: "own@x.fr" };
  w.pending.t9 = ["guest@y.fr"];
  w.invites = [inv()];
  w.log.set("invite_reminder:1:abcdefghijklmnopqrstuvwx", { key: "invite_reminder:1:abcdefghijklmnopqrstuvwx", channel: "email", tips: true, at: T0 - H });
  await w.run();
  check(w.mails.length === 0 && !!w.invites[0].reminded_at, "reminder already noted: the row is marked, no second e-mail");
}
{
  const w = world({ trips: [trip("t9", "2026-12-20")] });
  w.people.own = { email: "own@x.fr" };
  w.pending.t9 = [];
  w.invites = [inv({ id: 1 }), inv({ id: 2, email: "joined@y.fr", accepted_at: new Date(T0 - D).toISOString() }), inv({ id: 3, email: "out@y.fr" }), inv({ id: 4, email: "young@y.fr", sent_at: new Date(T0 - D).toISOString() })];
  w.pending.t9 = ["out@y.fr", "young@y.fr", "joined@y.fr"];
  w.optout.add("out@y.fr");
  await w.run();
  check(!mailsTo(w, "guest@y.fr").length, "reminder: not when the invitation was cancelled");
  check(!mailsTo(w, "joined@y.fr").length, "reminder: not when the person joined");
  check(!mailsTo(w, "out@y.fr").length, "reminder: not when the address opted out");
  check(!mailsTo(w, "young@y.fr").length, "reminder: not before 3 days");
  const w2 = world({ trips: [trip("t9", "2026-11-01", { end: "2026-11-05" })] });
  w2.pending.t9 = ["guest@y.fr"];
  w2.invites = [inv()];
  await w2.run();
  check(w2.mails.length === 0, "reminder: not when the trip has ended");
}
{
  const w = world({ trips: [trip("t9", "2026-12-20")] });
  w.people.own = { email: "own@x.fr", phones: 1 };
  w.people.guest = { email: "guest@y.fr", name: "Bertrand Rapa" };
  w.invites = [inv({ accepted_at: new Date(T0 - H).toISOString(), accepted_user: "guest" })];
  await w.run();
  check(w.pushes.length === 1 && w.pushes[0].title === "Bertrand a rejoint « Voyage t9 »" && w.pushes[0].url.includes("?src=push_joined#t9"), "inviter told by notification");
  check(evs(w, "reminder_sent", "invite_joined_push").length === 1 && w.invites[0].inviter_notified_at, "event reminder_sent / invite_joined_push, noted");
  await w.run();
  check(w.pushes.length === 1, "inviter told once");
  Object.assign(w.invites[0], { token: "zyxwvutsrqponmlkjihgfedc", accepted_at: new Date(T0 - H).toISOString(), inviter_notified_at: null });
  await w.run();
  check(w.pushes.length === 2, "joined again after a new invitation: the inviter is told again");
  const w2 = world({ trips: [trip("t9", "2026-12-20")] });
  w2.people.own = { email: "own@x.fr", phones: 0, tips: false };
  w2.invites = [inv({ accepted_at: new Date(T0 - H).toISOString() })];
  await w2.run();
  check(mailsTo(w2, "own@x.fr").length === 1 && evs(w2, "reminder_sent", "invite_joined").length === 1, "no phone: told by e-mail (transactional, even with tips off)");
}

// ---------- 6. caps ----------
console.log("Caps");
{
  const w = world();
  for (let i = 0; i < 40; i++) {
    w.people[`u${i}`] = { email: `u${i}@x.fr` };
    w.firstTrip.push(`u${i}`);
  }
  await w.run();
  check(w.mails.length === 30, "at most 30 e-mails per run");
  await w.run();
  check(w.mails.length === 40, "the rest at the next run");
}

{
  // 149 e-mails today and many "none" markers: one e-mail still goes
  const w = world();
  w.people.u1 = { email: "a@x.fr" };
  w.firstTrip = ["u1"];
  w.mailsToday = 149;
  for (let i = 0; i < 30; i++) w.log.set(`booking:${100 + i}`, { key: `booking:${100 + i}`, channel: "none", tips: false, at: T0 - H });
  await w.run({ dayCap: 150 });
  check(w.mails.length === 1, "daily cap: rows with channel none are not counted");
}

// ---------- 7. unsubscribe links ----------
console.log("Unsubscribe links");
{
  const uid = "6f1c2c3e-1111-4222-8333-444455556666";
  const url = new URL(C.unsubUser(SECRET, uid));
  check(C.checkUnsub(SECRET, `u:${uid}`, url.searchParams.get("s")), "a genuine link is accepted");
  check(!C.checkUnsub(SECRET, `u:${uid}`, "AAAAAAAAAAAAAAAAAAAAAAAA"), "a forged signature is refused");
  check(!C.checkUnsub(SECRET, "u:7f1c2c3e-1111-4222-8333-444455556666", url.searchParams.get("s")), "another account's id with this signature is refused");
  check(!C.checkUnsub(SECRET, `i:${uid}`, url.searchParams.get("s")), "an account's signature never works for an invitation");
  check(!url.search.includes("@"), "no address in the link");
}

// ---------- 8. api/mail ----------
console.log("api/mail (invitation e-mails)");
function mailWorld(o = {}) {
  const w = {
    ready: o.ready ?? true,
    me: o.me === undefined ? { id: "own", email: "own@x.fr", confirmed: true } : o.me,
    manage: o.manage ?? true,
    pending: new Set(o.pending ?? ["t1|guest@y.fr"]),
    invites: [],
    sentBy: o.sentBy || 0,
    sentAll: o.sentAll || 0,
    optout: new Set(o.optout || []),
    mails: [],
    events: [],
    out: [],
    name: o.name ?? "Eliot Rapa",
    title: o.title ?? "Shanghai",
    now: T0,
    seq: 0,
  };
  w.deps = {
    now: () => new Date(w.now),
    secret: SECRET,
    async user() {
      return w.me;
    },
    async canManage() {
      return w.manage;
    },
    async invitePending(trip, email) {
      return w.pending.has(`${trip}|${email}`);
    },
    async ready() {
      return w.ready;
    },
    async getInvite(trip, email) {
      return w.invites.find((i) => i.trip_id === trip && i.email === email) || null;
    },
    async insertInvite(row) {
      // unique (trip_id, email), as the table: the second insert at the same moment gets nothing (read back)
      if (w.invites.some((i) => i.trip_id === row.trip_id && i.email === row.email)) return null;
      const r = { id: ++w.seq, sent_at: null, send_count: 0, accepted_at: null, claimed_at: null, ...row };
      w.invites.push(r);
      return r;
    },
    async patchInvite(id, patch) {
      Object.assign(w.invites.find((i) => i.id === id), patch);
    },
    async sentSince(by) {
      const v = by ? w.sentBy : w.sentAll;
      if (v === "throw") throw new Error("count failed");
      return v;
    },
    async claimSend(id, sinceIso, nowIso, n) {
      const r = w.invites.find((i) => i.id === id);
      if (!r || (r.sent_at && r.sent_at >= sinceIso)) return false;
      r.sent_at = nowIso;
      r.send_count = n;
      return true;
    },
    async optedOut(email) {
      return w.optout.has(email);
    },
    async emailLang() {
      return null;
    },
    async profileName() {
      return w.name;
    },
    async trip() {
      return { title: w.title, start: "2026-11-24", end: "2026-11-29" };
    },
    async mail(m) {
      if (w.mailFail) return false;
      await new Promise((r) => setTimeout(r, 5));
      w.mails.push(m);
      return true;
    },
    async event(row) {
      w.events.push(row);
    },
    async userEmail(uid) {
      return uid === "6f1c2c3e-1111-4222-8333-444455556666" ? { email: "own@x.fr", lang: "fr" } : null;
    },
    async inviteById(id) {
      return id === 1 ? { email: "guest@y.fr", lang: "fr", trip_id: "t1" } : null;
    },
    async optout(email) {
      w.out.push(email);
      return true;
    },
    token: () => `tok${String(++w.seq).padStart(21, "0")}`,
  };
  w.post = (body, auth = "Bearer abc.def.ghi") => M.handleMail(new Request("https://orbesmap.vercel.app/api/mail", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }), w.deps);
  return w;
}
const body = (r) => r.json();
{
  const w = mailWorld();
  check((await w.post({ action: "invite", trip: "t1", email: "guest@y.fr" }, null)).status === 401, "401 without a session");
  const w2 = mailWorld({ manage: false });
  check((await w2.post({ action: "invite", trip: "t1", email: "guest@y.fr" })).status === 403, "403 when the account does not manage the trip");
  const w3 = mailWorld({ me: { id: "own", email: "own@x.fr", confirmed: false } });
  check((await w3.post({ action: "invite", trip: "t1", email: "guest@y.fr" })).status === 403, "403 when the inviter's address is not confirmed");
  const w4 = mailWorld({ pending: [] });
  check((await w4.post({ action: "invite", trip: "t1", email: "guest@y.fr" })).status === 404, "404 without the invitation made in the app");
  const w5 = mailWorld({ ready: false });
  const r5 = await w5.post({ action: "invite", trip: "t1", email: "guest@y.fr" });
  check(r5.status === 200 && (await body(r5)).fallback === true && !w5.mails.length, "saas-14 not run: fallback, nothing sent");
}
{
  const w = mailWorld({ title: "Shanghai <b>VIP</b> www.evil.com https://x.io/p", name: "Eliot visit evil.com now" });
  const r = await w.post({ action: "invite", trip: "t1", email: "Guest@Y.fr" });
  const j = await body(r);
  check(r.status === 200 && j.sent === true && /^https:\/\/orbesmap\.vercel\.app\/\?join=[A-Za-z0-9_-]{20,}&src=invite$/.test(j.link), "sent, with the trip's private link");
  const m = w.mails[0];
  check(m.to === "guest@y.fr" && m.subject === "Eliot vous invite à « Shanghai VIP »", "subject: first name, title cleaned");
  check(!/evil|x\.io|<b>/i.test(m.html + m.text + m.subject), "no link or markup from the inviter's text");
  check(m.text.includes("Ne plus recevoir ces e-mails d'invitation et de conseils") && m.html.includes("/api/mail?i=") && !!m.headers?.["List-Unsubscribe"], "unsubscribe link (says what stops) and headers");
  check(w.events.length === 1 && w.events[0].name === "invite_email_sent" && w.events[0].detail === "invite", "event invite_email_sent / invite");
  const again = await body(await w.post({ action: "invite", trip: "t1", email: "guest@y.fr" }));
  check(again.already === true && w.mails.length === 1, "never twice within 24 h");
  const link = await body(await w.post({ action: "link", trip: "t1", email: "guest@y.fr" }));
  check(link.link === j.link && w.mails.length === 1, "\"link\" gives the same link, no e-mail");
  const row = w.invites[0];
  check(row.share_token && row.share_token !== row.token && j.link.includes(`join=${row.share_token}&`) && m.text.includes(`join=${row.token}&`) && !(m.text + m.html).includes(row.share_token), "the inviter's link and the e-mail's link carry two different tokens");
  const sql = readFileSync(new URL("../supabase/saas-14.sql", import.meta.url), "utf8");
  check(/'email', case when shared then null else r\.email end/.test(sql) && /'has_account', not shared and r\.sent_at is not null/.test(sql), "invite_preview: the inviter's link never shows the address nor whether it has an account");
  check(/where token = p_token or share_token = p_token/.test(sql) && /perform 'public\.my_ref_code\(\)'::regprocedure;/.test(sql), "invite_claim accepts both links; saas-14.sql needs saas-12.sql first (offline_ready)");
}
{
  const w = mailWorld({ optout: ["guest@y.fr"] });
  const j = await body(await w.post({ action: "invite", trip: "t1", email: "guest@y.fr" }));
  check(j.optout === true && !!j.link && !w.mails.length, "address opted out: no e-mail, the link to send by hand");
  const w2 = mailWorld({ sentBy: M.CAP_INVITER });
  const j2 = await body(await w2.post({ action: "invite", trip: "t1", email: "guest@y.fr" }));
  check(j2.capped === true && !w2.mails.length, "20 invitation e-mails per inviter per 24 h");
  const w3 = mailWorld({ sentAll: M.CAP_ALL });
  const j3 = await body(await w3.post({ action: "invite", trip: "t1", email: "guest@y.fr" }));
  check(j3.capped === true && !w3.mails.length, "200 invitation e-mails for everyone per 24 h");
  const w4 = mailWorld({ sentBy: Infinity });
  const j4 = await body(await w4.post({ action: "invite", trip: "t1", email: "guest@y.fr" }));
  check(j4.capped === true && !w4.mails.length, "a count that fails (Infinity) counts as capped");
  const w5 = mailWorld({ sentAll: "throw" });
  const j5 = await body(await w5.post({ action: "invite", trip: "t1", email: "guest@y.fr" }));
  check(j5.capped === true && !w5.mails.length, "a count that throws counts as capped");
}
{
  // two taps at the same moment: one e-mail
  const w = mailWorld();
  const [a, b] = await Promise.all([w.post({ action: "invite", trip: "t1", email: "guest@y.fr" }), w.post({ action: "invite", trip: "t1", email: "guest@y.fr" })]);
  const ja = await body(a);
  const jb = await body(b);
  check(w.mails.length === 1 && [ja, jb].filter((j) => j.sent).length === 1, "two sends at the same moment: one e-mail");
  // Resend refuses: the row is not left marked as sent (the person can try again)
  const w2 = mailWorld();
  w2.mailFail = true;
  const jf = await body(await w2.post({ action: "invite", trip: "t1", email: "guest@y.fr" }));
  check(jf.failed === true && w2.invites[0].sent_at === null, "e-mail refused: not marked as sent");
  w2.mailFail = false;
  const jr = await body(await w2.post({ action: "invite", trip: "t1", email: "guest@y.fr" }));
  check(jr.sent === true && w2.mails.length === 1, "and the next try sends it");
}
{
  const w = mailWorld();
  const uid = "6f1c2c3e-1111-4222-8333-444455556666";
  const url = C.unsubUser(SECRET, uid);
  const g = await M.handleMail(new Request(url), w.deps);
  const html = await g.text();
  check(g.status === 200 && !w.out.length && /<form method="post">/.test(html), "GET alone (a mail scanner) does not opt out; a button confirms by POST");
  check(!/<script/i.test(html), "the GET page runs no script (a scanner running pages in a browser changes nothing)");
  const p = await M.handleMail(new Request(url, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } }), w.deps);
  check(p.status === 200 && w.out[0] === "own@x.fr" && w.events.some((e) => e.name === "mail_unsubscribed"), "POST (one-click) opts out, event mail_unsubscribed");
  const bad = await M.handleMail(new Request(url.replace(/s=[^&]+/, "s=AAAAAAAAAAAAAAAAAAAAAAAA"), { method: "POST" }), w.deps);
  check(bad.status === 400 && w.out.length === 1, "a forged link changes nothing");
  const iv = await M.handleMail(new Request(C.unsubInvite(SECRET, 1), { method: "POST" }), w.deps);
  check(iv.status === 200 && w.out[1] === "guest@y.fr", "an invitation's link opts its address out");
}

// ---------- 9. texts ----------
console.log("Texts");
{
  check(C.cleanUserText("Lisbonne 2027", 80) === "Lisbonne 2027", "a normal title is kept");
  check(C.rangeLabel("2026-11-24", "2026-11-29", "fr") === "24 – 29 nov. 2026", "dates in French");
  check(C.rangeLabel("2026-11-24", "2026-11-29", "en") === "24 – 29 Nov 2026", "dates in English");
  // every t("…") of the lot's client files has its English
  const en = {};
  for (const f of readdirSync(new URL("../src/i18n/en/", import.meta.url))) {
    const s = readFileSync(new URL(`../src/i18n/en/${f}`, import.meta.url), "utf8");
    for (const m of s.matchAll(/^\s*"((?:[^"\\]|\\.)*)"\s*:/gm)) en[JSON.parse(`"${m[1]}"`)] = 1;
  }
  const files = ["src/lib/inviteMail.ts", "src/lib/join.ts", "src/components/v3/JoinTripPage.tsx", "src/components/v3/AuthBox.tsx", "src/components/v3/InviteTravellers.tsx", "src/components/v3/ShareTrip.tsx", "src/components/v3/AccountScreen.tsx", "src/components/Tools.tsx", "src/lib/offline.ts"];
  const before = new Set(["Ajouter un vol ou une réservation"]); // already without English before this lot (not one of its texts)
  const miss = [];
  for (const f of files) {
    const s = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    for (const m of s.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      const k = JSON.parse(`"${m[1]}"`);
      if (!en[k] && !before.has(k)) miss.push(`${f}: ${k}`);
    }
  }
  check(miss.length === 0, `every text of the lot has its English${miss.length ? ": " + miss.join(" | ") : ""}`);
}

// ---------- 10. the « stop these e-mails » link and the service worker (public/sw.js) ----------
console.log("Service worker");
{
  const { runInNewContext } = await import("node:vm");
  const src = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  /** sw.js in a fake worker: the stored app, the network's answers, what each navigation got */
  function worker(answers) {
    const store = new Map([["/", { body: "APP", headers: new Map([["content-type", "text/html"]]) }]]);
    const handlers = [];
    const mkRes = (url, a) => ({ ok: a.status === 200, status: a.status, url: a.final || url, body: a.body, headers: { get: (k) => (k === "content-type" ? a.type : null) }, clone() { return this; } });
    const cache = { match: async (k) => store.get(typeof k === "string" ? k : k.url) || undefined, put: async (k, r) => void store.set(k, { body: r.body, headers: new Map() }), add: async () => undefined, keys: async () => [] };
    const ctx = {
      self: { location: { origin: "https://orbesmap.vercel.app" }, addEventListener: (t, f) => t === "fetch" && handlers.push(f), skipWaiting() {}, clients: { matchAll: async () => [], claim: async () => undefined }, registration: {} },
      caches: { open: async () => cache, keys: async () => [], delete: async () => true },
      fetch: async (req) => { const url = typeof req === "string" ? req : req.url; return mkRes(url, answers(new URL(url).pathname)); },
      Request: class { constructor(u) { this.url = u; } },
      URL, AbortController, setTimeout, clearTimeout, Response: { error: () => ({ error: true }) },
    };
    runInNewContext(src, ctx);
    return {
      store,
      async go(url) {
        let got = null;
        const waits = [];
        const e = { request: { method: "GET", mode: "navigate", url }, respondWith: (p) => (got = p), waitUntil: (p) => waits.push(p) };
        for (const h of handlers) h(e);
        const res = got ? await got : null;
        await Promise.all(waits);
        return res;
      },
    };
  }
  const html = { status: 200, type: "text/html; charset=utf-8", body: "UNSUB PAGE" };
  const w = worker((path) => (path.startsWith("/api/") ? html : { status: 200, type: "text/html", body: "APP v2" }));
  const r = await w.go("https://orbesmap.vercel.app/api/mail?u=abc&s=def");
  check(r === null, "the unsubscribe link goes to the network (the server's page), never the stored app");
  check(w.store.get("/").body === "APP", "…and the stored app is left as it is");
  const w2 = worker(() => html);
  await w2.go("https://orbesmap.vercel.app/p/abcdefghijkl");
  check(w2.store.get("/").body === "APP", "an address that is not the app's page is shown, never stored as the app");
  const w3 = worker(() => ({ status: 200, type: "text/html", body: "APP v2", final: "https://orbesmap.vercel.app/?t=abcdefghijkl" }));
  const r3 = await w3.go("https://orbesmap.vercel.app/p/abcdefghijkl");
  check(r3?.body === "APP" && w3.store.get("/").body === "APP v2", "the app's own page (after the /p/ redirect) still refreshes the stored app");
  const w4 = worker(() => ({ status: 200, type: "text/html", body: "APP v2" }));
  const r4 = await w4.go("https://orbesmap.vercel.app/?join=tok&src=invite");
  check(r4?.body === "APP" && w4.store.get("/").body === "APP v2", "any other address of the app: the stored app at once, refreshed behind (as today)");
  check(/const SHELL = "orbes-shell-v2";/.test(src), "the stored app's name is unchanged (an update never empties it)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
