// Vercel function: the alerts (lot 6g). Supabase calls it every 10 minutes (supabase/saas-7.sql, pg_cron + pg_net)
// with a secret only the database knows. For every trip happening now it sends, in each traveller's language:
// - around 7:30 local time on a trip day: the day by e-mail (Resend) and as a notification, with the places closed that day;
// - 30 minutes before each place at a set time: a notification (Web Push);
// - two days after a trip ends (lot retention): one "welcome back" e-mail, with a few figures of the trip and a way to the next one.
// - once, 2 to 36 hours after a sign-up never confirmed (lot acquisition): the confirmation e-mail again (api/_confirm.ts).
// Needs on Vercel: SUPABASE_SERVICE_ROLE_KEY, VAPID_PRIVATE_KEY, RESEND_API_KEY (MAIL_FROM optional).
import webpush from "web-push";
import { kickStale } from "./prepare.js";
import { confirmReminders, REMIND, type Unconfirmed } from "./_confirm.js";

type Json = Record<string, unknown>;
const SUPA_URL = process.env.SUPABASE_URL || "https://ifugaqjneprbtigvegeb.supabase.co";
const VAPID_PUBLIC = "BK5AQrfBJZC_DtZYyUGPrOeegzY8JzepoT5t6ia_5m1tF8sFZXySh39SlbBCQcfO6Ozc2lqdnQRCyID5f8O5ow4";
const APP_URL = "https://orbesmap.vercel.app";
const MORNING = { from: 7 * 60 + 25, to: 7 * 60 + 45 };
const AHEAD = { from: 25, to: 35 };
// the "welcome back" e-mail: from the 2nd day after the trip's end, within the 7 days after it, between 9:30 and 20:00
// Paris time (the account's own timezone is not stored on the server, so every traveller gets it in that window)
const RETURN = { afterDays: 2, withinDays: 7, from: 9 * 60 + 30, to: 20 * 60 };
const RETURN_TZ = "Europe/Paris";
// the discreet signature at the bottom of every e-mail
const FOOTER = `<p style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#a8a39b;margin:22px 0 0">ORBES Trips</p>`;
// "de Lisbonne", "d'Amsterdam", "du Caire", "de la Havane", "des Sables-d'Olonne", "de l'Haÿ"
const deCity = (c: string) => {
  const a = /^(le|la|les)\s+(.+)$/i.exec(c) || /^(l)['’]\s*(.+)$/i.exec(c);
  if (a) {
    const art = a[1].toLowerCase();
    return art === "l" ? `de l'${a[2]}` : `${art === "le" ? "du" : art === "les" ? "des" : "de la"} ${a[2]}`;
  }
  return /^[aeiouyàâäéèêëîïôöûüœ]/i.test(c) ? `d'${c}` : `de ${c}`;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function db(path: string, key: string, init: RequestInit = {}): Promise<unknown> {
  const r = await fetch(`${SUPA_URL}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`db ${r.status} ${path.split("?")[0]}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

/** The trip's local date (yyyy-mm-dd), minutes since midnight and weekday (0 = Sunday) */
function localNow(tz: string, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(p.weekday)) };
}
const startMin = (slot: unknown) => {
  const m = String(slot || "").match(/(\d{1,2})\s*[h:]\s*(\d{2})?/i);
  if (!m || +m[1] > 23) return null;
  return +m[1] * 60 + (m[2] ? +m[2] : 0);
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const TXT = {
  fr: {
    subject: (t: string, d: string) => `${t} · votre journée (${d})`,
    hello: (n: string) => (n ? `Bonjour ${n},` : "Bonjour,"),
    intro: "Voici votre journée :",
    none: "Rien d'heure fixe aujourd'hui : journée libre.",
    closed: (l: string) => `Attention, fermé aujourd'hui : ${l}.`,
    open: "Ouvrir le voyage",
    stop: "Pour ne plus recevoir cet e-mail : menu du compte → Alertes.",
    pushDay: (t: string, n: number) => `${t} : ${n} lieu${n > 1 ? "x" : ""} aujourd'hui`,
    pushNext: (time: string) => `À ${time}`,
    noTime: "sans heure",
    // the "welcome back" e-mail
    backSubject: (c: string) => `Bon retour ${deCity(c)}`,
    backHello: (n: string) => (n ? `Bonjour ${n},` : "Bonjour,"),
    backIntro: (c: string) => `Bon retour ${deCity(c)}. Votre voyage en quelques chiffres :`,
    backIntroShort: (c: string) => `Bon retour ${deCity(c)}.`,
    days: (n: number) => `${n} jour${n > 1 ? "s" : ""}`,
    visited: (n: number) => `${n} lieu${n > 1 ? "x" : ""} visité${n > 1 ? "s" : ""}`,
    photos: (n: number) => `${n} photo${n > 1 ? "s" : ""}`,
    recap: "Votre récapitulatif vous attend dans l'app : revoyez vos journées et partagez-le avec vos proches.",
    openRecap: "Voir le récapitulatif",
    nextQ: "Où allez-vous ensuite ?",
    nextLink: "Préparez votre prochain voyage",
  },
  en: {
    subject: (t: string, d: string) => `${t} · your day (${d})`,
    hello: (n: string) => (n ? `Good morning ${n},` : "Good morning,"),
    intro: "Here is your day:",
    none: "Nothing at a set time today: a free day.",
    closed: (l: string) => `Heads up, closed today: ${l}.`,
    open: "Open the trip",
    stop: "To stop this email: account menu → Alerts.",
    pushDay: (t: string, n: number) => `${t}: ${n} place${n > 1 ? "s" : ""} today`,
    pushNext: (time: string) => `At ${time}`,
    noTime: "no set time",
    // the "welcome back" e-mail
    backSubject: (c: string) => `Welcome back from ${c}`,
    backHello: (n: string) => (n ? `Hello ${n},` : "Hello,"),
    backIntro: (c: string) => `Welcome back from ${c}. Your trip in a few numbers:`,
    backIntroShort: (c: string) => `Welcome back from ${c}.`,
    days: (n: number) => `${n} day${n > 1 ? "s" : ""}`,
    visited: (n: number) => `${n} place${n > 1 ? "s" : ""} visited`,
    photos: (n: number) => `${n} photo${n > 1 ? "s" : ""}`,
    recap: "Your recap is waiting in the app: look back at your days and share it with friends and family.",
    openRecap: "See the recap",
    nextQ: "Where to next?",
    nextLink: "Plan your next trip",
  },
};

type Place = { id: string; name: string; slot: string; start: number | null; address: string; closed: boolean };

export async function POST(req: Request): Promise<Response> {
  try {
    return await run(req);
  } catch (e) {
    // the reason is written in the database's log of wake-ups (net._http_response), readable from the SQL editor
    return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500);
  }
}

async function run(req: Request): Promise<Response> {
  const t0 = Date.now();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) return json({ error: "SUPABASE_SERVICE_ROLE_KEY missing" }, 503);
  // only the database's own wake-up may run this
  const secret = req.headers.get("x-cron-secret") || "";
  const cfg = (await db("/rest/v1/app_config?key=eq.cron_secret&select=value", key)) as { value: string }[];
  if (!secret || !cfg?.[0]?.value || secret !== cfg[0].value) return json({ error: "forbidden" }, 403);

  // a key pasted with quotes or spaces still works; a wrong key only stops the notifications, never the e-mails
  let vapid = (process.env.VAPID_PRIVATE_KEY || "").trim().replace(/^["']|["']$/g, "");
  const warnings: string[] = [];
  if (vapid) {
    try {
      webpush.setVapidDetails("mailto:hello@joinentity.com", VAPID_PUBLIC, vapid);
    } catch (e) {
      warnings.push(`VAPID_PRIVATE_KEY: ${(e as Error).message}`);
      vapid = "";
    }
  } else warnings.push("VAPID_PRIVATE_KEY missing");
  const resend = (process.env.RESEND_API_KEY || "").trim();
  const from = process.env.MAIL_FROM || "ORBES Trips <trips@auth.theorbes.com>";
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const sent = { emails: 0, pushes: 0, gone: 0, returns: 0 };

  // trips happening around now
  const allTrips = (await db("/rest/v1/trips?select=id,data", key)) as { id: string; data: Json }[];
  // the trip preparations run on the server (api/prepare.ts): one that gave no sign of life for 6 minutes starts again
  let restarted = 0;
  try {
    restarted = await kickStale(allTrips, key);
  } catch (e) {
    warnings.push(`prepare: ${String((e as Error)?.message || e).slice(0, 120)}`);
  }
  const trips = allTrips.filter((t) => {
    const s = String(t.data.start || "");
    const e = String(t.data.end || "");
    return s && e && s <= addDays(today, 1) && e >= addDays(today, -1);
  });

  for (const trip of trips) {
    const d = trip.data;
    const tz = String(d.timezone || "UTC");
    const ln = localNow(tz, now);
    const days = (Array.isArray(d.days) ? d.days : []) as { key: string; title?: string; theme?: string; short?: string; dates?: string[] }[];
    const day = days.find((x) => Array.isArray(x.dates) && x.dates.includes(ln.date));
    if (!day) continue;
    const morning = ln.min >= MORNING.from && ln.min < MORNING.to;
    const rows = (await db(`/rest/v1/places?trip_id=eq.${encodeURIComponent(trip.id)}&select=place_id,data`, key)) as { place_id: string; data: Json }[];
    const places: Place[] = rows
      .map((r) => r.data)
      .map((p, i) => ({ p, id: rows[i].place_id }))
      .filter(({ p }) => p.day === day.key && p.deleted !== true && p.removed !== true && p.type !== "hotel")
      .map(({ p, id }) => {
        const h = (p.hours || {}) as { always?: boolean; closed?: number[] };
        return { id, name: String(p.name || p.nameCn || ""), slot: String(p.slot || ""), start: startMin(p.slot), address: String(p.address || p.addressCn || ""), closed: !h.always && Array.isArray(h.closed) && h.closed.includes(ln.dow) };
      })
      .sort((a, b) => (a.start ?? 9999) - (b.start ?? 9999));
    const soon = places.filter((p) => p.start != null && p.start - ln.min >= AHEAD.from && p.start - ln.min < AHEAD.to);
    if (!morning && !soon.length) continue;

    // the travellers, their language, e-mail, preferences and phones
    const members = (await db(`/rest/v1/trip_members?trip_id=eq.${encodeURIComponent(trip.id)}&select=user_id`, key)) as { user_id: string }[];
    for (const { user_id } of members) {
      const prof = ((await db(`/rest/v1/profiles?id=eq.${user_id}&select=data`, key)) as { data: Json }[])[0]?.data || {};
      const lang = prof.lang === "en" ? "en" : "fr";
      const T = TXT[lang];
      const alerts = (prof.alerts || {}) as { email?: boolean; push?: boolean };
      const phones = (await db(`/rest/v1/push_subscriptions?user_id=eq.${user_id}&select=endpoint,p256dh,auth`, key)) as { endpoint: string; p256dh: string; auth: string }[];
      const title = String(d.title || "ORBES Trips");
      const url = `${APP_URL}/#${trip.id}`;
      const closedNames = places.filter((p) => p.closed).map((p) => p.name);

      const push = async (payload: Json) => {
        if (!vapid || alerts.push === false) return;
        for (const ph of phones) {
          try {
            await webpush.sendNotification({ endpoint: ph.endpoint, keys: { p256dh: ph.p256dh, auth: ph.auth } }, JSON.stringify(payload), { TTL: 1800 });
            sent.pushes++;
          } catch (e) {
            const code = (e as { statusCode?: number }).statusCode;
            // the phone unsubscribed or the app was removed: forget it
            if (code === 404 || code === 410) {
              await db(`/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(ph.endpoint)}`, key, { method: "DELETE" }).catch(() => null);
              sent.gone++;
            }
          }
        }
      };
      const once = async (k: string) => {
        const r = (await db("/rest/v1/alert_log", key, { method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ key: k }) })) as unknown[];
        return Array.isArray(r) && r.length > 0;
      };

      if (morning && (await once(`m:${user_id}:${trip.id}:${ln.date}`))) {
        const lines = places.map((p) => `${p.slot || T.noTime} · ${p.name}${p.closed ? " ⚠" : ""}`);
        // the e-mail
        const to = await emailOf(user_id, key);
        if (resend && to && alerts.email !== false) {
          const list = places.length
            ? `<table style="width:100%;border-collapse:collapse">${places.map((p) => `<tr><td style="padding:8px 10px 8px 0;color:#6f6b65;white-space:nowrap;vertical-align:top">${esc(p.slot || T.noTime)}</td><td style="padding:8px 0;border-bottom:1px solid #eee"><b>${esc(p.name)}</b>${p.closed ? ` <span style="color:#b7791f">⚠</span>` : ""}${p.address ? `<br><span style="color:#6f6b65;font-size:13px">${esc(p.address)}</span>` : ""}</td></tr>`).join("")}</table>`
            : `<p>${esc(T.none)}</p>`;
          const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 22px;color:#0a0a0a">
<p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 22px">ORBES Trips</p>
<p style="font-size:16px;margin:0 0 6px">${esc(T.hello(String(prof.name || "")))}</p>
<p style="font-size:15px;margin:0 0 4px">${esc(T.intro)}</p>
<p style="font-size:20px;font-weight:600;margin:10px 0 2px">${esc(day.theme || day.title || "")}</p>
<p style="color:#6f6b65;margin:0 0 14px">${esc(title)} · ${esc(day.short || ln.date)}</p>
${closedNames.length ? `<p style="background:#fbf3e4;border-radius:10px;padding:10px 12px;color:#7a5410">${esc(T.closed(closedNames.join(", ")))}</p>` : ""}
${list}
<p style="margin:24px 0"><a href="${url}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:12px 20px;border-radius:12px">${esc(T.open)}</a></p>
<p style="font-size:12px;color:#6f6b65">${esc(T.stop)}</p>
${FOOTER}</div>`;
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { authorization: `Bearer ${resend}`, "content-type": "application/json" },
            body: JSON.stringify({ from, to: [to], subject: T.subject(title, String(day.short || ln.date)), html, text: [T.intro, ...lines, closedNames.length ? T.closed(closedNames.join(", ")) : "", url].filter(Boolean).join("\n") }),
          }).catch(() => null);
          if (r?.ok) sent.emails++;
        }
        // the notification
        await push({ title: T.pushDay(title, places.length), body: [closedNames.length ? T.closed(closedNames.join(", ")) : "", lines.slice(0, 4).join("\n")].filter(Boolean).join("\n"), url, tag: `day-${trip.id}` });
      }
      for (const p of soon) {
        if (!(await once(`s:${user_id}:${trip.id}:${p.id}:${ln.date}`))) continue;
        await push({ title: `${T.pushNext(p.slot.split("–")[0] || p.slot)} · ${p.name}`, body: [p.closed ? T.closed(p.name) : "", p.address].filter(Boolean).join("\n"), url, tag: `stop-${p.id}` });
      }
    }
  }
  // the "welcome back" e-mails (a failure here never stops the alerts above: they are only skipped this time)
  try {
    sent.returns = await welcomeBack(allTrips, key, resend, from, now);
  } catch (e) {
    warnings.push(`return: ${String((e as Error)?.message || e).slice(0, 120)}`);
  }
  // the single reminder of a sign-up never confirmed (lot acquisition, R07), only with time left in this run; a failure
  // here never touches what was sent above
  let reminders = 0;
  try {
    reminders = (await confirmReminders(reminderDeps(key, now, t0))).sent;
  } catch (e) {
    warnings.push(`confirm: ${String((e as Error)?.message || e).slice(0, 120)}`);
  }
  return json({ ok: true, trips: trips.length, ...sent, ...(reminders ? { reminders } : {}), ...(restarted ? { restarted } : {}), ...(warnings.length ? { warnings } : {}), ...(resend ? {} : { warning_mail: "RESEND_API_KEY missing" }) });
}

/** The real database, Auth and clock for the reminder of api/_confirm.ts */
function reminderDeps(key: string, now: Date, t0: number) {
  const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
  return {
    now,
    elapsed: () => Date.now() - t0,
    listSql: async (): Promise<Unconfirmed[] | "missing"> => {
      const r = await fetch(`${SUPA_URL}/rest/v1/rpc/unconfirmed_signups`, { method: "POST", headers: h, body: JSON.stringify({ p_min_hours: REMIND.minHours, p_max_hours: REMIND.maxHours, p_limit: 50 }) });
      if (r.status === 404) return "missing";
      if (!r.ok) throw new Error(`db ${r.status} unconfirmed_signups`);
      return ((await r.json()) as Unconfirmed[]) || [];
    },
    listAdmin: async (page: number): Promise<Unconfirmed[]> => {
      const r = (await db(`/auth/v1/admin/users?page=${page}&per_page=200`, key)) as { users?: Unconfirmed[] } | null;
      return Array.isArray(r?.users) ? r.users : [];
    },
    claims: async () => ((await db("/rest/v1/alert_log?key=like.confirm:*&select=key,at", key)) as { key: string; at: string }[]) || [],
    claim: async (k: string) => {
      const r = (await db("/rest/v1/alert_log", key, { method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ key: k }) })) as unknown[];
      return Array.isArray(r) && r.length > 0;
    },
    unclaim: async (k: string) => {
      await db(`/rest/v1/alert_log?key=eq.${encodeURIComponent(k)}`, key, { method: "DELETE" });
    },
    resend: async (email: string) => {
      const r = await fetch(`${SUPA_URL}/auth/v1/resend?redirect_to=${encodeURIComponent(`${APP_URL}/`)}`, { method: "POST", headers: h, body: JSON.stringify({ type: "signup", email }) }).catch(() => null);
      return r ? r.status : 0;
    },
    log: async (userId: string, detail: string) => {
      await fetch(`${SUPA_URL}/rest/v1/events`, { method: "POST", headers: { ...h, prefer: "return=minimal" }, body: JSON.stringify({ user_id: userId, name: "confirm_resent", detail }) });
    },
  };
}

function addDays(iso: string, n: number) {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}
async function emailOf(userId: string, key: string): Promise<string | null> {
  try {
    const u = (await db(`/auth/v1/admin/users/${userId}`, key)) as { email?: string };
    return u?.email || null;
  } catch {
    return null;
  }
}

/** A valid IANA timezone, else the fallback */
function zoneOr(tz: unknown, fallback: string): string {
  const z = String(tz || "");
  if (!z) return fallback;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: z });
    return z;
  } catch {
    return fallback;
  }
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
/** How many rows match, counted by the database (no row is downloaded); 0 when it cannot tell */
async function countRows(path: string, key: string): Promise<number> {
  try {
    const r = await fetch(`${SUPA_URL}${path}${path.includes("?") ? "&" : "?"}limit=1`, { method: "HEAD", headers: { apikey: key, authorization: `Bearer ${key}`, prefer: "count=exact" } });
    const n = Number((r.headers.get("content-range") || "").split("/")[1]);
    return r.ok && Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
/**
 * The places visited during a trip, counted like the app's trip card (TripHero): ticked "visited" (or the old
 * "visited" status), not removed from the programme, never the hotel.
 */
async function visitedCount(tripId: string, hotelId: string, key: string): Promise<number> {
  try {
    const id = encodeURIComponent(tripId);
    const seen = (await db(`/rest/v1/place_states?trip_id=eq.${id}&or=(data->>visited.eq.true,data->>status.eq.visited)&select=place_id,removed:data->>removed`, key)) as { place_id: string; removed: string | null }[];
    const ids = new Set(seen.filter((r) => r.removed !== "true").map((r) => r.place_id));
    if (!ids.size) return 0;
    // the hotel and the places deleted or removed from the trip do not count
    const out = (await db(`/rest/v1/places?trip_id=eq.${id}&or=(data->>type.eq.hotel,data->>deleted.eq.true,data->>removed.eq.true)&select=place_id`, key)) as { place_id: string }[];
    for (const r of out) ids.delete(r.place_id);
    if (hotelId) ids.delete(hotelId);
    return ids.size;
  } catch {
    return 0;
  }
}

/**
 * Two days after a trip ends (its end date in its own timezone), once per traveller and trip: "Bon retour de <ville>",
 * a few figures of the trip, a link to its recap and one to prepare the next trip. Only trips that ended within the
 * last 7 days (nothing is sent for older trips), only to travellers who kept the e-mails on (Alerts), in the daytime
 * (Paris time).
 */
async function welcomeBack(all: { id: string; data: Json }[], key: string, resend: string, from: string, now: Date): Promise<number> {
  if (!resend) return 0;
  // outside the daytime window nothing is read at all
  const paris = localNow(RETURN_TZ, now);
  if (paris.min < RETURN.from || paris.min >= RETURN.to) return 0;
  const today = now.toISOString().slice(0, 10);
  const ended = all.filter((t) => {
    const d = t.data;
    const s = String(d.start || "");
    const e = String(d.end || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return false;
    // a trip never confirmed (still being prepared or reviewed) gets no "welcome back"
    const st = (d.draft as { status?: string } | undefined)?.status;
    if (st === "preparing" || st === "review") return false;
    if (d.deleted === true || d.archived === true) return false;
    if (e < addDays(today, -(RETURN.withinDays + 1)) || e > addDays(today, -1)) return false;
    const since = daysBetween(e, localNow(zoneOr(d.timezone, "UTC"), now).date);
    return since >= RETURN.afterDays && since <= RETURN.withinDays;
  });
  if (!ended.length) return 0;
  // who already had it, or was skipped for good (the log keeps 30 days, longer than the 7-day window, so never twice)
  const done = new Set(((await db("/rest/v1/alert_log?key=like.return:*&select=key", key)) as { key: string }[]).map((r) => r.key));
  const claim = async (k: string) => {
    const r = (await db("/rest/v1/alert_log", key, { method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify({ key: k }) })) as unknown[];
    return Array.isArray(r) && r.length > 0;
  };
  let count = 0;
  for (const trip of ended) {
    const d = trip.data;
    const members = (await db(`/rest/v1/trip_members?trip_id=eq.${encodeURIComponent(trip.id)}&select=user_id`, key)) as { user_id: string }[];
    const todo = members.filter((m) => !done.has(`return:${m.user_id}:${trip.id}`));
    if (!todo.length) continue;
    // the city: the trip's first city (its title may join several, or be a name the travellers gave it)
    const zones = (Array.isArray(d.zones) ? d.zones : []) as { label?: string }[];
    const cities = (((d.draft as { cities?: { name?: string }[] } | undefined)?.cities) || []) as { name?: string }[];
    const city = String(zones[0]?.label || "").trim() || String(cities[0]?.name || "").trim() || String(d.title || "").trim();
    if (!city) continue;
    // the figures: read once per trip, and only once someone is to receive the e-mail
    const days = Math.max(1, daysBetween(String(d.start), String(d.end)) + 1);
    let figs: { visited: number; photos: number } | null = null;
    for (const { user_id } of todo) {
      const k = `return:${user_id}:${trip.id}`;
      const prof = ((await db(`/rest/v1/profiles?id=eq.${user_id}&select=data`, key)) as { data: Json }[])[0]?.data || {};
      const alerts = (prof.alerts || {}) as { email?: boolean };
      // e-mails turned off: skipped for good, never looked at again for this trip
      if (alerts.email === false) {
        await claim(k).catch(() => false);
        continue;
      }
      let to: string | null = null;
      try {
        to = ((await db(`/auth/v1/admin/users/${user_id}`, key)) as { email?: string })?.email || null;
      } catch {
        continue; // the account could not be read this time: tried again on the next run
      }
      if (!to) {
        // an account without an e-mail address: skipped for good
        await claim(k).catch(() => false);
        continue;
      }
      // claimed before sending: two runs at the same time never send it twice
      if (!(await claim(k))) continue;
      if (!figs) {
        const hotelId = String(((d.hotel || {}) as { placeId?: string }).placeId || "");
        figs = { visited: await visitedCount(trip.id, hotelId, key), photos: await countRows(`/rest/v1/photos?trip_id=eq.${encodeURIComponent(trip.id)}`, key) };
      }
      const { visited, photos } = figs;
      const T = TXT[prof.lang === "en" ? "en" : "fr"];
      const name = String(prof.name || "");
      const figures = [T.days(days), ...(visited > 0 ? [T.visited(visited)] : []), ...(photos > 0 ? [T.photos(photos)] : [])];
      const intro = figures.length > 1 ? T.backIntro(city) : T.backIntroShort(city);
      const tripUrl = `${APP_URL}/#${trip.id}`;
      const html = `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 22px;color:#0a0a0a">
<p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 22px">ORBES Trips</p>
<p style="font-size:16px;margin:0 0 6px">${esc(T.backHello(name))}</p>
<p style="font-size:15px;margin:0 0 4px">${esc(intro)}</p>
${figures.length > 1 ? `<p style="font-size:20px;font-weight:600;margin:10px 0 14px">${figures.map(esc).join(` <span style="color:#a8a39b;font-weight:400">·</span> `)}</p>` : ""}
<p style="font-size:15px;margin:10px 0 0">${esc(T.recap)}</p>
<p style="margin:22px 0"><a href="${tripUrl}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:12px 20px;border-radius:12px">${esc(T.openRecap)}</a></p>
<p style="font-size:15px;margin:26px 0 4px">${esc(T.nextQ)}</p>
<p style="margin:0 0 24px"><a href="${APP_URL}/" style="color:#0a0a0a">${esc(T.nextLink)}</a></p>
<p style="font-size:12px;color:#6f6b65">${esc(T.stop)}</p>
${FOOTER}</div>`;
      const text = [T.backHello(name), intro, figures.length > 1 ? figures.join(" · ") : "", T.recap, tripUrl, "", T.nextQ, T.nextLink, `${APP_URL}/`, "", T.stop, "ORBES Trips"].join("\n");
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${resend}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject: T.backSubject(city), html, text }),
      }).catch(() => null);
      if (res?.ok) count++;
    }
  }
  return count;
}
