// Vercel function: the invitation e-mails and the unsubscribe links (lot cycle, R09).
// - POST {action:"invite"|"link", trip, email} with the inviter's session: the invitation made in the app (trip_invites,
//   checked by its own rules) gets a private link to the trip (?join=…); "invite" also sends it by e-mail (Resend),
//   at most 20 per inviter and 200 for everyone per 24 h, never twice within 24 h, never to an address that opted out.
// - GET ?u=<account>&s=<signature> or ?i=<invitation>&s=…: the unsubscribe page; its script confirms at once (a
//   button when scripts are off), so a mail scanner opening the link alone changes nothing. POST on the same address
//   (the page, or a mail app's own "unsubscribe" button, RFC 8058) records the opt-out (mail_optout).
// Before supabase/saas-14.sql: {fallback:true}, the app keeps today's invitation message. Never 5xx on a missing table.
// Needs on Vercel: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (MAIL_FROM optional), both already set for api/cron.
import { randomBytes } from "node:crypto";
import { APP_URL, checkUnsub, deriveUnsub, esc, inviteMail, langOf, missing, restDb, TXT, unsubInvite, type InviteRow, type Json, type Lang, type Mail } from "./_cycle.js";

const SUPA_URL = process.env.SUPABASE_URL || "https://ifugaqjneprbtigvegeb.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_0qPu_8XZTLk-l68k2kPUvQ_7UXk-fCu";
const ORIGINS = [/^https:\/\/(www\.)?theorbes\.com$/, /^https:\/\/orbesmap(-[a-z0-9-]+)?\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
export const CAP_INVITER = 20;
export const CAP_ALL = 200;
const DAY_MS = 864e5;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type InviteRec = InviteRow & { expires_at: string; created_at?: string };
export interface MailDeps {
  now(): Date;
  /** the unsubscribe signing key ("" = links cannot be checked) */
  secret: string;
  /** the account behind a session (Bearer …), null = not signed in */
  user(auth: string): Promise<{ id: string; email: string; confirmed: boolean } | null>;
  canManage(auth: string, trip: string): Promise<boolean>;
  invitePending(trip: string, email: string): Promise<boolean>;
  /** saas-14 is in (invite_mails can be read) */
  ready(): Promise<boolean>;
  getInvite(trip: string, email: string): Promise<InviteRec | null>;
  insertInvite(row: Json): Promise<InviteRec | null>;
  patchInvite(id: number, patch: Json): Promise<void>;
  /** invitation e-mails sent since a moment, by one inviter (or everyone with null) */
  sentSince(by: string | null, sinceIso: string): Promise<number>;
  optedOut(email: string): Promise<boolean>;
  emailLang(email: string): Promise<string | null>;
  profileName(uid: string): Promise<string>;
  trip(id: string): Promise<Json | null>;
  mail(m: Mail): Promise<boolean>;
  event(row: { user_id: string | null; name: string; detail: string | null; trip_id: string | null }): Promise<void>;
  userEmail(uid: string): Promise<{ email: string; lang: string } | null>;
  inviteById(id: number): Promise<{ email: string; lang: string | null; trip_id: string } | null>;
  optout(email: string, uid: string | null, source: string): Promise<boolean>;
  token(): string;
}

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ORIGINS.some((r) => r.test(origin));
  return ok ? { "access-control-allow-origin": origin!, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", vary: "origin" } : {};
}
const json = (body: unknown, status: number, h: Record<string, string>) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } });

export async function handleMail(req: Request, d: MailDeps): Promise<Response> {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  const url = new URL(req.url);
  if (url.searchParams.has("u") || url.searchParams.has("i")) return unsubscribe(req, url, d);
  if (req.method !== "POST") return json({ error: "method" }, 405, h);
  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer [\w.-]+$/.test(auth)) return json({ error: "auth" }, 401, h);
  let b: Json;
  try {
    b = (await req.json()) as Json;
  } catch {
    return json({ error: "body" }, 400, h);
  }
  const action = b.action === "link" ? "link" : b.action === "invite" ? "invite" : "";
  const trip = typeof b.trip === "string" ? b.trip.slice(0, 64) : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!action || !trip || !EMAIL.test(email) || email.length > 200) return json({ error: "body" }, 400, h);
  try {
    const me = await d.user(auth);
    if (!me) return json({ error: "auth" }, 401, h);
    if (!me.confirmed) return json({ error: "unconfirmed" }, 403, h);
    if (!(await d.canManage(auth, trip))) return json({ error: "forbidden" }, 403, h);
    // the invitation itself is made by the app (trip_invites, with its own rules): this only sends it
    if (!(await d.invitePending(trip, email))) return json({ error: "no_invite" }, 404, h);
    if (!(await d.ready())) return json({ fallback: true }, 200, h);
    const now = d.now();
    let row = await d.getInvite(trip, email);
    const fresh = { token: d.token(), invited_by: me.id, expires_at: new Date(now.getTime() + 30 * DAY_MS).toISOString() };
    if (!row) {
      const lang = langOf((await d.emailLang(email).catch(() => null)) || b.lang);
      row = (await d.insertInvite({ ...fresh, trip_id: trip, email, lang })) || (await d.getInvite(trip, email));
      if (!row) return json({ fallback: true }, 200, h);
    } else if (row.accepted_at || row.claimed_at || Date.parse(row.expires_at) < now.getTime()) {
      // invited again after joining and leaving, or an old link: a new link, counted from zero
      const patch = { ...fresh, sent_at: null, send_count: 0, reminded_at: null, opened_at: null, accepted_at: null, accepted_user: null, claimed_at: null, inviter_notified_at: null };
      await d.patchInvite(row.id, patch);
      row = { ...row, ...patch } as InviteRec;
    }
    const link = `${APP_URL}/?join=${row.token}&src=invite`;
    if (action === "link") return json({ ok: true, sent: false, link }, 200, h);
    if (await d.optedOut(email)) return json({ ok: true, sent: false, link, optout: true }, 200, h);
    if (row.sent_at && now.getTime() - Date.parse(row.sent_at) < DAY_MS) return json({ ok: true, sent: false, link, already: true }, 200, h);
    const since = new Date(now.getTime() - DAY_MS).toISOString();
    if ((await d.sentSince(me.id, since)) >= CAP_INVITER || (await d.sentSince(null, since)) >= CAP_ALL) return json({ ok: true, sent: false, link, capped: true }, 200, h);
    const t = (await d.trip(trip)) || {};
    const lang = langOf(row.lang || b.lang);
    const m = inviteMail({ lang, inviter: await d.profileName(me.id).catch(() => ""), title: String(t.title || ""), start: String(t.start || ""), end: String(t.end || ""), link, unsub: unsubInvite(d.secret, row.id) });
    if (!(await d.mail({ to: email, ...m }).catch(() => false))) return json({ ok: true, sent: false, link, failed: true }, 200, h);
    await d.patchInvite(row.id, { sent_at: now.toISOString(), send_count: (row.send_count || 0) + 1 }).catch(() => undefined);
    await d.event({ user_id: me.id, name: "invite_email_sent", detail: "invite", trip_id: trip }).catch(() => undefined);
    return json({ ok: true, sent: true, link }, 200, h);
  } catch (e) {
    if (missing(e)) return json({ fallback: true }, 200, h);
    return json({ error: String((e as Error)?.message || e).slice(0, 120) }, 502, h);
  }
}

// ---------- unsubscribe ----------
function page(lang: Lang, body: string, status = 200) {
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>ORBES Trips</title></head>
<body style="margin:0;background:#f6f2ea"><div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:36px 22px;color:#0a0a0a">
<p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 26px">ORBES Trips</p>
${body}
<p style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#a8a39b;margin:28px 0 0">ORBES Trips</p></div></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

async function unsubscribe(req: Request, url: URL, d: MailDeps): Promise<Response> {
  const u = url.searchParams.get("u") || "";
  const i = url.searchParams.get("i") || "";
  const s = url.searchParams.get("s") || "";
  const what = u ? `u:${u}` : `i:${i}`;
  const valid = (u ? UUID.test(u) : /^\d{1,12}$/.test(i)) && checkUnsub(d.secret, what, s);
  if (!valid) return page("fr", `<p style="font-size:15px">${esc(TXT.fr.unsubBad)}</p>`, 400);
  try {
    const who = u ? await d.userEmail(u) : await d.inviteById(Number(i));
    const lang = langOf(who?.lang);
    const T = TXT[lang];
    if (!who?.email) return page(lang, `<p style="font-size:15px">${esc(T.unsubBad)}</p>`, 404);
    if (req.method === "POST") {
      await d.optout(who.email, u || null, u ? "link" : "invite");
      await d.event({ user_id: u || null, name: "mail_unsubscribed", detail: u ? "tips" : "invite", trip_id: "trip_id" in who ? who.trip_id : null }).catch(() => undefined);
      return page(lang, `<p style="font-size:15px;line-height:1.5">${esc(u ? T.unsubDone : T.unsubDoneGuest)}</p>`);
    }
    // GET: a person opened the link; a mail scanner that only reads it changes nothing
    const done = u ? T.unsubDone : T.unsubDoneGuest;
    return page(
      lang,
      `<p id="m" style="font-size:15px;line-height:1.5">${esc(T.unsubAsk)}</p>
<noscript><form method="post"><button style="font:inherit;background:#0a0a0a;color:#f6f2ea;border:0;padding:12px 20px;border-radius:12px">${esc(T.unsubConfirm)}</button></form></noscript>
<script>fetch(location.href,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:"confirm=1"}).then(function(r){if(r.ok)document.getElementById("m").textContent=${JSON.stringify(done).replace(/</g, "\\u003c")};}).catch(function(){});</script>`,
    );
  } catch (e) {
    return page("fr", `<p style="font-size:15px">${esc(TXT.fr.unsubBad)}</p>`, missing(e) ? 404 : 503);
  }
}

// ---------- the real services ----------
function realDeps(): MailDeps | null {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!key) return null;
  const db = restDb(SUPA_URL, key);
  const resend = (process.env.RESEND_API_KEY || "").trim();
  const from = process.env.MAIL_FROM || "ORBES Trips <trips@auth.theorbes.com>";
  const enc = encodeURIComponent;
  const count = async (path: string) => {
    const r = await fetch(`${SUPA_URL}${path}&select=id&limit=1`, { method: "HEAD", headers: { apikey: key, authorization: `Bearer ${key}`, prefer: "count=exact" } });
    const n = Number((r.headers.get("content-range") || "").split("/")[1]);
    return r.ok && Number.isFinite(n) ? n : 0;
  };
  return {
    now: () => new Date(),
    secret: deriveUnsub(key),
    async user(auth) {
      const r = await fetch(`${SUPA_URL}/auth/v1/user`, { headers: { apikey: SUPA_KEY, authorization: auth } }).catch(() => null);
      if (!r?.ok) return null;
      const u = (await r.json()) as { id?: string; email?: string; email_confirmed_at?: string | null };
      return u?.id ? { id: u.id, email: String(u.email || "").toLowerCase(), confirmed: !!u.email_confirmed_at } : null;
    },
    async canManage(auth, trip) {
      const r = await fetch(`${SUPA_URL}/rest/v1/rpc/can_manage_trip`, { method: "POST", headers: { apikey: SUPA_KEY, authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ t: trip }) }).catch(() => null);
      return !!r?.ok && (await r.json().catch(() => false)) === true;
    },
    async invitePending(trip, email) {
      const r = (await db(`/rest/v1/trip_invites?trip_id=eq.${enc(trip)}&email=eq.${enc(email)}&select=email`)) as unknown[];
      return Array.isArray(r) && r.length > 0;
    },
    async ready() {
      try {
        await db("/rest/v1/invite_mails?select=id&limit=1");
        return true;
      } catch (e) {
        if (missing(e)) return false;
        throw e;
      }
    },
    async getInvite(trip, email) {
      const r = (await db(`/rest/v1/invite_mails?trip_id=eq.${enc(trip)}&email=eq.${enc(email)}&select=*`)) as InviteRec[];
      return r?.[0] || null;
    },
    async insertInvite(row) {
      try {
        const r = (await db("/rest/v1/invite_mails", { method: "POST", headers: { prefer: "return=representation" }, body: JSON.stringify(row) })) as InviteRec[];
        return r?.[0] || null;
      } catch (e) {
        if (missing(e)) throw e;
        return null; // the same address invited at the same moment: read back by the caller
      }
    },
    async patchInvite(id, patch) {
      await db(`/rest/v1/invite_mails?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    async sentSince(by, sinceIso) {
      return count(`/rest/v1/invite_mails?sent_at=gte.${enc(sinceIso)}${by ? `&invited_by=eq.${by}` : ""}`);
    },
    async optedOut(email) {
      const r = (await db(`/rest/v1/mail_optout?email=eq.${enc(email)}&select=email`)) as unknown[];
      return Array.isArray(r) && r.length > 0;
    },
    async emailLang(email) {
      try {
        const r = await db("/rest/v1/rpc/cycle_email_lang", { method: "POST", body: JSON.stringify({ p_email: email }) });
        return typeof r === "string" ? r : null;
      } catch {
        return null;
      }
    },
    async profileName(uid) {
      const r = (await db(`/rest/v1/profiles?id=eq.${uid}&select=data`)) as { data: Json }[];
      return String(r?.[0]?.data?.name || "");
    },
    async trip(id) {
      const r = (await db(`/rest/v1/trips?id=eq.${enc(id)}&select=data`)) as { data: Json }[];
      return r?.[0]?.data || null;
    },
    async mail(m) {
      if (!resend) return false;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${resend}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.headers ? { headers: m.headers } : {}) }),
      }).catch(() => null);
      return !!r?.ok;
    },
    async event(row) {
      await db("/rest/v1/events", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(row) });
    },
    async userEmail(uid) {
      try {
        const u = (await db(`/auth/v1/admin/users/${uid}`)) as { email?: string };
        if (!u?.email) return null;
        const p = (await db(`/rest/v1/profiles?id=eq.${uid}&select=data`)) as { data: Json }[];
        return { email: u.email.toLowerCase(), lang: String(p?.[0]?.data?.lang || "fr") };
      } catch {
        return null;
      }
    },
    async inviteById(id) {
      const r = (await db(`/rest/v1/invite_mails?id=eq.${id}&select=email,lang,trip_id`)) as { email: string; lang: string | null; trip_id: string }[];
      return r?.[0] || null;
    },
    async optout(email, uid, source) {
      await db("/rest/v1/mail_optout", { method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ email: email.toLowerCase(), user_id: uid, source }) });
      return true;
    },
    token: () => randomBytes(18).toString("base64url"),
  };
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}
async function serve(req: Request): Promise<Response> {
  const d = realDeps();
  if (!d) {
    const url = new URL(req.url);
    if (url.searchParams.has("u") || url.searchParams.has("i")) return page("fr", `<p style="font-size:15px">${esc(TXT.fr.unsubBad)}</p>`, 503);
    return json({ fallback: true }, 200, cors(req.headers.get("origin")));
  }
  return handleMail(req, d);
}
export const GET = serve;
export const POST = serve;
