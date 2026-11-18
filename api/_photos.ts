// The photo of each place and of each trip, found and copied by the server (api/prepare.ts runs the pass).
// Sources, in this order: OpenStreetMap (Nominatim, extratags → the Wikidata id) → Wikidata P18 (P948 banner for the
// trip's city) → Wikimedia Commons (standard thumbnail widths, licence, author, file page) → the Wikipedia summary's
// Commons file → Openverse (commercial use + modification allowed, title naming the place). Never: Commons geosearch,
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
export type Target = { id: string; name: string; nameCn?: string; lat: number; lng: number; type: string };
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
};
export type PhotoRef = Omit<Found, "large" | "small" | "largeW" | "smallW"> & { v: 1; path: string; thumb: string; at: number };
export type Result = Found | "none" | "retry";

export const UA = "ORBES Trips (https://orbesmap.vercel.app)";
const REFERER = "https://orbesmap.vercel.app/";
/** the only iiurlwidth values ever sent (any other width answers 400) */
export const STEPS = [500, 960, 1280] as const;
export const BUCKET = "place-photos";
const MAX_BYTES = 3 * 1024 * 1024;
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** the only hosts a file is downloaded from */
const DOWNLOAD_HOSTS = new Set(["upload.wikimedia.org", "api.openverse.org"]);
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
/** The same rule as src/lib/photoData.ts needsLookup (server copy) */
export function needsLookup(photo: unknown, fieldsAt: unknown, now: number): boolean {
  if (!photo || typeof photo !== "object") return true;
  const p = photo as { none?: boolean; at?: number; path?: string };
  if (p.none !== true && typeof p.path !== "string") return true;
  const at = Number(p.at) || 0;
  if (p.none === true && now - at > NONE_TTL) return true;
  const fa = (fieldsAt && typeof fieldsAt === "object" ? fieldsAt : {}) as Record<string, unknown>;
  return ["name", "lat", "lng"].some((k) => (Number(fa[k]) || 0) > at);
}

const LICENSE = /^(CC0( 1\.0)?|Public domain|PD(-[\w-]+)?|CC BY(-SA)? \d\.\d( [a-z]{2})?)$/;
const BAD_TITLE = /\b(montage|collage|composite|mosaic|map|carte|plan|logo|flag|coat of arms|locator|diagram)\b/i;
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

/** One gate for Wikimedia: at most 3 requests in flight, at least 250 ms between two starts */
function makeGate(io: Io, max = 3, gap = 250) {
  let inflight = 0;
  let last = -Infinity;
  const waiting: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    while (inflight >= max) await new Promise<void>((r) => waiting.push(r));
    inflight++;
    try {
      const slot = Math.max(io.now(), last + gap);
      last = slot;
      const wait = slot - io.now();
      if (wait > 0) await io.sleep(wait);
      return await fn();
    } finally {
      inflight--;
      waiting.shift()?.();
    }
  };
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

type Ctx = { io: Io; gate: ReturnType<typeof makeGate> };
/** A Wikimedia JSON request through the gate; 429: waits Retry-After when it is short (3 times), else Busy */
async function wm(c: Ctx, url: string, init: RequestInit = {}, notFoundOk = false): Promise<unknown> {
  for (let i = 0; ; i++) {
    const r = await c.gate(() => timed(c.io, url, { ...init, headers: { "user-agent": UA, "api-user-agent": UA, accept: "application/json", ...((init.headers as Record<string, string>) || {}) } }, 15_000));
    if (r.status === 429) {
      const ms = retryAfter(r.headers.get("retry-after"), c.io.now());
      if (ms > 30_000 || i >= 3) throw new Busy();
      await c.io.sleep(ms);
      continue;
    }
    if (r.status === 404 && notFoundOk) return null;
    if (!r.ok) throw new Http(r.status);
    return r.json();
  }
}
const form = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

// ---------- Nominatim ----------
type NomHit = { lat: string; lon: string; extratags?: Record<string, string> | null };
async function nominatim(io: Io, params: Record<string, string>): Promise<NomHit[]> {
  await io.nomGate();
  const r = await timed(io, `https://nominatim.openstreetmap.org/search?${form({ format: "jsonv2", extratags: "1", "accept-language": "en", ...params })}`, { headers: { "user-agent": UA, referer: REFERER } }, 8000);
  if (!r.ok) throw new Http(r.status);
  const out = await r.json();
  return Array.isArray(out) ? (out as NomHit[]) : [];
}

// ---------- Commons ----------
type Info = { title: string; origW: number; origH: number; mime: string; page: string; license: string; licenseUrl?: string; author: string; thumb?: string; tw?: number; th?: number };
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
      body: form({ action: "query", format: "json", formatversion: "2", titles: chunk.join("|"), prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiextmetadatafilter: "LicenseShortName|LicenseUrl|Artist|AttributionRequired", iiurlwidth: String(width) }),
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
        author: plain(String(md.Artist?.value || "")),
        thumb: typeof ii.thumburl === "string" ? ii.thumburl : undefined,
        tw: Number(ii.thumbwidth) || undefined,
        th: Number(ii.thumbheight) || undefined,
      };
      out.set(p.title, rec);
      for (const f of back.get(p.title) || []) out.set(f, rec);
    }
  }
  return out;
}
/** A thumbnail URL usable as a step: a real thumbnail on upload.wikimedia.org (never the throttled original) */
const isThumb = (u?: string) => !!u && /^https:\/\/upload\.wikimedia\.org\/.+\/thumb\//.test(u);
const acceptInfo = (i: Info) => okLicense(i.license) && MIMES.has(i.mime) && okRatio(i.origW, i.origH) && okTitle(i.title);

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
async function entities(c: Ctx, qids: string[], langs: string[]): Promise<Map<string, { p18: string | null; sitelinks: Record<string, string> }>> {
  const out = new Map<string, { p18: string | null; sitelinks: Record<string, string> }>();
  const list = [...new Set(qids)];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const d = (await wm(c, `https://www.wikidata.org/w/api.php?${form({ action: "wbgetentities", format: "json", ids: chunk.join("|"), props: "claims|sitelinks", sitefilter: langs.map((l) => `${l}wiki`).join("|") })}`)) as { entities?: Record<string, { claims?: Record<string, Claim[]>; sitelinks?: Record<string, { title?: string }> }> } | null;
    for (const [q, e] of Object.entries(d?.entities || {})) {
      const sl: Record<string, string> = {};
      for (const [k, v] of Object.entries(e.sitelinks || {})) if (v?.title) sl[k] = v.title;
      out.set(q, { p18: firstValue(e.claims?.P18), sitelinks: sl });
    }
  }
  return out;
}
/** One property of one entity (a city weighs megabytes as a whole entity) */
async function claim(c: Ctx, qid: string, prop: "P18" | "P948"): Promise<string | null> {
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
type OvHit = { id?: string; title?: string; width?: number; height?: number; thumbnail?: string; license?: string; license_version?: string; license_url?: string; creator?: string; foreign_landing_url?: string };
export function ovLicense(l: string, v: string): string {
  const k = (l || "").toLowerCase();
  if (k === "cc0") return "CC0";
  if (k === "pdm") return "Public domain";
  return `CC ${k.toUpperCase()}${v ? ` ${v}` : ""}`;
}
function ovPick(hits: OvHit[], t: Target, city: string): Found | null {
  const need = tokens(t.name, city);
  for (const h of hits) {
    const title = fold(String(h.title || ""));
    const byName = need.length > 0 && need.every((w) => title.includes(w));
    const byCn = !!t.nameCn && String(h.title || "").includes(t.nameCn);
    if (!byName && !byCn) continue;
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
    return {
      large: thumb, small: thumb, largeW: 500, smallW: 500, w, h: hh,
      author: plain(String(h.creator || "")), license: ovLicense(lic, String(h.license_version || "")), licenseUrl: httpsUrl(h.license_url),
      source: "openverse", sourceUrl: httpsUrl(h.foreign_landing_url) || `https://openverse.org/image/${id}`, key: `openverse:${id}`,
    };
  }
  return null;
}

// ---------- the chain ----------
/**
 * Looks up every place: a photo found, "none" (nothing acceptable), or "retry" (an error, a busy service or the time
 * budget: nothing is written, the next pass tries again). Lookups stop at `budgetEnd`.
 */
export async function lookupPlaces(ts: Target[], ctx: { city: string; country: string; langs: string[] }, io: Io, budgetEnd: number): Promise<Map<string, Result>> {
  const c: Ctx = { io, gate: makeGate(io) };
  const found = new Map<string, Found>();
  const failed = new Set<string>();
  const langs = [...new Set(ctx.langs.filter((l) => LANG.test(l)))];
  let stopped = false;
  const over = (margin = 0) => io.now() > budgetEnd - margin;
  /** past the budget (or Wikimedia busy): every place not found by now stays to retry */
  const cut = () => {
    if (!stopped && over()) stopped = true;
    return stopped;
  };
  const st = new Map<string, { qid?: string; wp?: string; sitelinks?: Record<string, string>; p18?: string | null }>();
  const stop = (e: unknown, ids: string[]) => {
    if (e instanceof Busy) stopped = true;
    else io.log?.(`photos: ${String((e as Error)?.message || e).slice(0, 120)}`);
    for (const id of ids) failed.add(id);
  };

  // 1. OpenStreetMap: the Wikidata id (and the Wikipedia article) of each place, within 2 km of it
  for (const t of ts) {
    if (stopped || over(40_000)) {
      failed.add(t.id);
      continue;
    }
    const box = [t.lng - 0.03, t.lat + 0.03, t.lng + 0.03, t.lat - 0.03].map((x) => x.toFixed(5)).join(",");
    try {
      const near = (hits: NomHit[]) => hits.filter((h) => km(t, { lat: Number(h.lat), lng: Number(h.lon) }) <= 2);
      let hits = near(await nominatim(io, { limit: "3", viewbox: box, bounded: "1", q: t.name }));
      if (!hits.length && t.nameCn && t.nameCn !== t.name) hits = near(await nominatim(io, { limit: "3", viewbox: box, bounded: "1", q: t.nameCn }));
      const withQ = hits.find((h) => /^Q\d+$/.test(String(h.extratags?.wikidata || "")));
      const wpHit = withQ || hits.find((h) => h.extratags?.wikipedia);
      st.set(t.id, { qid: withQ?.extratags?.wikidata, wp: wpHit?.extratags?.wikipedia });
    } catch (e) {
      st.set(t.id, {});
      failed.add(t.id);
      if (!(e instanceof Http)) io.log?.(`photos nominatim: ${String((e as Error)?.message || e).slice(0, 80)}`);
    }
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
        if (f) found.set(t.id, { ...f, qid: st.get(t.id)!.qid });
      }
    } catch (e) {
      stop(e, p18.map((t) => t.id));
    }
  }

  // 4. the Wikipedia summary's Commons file, for the places still without one
  const wpFile = new Map<string, string>();
  const rest = ts.filter((t) => !found.has(t.id));
  let k = 0;
  const worker = async () => {
    while (k < rest.length && !cut()) {
      const t = rest[k++];
      const s = st.get(t.id) || {};
      const titles: [string, string, boolean][] = [];
      if (s.wp && s.wp.includes(":")) {
        const i = s.wp.indexOf(":");
        titles.push([s.wp.slice(0, i), s.wp.slice(i + 1), false]);
      }
      for (const l of langs) if (s.sitelinks?.[`${l}wiki`]) titles.push([l, s.sitelinks[`${l}wiki`], false]);
      // the place's own name only when it has no Wikidata id, and only an article within 2 km of it
      if (!s.qid) for (const l of langs) titles.push([l, t.name, true]);
      const seen = new Set<string>();
      for (const [l, title, byName] of titles) {
        const key = `${l}:${title}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const f = await summaryFile(c, l, title, byName ? t : undefined);
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
        if (f) found.set(t.id, { ...f, qid: st.get(t.id)?.qid });
      }
    } catch (e) {
      stop(e, wpT.map((t) => t.id));
    }
  }

  // 5. Openverse, one request every 2 s, 40 at most per pass; a 429 turns it off for the rest of the pass
  let ov = 0;
  let ovOff = false;
  let lastOv = -Infinity;
  for (const t of ts) {
    if (found.has(t.id)) continue;
    if (ovOff || cut() || ov >= OPENVERSE_MAX) {
      failed.add(t.id);
      continue;
    }
    const wait = lastOv + OPENVERSE_GAP - io.now();
    if (wait > 0) await io.sleep(wait);
    lastOv = io.now();
    ov++;
    try {
      const q = `${t.name} ${ctx.city}`.trim();
      const r = await timed(io, `https://api.openverse.org/v1/images/?${form({ q, license_type: "commercial,modification", page_size: "20", mature: "false" })}`, { headers: { "user-agent": UA, accept: "application/json" } }, 12_000);
      if (r.status === 429) {
        ovOff = true;
        failed.add(t.id);
        continue;
      }
      if (!r.ok) throw new Http(r.status);
      const d = (await r.json()) as { results?: OvHit[] };
      const f = ovPick(Array.isArray(d?.results) ? d.results : [], t, ctx.city);
      if (f) found.set(t.id, f);
    } catch {
      failed.add(t.id);
    }
  }

  const out = new Map<string, Result>();
  for (const t of ts) out.set(t.id, found.get(t.id) || (failed.has(t.id) || stopped ? "retry" : "none"));
  return out;
}

/** The trip's city: its Wikidata P18, else its P948 banner, under the same rules, and wide enough for the band */
export async function lookupCity(city: { name: string; country: string; lat?: number; lng?: number }, io: Io): Promise<Result> {
  const c: Ctx = { io, gate: makeGate(io) };
  try {
    const cc = /^[a-z]{2}$/.test(city.country) ? city.country : "";
    const hits = await nominatim(io, { q: city.name, limit: "3", featureType: "settlement", ...(cc ? { countrycodes: cc } : {}) });
    const known = typeof city.lat === "number" && typeof city.lng === "number" && Number.isFinite(city.lat) && Number.isFinite(city.lng);
    const hit = hits.find((h) => /^Q\d+$/.test(String(h.extratags?.wikidata || "")) && (!known || km({ lat: city.lat!, lng: city.lng! }, { lat: Number(h.lat), lng: Number(h.lon) }) <= 80));
    if (!hit) return "none";
    const qid = hit.extratags!.wikidata!;
    for (const prop of ["P18", "P948"] as const) {
      const file = await claim(c, qid, prop);
      if (!file) continue;
      const got = await commonsFound(c, [file], "wikidata", 960);
      const f = got.get(titleOf(file));
      if (f) return { ...f, qid };
    }
    return "none";
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
  const r = await io.fetch(storage(io, "bucket"), {
    method: "POST",
    headers: { ...auth(io), "content-type": "application/json" },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: MAX_BYTES, allowed_mime_types: Object.keys(MIME_EXT) }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    if (!((r.status === 400 || r.status === 409) && /already exists|duplicate/i.test(text))) throw new Error(`bucket ${r.status}`);
  }
  bucketDone.add(memo);
}

/** A file from an allow-listed host only, following at most 2 redirects that stay on the list */
async function download(io: Io, url: string): Promise<{ bytes: ArrayBuffer; type: string }> {
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
    const r = await timed(io, u, { redirect: "manual", headers: { "user-agent": UA, accept: "image/jpeg,image/png,image/webp" } }, 20_000);
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
async function copyOne(io: Io, url: string, base: string, w: number): Promise<string> {
  const guess = `${base}-${w}.${guessExt(url)}`;
  // already copied (another trip, an earlier pass): checked with the service key, never on the public URL
  const head = await io.fetch(storage(io, `object/${BUCKET}/${guess}`), { method: "HEAD", headers: auth(io) });
  if (head.status === 200) return guess;
  const { bytes, type } = await download(io, url);
  const path = `${base}-${w}.${MIME_EXT[type]}`;
  const up = await io.fetch(storage(io, `object/${BUCKET}/${path}`), {
    method: "POST",
    headers: { ...auth(io), "content-type": type, "cache-control": "max-age=31536000", "x-upsert": "true" },
    body: bytes,
  });
  if (!up.ok) throw new Error(`upload ${up.status}`);
  return path;
}
/** Copies a found photo (large and small) into the bucket; returns what the records keep */
export async function copyToBucket(f: Found, io: Io): Promise<PhotoRef> {
  const base = baseOf(f);
  const thumb = await copyOne(io, f.small, base, f.smallW);
  const path = f.large === f.small ? thumb : await copyOne(io, f.large, base, f.largeW);
  const ref: PhotoRef = {
    v: 1, path, thumb, w: f.w, h: f.h, author: f.author, license: f.license, source: f.source, sourceUrl: f.sourceUrl, key: f.key, at: io.now(),
  };
  if (f.licenseUrl) ref.licenseUrl = f.licenseUrl;
  if (f.qid) ref.qid = f.qid;
  return ref;
}
