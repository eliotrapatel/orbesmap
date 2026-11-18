// Vercel function: bookings forwarded by e-mail (lot 6g). Resend receives the mail sent to an account's own address
// (<token>@in.theorbes.com, supabase/saas-7.sql) and calls this webhook ("email.received"); the content is then read
// from Resend with our key (so a forged call cannot inject anything), the AI extracts flights, hotel and bookings,
// and the result waits in the app ("Réservations reçues") until the person adds it to the trip.
// Needs on Vercel: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, DEEPSEEK_API_KEY.
import { coerce, DS_MODEL, DS_URL, EXTRACT_SCHEMA, EXTRACT_SYSTEM, skeleton } from "./ai";

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
  const trips = mine.map((m) => m.trips).filter((t): t is { id: string; data: Json } => !!t && t.id !== "sha-2026" && t.id !== "gz-2026");
  const during = trips.find((t) => String(t.data.start) <= today && String(t.data.end) >= today);
  const next = trips.filter((t) => String(t.data.start) > today).sort((a, b) => String(a.data.start).localeCompare(String(b.data.start)))[0];
  const trip = during || next || null;

  // what the mail holds (flights, hotel, bookings)
  const body = (String(mail.text || "") || plain(String(mail.html || ""))).slice(0, 14_000);
  const subject = String(mail.subject || "").slice(0, 300);
  let extracted: Json = {};
  try {
    const system = `${EXTRACT_SYSTEM}\n\nRéponds UNIQUEMENT avec un objet json valide, exactement de cette forme (mêmes clés, mêmes types) :\n${JSON.stringify(skeleton(EXTRACT_SCHEMA as Json))}`;
    const ai = await fetch(`${DS_URL}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${ds}`, "content-type": "application/json" },
      body: JSON.stringify({ model: DS_MODEL, messages: [{ role: "system", content: system }, { role: "user", content: `Confirmation à lire (e-mail transféré, objet : ${subject}) :\n${body}` }], response_format: { type: "json_object" }, thinking: { type: "disabled" }, max_tokens: 3000 }),
      signal: AbortSignal.timeout(60_000),
    });
    const j = (await ai.json()) as Json;
    const text = String(((j.choices as Json[] | undefined)?.[0]?.message as Json | undefined)?.content || "").trim();
    extracted = text ? (coerce(EXTRACT_SCHEMA as Json, JSON.parse(text)) as Json) : {};
  } catch {
    extracted = {};
  }
  await db("/rest/v1/ai_usage", key, { method: "POST", body: JSON.stringify({ user_id: owner.user_id, task: "inbound" }) }).catch(() => null);
  await db("/rest/v1/inbound_items", key, {
    method: "POST",
    body: JSON.stringify({ user_id: owner.user_id, trip_id: trip?.id || null, from_addr: String(mail.from || "").slice(0, 200), subject, extracted }),
  });
  return ok({ ok: true });
}
