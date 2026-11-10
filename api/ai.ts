// ORBES AI relay (Vercel function). Keeps the Anthropic key on the server and only answers
// members of the shared space (Supabase session + public.members check).
// Tasks: "photo" (translate a photo), "interpret" (live interpreter), "place" (find a place from a link / text / screenshot).
import Anthropic from "@anthropic-ai/sdk";

const SUPA_URL = process.env.SUPABASE_URL || "https://ifugaqjneprbtigvegeb.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_0qPu_8XZTLk-l68k2kPUvQ_7UXk-fCu";
const MODEL = "claude-opus-5-5";
const ORIGINS = [/^https:\/\/(www\.)?theorbes\.com$/, /^https:\/\/orbesmap(-[a-z0-9-]+)?\.vercel\.app$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];

type Json = Record<string, unknown>;

function corsHeaders(origin: string | null): Record<string, string> {
  const ok = origin && ORIGINS.some((r) => r.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "https://theorbes.com",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...corsHeaders(origin) } });

/** The caller must be signed in to Supabase AND listed in public.members. */
async function isMember(token: string): Promise<boolean> {
  const u = await fetch(`${SUPA_URL}/auth/v1/user`, { headers: { apikey: SUPA_KEY, authorization: `Bearer ${token}` } });
  if (!u.ok) return false;
  const r = await fetch(`${SUPA_URL}/rest/v1/rpc/is_member`, {
    method: "POST",
    headers: { apikey: SUPA_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  return r.ok && (await r.json()) === true;
}

// ---------- output schemas (structured outputs: every object closed, every field required) ----------
const str = { type: "string" } as const;
const num = { type: "number" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const arr = (items: unknown) => ({ type: "array", items });

const PHOTO_SCHEMA = obj({
  kind: { type: "string", enum: ["menu", "panneau", "etiquette", "carte", "ticket", "autre"] },
  title: str, // e.g. "Menu — cuisine shanghaïenne"
  summary: str, // 1–2 sentences in French
  lines: arr(obj({ zh: str, fr: str, price: num, note: str })), // price in CNY, 0 when none
  picks: arr(obj({ name: str, why: str })),
  avoid: arr(obj({ name: str, why: str })),
  material: str, // labels: composition / origin / care, else ""
  contact: obj({ name: str, company: str, role: str, phone: str, wechat: str, email: str, address: str, addressCn: str }),
});
const INTERPRET_SCHEMA = obj({ translation: str, pinyin: str, note: str });
const PLACE_SCHEMA = obj({
  found: { type: "boolean" },
  name: str,
  nameCn: str,
  address: str,
  addressCn: str,
  lat: num,
  lng: num,
  coordSystem: { type: "string", enum: ["WGS84", "GCJ02", "BD09", "none"] },
  type: { type: "string", enum: ["concept", "mode", "luxe", "montres", "cuir", "textile", "bijoux", "musee", "galerie", "jardin", "landmark", "design", "tech", "restaurant", "cafe", "bar", "club", "mall", "lifestyle"] },
  desc: str,
  hours: str,
  source: str,
  confidence: { type: "string", enum: ["haute", "moyenne", "faible"] },
  message: str, // what to tell the user if not found / ambiguous
});

const PHOTO_SYSTEM = `Tu aides Eliot, fondateur français de la marque ORBES (maroquinerie et mode premium, minimaliste), en voyage à Shanghai avec son père.
On t'envoie une photo prise sur place (menu, panneau, étiquette de produit ou de tissu, carte de visite, ticket…). Réponds en français simple.
- lines : chaque élément lisible, chinois d'origine (zh) et traduction française naturelle (fr). price = prix en yuans si visible, sinon 0. note = précision utile (épicé, ingrédient, taille…) ou "".
- Menu : picks = 3 plats conseillés (spécialités, bons classiques) avec la raison ; avoid = plats à éviter pour un palais français (abats, très épicé, texture difficile…) avec la raison. Sinon tableaux vides.
- Étiquette produit ou tissu : material = composition, origine, entretien, ce que ça dit de la qualité (utile pour ORBES). Sinon "".
- Carte de visite : remplis contact (sinon tous les champs à ""). Numéro au format international si possible.
- Ne devine pas ce qui est illisible : écris "illisible".`;

const INTERPRET_SYSTEM = `Tu es l'interprète d'Eliot et de son père (français) à Shanghai : boutiques, tailleur, restaurant, taxi, artisans, fournisseurs de cuir et de textile.
Traduis fidèlement le message, sans rien ajouter ni commenter.
- Du français vers le chinois : mandarin parlé naturel et poli, caractères simplifiés ; pinyin avec tons.
- Du chinois vers le français : français naturel ; pinyin = "".
- note : seulement si un point culturel ou un risque de malentendu mérite d'être signalé (sinon "").
Latency-sensitive; begin your visible answer immediately.`;

const PLACE_SYSTEM = `Tu retrouves un lieu à Shanghai (ou en Chine) à partir d'un lien (Xiaohongshu, Dianping, Instagram, article, Google Maps…), d'un texte ou d'une capture d'écran, pour l'ajouter à la carte de voyage d'Eliot.
- Utilise la recherche web et la lecture de pages pour confirmer le nom, le nom chinois, l'adresse exacte en chinois et en anglais/pinyin, et les coordonnées.
- Coordonnées : de préférence WGS-84 (OpenStreetMap, Wikipedia, site officiel). Si elles viennent d'Amap/Gaode, de Dianping ou de Tencent, c'est du GCJ02 ; de Baidu, c'est du BD09 : indique-le dans coordSystem sans convertir. Si tu n'as aucune coordonnée fiable, lat = 0, lng = 0, coordSystem = "none".
- desc : une phrase en français sur ce que c'est et pourquoi c'est intéressant. hours : horaires si trouvés, sinon "".
- source : l'URL la plus fiable consultée.
- Si le lien ne s'ouvre pas (ex. xhslink demande l'app) et qu'il n'y a pas d'autre indice, found = false et message explique quoi envoyer à la place (une capture d'écran du post).`;

async function run(client: Anthropic, params: Json): Promise<Json> {
  const messages = params.messages as Anthropic.Beta.BetaMessageParam[];
  // server tools can pause a long turn: send it back so the server continues (max 3 times)
  for (let i = 0; i < 4; i++) {
    const res = await client.beta.messages.create({
      ...(params as object),
      messages,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    } as Anthropic.Beta.MessageCreateParamsNonStreaming);
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    if (res.stop_reason === "refusal") throw new Error("refusal");
    if (res.stop_reason === "max_tokens") throw new Error("too_long");
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
    return JSON.parse(text);
  }
  throw new Error("paused");
}

const b64ok = (s: unknown): s is string => typeof s === "string" && s.length > 100 && s.length < 6_000_000 && /^[A-Za-z0-9+/=]+$/.test(s);

export async function handle(req: Request, deps: { client?: Anthropic; member?: (t: string) => Promise<boolean> } = {}): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "auth", message: "Connectez-vous dans l'onglet Compte pour utiliser cette fonction." }, 401, origin);
  if (!(await (deps.member || isMember)(token).catch(() => false)))
    return json({ error: "auth", message: "Ce compte n'a pas accès à l'espace partagé." }, 403, origin);
  if (!deps.client && !process.env.ANTHROPIC_API_KEY) return json({ error: "config", message: "La clé Claude n'est pas encore configurée sur Vercel (ANTHROPIC_API_KEY)." }, 503, origin);

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad", message: "Requête illisible." }, 400, origin);
  }
  const client = deps.client || new Anthropic({ maxRetries: 1, timeout: 55_000 });
  const fmt = (schema: unknown) => ({ type: "json_schema", schema });
  try {
    if (body.task === "photo") {
      if (!b64ok(body.image)) return json({ error: "bad", message: "Image manquante ou trop lourde." }, 400, origin);
      const out = await run(client, {
        model: MODEL,
        max_tokens: 8000,
        system: PHOTO_SYSTEM,
        output_config: { effort: "medium", format: fmt(PHOTO_SCHEMA) },
        messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: body.image } }, { type: "text", text: "Traduis et explique cette photo." }] }],
      });
      return json(out, 200, origin);
    }
    if (body.task === "interpret") {
      const text = String(body.text || "").slice(0, 2000).trim();
      const from = body.from === "zh" ? "zh" : "fr";
      if (!text) return json({ error: "bad", message: "Rien à traduire." }, 400, origin);
      const history = Array.isArray(body.history) ? (body.history as { from: string; text: string; translation: string }[]).slice(-6) : [];
      const ctx = history.length ? `Échanges précédents (contexte) :\n${history.map((h) => `${h.from === "zh" ? "Chinois" : "Français"} : ${h.text} → ${h.translation}`).join("\n")}\n\n` : "";
      const out = await run(client, {
        model: MODEL,
        max_tokens: 2000,
        system: INTERPRET_SYSTEM,
        output_config: { effort: "low", format: fmt(INTERPRET_SCHEMA) },
        messages: [{ role: "user", content: `${ctx}Traduis ${from === "fr" ? "du français vers le chinois" : "du chinois vers le français"} :\n${text}` }],
      });
      return json(out, 200, origin);
    }
    if (body.task === "place") {
      const url = typeof body.url === "string" ? body.url.slice(0, 1000) : "";
      const text = typeof body.text === "string" ? body.text.slice(0, 3000) : "";
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (b64ok(body.image)) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: body.image } });
      content.push({ type: "text", text: `Retrouve ce lieu.${url ? `\nLien : ${url}` : ""}${text ? `\nTexte : ${text}` : ""}${content.length ? "\n(Capture d'écran jointe.)" : ""}` });
      if (!url && !text && content.length < 2) return json({ error: "bad", message: "Collez un lien, un texte ou ajoutez une capture." }, 400, origin);
      const out = await run(client, {
        model: MODEL,
        max_tokens: 8000,
        system: PLACE_SYSTEM,
        output_config: { effort: "medium", format: fmt(PLACE_SCHEMA) },
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 5 },
          { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 },
        ],
        messages: [{ role: "user", content }],
      });
      return json(out, 200, origin);
    }
    return json({ error: "bad", message: "Tâche inconnue." }, 400, origin);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: "busy", message: "Trop de demandes en même temps, réessayez dans une minute." }, 429, origin);
    if (e instanceof Anthropic.APIError) return json({ error: "upstream", message: "Le service IA ne répond pas, réessayez." }, 502, origin);
    const m = (e as Error)?.message;
    if (m === "refusal") return json({ error: "refusal", message: "Cette demande n'a pas pu être traitée." }, 422, origin);
    return json({ error: "server", message: "Réponse illisible, réessayez." }, 500, origin);
  }
}

export const OPTIONS = (req: Request) => handle(req);
export const POST = (req: Request) => handle(req);
