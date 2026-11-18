// Vercel function: bookings forwarded by e-mail (lot 6g). Resend receives the mail sent to an account's own address
// (<token>@in.theorbes.com, supabase/saas-7.sql) and calls this webhook ("email.received"); the content is then read
// from Resend with our key (so a forged call cannot inject anything), the AI extracts flights, hotel and bookings,
// and the result waits in the app ("Réservations reçues") until the person adds it to the trip. A booking whose dates
// fall outside all the account's trips, still to come, waits as a new trip to create ("Nouveau voyage détecté").
// Needs on Vercel: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, DEEPSEEK_API_KEY.
import { coerce, DS_MODEL, DS_URL, EXTRACT_SCHEMA, EXTRACT_SYSTEM, skeleton } from "./ai.js";

type Json = Record<string, unknown>;
const SUPA_URL = process.env.SUPABASE_URL || "https://ifugaqjneprbtigvegeb.supabase.co";
const ok = (body: unknown = { ok: true }, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function db(path: string, key: string, init: RequestInit = {}): Promise<unknown> {
  const r = await fetch(`${SUPA_URL}${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`db ${r.status}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
const plain = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

// the booking's stay (lot retention): where (the destination, not the departure city) and when, to tell which trip it
// belongs to, or that it is a new trip. Kept in `extracted.stay`; a new trip is offered from `extracted.detected`.
const INBOUND_SCHEMA = {
  ...EXTRACT_SCHEMA,
  properties: {
    ...EXTRACT_SCHEMA.properties,
    stay: { type: "object", properties: { city: { type: "string" }, country: { type: "string" }, start: { type: "string" }, end: { type: "string" } }, required: ["city", "country", "start", "end"], additionalProperties: false },
  },
  required: [...EXTRACT_SCHEMA.required, "stay"],
};
const STAY_RULE = `- stay : le séjour que cette réservation concerne. city = la ville de destination où le voyageur séjourne (pas la ville de départ ; pour un aller-retour, la ville de l'aller), en français ; country = son pays, en français ; start / end = premier et dernier jour sur place, AAAA-MM-JJ (arrivée du vol aller ou arrivée à l'hôtel, départ du vol retour ou départ de l'hôtel) ; "" si inconnu.`;
// a flight often leaves the day before the trip starts, or lands the day after it ends
const MARGIN = 2;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** The first and last days of what a booking covers: the stay the AI read, else the dates of its flights, hotel and bookings */
function stayOf(x: Json): { start: string; end: string } | null {
  const stay = (x.stay || {}) as Json;
  const s = String(stay.start || "").slice(0, 10);
  const e = String(stay.end || "").slice(0, 10);
  if (ISO.test(s) && ISO.test(e) && e >= s) return { start: s, end: e };
  const dates: string[] = [];
  for (const f of (x.flights as Json[] | undefined) || []) dates.push(String(f.departAt || "").slice(0, 10), String(f.arriveAt || "").slice(0, 10));
  const h = (x.hotel || {}) as Json;
  dates.push(String(h.checkIn || "").slice(0, 10), String(h.checkOut || "").slice(0, 10));
  for (const f of (x.fixed as Json[] | undefined) || []) dates.push(String(f.date || "").slice(0, 10));
  const ok = dates.filter((d) => ISO.test(d)).sort();
  if (ISO.test(s) && !ok.length) return { start: s, end: s };
  return ok.length ? { start: ok[0], end: ok[ok.length - 1] } : null;
}

export async function POST(req: Request): Promise<Response> {
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const resend = (process.env.RESEND_API_KEY || "").trim();
  const ds = (process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_KEY || "").trim();
  if (!key || !resend || !ds) return ok({ error: "not configured" }, 503);
  let ev: Json;
  try {
    ev = (await req.json()) as Json;
  } catch {
    return ok({ ignored: "bad json" });
  }
  if (ev.type !== "email.received") return ok({ ignored: ev.type });
  const data = (ev.data || {}) as Json;
  const id = String(data.email_id || "");
  if (!/^[0-9a-f-]{20,60}$/i.test(id)) return ok({ ignored: "no id" });

  // the real mail, from Resend (never trust the webhook's own fields)
  const r = await fetch(`https://api.resend.com/emails/receiving/${id}`, { headers: { authorization: `Bearer ${resend}` } });
  if (!r.ok) return ok({ ignored: "unknown email" });
  const mail = (await r.json()) as Json;
  const to = [...((mail.to as string[]) || []), ...((mail.received_for as string[]) || [])].map((x) => String(x).toLowerCase());
  const token = to.map((a) => /([a-z0-9]{8,24})(\+[^@]*)?@/.exec(a.replace(/^.*</, ""))?.[1]).find(Boolean);
  if (!token) return ok({ ignored: "no address" });
  const owner = ((await db(`/rest/v1/inbound_tokens?token=eq.${token}&select=user_id`, key)) as { user_id: string }[])[0];
  if (!owner) return ok({ ignored: "unknown address" });

  // the trip it most likely belongs to: the one under way, else the next one
  const today = new Date().toISOString().slice(0, 10);
  const mine = (await db(`/rest/v1/trip_members?user_id=eq.${owner.user_id}&select=trip_id,trips(id,data)`, key)) as { trip_id: string; trips: { id: string; data: Json } | null }[];
  const trips = mine.map((m) => m.trips).filter((t): t is { id: string; data: Json } => !!t);
  const during = trips.find((t) => String(t.data.start) <= today && String(t.data.end) >= today);
  const next = trips.filter((t) => String(t.data.start) > today).sort((a, b) => String(a.data.start).localeCompare(String(b.data.start)))[0];
  let trip: { id: string; data: Json } | null = during || next || null;

  // what the mail holds (flights, hotel, bookings, and where and when the stay is)
  const body = (String(mail.text || "") || plain(String(mail.html || ""))).slice(0, 14_000);
  const subject = String(mail.subject || "").slice(0, 300);
  let extracted: Json = {};
  try {
    const system = `${EXTRACT_SYSTEM}\n${STAY_RULE}\n\nRéponds UNIQUEMENT avec un objet json valide, exactement de cette forme (mêmes clés, mêmes types) :\n${JSON.stringify(skeleton(INBOUND_SCHEMA as Json))}`;
    const ai = await fetch(`${DS_URL}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${ds}`, "content-type": "application/json" },
      body: JSON.stringify({ model: DS_MODEL, messages: [{ role: "system", content: system }, { role: "user", content: `Confirmation à lire (e-mail transféré, objet : ${subject}) :\n${body}` }], response_format: { type: "json_object" }, thinking: { type: "disabled" }, max_tokens: 3000 }),
      signal: AbortSignal.timeout(60_000),
    });
    const j = (await ai.json()) as Json;
    const text = String(((j.choices as Json[] | undefined)?.[0]?.message as Json | undefined)?.content || "").trim();
    extracted = text ? (coerce(INBOUND_SCHEMA as Json, JSON.parse(text)) as Json) : {};
  } catch {
    extracted = {};
  }
  // the trip it belongs to, from its dates: one of the account's trips, or a new trip to create (lot retention)
  const range = stayOf(extracted);
  if (range) {
    const near = (t: { data: Json }) => {
      const s = String(t.data.start || "");
      const e = String(t.data.end || "");
      return !!s && !!e && addDays(s, -MARGIN) <= range.end && addDays(e, MARGIN) >= range.start;
    };
    const match = trips.find((t) => near(t) && String(t.data.start) <= range.start && String(t.data.end) >= range.end) || trips.find(near);
    if (match) trip = match;
    else if (range.end >= today) {
      // a booking outside all the trips, still to come: the app offers to create that trip
      const stay = (extracted.stay || {}) as Json;
      trip = null;
      extracted.detected = { city: String(stay.city || "").slice(0, 80), country: String(stay.country || "").slice(0, 80), start: range.start, end: range.end };
    }
  }
  await db("/rest/v1/ai_usage", key, { method: "POST", body: JSON.stringify({ user_id: owner.user_id, task: "inbound" }) }).catch(() => null);
  await db("/rest/v1/inbound_items", key, {
    method: "POST",
    body: JSON.stringify({ user_id: owner.user_id, trip_id: trip?.id || null, from_addr: String(mail.from || "").slice(0, 200), subject, extracted }),
  });
  return ok({ ok: true });
}
