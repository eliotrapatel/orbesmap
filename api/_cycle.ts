// The cycle (lot R09 R15 R18 R19): every new timed message, run by api/cron after the existing alerts, and the
// pieces api/mail shares (e-mail look, texts, unsubscribe links). Not a route (underscore, like _photos.ts).
//
// Messages, each once per account (or address) and trip, recorded in mail_log (supabase/saas-14.sql):
// - the inviter told when an invited person joins (notification, else e-mail);
// - J-3: "your trip is not offline yet" (notification, Pro travellers whose pack is not complete);
// - J-2: what is left to do before leaving (e-mail, only the lines that are true);
// - an invitation e-mail not answered after 3 days: one reminder;
// - J+3 after sign-up without any trip: "plan your first trip";
// - the 1st of the month: the free prepared trip is back (accounts that used last month's);
// - a forwarded booking announcing a new trip: "plan it?" (notification, else e-mail).
// Rules: e-mails 10:00-19:30 Paris, notifications 08:00-22:00 Paris; tips skipped when e-mails are off (Alerts), the
// tips switch is off (profile mailTips) or the address opted out; at most one tips e-mail per 48 h per account or
// address (the "Bon retour" e-mail counts); caps per run and per day; CYCLE_PAUSE=1 stops everything new.
// Everything goes through CycleDeps, so scripts/cycle-sim.mjs runs it offline with a fake database.
import { createHmac, timingSafeEqual } from "node:crypto";

export type Json = Record<string, unknown>;
export type Lang = "fr" | "en";
export const APP_URL = "https://orbesmap.vercel.app";
export const UNSUB_URL = `${APP_URL}/api/mail`;
/** The two trips of the first shared space (code trips): never part of the new departure messages */
export const CODE_TRIPS = new Set(["sha-2026", "gz-2026"]);
const PARIS = "Europe/Paris";
const MAIL_WINDOW = { from: 10 * 60, to: 19 * 60 + 30 };
const PUSH_WINDOW = { from: 8 * 60, to: 22 * 60 };
const GAP_MS = 48 * 3600_000;
const DAY_MS = 864e5;

// ---------- small helpers ----------
export const esc = (s: string) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const langOf = (v: unknown): Lang => (v === "en" ? "en" : "fr");
/** Text a person typed (a first name, a trip title) going into an e-mail to someone else: no links, no markup, short */
export function cleanUserText(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/<[^>]{0,200}>/g, " ")
    .replace(/[\u0000-\u001f\u007f<>{}\\]/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S*/gi, "")
    .replace(/\S*@\S*/g, "")
    .replace(/[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[a-z]{2,}\b\S*/giu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}
export const firstName = (s: unknown) => cleanUserText(String(s ?? "").trim().split(/\s+/)[0] || "", 40);

/** The local date (yyyy-mm-dd) and minutes since midnight in a timezone */
export function localNow(tz: string, now: Date) {
  let zone = tz || "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute), day: Number(p.day) };
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
export const shiftDay = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** "24 – 29 nov. 2026" / "24 – 29 Nov 2026" */
export function rangeLabel(start: string, end: string, lang: Lang): string {
  if (!ISO_DAY.test(start || "")) return "";
  const loc = lang === "en" ? "en-GB" : "fr-FR";
  const d = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(loc, { timeZone: "UTC", ...o });
  const e = ISO_DAY.test(end || "") && end >= start ? end : start;
  if (e === start) return d(start, { day: "numeric", month: "short", year: "numeric" });
  if (start.slice(0, 7) === e.slice(0, 7)) return `${d(start, { day: "numeric" })} – ${d(e, { day: "numeric", month: "short", year: "numeric" })}`;
  return `${d(start, { day: "numeric", month: "short" })} – ${d(e, { day: "numeric", month: "short", year: "numeric" })}`;
}
const monthName = (now: Date, lang: Lang) => now.toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR", { timeZone: PARIS, month: "long" });

// ---------- unsubscribe links (no address in any link: an account id or an invitation id, signed) ----------
export const deriveUnsub = (serviceKey: string) => (serviceKey ? createHmac("sha256", serviceKey).update("orbes-unsub").digest("hex") : "");
export const signUnsub = (secret: string, what: string) => createHmac("sha256", secret).update(what).digest("base64url").slice(0, 24);
export function checkUnsub(secret: string, what: string, sig: string): boolean {
  if (!secret || !sig) return false;
  const a = Buffer.from(signUnsub(secret, what));
  const b = Buffer.from(String(sig));
  return a.length === b.length && timingSafeEqual(a, b);
}
export const unsubUser = (secret: string, uid: string) => `${UNSUB_URL}?u=${encodeURIComponent(uid)}&s=${signUnsub(secret, `u:${uid}`)}`;
export const unsubInvite = (secret: string, id: number | string) => `${UNSUB_URL}?i=${encodeURIComponent(String(id))}&s=${signUnsub(secret, `i:${id}`)}`;
/** The headers that give mail apps their own one-click "unsubscribe" (RFC 8058) */
export const unsubHeaders = (url: string) => ({ "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });

// ---------- texts ----------
const n_ = (n: number, one: string, many: string) => (n > 1 ? many.replace("{n}", String(n)) : one);
export const TXT = {
  fr: {
    hello: (n: string) => (n ? `Bonjour ${n},` : "Bonjour,"),
    // invitation
    inviteSubject: (who: string, title: string) => (who ? `${who} vous invite à « ${title} »` : `Invitation au voyage « ${title} »`),
    inviteIntro: (who: string) => (who ? `${who} vous invite à rejoindre son voyage sur ORBES Trips.` : "Vous êtes invité à rejoindre un voyage sur ORBES Trips."),
    seeTrip: "Voir le voyage",
    inviteHow: "Créez votre compte avec cette adresse : le voyage s'ouvrira dès la confirmation.",
    inviteWhy: (who: string) => (who ? `Vous recevez cet e-mail car ${who} a saisi votre adresse.` : "Vous recevez cet e-mail car quelqu'un a saisi votre adresse."),
    stopAll: "Ne plus recevoir d'e-mails d'ORBES Trips",
    reminderSubject: (title: string) => `Rappel : « ${title} » vous attend`,
    reminderIntro: (who: string) => (who ? `${who} vous a invité il y a 3 jours. Le voyage est prêt : il ne manque que vous.` : "Vous avez été invité il y a 3 jours. Le voyage est prêt : il ne manque que vous."),
    joinedTitle: (name: string, title: string) => `${name} a rejoint « ${title} »`,
    joinedBody: "Le voyage est maintenant partagé.",
    openTrip: "Ouvrir le voyage",
    // tips
    firstSubject: "Préparez votre premier voyage",
    firstBody: "Une destination et des dates suffisent : ORBES Trips prépare le programme, la carte et les horaires. Vous gardez la main sur tout.",
    firstButton: "Préparer mon voyage",
    tipsStop: "Ne plus recevoir ces conseils",
    tipsStopTail: " · ou : menu du compte → Alertes.",
    j2Subject: (title: string) => `${title} · départ dans 2 jours`,
    j2Intro: "Départ dans 2 jours. Ce qui reste à faire :",
    j2Review: "Le voyage attend encore votre validation.",
    j2Bookings: (n: number) => n_(n, "1 réservation reçue à ajouter au voyage.", "{n} réservations reçues à ajouter au voyage."),
    j2Invites: (n: number) => n_(n, "1 voyageur invité n'a pas encore rejoint : renvoyez-lui l'invitation.", "{n} voyageurs invités n'ont pas encore rejoint : renvoyez-leur l'invitation."),
    j2Install: "Installez l'app sur votre téléphone et activez les notifications : vous recevrez la journée chaque matin et un rappel avant chaque lieu.",
    j2Offline: "Préparez le hors ligne en Wi-Fi : la carte, les trajets et les photos marcheront sans réseau.",
    j3Title: "Votre voyage n'est pas encore hors ligne",
    j3Body: (title: string) => `${title} : préparez-le en Wi-Fi, en un tap.`,
    j3Free: (title: string) => `${title} : le hors ligne fait partie de Pro.`,
    quotaSubject: (m: string) => `Votre voyage préparé de ${m} est disponible`,
    quotaBody: (m: string) => `Chaque mois, un voyage préparé par l'IA vous est offert. Celui de ${m} vous attend.`,
    quotaButton: "Préparer un voyage",
    bookingTitle: (w: string) => `Nouveau voyage détecté : ${w}`,
    bookingPush: "Le préparer ?",
    bookingBody: (w: string) => `Une réservation transférée annonce un nouveau voyage : ${w}. Le formulaire est prêt, rempli depuis la réservation.`,
    bookingButton: "Préparer ce voyage",
    // unsubscribe page
    unsubConfirm: "Confirmer",
    unsubAsk: "Ne plus recevoir ces e-mails d'ORBES Trips ?",
    unsubDone: "C'est fait : vous ne recevrez plus ces e-mails. Vous pouvez les réactiver dans l'app : menu du compte → Alertes.",
    unsubDoneGuest: "C'est fait : vous ne recevrez plus d'e-mails d'ORBES Trips.",
    unsubBad: "Ce lien n'est pas valide.",
  },
  en: {
    hello: (n: string) => (n ? `Hello ${n},` : "Hello,"),
    inviteSubject: (who: string, title: string) => (who ? `${who} invited you to “${title}”` : `Invitation to the trip “${title}”`),
    inviteIntro: (who: string) => (who ? `${who} invited you to join their trip on ORBES Trips.` : "You are invited to join a trip on ORBES Trips."),
    seeTrip: "See the trip",
    inviteHow: "Create your account with this address: the trip opens as soon as you confirm it.",
    inviteWhy: (who: string) => (who ? `You are receiving this email because ${who} entered your address.` : "You are receiving this email because someone entered your address."),
    stopAll: "Stop emails from ORBES Trips",
    reminderSubject: (title: string) => `Reminder: “${title}” is waiting for you`,
    reminderIntro: (who: string) => (who ? `${who} invited you 3 days ago. The trip is ready: only you are missing.` : "You were invited 3 days ago. The trip is ready: only you are missing."),
    joinedTitle: (name: string, title: string) => `${name} joined “${title}”`,
    joinedBody: "The trip is now shared.",
    openTrip: "Open the trip",
    firstSubject: "Plan your first trip",
    firstBody: "A destination and dates are enough: ORBES Trips prepares the programme, the map and the opening times. You stay in control.",
    firstButton: "Plan my trip",
    tipsStop: "Stop these tips",
    tipsStopTail: " · or: account menu → Alerts.",
    j2Subject: (title: string) => `${title} · leaving in 2 days`,
    j2Intro: "Leaving in 2 days. What is left to do:",
    j2Review: "The trip is still waiting for your confirmation.",
    j2Bookings: (n: number) => n_(n, "1 booking received to add to the trip.", "{n} bookings received to add to the trip."),
    j2Invites: (n: number) => n_(n, "1 invited traveller has not joined yet: send the invitation again.", "{n} invited travellers have not joined yet: send them the invitation again."),
    j2Install: "Install the app on your phone and turn on notifications: you will get your day each morning and a reminder before each place.",
    j2Offline: "Get offline ready on Wi-Fi: the map, routes and photos will work without a network.",
    j3Title: "Your trip is not offline yet",
    j3Body: (title: string) => `${title}: get it ready on Wi-Fi, in one tap.`,
    j3Free: (title: string) => `${title}: offline is part of Pro.`,
    quotaSubject: (m: string) => `Your prepared trip for ${m} is available`,
    quotaBody: (m: string) => `Each month, one trip prepared by the AI is on us. The one for ${m} is waiting for you.`,
    quotaButton: "Plan a trip",
    bookingTitle: (w: string) => `New trip detected: ${w}`,
    bookingPush: "Plan it?",
    bookingBody: (w: string) => `A forwarded booking announces a new trip: ${w}. The form is ready, filled in from the booking.`,
    bookingButton: "Plan this trip",
    unsubConfirm: "Confirm",
    unsubAsk: "Stop these emails from ORBES Trips?",
    unsubDone: "Done: you will no longer receive these emails. You can turn them back on in the app: account menu → Alerts.",
    unsubDoneGuest: "Done: you will no longer receive emails from ORBES Trips.",
    unsubBad: "This link is not valid.",
  },
};
export type Texts = (typeof TXT)["fr"];

// ---------- the e-mail look (same as the cron's e-mails) ----------
const FOOTER = `<p style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#a8a39b;margin:22px 0 0">ORBES Trips</p>`;
export type MailParts = { hello?: string; lines: string[]; big?: string; sub?: string; list?: string[]; button?: { label: string; url: string }; after?: string; foot?: { text: string; link?: { label: string; url: string }; tail?: string } };
export function mailHtml(m: MailParts): string {
  return `<div style="font-family:Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:28px 22px;color:#0a0a0a">
<p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 22px">ORBES Trips</p>
${m.hello ? `<p style="font-size:16px;margin:0 0 6px">${esc(m.hello)}</p>` : ""}
${m.lines.map((l) => `<p style="font-size:15px;line-height:1.5;margin:0 0 4px">${esc(l)}</p>`).join("\n")}
${m.big ? `<p style="font-size:20px;font-weight:600;margin:12px 0 2px">${esc(m.big)}</p>` : ""}
${m.sub ? `<p style="color:#6f6b65;margin:0 0 14px">${esc(m.sub)}</p>` : ""}
${m.list?.length ? `<table style="width:100%;border-collapse:collapse;margin:10px 0 0">${m.list.map((l) => `<tr><td style="padding:8px 10px 8px 0;color:#6f6b65;vertical-align:top;width:14px">·</td><td style="padding:8px 0;border-bottom:1px solid #eee;font-size:15px;line-height:1.45">${esc(l)}</td></tr>`).join("")}</table>` : ""}
${m.button ? `<p style="margin:24px 0"><a href="${esc(m.button.url)}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:12px 20px;border-radius:12px">${esc(m.button.label)}</a></p>` : ""}
${m.after ? `<p style="font-size:14px;line-height:1.5;color:#3b3833;margin:0 0 18px">${esc(m.after)}</p>` : ""}
${m.foot ? `<p style="font-size:12px;color:#6f6b65;line-height:1.5">${esc(m.foot.text)}${m.foot.link ? ` <a href="${esc(m.foot.link.url)}" style="color:#6f6b65">${esc(m.foot.link.label)}</a>` : ""}${m.foot.tail ? esc(m.foot.tail) : ""}</p>` : ""}
${FOOTER}</div>`;
}
export function mailText(m: MailParts): string {
  return [m.hello || "", ...m.lines, m.big || "", m.sub || "", ...(m.list || []).map((l) => `· ${l}`), m.button ? `${m.button.label} : ${m.button.url}` : "", m.after || "", m.foot ? `${m.foot.text}${m.foot.link ? ` ${m.foot.link.label} : ${m.foot.link.url}` : ""}${m.foot.tail || ""}` : "", "ORBES Trips"]
    .filter(Boolean)
    .join("\n");
}

// ---------- the invitation e-mail (api/mail and the reminder) ----------
export function inviteMail(o: { lang: Lang; inviter: string; title: string; start?: string; end?: string; link: string; unsub: string; reminder?: boolean }) {
  const T = TXT[o.lang];
  const who = firstName(o.inviter);
  const title = cleanUserText(o.title, 80) || "ORBES Trips";
  const dates = rangeLabel(String(o.start || ""), String(o.end || ""), o.lang);
  const parts: MailParts = {
    lines: [o.reminder ? T.reminderIntro(who) : T.inviteIntro(who)],
    big: title,
    sub: dates || undefined,
    button: { label: T.seeTrip, url: o.link },
    after: T.inviteHow,
    foot: { text: T.inviteWhy(who), link: { label: T.stopAll, url: o.unsub } },
  };
  return { subject: o.reminder ? T.reminderSubject(title) : T.inviteSubject(who, title), html: mailHtml(parts), text: mailText(parts), headers: unsubHeaders(o.unsub) };
}

// ---------- what the cycle reads and writes ----------
export type Person = { user_id: string; email: string; lang: string; name: string };
export type Alerts = { email?: boolean; push?: boolean };
export type Profiled = Person & { alerts: Alerts; tips: boolean; opted_out: boolean; phones: number };
export type TripPerson = Profiled & { role: string; pro: boolean; offline_full: boolean; bookings: number };
export type MailRow = { key: string; user_id: string | null; email: string | null; kind: string; trip_id: string | null; channel: "email" | "push"; tips: boolean };
export type InviteRow = { id: number; token: string; trip_id: string; email: string; invited_by: string | null; lang: string | null; sent_at: string | null; reminded_at: string | null; accepted_at: string | null; accepted_user: string | null; claimed_at: string | null; inviter_notified_at: string | null; send_count?: number };
export type BookingRow = { id: number; user_id: string; received_at: string; extracted: Json };
export type Mail = { to: string; subject: string; html: string; text: string; headers?: Record<string, string> };
export type TripRow = { id: string; data: Json };

export interface CycleDeps {
  /** saas-14 is in (mail_log can be read); false = nothing new is sent */
  ready(): Promise<boolean>;
  /** records a message before it is sent; false = already recorded (sent before, or by a run at the same time) */
  claim(row: MailRow): Promise<boolean>;
  release(key: string): Promise<void>;
  logRow(key: string): Promise<{ channel: string } | null>;
  setChannel(key: string, channel: "email" | "push"): Promise<void>;
  /** the last tips e-mail to this account or address (ms), the "Bon retour" e-mail included */
  lastTipsAt(userId: string | null, email: string): Promise<number | null>;
  /** e-mails of this lot sent since midnight UTC */
  mailsToday(): Promise<number>;
  firstTrip(limit: number): Promise<Person[]>;
  quota(limit: number): Promise<Person[]>;
  tripPeople(tripId: string): Promise<TripPerson[]>;
  pendingInvites(tripId: string): Promise<number>;
  person(userId: string): Promise<Profiled | null>;
  bookings(sinceIso: string): Promise<BookingRow[]>;
  /** the start and end of every trip the account belongs to (not deleted) */
  userTrips(userId: string): Promise<{ start: string; end: string }[]>;
  invitesToRemind(fromIso: string, toIso: string): Promise<InviteRow[]>;
  invitePending(tripId: string, email: string): Promise<boolean>;
  invitesJoined(): Promise<InviteRow[]>;
  patchInvite(id: number, patch: Json): Promise<void>;
  optedOut(email: string): Promise<boolean>;
  event(row: { user_id: string | null; name: string; detail: string | null; trip_id: string | null }): Promise<void>;
  mail(m: Mail): Promise<boolean>;
  /** sends to every phone of the account; returns how many phones got it */
  push(userId: string, payload: Json): Promise<number>;
}
export type CycleOpts = {
  trips: TripRow[];
  now: Date;
  /** ms (real clock): nothing new is started after it */
  deadline: number;
  secret: string;
  canMail: boolean;
  canPush: boolean;
  pause?: boolean;
  dayCap?: number;
  offlineFree?: boolean;
  runMails?: number;
  runPushes?: number;
  clock?: () => number;
};
export type CycleResult = { sent: Record<string, number>; warnings: string[]; skipped?: string };

const tripStatus = (d: Json) => String(((d.draft || {}) as { status?: unknown }).status || "");
/** A trip the departure messages may concern: confirmed or in review, not deleted or archived, not a code trip */
const departing = (t: TripRow) => !CODE_TRIPS.has(t.id) && tripStatus(t.data) !== "preparing" && t.data.deleted !== true && t.data.archived !== true && ISO_DAY.test(String(t.data.start || ""));

export async function runCycle(deps: CycleDeps, o: CycleOpts): Promise<CycleResult> {
  const warnings: string[] = [];
  const sent: Record<string, number> = {};
  const add = (k: string) => (sent[k] = (sent[k] || 0) + 1);
  if (o.pause) return { sent, warnings, skipped: "pause" };
  let ok = false;
  try {
    ok = await deps.ready();
  } catch {
    ok = false;
  }
  if (!ok) return { sent, warnings: ["cycle: saas-14.sql not run"], skipped: "no-sql" };

  const clock = o.clock || Date.now;
  const late = () => clock() >= o.deadline;
  const nowMs = o.now.getTime();
  const paris = localNow(PARIS, o.now);
  const mailHour = paris.min >= MAIL_WINDOW.from && paris.min < MAIL_WINDOW.to;
  const pushHour = paris.min >= PUSH_WINDOW.from && paris.min < PUSH_WINDOW.to;
  let mailsLeft = Math.max(0, o.runMails ?? 30);
  let pushesLeft = Math.max(0, o.runPushes ?? 60);
  if (o.canMail && mailHour) {
    const today = await deps.mailsToday().catch(() => 0);
    mailsLeft = Math.min(mailsLeft, Math.max(0, (o.dayCap ?? 150) - today));
    if (mailsLeft === 0) warnings.push("cycle: daily e-mail cap reached");
  }
  const canMailNow = () => o.canMail && mailHour && mailsLeft > 0 && !late();
  const canPushNow = () => o.canPush && pushHour && pushesLeft > 0 && !late();
  const tripById = new Map(o.trips.map((t) => [t.id, t]));
  const titleOf = (id: string) => cleanUserText(tripById.get(id)?.data.title, 80) || "ORBES Trips";

  /** One e-mail: claimed first, released if Resend refused it */
  const sendMail = async (row: MailRow, m: Mail, ev: { user_id: string | null; name: string; detail: string | null; trip_id: string | null }) => {
    if (!canMailNow()) return false;
    if (row.tips) {
      const last = await deps.lastTipsAt(row.user_id, row.email || "");
      if (last != null && nowMs - last < GAP_MS) return false;
    }
    if (!(await deps.claim(row))) return false;
    mailsLeft--;
    const okSent = await deps.mail(m).catch(() => false);
    if (!okSent) {
      await deps.release(row.key).catch(() => undefined);
      return false;
    }
    add(row.kind);
    await deps.event(ev).catch(() => undefined);
    return true;
  };
  /** One notification to every phone of the account; 0 phones reached = the claim is released */
  const sendPush = async (row: MailRow, userId: string, payload: Json, ev: { user_id: string | null; name: string; detail: string | null; trip_id: string | null }) => {
    if (!canPushNow()) return -1;
    if (!(await deps.claim(row))) return -1;
    pushesLeft--;
    const n = await deps.push(userId, payload).catch(() => 0);
    if (n > 0) {
      add(`${row.kind}_push`);
      await deps.event(ev).catch(() => undefined);
    }
    return n;
  };
  const tipsOk = (p: { alerts: Alerts; tips: boolean; opted_out: boolean }) => p.alerts.email !== false && p.tips && !p.opted_out;
  const tipsFoot = (T: Texts, uid: string) => ({ text: "", link: { label: T.tipsStop, url: unsubUser(o.secret, uid) }, tail: T.tipsStopTail });
  const section = async (name: string, f: () => Promise<void>) => {
    if (late()) return;
    try {
      await f();
    } catch (e) {
      warnings.push(`cycle ${name}: ${String((e as Error)?.message || e).slice(0, 100)}`);
    }
  };

  // 1. the inviter is told when an invited person joins (transactional: no 48 h rule, no tips switch)
  await section("joined", async () => {
    for (const inv of await deps.invitesJoined()) {
      if (late()) break;
      if (!inv.invited_by || !inv.accepted_at) continue;
      if (nowMs - Date.parse(inv.accepted_at) > 14 * DAY_MS) {
        await deps.patchInvite(inv.id, { inviter_notified_at: o.now.toISOString() });
        continue;
      }
      const who = await deps.person(inv.invited_by);
      const joiner = inv.accepted_user ? await deps.person(inv.accepted_user) : null;
      const pushOn = !!who && who.phones > 0 && who.alerts.push !== false;
      const mailOn = !!who && who.alerts.email !== false && !who.opted_out && !!who.email;
      if (!who || (!pushOn && !mailOn)) {
        await deps.patchInvite(inv.id, { inviter_notified_at: o.now.toISOString() });
        continue;
      }
      const T = TXT[langOf(who.lang)];
      const name = firstName(joiner?.name) || inv.email.split("@")[0].slice(0, 40);
      const title = titleOf(inv.trip_id);
      const key = `invite_joined:${inv.id}`;
      // already told (a run that stopped before noting it): noted now
      if (await deps.logRow(key)) {
        await deps.patchInvite(inv.id, { inviter_notified_at: o.now.toISOString() });
        continue;
      }
      let done = false;
      if (pushOn) {
        const n = await sendPush({ key, user_id: who.user_id, email: who.email, kind: "invite_joined", trip_id: inv.trip_id, channel: "push", tips: false }, who.user_id, { title: T.joinedTitle(name, title), body: T.joinedBody, url: `${APP_URL}/?src=push_joined#${inv.trip_id}`, tag: `joined-${inv.id}` }, { user_id: who.user_id, name: "reminder_sent", detail: "invite_joined_push", trip_id: inv.trip_id });
        if (n > 0) done = true;
        else if (n === 0) await deps.release(key);
        else if (!mailOn) continue; // not now (night, cap): next run
      }
      if (!done && mailOn) {
        if (!canMailNow()) continue;
        const url = `${APP_URL}/?src=email_joined#${inv.trip_id}`;
        const parts: MailParts = { hello: T.hello(firstName(who.name)), lines: [T.joinedTitle(name, title) + ".", T.joinedBody], button: { label: T.openTrip, url } };
        done = await sendMail({ key, user_id: who.user_id, email: who.email, kind: "invite_joined", trip_id: inv.trip_id, channel: "email", tips: false }, { to: who.email, subject: T.joinedTitle(name, title), html: mailHtml(parts), text: mailText(parts) }, { user_id: who.user_id, name: "reminder_sent", detail: "invite_joined", trip_id: inv.trip_id });
      }
      if (done) await deps.patchInvite(inv.id, { inviter_notified_at: o.now.toISOString() });
    }
  });

  // trips by days before their start (the trip's own date)
  const startsIn = (t: TripRow, n: number) => daysBetween(localNow(String(t.data.timezone || "UTC"), o.now).date, String(t.data.start)) === n;

  // 2. J-3: the offline pack (notification; Pro travellers whose pack is not complete)
  await section("j3", async () => {
    for (const trip of o.trips.filter((t) => departing(t) && startsIn(t, 3))) {
      if (late()) break;
      const title = titleOf(trip.id);
      for (const p of await deps.tripPeople(trip.id)) {
        if (late()) break;
        if (p.offline_full || (!p.pro && !o.offlineFree)) continue;
        if (!(p.phones > 0 && p.alerts.push !== false)) continue; // no phone: the line goes into the J-2 e-mail
        const T = TXT[langOf(p.lang)];
        const key = `j3:${p.user_id}:${trip.id}`;
        const n = await sendPush({ key, user_id: p.user_id, email: p.email, kind: "j3", trip_id: trip.id, channel: "push", tips: false }, p.user_id, { title: T.j3Title, body: p.pro ? T.j3Body(title) : T.j3Free(title), url: `${APP_URL}/?offline=1&src=push_offline#${trip.id}`, tag: `offline-${trip.id}` }, { user_id: p.user_id, name: "offline_reminder_sent", detail: p.pro ? "push" : "free", trip_id: trip.id });
        // every phone gone: kept as handled, the J-2 e-mail carries the line
        if (n === 0) await deps.setChannel(key, "email");
      }
    }
  });

  // 3. J-2: what is left to do (e-mail, only true lines; before the other tips so it wins the 48 h rule)
  await section("j2", async () => {
    for (const trip of o.trips.filter((t) => departing(t) && startsIn(t, 2))) {
      if (late() || !canMailNow()) break;
      const title = titleOf(trip.id);
      const review = tripStatus(trip.data) === "review";
      let invites: number | null = null;
      for (const p of await deps.tripPeople(trip.id)) {
        if (late() || !canMailNow()) break;
        if (!tipsOk(p) || !p.email) continue;
        const key = `j2:${p.user_id}:${trip.id}`;
        const T = TXT[langOf(p.lang)];
        const lines: string[] = [];
        if (p.role === "owner" && review) lines.push(T.j2Review);
        if (p.bookings > 0) lines.push(T.j2Bookings(p.bookings));
        if (p.role === "owner") {
          if (invites == null) invites = await deps.pendingInvites(trip.id).catch(() => 0);
          if (invites > 0) lines.push(T.j2Invites(invites));
        }
        if (p.phones === 0) lines.push(T.j2Install);
        if (p.pro && !p.offline_full) {
          const j3 = await deps.logRow(`j3:${p.user_id}:${trip.id}`).catch(() => null);
          if (!j3 || j3.channel !== "push") lines.push(T.j2Offline);
        }
        if (!lines.length) continue;
        const parts: MailParts = { hello: T.hello(firstName(p.name)), lines: [T.j2Intro], big: title, sub: rangeLabel(String(trip.data.start), String(trip.data.end || ""), langOf(p.lang)) || undefined, list: lines, button: { label: T.openTrip, url: `${APP_URL}/?src=email_j2#${trip.id}` }, foot: tipsFoot(T, p.user_id) };
        await sendMail({ key, user_id: p.user_id, email: p.email, kind: "j2", trip_id: trip.id, channel: "email", tips: true }, { to: p.email, subject: T.j2Subject(title), html: mailHtml(parts), text: mailText(parts), headers: unsubHeaders(unsubUser(o.secret, p.user_id)) }, { user_id: p.user_id, name: "reminder_sent", detail: "j2", trip_id: trip.id });
      }
    }
  });

  // 4. one reminder of an invitation e-mail not answered after 3 days
  await section("invite_reminder", async () => {
    if (!canMailNow()) return;
    const today = paris.date;
    for (const inv of await deps.invitesToRemind(new Date(nowMs - 10 * DAY_MS).toISOString(), new Date(nowMs - 3 * DAY_MS).toISOString())) {
      if (!canMailNow()) break;
      if (inv.accepted_at || inv.claimed_at || inv.reminded_at || !inv.sent_at) continue;
      const trip = tripById.get(inv.trip_id);
      const key = `invite_reminder:${inv.id}`;
      const end = String(trip?.data.end || trip?.data.start || "");
      if (!trip || trip.data.deleted === true || (ISO_DAY.test(end) && end < today) || !(await deps.invitePending(inv.trip_id, inv.email)) || (await deps.optedOut(inv.email))) {
        // nothing to remind any more: never looked at again
        await deps.patchInvite(inv.id, { reminded_at: o.now.toISOString() });
        continue;
      }
      const inviter = inv.invited_by ? await deps.person(inv.invited_by) : null;
      const lang = langOf(inv.lang);
      const m = inviteMail({ lang, inviter: inviter?.name || "", title: String(trip.data.title || ""), start: String(trip.data.start || ""), end: String(trip.data.end || ""), link: `${APP_URL}/?join=${inv.token}&src=invite_reminder`, unsub: unsubInvite(o.secret, inv.id), reminder: true });
      const okSent = await sendMail({ key, user_id: null, email: inv.email, kind: "invite_reminder", trip_id: inv.trip_id, channel: "email", tips: true }, { to: inv.email, ...m }, { user_id: inv.invited_by, name: "invite_email_sent", detail: "invite_reminder", trip_id: inv.trip_id });
      if (okSent) await deps.patchInvite(inv.id, { reminded_at: o.now.toISOString(), send_count: (inv.send_count || 1) + 1 });
    }
  });

  // 5. J+3 after sign-up, no trip yet
  await section("first_trip", async () => {
    if (!canMailNow()) return;
    for (const p of await deps.firstTrip(Math.min(30, mailsLeft))) {
      if (!canMailNow()) break;
      const T = TXT[langOf(p.lang)];
      const parts: MailParts = { hello: T.hello(firstName(p.name)), lines: [T.firstBody], button: { label: T.firstButton, url: `${APP_URL}/?new=1&src=email_first` }, foot: tipsFoot(T, p.user_id) };
      await sendMail({ key: `first_trip:${p.user_id}`, user_id: p.user_id, email: p.email, kind: "first_trip", trip_id: null, channel: "email", tips: true }, { to: p.email, subject: T.firstSubject, html: mailHtml(parts), text: mailText(parts), headers: unsubHeaders(unsubUser(o.secret, p.user_id)) }, { user_id: p.user_id, name: "reminder_sent", detail: "first_trip", trip_id: null });
    }
  });

  // 6. the 1st of the month: the free prepared trip is back
  await section("quota", async () => {
    if (paris.day !== 1 || !canMailNow()) return;
    const month = o.now.toISOString().slice(0, 7);
    for (const p of await deps.quota(Math.min(30, mailsLeft))) {
      if (!canMailNow()) break;
      const lang = langOf(p.lang);
      const T = TXT[lang];
      const mname = monthName(o.now, lang);
      const parts: MailParts = { hello: T.hello(firstName(p.name)), lines: [T.quotaBody(mname)], button: { label: T.quotaButton, url: `${APP_URL}/?new=1&src=email_quota` }, foot: tipsFoot(T, p.user_id) };
      await sendMail({ key: `quota:${p.user_id}:${month}`, user_id: p.user_id, email: p.email, kind: "quota", trip_id: null, channel: "email", tips: true }, { to: p.email, subject: T.quotaSubject(mname), html: mailHtml(parts), text: mailText(parts), headers: unsubHeaders(unsubUser(o.secret, p.user_id)) }, { user_id: p.user_id, name: "reminder_sent", detail: "quota", trip_id: null });
    }
  });

  // 7. a forwarded booking announces a new trip
  await section("booking", async () => {
    if (!canPushNow() && !canMailNow()) return;
    const today = paris.date;
    for (const b of await deps.bookings(new Date(nowMs - 3 * DAY_MS).toISOString())) {
      if (late()) break;
      const d = (b.extracted?.detected || null) as { start?: string; end?: string; city?: string } | null;
      const key = `booking:${b.id}`;
      if (!d || !ISO_DAY.test(d.start || "")) continue;
      const end = d.end && ISO_DAY.test(d.end) && d.end >= d.start! ? d.end : d.start!;
      const covered = end < today || (await deps.userTrips(b.user_id)).some((t) => ISO_DAY.test(t.start) && ISO_DAY.test(t.end) && shiftDay(t.start, -2) <= end && shiftDay(t.end, 2) >= d.start!);
      if (covered) {
        // a trip covers it now (or it is past): never sent
        await deps.claim({ key, user_id: b.user_id, email: null, kind: "booking", trip_id: null, channel: "email", tips: false }).catch(() => false);
        continue;
      }
      const p = await deps.person(b.user_id);
      if (!p) continue;
      const lang = langOf(p.lang);
      const T = TXT[lang];
      const city = cleanUserText(d.city, 60);
      const dates = rangeLabel(d.start!, end, lang);
      const where = city ? `${city}, ${dates}` : dates;
      let done = false;
      if (p.phones > 0 && p.alerts.push !== false) {
        const n = await sendPush({ key, user_id: p.user_id, email: p.email, kind: "booking", trip_id: null, channel: "push", tips: false }, p.user_id, { title: T.bookingTitle(where), body: T.bookingPush, url: `${APP_URL}/?booking=${b.id}&src=push_booking`, tag: `booking-${b.id}` }, { user_id: p.user_id, name: "reminder_sent", detail: "booking_push", trip_id: null });
        if (n > 0) done = true;
        else if (n === 0) await deps.release(key);
        else continue; // not now: next run
      }
      if (!done && tipsOk(p) && p.email) {
        const parts: MailParts = { hello: T.hello(firstName(p.name)), lines: [T.bookingBody(where)], button: { label: T.bookingButton, url: `${APP_URL}/?booking=${b.id}&src=email_booking` }, foot: tipsFoot(T, p.user_id) };
        await sendMail({ key, user_id: p.user_id, email: p.email, kind: "booking", trip_id: null, channel: "email", tips: true }, { to: p.email, subject: T.bookingTitle(where), html: mailHtml(parts), text: mailText(parts), headers: unsubHeaders(unsubUser(o.secret, p.user_id)) }, { user_id: p.user_id, name: "reminder_sent", detail: "booking", trip_id: null });
      }
    }
  });

  return { sent, warnings };
}

// ---------- the real database (PostgREST with the service key) ----------
export class DbError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string, path: string) {
    super(`db ${status} ${path.split("?")[0]}`);
    this.status = status;
    this.body = body;
  }
}
/** A table or function that does not exist (yet): PostgREST 404, PGRST202/205, Postgres 42P01/42883 */
export const missing = (e: unknown) => e instanceof DbError && (e.status === 404 || /PGRST20[25]|42P01|42883/.test(e.body));

export function restDb(url: string, key: string, f: typeof fetch = fetch) {
  return async function db(path: string, init: RequestInit = {}): Promise<unknown> {
    const r = await f(`${url}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers || {}) } });
    const text = await r.text();
    if (!r.ok) throw new DbError(r.status, text.slice(0, 300), path);
    return text ? JSON.parse(text) : null;
  };
}
const enc = encodeURIComponent;

/** CycleDeps on the real database, Resend and Web Push (the push sender is given by api/cron, which holds web-push) */
export function restDeps(o: { url: string; key: string; resend: string; from: string; pushTo: (sub: { endpoint: string; p256dh: string; auth: string }, payload: Json) => Promise<"ok" | "gone" | "fail"> }): CycleDeps {
  const db = restDb(o.url, o.key);
  const emailOf = async (uid: string) => {
    try {
      const u = (await db(`/auth/v1/admin/users/${uid}`)) as { email?: string; email_confirmed_at?: string | null };
      return u?.email && u.email_confirmed_at ? u.email.toLowerCase() : null;
    } catch {
      return null;
    }
  };
  return {
    async ready() {
      try {
        await db("/rest/v1/mail_log?select=key&limit=1");
        return true;
      } catch (e) {
        if (missing(e)) return false;
        throw e;
      }
    },
    async claim(row) {
      const r = (await db("/rest/v1/mail_log", { method: "POST", headers: { prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(row) })) as unknown[];
      return Array.isArray(r) && r.length > 0;
    },
    async release(key) {
      await db(`/rest/v1/mail_log?key=eq.${enc(key)}`, { method: "DELETE" });
    },
    async logRow(key) {
      const r = (await db(`/rest/v1/mail_log?key=eq.${enc(key)}&select=channel`)) as { channel: string }[];
      return r?.[0] || null;
    },
    async setChannel(key, channel) {
      await db(`/rest/v1/mail_log?key=eq.${enc(key)}`, { method: "PATCH", body: JSON.stringify({ channel }) });
    },
    async lastTipsAt(userId, email) {
      const who = [userId ? `user_id.eq.${userId}` : "", email ? `email.eq.${enc(email.toLowerCase())}` : ""].filter(Boolean).join(",");
      let last: number | null = null;
      if (who) {
        const r = (await db(`/rest/v1/mail_log?or=(${who})&channel=eq.email&tips=is.true&select=at&order=at.desc&limit=1`)) as { at: string }[];
        if (r?.[0]) last = Date.parse(r[0].at);
      }
      // the "Bon retour" e-mail of the cron (alert_log, kept 30 days)
      if (userId) {
        const b = (await db(`/rest/v1/alert_log?key=like.${enc(`return:${userId}:*`)}&select=at&order=at.desc&limit=1`)) as { at: string }[];
        if (b?.[0]) last = Math.max(last ?? 0, Date.parse(b[0].at));
      }
      return last;
    },
    async mailsToday() {
      const since = new Date().toISOString().slice(0, 10) + "T00:00:00Z";
      const r = await fetch(`${o.url}/rest/v1/mail_log?channel=eq.email&at=gte.${enc(since)}&select=key&limit=1`, { method: "HEAD", headers: { apikey: o.key, authorization: `Bearer ${o.key}`, prefer: "count=exact" } });
      const n = Number((r.headers.get("content-range") || "").split("/")[1]);
      return r.ok && Number.isFinite(n) ? n : 0;
    },
    async firstTrip(limit) {
      return ((await db("/rest/v1/rpc/cycle_first_trip", { method: "POST", body: JSON.stringify({ p_limit: limit }) })) as Person[]) || [];
    },
    async quota(limit) {
      return ((await db("/rest/v1/rpc/cycle_quota", { method: "POST", body: JSON.stringify({ p_limit: limit }) })) as Person[]) || [];
    },
    async tripPeople(tripId) {
      const r = ((await db("/rest/v1/rpc/cycle_trip_people", { method: "POST", body: JSON.stringify({ p_trip: tripId }) })) as TripPerson[]) || [];
      return r.map((p) => ({ ...p, alerts: (p.alerts || {}) as Alerts }));
    },
    async pendingInvites(tripId) {
      const r = (await db(`/rest/v1/trip_invites?trip_id=eq.${enc(tripId)}&select=email`)) as unknown[];
      return Array.isArray(r) ? r.length : 0;
    },
    async person(userId) {
      const email = await emailOf(userId);
      const prof = (((await db(`/rest/v1/profiles?id=eq.${userId}&select=data`)) as { data: Json }[])?.[0]?.data || {}) as Json;
      const phones = (await db(`/rest/v1/push_subscriptions?user_id=eq.${userId}&select=endpoint`)) as unknown[];
      const out = email ? ((await db(`/rest/v1/mail_optout?email=eq.${enc(email)}&select=email`)) as unknown[]) : [];
      return { user_id: userId, email: email || "", lang: String(prof.lang || "fr"), name: String(prof.name || ""), alerts: (prof.alerts || {}) as Alerts, tips: prof.mailTips !== false, opted_out: Array.isArray(out) && out.length > 0, phones: Array.isArray(phones) ? phones.length : 0 };
    },
    async bookings(sinceIso) {
      return ((await db(`/rest/v1/inbound_items?status=eq.new&trip_id=is.null&received_at=gte.${enc(sinceIso)}&extracted->detected=not.is.null&select=id,user_id,received_at,extracted&order=received_at.asc&limit=50`)) as BookingRow[]) || [];
    },
    async userTrips(userId) {
      const r = (await db(`/rest/v1/trip_members?user_id=eq.${userId}&select=trips(data)`)) as { trips: { data: Json } | null }[];
      return (r || []).map((x) => x.trips?.data || {}).filter((d) => d.deleted !== true).map((d) => ({ start: String(d.start || "").slice(0, 10), end: String(d.end || "").slice(0, 10) }));
    },
    async invitesToRemind(fromIso, toIso) {
      return ((await db(`/rest/v1/invite_mails?sent_at=gte.${enc(fromIso)}&sent_at=lte.${enc(toIso)}&reminded_at=is.null&accepted_at=is.null&claimed_at=is.null&select=*&order=sent_at.asc&limit=50`)) as InviteRow[]) || [];
    },
    async invitePending(tripId, email) {
      const r = (await db(`/rest/v1/trip_invites?trip_id=eq.${enc(tripId)}&email=eq.${enc(email)}&select=email`)) as unknown[];
      return Array.isArray(r) && r.length > 0;
    },
    async invitesJoined() {
      return ((await db(`/rest/v1/invite_mails?accepted_at=not.is.null&inviter_notified_at=is.null&invited_by=not.is.null&select=*&order=accepted_at.asc&limit=50`)) as InviteRow[]) || [];
    },
    async patchInvite(id, patch) {
      await db(`/rest/v1/invite_mails?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    async optedOut(email) {
      const r = (await db(`/rest/v1/mail_optout?email=eq.${enc(email.toLowerCase())}&select=email`)) as unknown[];
      return Array.isArray(r) && r.length > 0;
    },
    async event(row) {
      await db("/rest/v1/events", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(row) });
    },
    async mail(m) {
      if (!o.resend) return false;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${o.resend}`, "content-type": "application/json" },
        body: JSON.stringify({ from: o.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.headers ? { headers: m.headers } : {}) }),
      }).catch(() => null);
      return !!r?.ok;
    },
    async push(userId, payload) {
      const subs = (await db(`/rest/v1/push_subscriptions?user_id=eq.${userId}&select=endpoint,p256dh,auth`)) as { endpoint: string; p256dh: string; auth: string }[];
      let n = 0;
      for (const s of subs || []) {
        const r = await o.pushTo(s, payload);
        if (r === "ok") n++;
        else if (r === "gone") await db(`/rest/v1/push_subscriptions?endpoint=eq.${enc(s.endpoint)}`, { method: "DELETE" }).catch(() => null);
      }
      return n;
    },
  };
}
