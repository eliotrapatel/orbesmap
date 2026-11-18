// Vercel function: one step of a person's use (lot 7). The app sends the step here instead of straight to the
// database so the approximate city and country of the connection (Vercel's own headers) and the phone's system and
// browser are recorded with it. The person's session (if any) is passed on, so the step belongs to their account.
type Json = Record<string, unknown>;
const SUPA_URL = process.env.SUPABASE_URL || "https://ifugaqjneprbtigvegeb.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_0qPu_8XZTLk-l68k2kPUvQ_7UXk-fCu";
const ORIGINS = [/^https:\/\/(www\.)?theorbes\.com$/, /^https:\/\/orbesmap(-[a-z0-9-]+)?\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

function cors(origin: string | null): Record<string, string> {
  const ok = origin && ORIGINS.some((r) => r.test(origin));
  return ok ? { "access-control-allow-origin": origin!, "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", vary: "origin" } : {};
}
const dec = (v: string | null) => {
  try {
    return v ? decodeURIComponent(v) : "";
  } catch {
    return v || "";
  }
};
function device(ua: string): { os: string; browser: string } {
  const os = /iphone|ipad|ipod/i.test(ua) ? "iOS" : /android/i.test(ua) ? "Android" : /mac os x|macintosh/i.test(ua) ? "macOS" : /windows/i.test(ua) ? "Windows" : /linux/i.test(ua) ? "Linux" : "";
  const browser = /edg\//i.test(ua) ? "Edge" : /crios|chrome\//i.test(ua) && !/edg\//i.test(ua) ? "Chrome" : /fxios|firefox\//i.test(ua) ? "Firefox" : /safari\//i.test(ua) ? "Safari" : "";
  return { os, browser };
}

/**
 * The steps renamed by supabase/saas-12.sql, under the name production's database knows before that file runs
 * (its track_event drops an unknown name without an error): sign-ups and finished welcomes were « signup_done »,
 * public links created and their button clicked were « link_opened » (same details as today).
 */
const OLD_NAMES: Record<string, string> = {
  signup_submitted: "signup_done",
  onboarding_done: "signup_done",
  public_link_created: "link_opened",
  public_cta_clicked: "link_opened",
};

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request): Promise<Response> {
  const h = cors(req.headers.get("origin"));
  let b: Json;
  try {
    b = (await req.json()) as Json;
  } catch {
    return new Response(null, { status: 204, headers: h });
  }
  if (!b || typeof b !== "object") return new Response(null, { status: 204, headers: h });
  const auth = req.headers.get("authorization");
  const token = auth && /^Bearer [\w.-]+$/.test(auth) ? auth : `Bearer ${SUPA_KEY}`;
  const { os, browser } = device(req.headers.get("user-agent") || "");
  const base = { p_name: b.name, p_detail: b.detail ?? null, p_device: b.device ?? null, p_ref: b.ref ?? null, p_visitor: b.visitor ?? null, p_trip: b.trip ?? null };
  const call = (args: Json) =>
    fetch(`${SUPA_URL}/rest/v1/rpc/track_event`, { method: "POST", headers: { apikey: SUPA_KEY, authorization: token, "content-type": "application/json" }, body: JSON.stringify(args) });
  const full = { ...base, p_city: dec(req.headers.get("x-vercel-ip-city")) || null, p_country: req.headers.get("x-vercel-ip-country") || null, p_region: dec(req.headers.get("x-vercel-ip-country-region")) || null, p_os: os || null, p_browser: browser || null };
  // the link's channel and sharer (supabase/saas-12.sql), only when the step has them; checked again by the database
  const src = typeof b.src === "string" ? b.src.slice(0, 24) : null;
  const by = typeof b.by === "string" ? b.by.slice(0, 16) : null;
  // a renamed step (supabase/saas-12.sql) is always tried on the full version: its absence (404) is the only sign
  const old = typeof b.name === "string" && Object.hasOwn(OLD_NAMES, b.name) ? OLD_NAMES[b.name] : null;
  let r = src || by || old ? await call({ ...full, p_src: src, p_by: by }).catch(() => null) : null;
  if (r && r.ok) return new Response(null, { status: 204, headers: h });
  // before supabase/saas-12.sql (404): the step without its source, under the name the database knows today
  const p_name = r && r.status === 404 && old ? old : base.p_name;
  r = await call({ ...full, p_name }).catch(() => null);
  // before supabase/saas-8.sql: the step without place and device
  if (r && r.status === 404) r = await call({ ...base, p_name }).catch(() => null);
  return new Response(null, { status: 204, headers: h });
}
