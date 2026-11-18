// Vercel function: the link preview of a shared programme (lot acquisition, R10). WhatsApp, iMessage, Telegram, Slack…
// read a page's title, description and image to draw a card under the link. The app is one page for everyone, so
// vercel.json sends only these preview robots here (never a person: a person goes to /?t=<slug>, the app itself):
//   /p/<slug> (the shared address) and /?t=<slug> (an address copied from the bar).
// It reads the programme through public_trip (already readable without an account: supabase/saas-6.sql), and answers a
// small page with the trip's own title and description and a typographic card (public/og/*.png: no map, no photo, no
// AI image). A closed link, an unknown one or any error: the generic ORBES Trips card, nothing leaks, never an error.
import { waitUntil } from "@vercel/functions";

const SUPA_URL = process.env.SUPABASE_URL || "https://ifugaqjneprbtigvegeb.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_0qPu_8XZTLk-l68k2kPUvQ_7UXk-fCu";
const APP_URL = "https://orbesmap.vercel.app";
const SLUG = /^[a-z0-9]{10,24}$/;

type Lang = "fr" | "en";
const TXT = {
  fr: {
    days: (n: number) => `${n} jour${n > 1 ? "s" : ""}`,
    desc: (n: number) => `${n} lieu${n > 1 ? "x" : ""}, jour par jour. Copiez ce programme avec vos dates sur ORBES Trips.`,
    descNone: "Le programme jour par jour. Copiez-le avec vos dates sur ORBES Trips.",
    homeTitle: "ORBES Trips — Carnet de voyage",
    homeDesc: "Carnet de voyage préparé par IA : chaque journée prête, chaque lieu vérifié. Gratuit pour commencer.",
    open: "Ouvrir le programme",
  },
  en: {
    days: (n: number) => `${n} day${n > 1 ? "s" : ""}`,
    desc: (n: number) => `${n} place${n > 1 ? "s" : ""}, day by day. Copy this programme with your dates on ORBES Trips.`,
    descNone: "The programme, day by day. Copy it with your dates on ORBES Trips.",
    homeTitle: "ORBES Trips — Travel notebook",
    homeDesc: "AI-prepared travel notebook: every day planned, every place checked. Free to start.",
    open: "Open the programme",
  },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The family of a preview robot, for the count (whatsapp, imessage…); "" for anything else */
export function botFamily(ua: string): string {
  const u = ua || "";
  if (/WhatsApp/i.test(u)) return "whatsapp";
  if (/facebookexternalhit|Facebot/i.test(u)) return /Twitterbot/i.test(u) ? "imessage" : "facebook";
  if (/Twitterbot/i.test(u)) return "x";
  if (/TelegramBot/i.test(u)) return "telegram";
  if (/Slackbot/i.test(u)) return "slack";
  if (/Discordbot/i.test(u)) return "discord";
  if (/LinkedInBot/i.test(u)) return "linkedin";
  if (/SkypeUriPreview/i.test(u)) return "skype";
  if (/Applebot/i.test(u)) return "apple";
  if (/Pinterestbot/i.test(u)) return "pinterest";
  if (/redditbot/i.test(u)) return "reddit";
  if (/Googlebot|bingbot/i.test(u)) return "search";
  if (/Embedly|vkShare|Iframely/i.test(u)) return "other";
  return "";
}

export type PublicData = { trip?: Record<string, unknown>; places?: unknown[] } | null;

/** The preview page: the trip's title and description, or the generic card (data null) */
export function previewHtml(slug: string | null, data: PublicData): string {
  const trip = data?.trip || null;
  const lang: Lang = trip?.lang === "en" ? "en" : "fr";
  const T = TXT[lang];
  let title = T.homeTitle;
  let desc = T.homeDesc;
  let image = `${APP_URL}/og/home-${lang}.png`;
  let url = `${APP_URL}/`;
  let to = "/";
  if (trip && slug) {
    const days = (Array.isArray(trip.days) ? trip.days : []) as { scheduled?: boolean; dates?: unknown[] }[];
    const n = days.filter((d) => d && d.scheduled && Array.isArray(d.dates) && d.dates.length).length;
    const places = Array.isArray(data?.places) ? data!.places.length : 0;
    const name = clean(trip.title, 80) || "ORBES Trips";
    title = n > 0 ? `${name} · ${T.days(n)}` : name;
    desc = places > 0 ? T.desc(places) : T.descNone;
    image = `${APP_URL}/og/programme-${lang}.png`;
    url = `${APP_URL}/p/${slug}`;
    to = `/?t=${slug}`;
  }
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ORBES Trips">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta property="og:locale" content="${lang === "en" ? "en_GB" : "fr_FR"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(url)}">
<meta http-equiv="refresh" content="0; url=${esc(to)}">
</head>
<body style="background:#0a0a0a;color:#f6f2ea;font-family:Helvetica,Arial,sans-serif">
<p><a href="${esc(to)}" style="color:#f6f2ea">${esc(T.open)}</a></p>
</body>
</html>`;
}

/** Reads the programme behind a slug (null: closed, unknown, not available, or an error) */
async function readPublic(slug: string): Promise<PublicData> {
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/rpc/public_trip`, { method: "POST", headers: { apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ p_slug: slug }) });
    if (!r.ok) return null;
    const d = (await r.json()) as PublicData;
    return d && typeof d === "object" && d.trip ? d : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request): Promise<Response> {
  let slug: string | null = null;
  try {
    const t = (new URL(req.url).searchParams.get("t") || "").toLowerCase();
    slug = SLUG.test(t) ? t : null;
  } catch {
    slug = null;
  }
  const data = slug ? await readPublic(slug) : null;
  const html = previewHtml(data ? slug : null, data);
  // counted once per preview computed (the CDN keeps it 10 minutes per link); before saas-15.sql: not counted
  const family = botFamily(req.headers.get("user-agent") || "");
  if (slug && data) {
    waitUntil(
      fetch(`${SUPA_URL}/rest/v1/rpc/track_step`, { method: "POST", headers: { apikey: SUPA_KEY, authorization: `Bearer ${SUPA_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ p_name: "link_preview", p_detail: slug, p_ref: family || null }) }).then(
        () => undefined,
        () => undefined,
      ),
    );
  }
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // per address (one per link): 10 minutes fresh, a day served stale while it refreshes; the generic card 1 minute
      "cache-control": data ? "public, max-age=0, s-maxage=600, stale-while-revalidate=86400" : "public, max-age=0, s-maxage=60",
      "x-robots-tag": "noindex",
    },
  });
}
