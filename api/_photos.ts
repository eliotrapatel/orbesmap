// The photo of each place and of each trip, found and copied by the server (api/prepare.ts runs the pass).
// Sources, in this order: OpenStreetMap (Nominatim, extratags → the Wikidata id) → Wikidata P18 → Wikimedia Commons (standard thumbnail widths, licence, author, file page) → the Wikipedia summary's
// Commons file → a Wikipedia search (a page naming the place and standing near it: its P18, else its free Commons
// image) → Openverse (commercial use + modification allowed, title naming the place). Each source is asked by the
// variants of the place's name (nameVariants: « Jardin Yu & temple… » → « Jardin Yu », « 豫园 »…). Never: Commons geosearch,
// Google, Unsplash, AI images. The files are copied, as plain resized thumbnails, into the public Supabase Storage
// bucket "place-photos", keyed by their source (shared between trips). The underscore keeps Vercel from making this a
// function of its own.
import { createHash } from "node:crypto";

export type Io = {
  fetch: typeof fetch;
  now(): number;
  sleep(ms: number): Promise<void>;
  log?(m: string): void;
  supaUrl: string;
  key: string;
  /** the 1.1 s Nominatim spacing shared with prepare.ts's geocoding */
  nomGate(): Promise<void>;
};
/** `addressCn`: the place's Chinese address (its last part is often the Chinese name: « …人民大道201号 上海博物馆 ») */
export type Target = { id: string; name: string; nameCn?: string; addressCn?: string; lat: number; lng: number; type: string };
type Source = "wikidata" | "wikipedia" | "openverse";
/** A photo found, not copied yet (remote URLs) */
export type Found = {
  large: string;
  small: string;
  /** the standard width of each (Commons: 1280 / 960 / 500; Openverse: its thumbnail for both) */
  largeW: number;
  smallW: number;
  w: number;
  h: number;
  author: string;
  license: string;
  licenseUrl?: string;
  source: Source;
  sourceUrl: string;
  key: string;
  qid?: string;
  /** how it was found (the name variant and the step), for the logs and the live check; never stored */
  via?: string;
};
export type PhotoRef = Omit<Found, "large" | "small" | "largeW" | "smallW" | "via"> & { v: 1; path: string; thumb: string; at: number };
export type Result = Found | "none" | "retry";

export const UA = "ORBES Trips (https://orbesmap.vercel.app)";
const REFERER = "https://orbesmap.vercel.app/";
/** the only iiurlwidth values ever sent (any other width answers 400) */
export const STEPS = [500, 960, 1280] as const;
export const BUCKET = "place-photos";
const MAX_BYTES = 3 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** the only hosts a file is downloaded from */
const DOWNLOAD_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org", "api.openverse.org"]);
const NONE_TTL = 30 * 86_400_000;
const OPENVERSE_MAX = 40;
const OPENVERSE_GAP = 2000;

/** Wikimedia is busy beyond a short wait: the pass stops cleanly and keeps the rest for the next one */
export class Busy extends Error {
  constructor() {
    super("wikimedia busy");
  }
}
class Http extends Error {
  status: number;
  constructor(status: number) {
    super(`http ${status}`);
    this.status = status;
  }
}

// ---------- rules ----------
/** The « nothing found » marker written now; a version-1 one was written before the name variants (looked up again) */
export const NONE_V = 2;
/** The same rule as src/lib/photoData.ts needsLookup (server copy) */
export function needsLookup(photo: unknown, fieldsAt: unknown, now: number): boolean {
  if (!photo || typeof photo !== "object") return true;
  const p = photo as { none?: boolean; at?: number; path?: string; v?: number };
  if (p.none !== true && typeof p.path !== "string") return true;
  const at = Number(p.at) || 0;
  if (p.none === true && (p.v !== NONE_V || now - at > NONE_TTL)) return true;
  const fa = (fieldsAt && typeof fieldsAt === "object" ? fieldsAt : {}) as Record<string, unknown>;
  return ["name", "lat", "lng"].some((k) => (Number(fa[k]) || 0) > at);
}

const LICENSE = /^(CC0( 1\.0)?|Public domain|PD(-[\w-]+)?|CC BY(-SA)? \d\.\d( [a-z]{2})?)$/;
const BAD_TITLE = /\b(montage|collage|composite|mosaic|map|carte|plan|logo|flag|coat of arms|locator|diagram)\b/i;
/** an Openverse photo of a person at the place (« Chef …, Taian Table ») is not a photo of the place */
const PERSON_TITLE = /\b(chef|portrait|selfie|headshot|interview)\b/i;
const MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/tiff"]);
export const okLicense = (name: string) => LICENSE.test(name.trim());
export const okTitle = (title: string) => !BAD_TITLE.test(title.replace(/^File:/i, "").replace(/_/g, " "));
export const okRatio = (w: number, h: number) => w > 0 && h > 0 && w / h >= 0.6 && w / h <= 2.2;

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** HTML → plain text (Commons' Artist field is HTML) */
export function plain(html: string, max = 120): string {
  const t = String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
      }
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}
const httpsUrl = (u: unknown): string | undefined => {
  if (typeof u !== "string" || !u) return undefined;
  const v = u.trim().replace(/^\/\//, "https://").replace(/^http:\/\/(creativecommons\.org|commons\.wikimedia\.org|openverse\.org)\//, "https://$1/");
  return /^https:\/\/[^\s"<>]+$/.test(v) && v.length <= 600 ? v : undefined;
};

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// ---------- requests ----------
const retryAfter = (v: string | null, now: number): number => {
  if (!v) return 30_000;
  if (/^\d+$/.test(v.trim())) return Number(v.trim()) * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : 30_000;
};

/** One gate for Wikimedia: at most 3 requests in flight, at least 250 ms between two starts, and none started
 *  while a Retry-After runs (`pause`: set by the request that got the 429, before its slot is freed, so it holds for
 *  every request of the pass, not only its own) */
function makeGate(io: Io, max = 3, gap = 250) {
  let inflight = 0;
  let last = -Infinity;
  let pauseUntil = -Infinity;
  const waiting: (() => void)[] = [];
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    while (inflight >= max) await new Promise<void>((r) => waiting.push(r));
    inflight++;
    try {
      for (;;) {
        const p = pauseUntil - io.now();
        if (p > 0) {
          await io.sleep(p);
          continue;
        }
        const slot = Math.max(io.now(), last + gap);
        last = slot;
        const wait = slot - io.now();
        if (wait > 0) await io.sleep(wait);
        // a Retry-After set meanwhile is waited too
        if (pauseUntil <= io.now()) break;
      }
      return await fn();
    } finally {
      inflight--;
      waiting.shift()?.();
    }
  };
  return Object.assign(run, { pause: (until: number) => void (pauseUntil = Math.max(pauseUntil, until)) });
}

async function timed(io: Io, url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await io.fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** `deadline`: no Wikimedia request starts, and no Retry-After is waited, past it (the call lives 300 s) */
type Ctx = { io: Io; gate: ReturnType<typeof makeGate>; deadline: number };
/** A Wikimedia JSON request through the gate; 429: waits Retry-After when it is short (3 times), every other request
 *  of the pass with it (the gate's pause), else Busy */
async function wm(c: Ctx, url: string, init: RequestInit = {}, notFoundOk = false): Promise<unknown> {
  for (let i = 0; ; i++) {
    if (c.io.now() > c.deadline) throw new Busy();
    let busy = false;
    const r = await c.gate(async () => {
      const res = await timed(c.io, url, { ...init, headers: { "user-agent": UA, "api-user-agent": UA, accept: "application/json", ...((init.headers as Record<string, string>) || {}) } }, 15_000);
      if (res.status === 429) {
        const ms = retryAfter(res.headers.get("retry-after"), c.io.now());
        busy = ms > 30_000 || i >= 3 || c.io.now() + ms > c.deadline;
        // waited: no other request starts before it ends (set before the slot is freed)
        if (!busy) c.gate.pause(c.io.now() + ms);
      }
      return res;
    });
    if (r.status === 429) {
      if (busy) throw new Busy();
      // the gate waits the pause before the next try
      continue;
    }
    if (r.status === 404 && notFoundOk) return null;
    if (!r.ok) throw new Http(r.status);
    return r.json();
  }
}
const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

// ---------- Nominatim ----------
type NomHit = { lat: string; lon: string; category?: string; type?: string; name?: string; namedetails?: Record<string, string> | null; extratags?: Record<string, string> | null };
/** A hit that may stand for the place: never its bus stop or metro station (unless it is one), a road (unless the
 *  name is one), or a whole district or city */
export function okHit(h: NomHit, t: Pick<Target, "type" | "name">, q: string, city = ""): boolean {
  const cat = String(h.category || "");
  const typ = String(h.type || "");
  if ((cat === "railway" || cat === "public_transport") && t.type !== "transport") return false;
  // (a street in brackets is where the place stands: « Jia Jia Tang Bao (Huanghe Road) » is no road)
  if (cat === "highway" && !(STREETY.test(noBrackets(q)) || /[路街]$/.test(q))) return false;
  if (cat === "boundary") return false;
  if (cat === "place" && /^(city|town|village|county|state|province|region|district|borough|municipality|country)$/.test(typ)) return false;
  // a free search also matches addresses (« 张园 » finds a hospital on a street of that name): one of its names must
  // name the place as asked
  const names = [h.name, ...Object.entries(h.namedetails || {}).filter(([k]) => /^(name|official_name|alt_name|old_name|short_name)(:|$)/.test(k)).map(([, v]) => v)];
  return names.some((n) => typeof n === "string" && !!n.trim() && titleNames(n.replace(/[（(]/g, " (").replace(/[）)]/g, ") "), q, t, city));
}
/** OpenStreetMap refused us (429 / 403 / 503): no photo request goes to it from this instance for 10 minutes at least
 *  (the preparation's own geocoding shares the servers' address, it must never be blocked by the photos). Kept with
 *  the Nominatim gate the instance shares. */
const nomBlocked = new WeakMap<object, number>();
async function nominatim(io: Io, params: Record<string, string>): Promise<NomHit[]> {
  if (io.now() < (nomBlocked.get(io.nomGate) || 0)) throw new Busy();
  await io.nomGate();
  const r = await timed(io, `https://nominatim.openstreetmap.org/search?${form({ format: "jsonv2", extratags: "1", namedetails: "1", "accept-language": "en", ...params })}`, { headers: { "user-agent": UA, referer: REFERER } }, 12_000);
  if (r.status === 429 || r.status === 403 || r.status === 503) {
    nomBlocked.set(io.nomGate, io.now() + Math.max(10 * 60_000, retryAfter(r.headers.get("retry-after"), io.now())));
    throw new Busy();
  }
  if (!r.ok) throw new Http(r.status);
  const out = await r.json();
  return Array.isArray(out) ? (out as NomHit[]) : [];
}

// ---------- Commons ----------
type Info = { title: string; origW: number; origH: number; mime: string; page: string; license: string; licenseUrl?: string; author: string; attrRequired: boolean; thumb?: string; tw?: number; th?: number };
const titleOf = (f: string) => (/^File:/i.test(f) ? "File:" + f.slice(5) : "File:" + f).replace(/_/g, " ");
/** imageinfo for up to 50 files per POST at one standard width; the answer is keyed by the title asked */
async function commons(c: Ctx, files: string[], width: (typeof STEPS)[number]): Promise<Map<string, Info>> {
  const out = new Map<string, Info>();
  const list = [...new Set(files.map(titleOf))];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const d = (await wm(c, "https://commons.wikimedia.org/w/api.php", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ action: "query", format: "json", formatversion: "2", titles: chunk.join("|"), prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|Attribution|Credit|AttributionRequired", iiurlwidth: String(width) }),
    })) as { query?: { normalized?: { from: string; to: string }[]; pages?: { title: string; imageinfo?: Record<string, unknown>[] }[] } } | null;
    const back = new Map<string, string[]>();
    for (const n of d?.query?.normalized || []) back.set(n.to, [...(back.get(n.to) || []), n.from]);
    for (const p of d?.query?.pages || []) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const md = (ii.extmetadata || {}) as Record<string, { value?: string }>;
      const rec: Info = {
        title: p.title,
        origW: Number(ii.width) || 0,
        origH: Number(ii.height) || 0,
        mime: String(ii.mime || ""),
        page: httpsUrl(ii.descriptionurl) || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
        license: plain(String(md.LicenseShortName?.value || ""), 60),
        licenseUrl: httpsUrl(plain(String(md.LicenseUrl?.value || ""), 300)),
        // the credit the uploader asked for, else the author, else the credit line (never « Own work » alone)
        author: plain(String(md.Attribution?.value || "")) || plain(String(md.Artist?.value || "")) || creditOf(String(md.Credit?.value || "")),
        attrRequired: /^true$/i.test(plain(String(md.AttributionRequired?.value || ""), 10)),
        thumb: typeof ii.thumburl === "string" ? thumbUrl(ii.thumburl) : undefined,
        tw: Number(ii.thumbwidth) || undefined,
        th: Number(ii.thumbheight) || undefined,
      };
      out.set(p.title, rec);
      for (const f of back.get(p.title) || []) out.set(f, rec);
    }
  }
  return out;
}
const creditOf = (html: string) => {
  const v = plain(html);
  return /^(own work|travail personnel|self-photographed|selbst fotografiert)\.?$/i.test(v) ? "" : v;
};
/** CC BY and CC BY-SA ask for the author's name: such a file without one is refused */
const BY_LICENSE = /^CC BY(-SA)? /;
/** A thumbnail URL usable as a step: a real thumbnail on upload.wikimedia.org or thumb.wikimedia.org (where Commons
 *  now answers with them), never the throttled original */
const isThumb = (u?: string) => !!u && /^https:\/\/(upload|thumb)\.wikimedia\.org\/.+\/thumb\//.test(u);
/** Commons' thumbnail URL without the tracking query it now carries (« ?utm_source=… ») */
export const thumbUrl = (u: string) => (/^https:\/\/thumb\.wikimedia\.org\//.test(u) ? u.replace(/[?#].*$/, "") : u);
const acceptInfo = (i: Info) => okLicense(i.license) && MIMES.has(i.mime) && okRatio(i.origW, i.origH) && okTitle(i.title) && (!!i.author || !(BY_LICENSE.test(i.license.trim()) || i.attrRequired));

/**
 * The files' sizes: large = 1280 when wider than 1280, else 960 when wider than 960, else the small one; small = 500
 * (files not wider than 500 are refused). Returns the accepted files, keyed by the title asked.
 */
async function commonsFound(c: Ctx, files: string[], source: Source, minLarge = 0): Promise<Map<string, Found>> {
  const out = new Map<string, Found>();
  if (!files.length) return out;
  const big = await commons(c, files, 1280);
  const ok = [...new Set(files.map(titleOf))].filter((f) => {
    const i = big.get(f);
    return !!i && acceptInfo(i) && i.origW > 500;
  });
  if (!ok.length) return out;
  const small = await commons(c, ok, 500);
  const mid960 = ok.filter((f) => {
    const i = big.get(f)!;
    return (i.origW > 960 && i.origW <= 1280) || (i.origW > 1280 && !isThumb(i.thumb));
  });
  const mid = mid960.length ? await commons(c, mid960, 960) : new Map<string, Info>();
  for (const f of ok) {
    const i = big.get(f)!;
    const s = small.get(f);
    if (!s || !isThumb(s.thumb)) continue;
    let large: { u: string; w: number; tw: number; th: number } | null = null;
    if (i.origW > 1280 && isThumb(i.thumb)) large = { u: i.thumb!, w: 1280, tw: i.tw || 1280, th: i.th || 0 };
    else {
      const m = mid.get(f);
      if (i.origW > 960 && m && isThumb(m.thumb)) large = { u: m.thumb!, w: 960, tw: m.tw || 960, th: m.th || 0 };
    }
    if (!large) large = { u: s.thumb!, w: 500, tw: s.tw || 500, th: s.th || 0 };
    if (large.w < minLarge) continue;
    out.set(f, {
      large: large.u, small: s.thumb!, largeW: large.w, smallW: 500,
      w: large.tw, h: large.th || Math.round((large.tw * i.origH) / i.origW),
      author: i.author, license: i.license, licenseUrl: i.licenseUrl, source, sourceUrl: i.page, key: i.title,
    });
  }
  return out;
}

// ---------- Wikidata ----------
type Claim = { rank?: string; mainsnak?: { datavalue?: { value?: unknown } } };
const firstValue = (claims: Claim[] | undefined): string | null => {
  const list = (claims || []).filter((x) => x.rank !== "deprecated" && typeof x.mainsnak?.datavalue?.value === "string");
  const pick = list.find((x) => x.rank === "preferred") || list[0];
  return pick ? String(pick.mainsnak!.datavalue!.value) : null;
};
type Ent = { p18: string | null; at: { lat: number; lng: number } | null; sitelinks: Record<string, string> };
/** its position (P625), the first one not deprecated (the preferred one first) */
const coordOf = (claims: Claim[] | undefined): { lat: number; lng: number } | null => {
  const list = (claims || []).filter((x) => x.rank !== "deprecated" && x.mainsnak?.datavalue?.value && typeof x.mainsnak.datavalue.value === "object");
  const v = (list.find((x) => x.rank === "preferred") || list[0])?.mainsnak?.datavalue?.value as { latitude?: unknown; longitude?: unknown } | undefined;
  return v && typeof v.latitude === "number" && typeof v.longitude === "number" ? { lat: v.latitude, lng: v.longitude } : null;
};
async function entities(c: Ctx, qids: string[], langs: string[]): Promise<Map<string, Ent>> {
  const out = new Map<string, Ent>();
  const list = [...new Set(qids)];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const d = (await wm(c, `https://www.wikidata.org/w/api.php?${form({ action: "wbgetentities", format: "json", ids: chunk.join("|"), props: "claims|sitelinks", sitefilter: langs.map((l) => `${l}wiki`).join("|") })}`)) as { entities?: Record<string, { claims?: Record<string, Claim[]>; sitelinks?: Record<string, { title?: string }> }> } | null;
    for (const [q, e] of Object.entries(d?.entities || {})) {
      const sl: Record<string, string> = {};
      for (const [k, v] of Object.entries(e.sitelinks || {})) if (v?.title) sl[k] = v.title;
      out.set(q, { p18: firstValue(e.claims?.P18), at: coordOf(e.claims?.P625), sitelinks: sl });
    }
  }
  return out;
}
/** One property of one entity (a city weighs megabytes as a whole entity) */
async function claim(c: Ctx, qid: string, prop: "P18"): Promise<string | null> {
  const d = (await wm(c, `https://www.wikidata.org/w/api.php?${form({ action: "wbgetclaims", format: "json", entity: qid, property: prop })}`)) as { claims?: Record<string, Claim[]> } | null;
  return firstValue(d?.claims?.[prop]);
}

// ---------- Wikipedia ----------
const LANG = /^[a-z]{2,3}(-[a-z]{2,8})?$/;
/** The Commons file of a Wikipedia article's summary (never a file local to that Wikipedia: often not free) */
async function summaryFile(c: Ctx, lang: string, title: string, near?: { lat: number; lng: number }): Promise<string | null> {
  if (!LANG.test(lang) || !title.trim()) return null;
  const d = (await wm(c, `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.trim().replace(/ /g, "_"))}`, {}, true)) as {
    type?: string; originalimage?: { source?: string }; coordinates?: { lat?: number; lon?: number };
  } | null;
  if (!d || d.type === "disambiguation") return null;
  if (near) {
    const co = d.coordinates;
    if (!co || typeof co.lat !== "number" || typeof co.lon !== "number" || km(near, { lat: co.lat, lng: co.lon }) > 2) return null;
  }
  const src = String(d.originalimage?.source || "");
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(src);
  if (!m) return null;
  try {
    return "File:" + decodeURIComponent(m[1]).replace(/_/g, " ");
  } catch {
    return null;
  }
}

// ---------- Openverse ----------
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const STOP = new Set(["the", "le", "la", "les", "de", "des", "of", "du", "and", "et"]);
/** the words of a place's name a photo's title must carry (the city's own name aside) */
export function tokens(name: string, city: string): string[] {
  const c = new Set(fold(city).split(" "));
  return fold(name).split(" ").filter((w) => w.length >= 3 && !STOP.has(w) && !c.has(w));
}
/**
 * Does a photo's title name the place? Its whole name as a phrase, on word boundaries (« Shanghai Museum », never
 * « Shanghai Natural History Museum »; « Bund », never « bundle »); the city's words may be missing only when at least
 * two distinctive words are left (« Musée de l'Orangerie » in Paris), each a whole word of the title.
 */
export function namesPlace(title: string, name: string, city: string, nameCn?: string): boolean {
  return !!nameMatch(title, name, city, nameCn);
}
/** How a title names the place: by its Chinese name, its whole name as a phrase of two words or more, only by its
 *  words (or a one-word phrase: « Peninsula » for « The Peninsula »), or not at all ("") */
function nameMatch(title: string, name: string, city: string, nameCn?: string): "cn" | "phrase" | "words" | "" {
  if (nameCn && title.includes(nameCn)) return "cn";
  const t = ` ${fold(title)} `;
  // the leading article aside (« Le Bund » names « The Bund, Shanghai »)
  const phrase = fold(name).replace(/^(the|le|la|les|l) (?=\S)/, "");
  if (phrase && t.includes(` ${phrase} `)) return phrase.includes(" ") ? "phrase" : "words";
  const need = tokens(name, city);
  if (need.length < 2) return "";
  const words = new Set(t.trim().split(" "));
  return need.every((w) => words.has(w)) ? "words" : "";
}
/** Does a text name another city than the place's own (« The Peninsula Tokyo », « Lei Garden, Hong Kong »)? A city
 *  the place's name carries (« Suzhou Museum ») is its own. */
function otherCity(text: string, name: string, cities: string[]): boolean {
  const t = ` ${fold(text)} `;
  const own = ` ${fold(name)} `;
  const home = new Set(cities.map(fold));
  return NEAR_CITIES.some((c) => t.includes(` ${c} `) && !own.includes(` ${c} `) && !home.has(c));
}
type OvHit = { id?: string; title?: string; width?: number; height?: number; thumbnail?: string; license?: string; license_version?: string; license_url?: string; creator?: string; foreign_landing_url?: string; tags?: { name?: string }[] };
export function ovLicense(l: string, v: string): string {
  const k = (l || "").toLowerCase();
  if (k === "cc0") return "CC0";
  if (k === "pdm") return "Public domain";
  return `CC ${k.toUpperCase()}${v ? ` ${v}` : ""}`;
}
/**
 * `names`: the place's name variants. The title must name the place by the first one or by its name without brackets
 * (never a hotel it stands in, a second part or another name), never name another city, and, when it names it only
 * by words (not its whole name), carry the place's city in its title or its tags. `tripCity`: the trip's own city.
 */
function ovPick(hits: OvHit[], t: Target, city: string, names: string[] = [t.name], tripCity = city): Found | null {
  const cn = names.find((v) => CJK.test(v) && !/[a-z]/i.test(v)) || t.nameCn;
  const own = [...new Set([names.find((v) => !CJK.test(v)) || t.name, noBrackets(t.name)].filter(Boolean))];
  const fc = fold(city);
  for (const h of hits) {
    const title = String(h.title || "");
    const how = own.map((v) => nameMatch(title, v, city, cn)).find(Boolean) || "";
    if (!how || PERSON_TITLE.test(title) || !okTitle(title)) continue;
    if (otherCity(title, t.name, [city, tripCity])) continue;
    if (how === "words" && fc) {
      const tags = ` ${fold((Array.isArray(h.tags) ? h.tags : []).map((x) => String(x?.name || "")).join(" "))} `;
      if (!` ${fold(title)} `.includes(` ${fc} `) && !tags.includes(` ${fc} `)) continue;
    }
    const w = Number(h.width) || 0;
    const hh = Number(h.height) || 0;
    if (w < 500 || !okRatio(w, hh)) continue;
    const id = String(h.id || "");
    if (!/^[0-9a-f-]{36}$/.test(id)) continue;
    const thumb = String(h.thumbnail || "");
    if (!/^https:\/\/api\.openverse\.org\//.test(thumb)) continue;
    const lic = String(h.license || "").toLowerCase();
    // commercial use and modification allowed (the search asked for it; checked again here)
    if (!["cc0", "pdm", "by", "by-sa"].includes(lic)) continue;
    // CC BY / BY-SA ask for the author's name
    if ((lic === "by" || lic === "by-sa") && !plain(String(h.creator || ""))) continue;
    return {
      large: thumb, small: thumb, largeW: 500, smallW: 500, w, h: hh,
      author: plain(String(h.creator || "")), license: ovLicense(lic, String(h.license_version || "")), licenseUrl: httpsUrl(h.license_url),
      source: "openverse", sourceUrl: httpsUrl(h.foreign_landing_url) || `https://openverse.org/image/${id}`, key: `openverse:${id}`,
    };
  }
  return null;
}

// ---------- names: the variants of a place's name, and whether a page's title names it ----------
const CJK = /[㐀-䶿一-鿿豈-﫿]/;
const CJK_ONLY = /^[㐀-䶿一-鿿豈-﫿·]{2,24}$/;
const CJK_LEAD = /^[㐀-䶿一-鿿豈-﫿]{4,24}/;
/** cities a place's name may start with (« Suzhou – Jardin… »), besides the trip's own */
const NEAR_CITIES = ["shanghai", "suzhou", "hangzhou", "nanjing", "wuxi", "ningbo", "jiaxing", "haining", "tongli", "zhouzhuang", "wuzhen", "xitang", "zhujiajiao", "beijing", "guangzhou", "shenzhen", "hong kong", "macau", "macao", "foshan", "xi an", "chengdu", "chongqing", "paris", "london", "new york", "tokyo", "kyoto", "osaka", "seoul"];
/** words that say what kind of place it is, by family (« Jardin Yu » and « Yu Garden » are the same kind) */
const KIND: Record<string, string> = {
  museum: "museum", gallery: "museum", foundation: "museum",
  garden: "garden", park: "garden",
  temple: "temple", pagoda: "temple", monastery: "temple", church: "temple", cathedral: "temple", mosque: "temple", shrine: "temple",
  hotel: "hotel", peninsula: "hotel", ritz: "hotel", carlton: "hotel", fairmont: "hotel", bulgari: "hotel", bvlgari: "hotel", waldorf: "hotel", rosewood: "hotel", mandarin: "hotel", shangri: "hotel", hyatt: "hotel", aman: "hotel",
  house: "building", mansion: "building", building: "building", villa: "building", tower: "building", apartments: "building",
  station: "station", railway: "station",
  airport: "airport",
  market: "market", bazaar: "market",
};
/** hotel names that say the kind and still set the place apart (« The Peninsula », « Bulgari Hotel ») */
const BRAND = new Set(["peninsula", "ritz", "carlton", "fairmont", "bulgari", "bvlgari", "waldorf", "rosewood", "mandarin", "shangri", "hyatt", "aman"]);
const CJK_KIND: [RegExp, string][] = [[/博物馆|美术馆|艺术馆|纪念馆|艺术中心|影像/, "museum"], [/园/, "garden"], [/寺|庙|塔|教堂/, "temple"], [/酒店|饭店|宾馆/, "hotel"], [/大厦|大楼|公馆|中心/, "building"], [/站$/, "station"], [/机场/, "airport"], [/市场|商城/, "market"]];
/** the same word across languages, before comparing */
const NORM: Record<string, string> = { musee: "museum", musees: "museum", museo: "museum", museums: "museum", galerie: "gallery", fondation: "foundation", jardin: "garden", jardins: "garden", gardens: "garden", parc: "park", botanique: "botanical", temples: "temple", pagode: "pagoda", monastere: "monastery", eglise: "church", cathedrale: "cathedral", aeroport: "airport", gare: "station", marche: "market", hotels: "hotel" };
/** words that never name the place (« boutique d'expérience », « flagship », « Terminal 1 ») */
const GENERIC = new Set(["boutique", "flagship", "store", "shop", "experience", "balade", "walk", "promenade", "terminal", "official", "concept", "new", "old"]);
/** words that make a page another thing than the place (its metro station, its district, a list…), unless the name has them */
const DISTRACT = new Set(["station", "metro", "line", "district", "subdistrict", "town", "township", "county", "province", "road", "street", "avenue", "boulevard", "list", "liste", "university", "school", "company", "corporation", "group", "bank", "film", "song", "album", "novel", "band", "dynasty", "war", "incident", "battle", "language", "cuisine", "people"]);
const ARTICLE = new Set(["the", "le", "la", "les", "l"]);
const STREETY = /\b(road|rd|street|st|avenue|ave|lane|boulevard|blvd|rue|lu|jie)\b\.?/i;
const STREET_WORDS = new Set(["road", "rd", "street", "st", "avenue", "ave", "lane", "boulevard", "blvd", "rue", "lu", "jie"]);
/** kinds of place that may be a street themselves (« Wukang Road & Wukang Mansion »): their street parts are kept */
const STREET_TYPES = new Set(["landmark", "quartier", "neighbourhood", "district"]);
/** districts and areas of the cities the trips cover: a name in brackets that is one says where the place stands,
 *  never another name of it (« Jardin botanique de Shanghai (Xuhui) ») */
const AREAS = new Set(["huangpu", "xuhui", "changning", "jing an", "jingan", "putuo", "hongkou", "yangpu", "minhang", "baoshan", "jiading", "pudong", "jinshan", "songjiang", "qingpu", "fengxian", "chongming", "lujiazui", "people s square", "west bund", "french concession", "former french concession", "hongqiao", "caohejing", "jiuguang", "gubei", "xintiandi", "chaoyang", "haidian", "dongcheng", "xicheng", "sanlitun", "tianhe", "yuexiu", "haizhu", "liwan", "panyu", "baiyun", "futian", "nanshan", "luohu", "central", "kowloon", "tsim sha tsui", "wan chai", "causeway bay", "mong kok", "admiralty", "shibuya", "shinjuku", "ginza", "marais", "montmartre", "soho"]);
const isArea = (s: string) => {
  const f = fold(s);
  return AREAS.has(f) || /\b(district|qu|new area|subdistrict)$/.test(f);
};
/** a name without its brackets */
const noBrackets = (s: string) => s.replace(/[（(][^（）()]*[）)]/g, " ").replace(/\s+/g, " ").trim();
/** kinds of place whose name in brackets is another name of the place itself (« Le Bund (Waitan) ») */
const ALIAS_TYPES = new Set(["landmark", "jardin", "parc", "park", "garden"]);
/** kinds of place seen over a wide area: a page's position may be farther from the pin */
const WIDE_TYPES = new Set(["jardin", "parc", "park", "garden", "quartier", "neighbourhood", "district"]);
const WIDE_WORDS = /\b(road|street|lu|rue|bund|lake|lac|concession|quartier|quarter|waterfront|old town|vieille ville)\b/i;

const words = (s: string) => fold(s).split(" ").filter(Boolean).map((w) => NORM[w] || w);
const cityWords = (city: string) => new Set([...words(city), ...NEAR_CITIES.flatMap((c) => c.split(" "))]);
const isCityName = (s: string, city: string) => {
  const f = fold(s);
  return !!f && (f === fold(city) || NEAR_CITIES.includes(f));
};
const kindsOf = (s: string): Set<string> => {
  const out = new Set<string>();
  for (const w of words(s)) if (KIND[w]) out.add(KIND[w]);
  for (const [re, k] of CJK_KIND) if (re.test(s)) out.add(k);
  return out;
};
/** the words that set a name apart: not the city, not its kind, not a filler */
const distinct = (s: string, cw: Set<string>) => words(s).filter((w) => w.length >= 2 && !STOP.has(w) && !ARTICLE.has(w) && !cw.has(w) && (!KIND[w] || BRAND.has(w)) && !GENERIC.has(w));
/** a part of a name that can name a place: a distinctive word, or a kind of place (« Jardin Yu », « Shanghai Tower ») */
const meaningful = (s: string, cw: Set<string>) => CJK.test(s) || kindsOf(s).size > 0 || distinct(s, cw).some((w) => w.length >= 3);
/** a walk (« Balade … », « … → … ») has no one subject; « Hollywood Walk of Fame », « Promenade des Anglais » are places */
export const isWalk = (name: string) => /→/.test(name) || /^(balade|walk|stroll|itineraire)\b/.test(fold(name));

/** The Chinese name at the end of a Chinese address (« …人民大道201号 上海博物馆 » → « 上海博物馆 »), or "" */
export function cnName(addressCn?: string): string {
  const a = String(addressCn || "").trim();
  const parts = a.split(/[\s　]+/);
  if (parts.length < 2) return "";
  const tail = parts[parts.length - 1].replace(/[（(][^）)]*[）)]/g, "").trim();
  const name = CJK_ONLY.test(tail) ? tail : (CJK_LEAD.exec(tail)?.[0] ?? "");
  if (!name || /[路街号弄楼层室]$/.test(name) || /^.{1,4}[省市区县]/.test(name)) return "";
  return name;
}

/** Is the content of a pair of brackets (or of quotes) a name worth looking up for this place? */
function aliasOk(s: string, type: string): boolean {
  if (!s || /\d/.test(s) || STREETY.test(s) || /[A-Z]\.[A-Z]?\./.test(s)) return false;
  if (/^[A-Z0-9][A-Z0-9&.\-]{1,5}$/.test(s) || /^[a-z]{2,5}$/.test(s) || /^(tgv|hsr|metro|mrt|bts)$/i.test(s)) return false;
  // never a district or a city area, even for a garden or a landmark (« Xuhui »)
  if (isArea(s)) return false;
  // another name of the place itself, or the hotel / house it stands in (never its square, park, district or mall)
  return ALIAS_TYPES.has(type) || [...kindsOf(s)].some((k) => k === "hotel" || k === "building" || k === "museum" || k === "temple");
}

/**
 * The names to look a place up by, best first, 4 at most: the meaningful parts of its name (brackets removed, split
 * on « & + – - : → × », the city it starts with dropped, a street part dropped unless the place may be a street
 * itself), its Chinese name (its own, or the end of its Chinese address), another name in brackets (« Waitan ») or the
 * hotel it stands in (« The Peninsula »), then the whole name without its brackets (never with them: a street, a park
 * or a district in brackets is where the place stands, never a name of it).
 */
export function nameVariants(t: Pick<Target, "name" | "nameCn" | "addressCn" | "type">, city: string): string[] {
  const cw = cityWords(city);
  const raw = String(t.name || "").replace(/\s+/g, " ").trim();
  const aliases: string[] = [];
  for (const m of raw.matchAll(/\(([^()]*)\)|«\s*([^«»]+?)\s*»/g)) for (const a of (m[1] ?? m[2]).split(/\s*,\s*/)) aliases.push(a.replace(/^\+\s*/, "").trim());
  const base = raw.replace(/\([^()]*\)/g, " ").replace(/[«»“”"]/g, " ").replace(/\s+/g, " ").replace(/\s*[–—:&+→×-]\s*$/, "").trim();
  const segs = base.split(/\s+[&+–—:×-]\s+|\s*→\s*/).map((s) => s.trim()).filter(Boolean);
  const kept = segs.filter((s) => !isCityName(s, city) && meaningful(s, cw) && (STREET_TYPES.has(t.type) || !STREETY.test(s)));
  const main = kept.length ? kept : [base];
  const cn = t.nameCn && CJK.test(t.nameCn) ? t.nameCn.trim() : cnName(t.addressCn);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...main, cn, ...aliases.filter((a) => aliasOk(a, t.type) && !isCityName(a, city)), base]) {
    const k = CJK.test(v) && !/[a-z]/i.test(v) ? v : fold(v);
    if (!v || !k || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out.slice(0, 4);
}

/** the city a place's name starts with (« Suzhou – … »), else the trip's */
function cityOf(name: string, city: string): string {
  const first = name.split(/\s+[–—:-]\s+/)[0];
  return first !== name && isCityName(first, "") ? first.trim() : city;
}

/** How far a page's position may be from the place (km): 3 for gardens, parks, quarters and streets, else 1.5 */
export function radiusOf(t: Pick<Target, "name" | "type">): number {
  return WIDE_TYPES.has(t.type) || kindsOf(t.name).has("garden") || WIDE_WORDS.test(fold(t.name)) ? 3 : 1.5;
}
/** A page's position near enough to the place (a page without one is never accepted on its own) */
export function nearEnough(t: Pick<Target, "name" | "type" | "lat" | "lng">, at: { lat: number; lng: number } | null | undefined): boolean {
  return !!at && Number.isFinite(at.lat) && Number.isFinite(at.lng) && km(t, at) <= radiusOf(t);
}

/**
 * Does a Wikipedia page's title name the place, as looked up by `variant`? A Chinese name: the same title (or one
 * containing it, never a district or a station of it). Otherwise: every distinctive word of the variant in the title,
 * or every distinctive word of the title in the variant (« Bund » for « Le Bund »); the same exact phrase when the
 * variant has no distinctive word (« Shanghai Museum »); the same kind of place as the variant (else as the place's
 * name: never « Pudong » for « Museum of Art Pudong »); and none of a station's, a district's, a list's words.
 */
export function titleNames(title: string, variant: string, t: Pick<Target, "name">, city: string): boolean {
  const base = t.name.replace(/\([^()]*\)/g, " ");
  // the variant's words without its brackets (« Jia Jia Tang Bao (Huanghe Road) » never names « Huanghe Road »)
  const vb = variant.replace(/\([^()]*\)/g, " ");
  const need = kindsOf(vb).size ? kindsOf(vb) : kindsOf(base);
  const clean = title.replace(/\s*[（(][^）)]*[）)]\s*$/, "").trim();
  if (CJK.test(variant) && !/[a-z]/i.test(variant)) {
    if (clean === variant) return true;
    if (/[区市县省镇乡]$|街道$/.test(clean) || (/站$/.test(clean) && !/站$/.test(variant))) return false;
    const contains = (variant.length >= 3 && clean.includes(variant)) || (clean.length >= 3 && variant.includes(clean));
    return contains && (!need.size || [...kindsOf(clean)].some((k) => need.has(k)));
  }
  const tw = words(clean);
  const vw = new Set([...words(vb), ...words(base)]);
  if (tw.some((w) => DISTRACT.has(w) && !vw.has(w))) return false;
  if (need.size && ![...kindsOf(clean)].some((k) => need.has(k))) return false;
  // only the place's own city aside (never another one: « Nanjing Road » keeps its « Nanjing »)
  const cw = new Set([...words(city), ...words(cityOf(t.name, city))]);
  const dv = distinct(vb, cw);
  const dt = distinct(clean, cw);
  const tset = new Set(tw);
  if (!dv.length) {
    // the same words, its articles and the city aside (« Shanghai Museum », « Suzhou Museum »)
    const strip = (s: string) => words(s).filter((w) => !ARTICLE.has(w) && !cw.has(w)).join(" ");
    return strip(clean) === strip(vb);
  }
  if (dv.every((w) => tset.has(w))) return true;
  // the other way (« Bund » for « Le Bund »): never a street (it must carry every word of the variant), and one word
  // at least that is neither a street's nor another thing's
  return !STREETY.test(clean) && dt.some((w) => !STREET_WORDS.has(w) && !DISTRACT.has(w)) && dt.every((w) => vw.has(w));
}

// ---------- Wikipedia search ----------
type WpPage = { title: string; index?: number; coordinates?: { lat: number; lon: number }[]; pageprops?: { wikibase_item?: string; page_image_free?: string; disambiguation?: string }; pageimage?: string };
async function wpSearch(c: Ctx, lang: string, q: string): Promise<WpPage[]> {
  const d = (await wm(c, `https://${lang}.wikipedia.org/w/api.php?${form({ action: "query", format: "json", formatversion: "2", generator: "search", gsrsearch: q, gsrlimit: "3", gsrnamespace: "0", prop: "coordinates|pageprops|pageimages", piprop: "name", ppprop: "wikibase_item|page_image_free|disambiguation" })}`)) as { query?: { pages?: WpPage[] } } | null;
  return [...(d?.query?.pages || [])].sort((a, b) => (a.index || 0) - (b.index || 0));
}
/** A page found by a search: its Wikidata id, its free Commons image, its position (null: to take from Wikidata) */
type Cand = { qid?: string; file?: string; at: { lat: number; lng: number } | null; via: string };

// ---------- the chain ----------
const isCn = (v: string) => CJK.test(v) && !/[a-z]/i.test(v);
/**
 * Looks up every place: a photo found, "none" (nothing acceptable), or "retry" (an error, a busy service or the time
 * budget: nothing is written, the next pass tries again). Lookups stop at `budgetEnd`. Each place is looked up by the
 * variants of its name (nameVariants): OpenStreetMap by two of them (its Chinese name first), then a Wikipedia search
 * (English, the trip's languages, Chinese) accepting only a page that names it and stands near it, then Openverse.
 */
export async function lookupPlaces(ts: Target[], ctx: { city: string; country: string; langs: string[] }, io: Io, budgetEnd: number): Promise<Map<string, Result>> {
  // a step started before the budget may finish within 30 s after it
  const c: Ctx = { io, gate: makeGate(io), deadline: budgetEnd + 30_000 };
  const found = new Map<string, Found>();
  const failed = new Set<string>();
  const langs = [...new Set(ctx.langs.filter((l) => LANG.test(l)))];
  let stopped = false;
  const over = (margin = 0) => io.now() > budgetEnd - margin;
  /** past the budget (or Wikimedia busy): every place not looked up through by now stays to retry */
  const cut = () => {
    if (!stopped && over()) stopped = true;
    return stopped;
  };
  const st = new Map<string, { qid?: string; wp?: string; sitelinks?: Record<string, string>; p18?: string | null; via?: string }>();
  const stop = (e: unknown, ids: string[]) => {
    if (e instanceof Busy) stopped = true;
    else io.log?.(`photos: ${String((e as Error)?.message || e).slice(0, 120)}`);
    for (const id of ids) failed.add(id);
  };
  const vars = new Map(ts.map((t) => [t.id, nameVariants(t, ctx.city)]));
  /** every request for this place answered (nothing found is then « none », even if the pass is cut later) */
  const settled = new Set<string>();

  // the Wikipedia search of one place (step 5), by its name variants and the city: in English, by its Chinese name in
  // Chinese, in the trip's other languages; a page is kept only when its title names the place (titleNames) and it
  // stands within 1.5 km of it (3 km: gardens, parks, quarters), its position from Wikidata when the page has none
  const searchLangs = ["en", ...langs.filter((l) => l !== "en" && l !== "zh")];
  const cands = new Map<string, Cand[]>();
  const searched = new Set<string>();
  const searchPlace = async (t: Target) => {
    searched.add(t.id);
    const vs = vars.get(t.id)!;
    const cn = vs.find(isCn);
    const latin = vs.filter((v) => !CJK.test(v)).slice(0, 2);
    const sc = cityOf(t.name, ctx.city);
    const plan: [string, string][] = [];
    if (latin[0]) plan.push(["en", latin[0]]);
    if (cn) plan.push(["zh", cn]);
    for (const l of searchLangs.slice(1)) if (latin[0]) plan.push([l, latin[0]]);
    for (const l of searchLangs) if (latin[1]) plan.push([l, latin[1]]);
    const list: Cand[] = [];
    for (const [l, v] of plan.slice(0, 6)) {
      if (cut()) break;
      const named = isCn(v) || words(v).some((w) => cityWords(sc).has(w));
      try {
        let near = false;
        for (const p of await wpSearch(c, l, named ? v : `${v} ${sc}`)) {
          if (p.pageprops?.disambiguation !== undefined || !titleNames(p.title, v, t, sc)) continue;
          const co = p.coordinates?.[0];
          const at = co && typeof co.lat === "number" && typeof co.lon === "number" ? { lat: co.lat, lng: co.lon } : null;
          if (at && !nearEnough(t, at)) continue;
          const qid = /^Q\d+$/.test(String(p.pageprops?.wikibase_item || "")) ? p.pageprops!.wikibase_item : undefined;
          // only a free image (a Commons file is checked again there; a non-free local one is never asked)
          const free = String(p.pageprops?.page_image_free || "");
          const file = free ? titleOf(free) : undefined;
          if (!qid && (!file || !at)) continue;
          list.push({ qid, file, at, via: `${l} « ${v} » → ${p.title}` });
          if (at) {
            near = true;
            break;
          }
        }
        if (near) break;
      } catch (e) {
        stop(e, [t.id]);
        break;
      }
    }
    if (list.length) cands.set(t.id, list);
  };
  const searchAll = async (list: Target[]) => {
    let i = 0;
    const worker = async () => {
      while (i < list.length && !cut()) await searchPlace(list[i++]);
    };
    await Promise.all([worker(), worker(), worker()]);
    for (let j = i; j < list.length; j++) if (!searched.has(list[j].id)) failed.add(list[j].id);
  };

  // 1. OpenStreetMap: the Wikidata id (and the Wikipedia article) of each place, within 2 km of it, by its Chinese
  // name first, then by the best other variant when the first finds nothing usable (2 requests at most); refused once
  // (429 / 403 / 503), it is asked nothing more: the places left stay to retry. A walk (« … → … ») has no one subject:
  // it is never looked up. Meanwhile the places it finds no Wikidata id for are already searched on Wikipedia (the
  // other services, at most 3 requests in flight): OpenStreetMap's 1.1 s spacing is the pass's longest wait.
  const nomDone = new Map<string, () => void>();
  const nomReady = new Map(ts.map((t) => [t.id, new Promise<void>((r) => nomDone.set(t.id, r))]));
  const early = ts.filter((t) => !isWalk(t.name));
  let ke = 0;
  const earlyWorker = async () => {
    while (ke < early.length) {
      const t = early[ke++];
      await nomReady.get(t.id);
      if (cut()) return;
      // a Wikidata id found: its own photo first (steps 2–4), searched later only if it has none
      if (!st.get(t.id)?.qid) await searchPlace(t);
    }
  };
  const earlyRun = Promise.all([earlyWorker(), earlyWorker(), earlyWorker()]);
  let nomOff = false;
  try {
    for (const t of ts) {
      if (isWalk(t.name)) {
        settled.add(t.id);
        nomDone.get(t.id)!();
        continue;
      }
      if (stopped || nomOff || over(40_000)) {
        failed.add(t.id);
        nomDone.get(t.id)!();
        continue;
      }
      const box = [t.lng - 0.03, t.lat + 0.03, t.lng + 0.03, t.lat - 0.03].map((x) => x.toFixed(5)).join(",");
      const vs = vars.get(t.id)!;
      const cn = vs.find(isCn);
      const tries = (cn ? [cn, ...vs.filter((v) => v !== cn)] : vs).slice(0, 2);
      // a request that fails (slow, an error) leaves the next variant to try; the place stays to retry unless found
      let got: { qid?: string; wp?: string; via?: string } = {};
      for (const q of tries) {
        try {
          const hits = (await nominatim(io, { limit: "3", viewbox: box, bounded: "1", q })).filter((h) => km(t, { lat: Number(h.lat), lng: Number(h.lon) }) <= 2 && okHit(h, t, q, cityOf(t.name, ctx.city)));
          const withQ = hits.find((h) => /^Q\d+$/.test(String(h.extratags?.wikidata || "")));
          const wpHit = withQ || hits.find((h) => h.extratags?.wikipedia);
          if (wpHit) {
            got = { qid: withQ?.extratags?.wikidata, wp: wpHit.extratags?.wikipedia, via: q };
            break;
          }
        } catch (e) {
          failed.add(t.id);
          if (e instanceof Busy) {
            nomOff = true;
            break;
          }
          if (!(e instanceof Http)) io.log?.(`photos nominatim: ${String((e as Error)?.message || e).slice(0, 80)}`);
        }
      }
      st.set(t.id, got);
      nomDone.get(t.id)!();
    }
  } finally {
    for (const r of nomDone.values()) r();
  }

  // 2. Wikidata P18, 50 ids per request
  const withQ = ts.filter((t) => st.get(t.id)?.qid);
  if (withQ.length && !cut()) {
    try {
      const ents = await entities(c, withQ.map((t) => st.get(t.id)!.qid!), langs);
      for (const t of withQ) {
        const e = ents.get(st.get(t.id)!.qid!);
        if (e) Object.assign(st.get(t.id)!, { p18: e.p18, sitelinks: e.sitelinks });
      }
    } catch (e) {
      stop(e, withQ.map((t) => t.id));
    }
  }

  // 3. Commons: the P18 files, 50 per request, accepted under the rules
  const p18 = ts.filter((t) => st.get(t.id)?.p18);
  if (p18.length && !cut()) {
    try {
      const got = await commonsFound(c, p18.map((t) => st.get(t.id)!.p18!), "wikidata");
      for (const t of p18) {
        const f = got.get(titleOf(st.get(t.id)!.p18!));
        if (f) found.set(t.id, { ...f, qid: st.get(t.id)!.qid, via: `osm « ${st.get(t.id)!.via} »` });
      }
    } catch (e) {
      stop(e, p18.map((t) => t.id));
    }
  }

  // 4. the Commons file of the summary of the place's own Wikipedia article (from OpenStreetMap or Wikidata)
  const wpFile = new Map<string, string>();
  const rest = ts.filter((t) => !found.has(t.id) && (st.get(t.id)?.wp || st.get(t.id)?.sitelinks));
  let k = 0;
  const worker = async () => {
    while (k < rest.length && !cut()) {
      const t = rest[k++];
      const s = st.get(t.id) || {};
      const titles: [string, string][] = [];
      if (s.wp && s.wp.includes(":")) {
        const i = s.wp.indexOf(":");
        titles.push([s.wp.slice(0, i), s.wp.slice(i + 1)]);
      }
      for (const l of langs) if (s.sitelinks?.[`${l}wiki`]) titles.push([l, s.sitelinks[`${l}wiki`]]);
      const seen = new Set<string>();
      for (const [l, title] of titles) {
        const key = `${l}:${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const f = await summaryFile(c, l, title);
          if (f) {
            wpFile.set(t.id, f);
            break;
          }
        } catch (e) {
          stop(e, [t.id]);
          if (stopped) return;
        }
      }
    }
    // places never reached (budget, busy) stay to retry
  };
  if (rest.length && !cut()) await Promise.all([worker(), worker(), worker()]);
  for (let i = k; i < rest.length; i++) failed.add(rest[i].id);
  const wpT = rest.filter((t) => wpFile.has(t.id));
  if (wpT.length && !cut()) {
    try {
      const got = await commonsFound(c, wpT.map((t) => wpFile.get(t.id)!), "wikipedia");
      for (const t of wpT) {
        const f = got.get(titleOf(wpFile.get(t.id)!));
        if (f) found.set(t.id, { ...f, qid: st.get(t.id)?.qid, via: `wikipedia summary ${wpFile.get(t.id)}` });
      }
    } catch (e) {
      stop(e, wpT.map((t) => t.id));
    }
  }

  // 5. the Wikipedia search (searchPlace): the places with a Wikidata id but no photo yet, now; then the pages found,
  // their Wikidata P18, else their free Commons image
  await earlyRun;
  const left = ts.filter((t) => !found.has(t.id) && !isWalk(t.name));
  if (!cut()) await searchAll(left.filter((t) => !searched.has(t.id)));
  else for (const t of left) if (!searched.has(t.id)) failed.add(t.id);
  // their Wikidata ids at once: the P18, and the position of a page that gives none
  const ids = [...new Set([...cands.values()].flat().map((x) => x.qid).filter((q): q is string => !!q))];
  let ents = new Map<string, Ent>();
  if (ids.length && !cut()) {
    try {
      ents = await entities(c, ids, langs);
    } catch (e) {
      stop(e, [...cands.keys()]);
    }
  }
  const files = new Map<string, { file: string; source: Source; qid?: string; via: string }[]>();
  for (const t of left) {
    const list: { file: string; source: Source; qid?: string; via: string }[] = [];
    for (const x of cands.get(t.id) || []) {
      const e = x.qid ? ents.get(x.qid) : undefined;
      if (!nearEnough(t, x.at || e?.at)) continue;
      if (e?.p18) list.push({ file: titleOf(e.p18), source: "wikidata", qid: x.qid, via: x.via });
      if (x.file) list.push({ file: x.file, source: "wikipedia", qid: x.qid, via: x.via });
    }
    if (list.length) files.set(t.id, list);
  }
  if (files.size && !cut()) {
    try {
      const got = await commonsFound(c, [...files.values()].flat().map((f) => f.file), "wikipedia");
      for (const [id, list] of files) {
        for (const f of list) {
          const g = got.get(f.file);
          if (!g) continue;
          found.set(id, { ...g, source: f.source, qid: f.qid, via: `search ${f.via}` });
          break;
        }
      }
    } catch (e) {
      stop(e, [...files.keys()]);
    }
  }

  // 6. Openverse by the best variant, one request every 2 s, 40 at most per pass; a 429 turns it off for the rest of
  // the pass; a photo's title must name the place by one of its variants
  let ov = 0;
  let ovOff = false;
  let lastOv = -Infinity;
  for (const t of ts) {
    if (found.has(t.id) || isWalk(t.name)) continue;
    if (ovOff || cut() || ov >= OPENVERSE_MAX) {
      failed.add(t.id);
      continue;
    }
    const wait = lastOv + OPENVERSE_GAP - io.now();
    if (wait > 0) await io.sleep(wait);
    lastOv = io.now();
    ov++;
    try {
      const vs = vars.get(t.id)!;
      const best = vs.find((v) => !CJK.test(v)) || t.name;
      const sc = cityOf(t.name, ctx.city);
      const q = `${best} ${sc}`.trim();
      const r = await timed(io, `https://api.openverse.org/v1/images/?${form({ q, license_type: "commercial,modification", page_size: "20", mature: "false" })}`, { headers: { "user-agent": UA, accept: "application/json" } }, 12_000);
      if (r.status === 429) {
        ovOff = true;
        failed.add(t.id);
        continue;
      }
      if (!r.ok) throw new Http(r.status);
      const d = (await r.json()) as { results?: OvHit[] };
      const f = ovPick(Array.isArray(d?.results) ? d.results : [], t, sc, vs, ctx.city);
      if (f) found.set(t.id, { ...f, via: `openverse « ${best} »` });
      settled.add(t.id);
    } catch {
      failed.add(t.id);
    }
  }

  // nothing found: « none » once every source answered for the place, else it stays to retry (an error, a busy
  // service, the time budget)
  const out = new Map<string, Result>();
  for (const t of ts) out.set(t.id, found.get(t.id) || (settled.has(t.id) && !failed.has(t.id) ? "none" : "retry"));
  return out;
}

/**
 * The trip's city: its Wikidata P18, under the same rules, and wide enough for the band. (Its P948 Wikivoyage banner
 * is not asked: about 7:1, always outside the 0.6–2.2 ratio rule.)
 */
export async function lookupCity(city: { name: string; country: string; lat?: number; lng?: number }, io: Io, deadline = io.now() + 60_000): Promise<Result> {
  const c: Ctx = { io, gate: makeGate(io), deadline };
  try {
    const cc = /^[a-z]{2}$/.test(city.country) ? city.country : "";
    const hits = await nominatim(io, { q: city.name, limit: "3", featureType: "settlement", ...(cc ? { countrycodes: cc } : {}) });
    const known = typeof city.lat === "number" && typeof city.lng === "number" && Number.isFinite(city.lat) && Number.isFinite(city.lng);
    const hit = hits.find((h) => /^Q\d+$/.test(String(h.extratags?.wikidata || "")) && (!known || km({ lat: city.lat!, lng: city.lng! }, { lat: Number(h.lat), lng: Number(h.lon) }) <= 80));
    if (!hit) return "none";
    const qid = hit.extratags!.wikidata!;
    const file = await claim(c, qid, "P18");
    if (!file) return "none";
    const got = await commonsFound(c, [file], "wikidata", 960);
    const f = got.get(titleOf(file));
    return f ? { ...f, qid } : "none";
  } catch (e) {
    if (!(e instanceof Busy) && !(e instanceof Http)) io.log?.(`photos city: ${String((e as Error)?.message || e).slice(0, 80)}`);
    return "retry";
  }
}

// ---------- the bucket and the copies ----------
const storage = (io: Io, path: string) => `${io.supaUrl}/storage/v1/${path}`;
const auth = (io: Io) => ({ authorization: `Bearer ${io.key}`, apikey: io.key });
const bucketDone = new Set<string>();
/** Creates the public bucket once (an existing one is fine); anything else throws, before anything is written */
export async function ensureBucket(io: Io): Promise<void> {
  const memo = `${io.supaUrl}|${createHash("sha1").update(io.key).digest("hex")}`;
  if (bucketDone.has(memo)) return;
  const r = await timed(io, storage(io, "bucket"), {
    method: "POST",
    headers: { ...auth(io), "content-type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: MAX_BYTES, allowed_mime_types: Object.keys(MIME_EXT) }),
  }, 10_000);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    if (!((r.status === 400 || r.status === 409) && /already exists|duplicate/i.test(text))) throw new Error(`bucket ${r.status}`);
  }
  bucketDone.add(memo);
}

/** A file from an allow-listed host only, following at most 2 redirects that stay on the list */
async function download(io: Io, url: string, accept = "image/jpeg,image/png,image/webp"): Promise<{ bytes: ArrayBuffer; type: string }> {
  let u = url;
  for (let hop = 0; hop <= 2; hop++) {
    let host = "";
    try {
      const p = new URL(u);
      host = p.protocol === "https:" ? p.hostname : "";
    } catch {
      host = "";
    }
    if (!DOWNLOAD_HOSTS.has(host)) throw new Error("host");
    const r = await timed(io, u, { redirect: "manual", headers: { "user-agent": UA, accept } }, 20_000);
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      if (!loc) throw new Error("redirect");
      u = new URL(loc, u).toString();
      continue;
    }
    if (r.status === 429) throw new Busy();
    if (!r.ok) throw new Http(r.status);
    const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!MIME_EXT[type]) throw new Error("type");
    if (Number(r.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("size");
    const bytes = await r.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES || bytes.byteLength < 200) throw new Error("size");
    return { bytes, type };
  }
  throw new Error("redirects");
}

const guessExt = (url: string) => {
  const m = /\.(jpe?g|png|webp)(?:$|[?#])/i.exec(url);
  return m ? (m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase()) : "jpg";
};
/** The object's name: the source's key (a Commons file's title hashed, an Openverse id) and the width */
export function baseOf(f: Pick<Found, "key">): string {
  if (f.key.startsWith("openverse:")) return `o/${f.key.slice(10)}`;
  return `c/${createHash("sha1").update(f.key).digest("hex").slice(0, 20)}`;
}
async function copyOne(io: Io, url: string, base: string, w: number, openverse: boolean): Promise<string> {
  // already copied (another trip, an earlier pass): checked with the service key, never on the public URL. An
  // Openverse thumbnail's URL carries no extension (asked as JPEG, but its type decides the name): each is tried
  const first = openverse ? "jpg" : guessExt(url);
  const exts = openverse ? [first, ...Object.values(MIME_EXT).filter((x) => x !== first)] : [first];
  for (const ext of exts) {
    const guess = `${base}-${w}.${ext}`;
    const head = await timed(io, storage(io, `object/${BUCKET}/${guess}`), { method: "HEAD", headers: auth(io) }, 10_000);
    if (head.status === 200) return guess;
  }
  const { bytes, type } = await download(io, url, openverse ? "image/jpeg" : undefined);
  const path = `${base}-${w}.${MIME_EXT[type]}`;
  const up = await timed(io, storage(io, `object/${BUCKET}/${path}`), {
    method: "POST",
    headers: { ...auth(io), "content-type": type, "cache-control": "max-age=31536000", "x-upsert": "true" },
    body: bytes,
  }, 10_000);
  if (!up.ok) throw new Error(`upload ${up.status}`);
  return path;
}
/** Copies a found photo (large and small) into the bucket; returns what the records keep */
export async function copyToBucket(f: Found, io: Io): Promise<PhotoRef> {
  const base = baseOf(f);
  const ov = f.source === "openverse";
  const thumb = await copyOne(io, f.small, base, f.smallW, ov);
  const path = f.large === f.small ? thumb : await copyOne(io, f.large, base, f.largeW, ov);
  const ref: PhotoRef = {
    v: 1, path, thumb, w: f.w, h: f.h, author: f.author, license: f.license, source: f.source, sourceUrl: f.sourceUrl, key: f.key, at: io.now(),
  };
  if (f.licenseUrl) ref.licenseUrl = f.licenseUrl;
  if (f.qid) ref.qid = f.qid;
  return ref;
}
