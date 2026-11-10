// ORBES AI relay (Vercel function). Keeps the AI key on the server and only answers
// members of the shared space (Supabase session + public.members check).
// Provider: DeepSeek (DEEPSEEK_API_KEY, default when set) or Claude (ANTHROPIC_API_KEY). AI_PROVIDER forces one.
// Tasks: "photo" (translate a photo), "interpret" (live interpreter), "place" (find a place from a link / text / screenshot).
import Anthropic from "@anthropic-ai/sdk";

const SUPA_URL = process.env.SUPABASE_URL || "https://ifugaqjneprbtigvegeb.supabase.co";
const SUPA_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_0qPu_8XZTLk-l68k2kPUvQ_7UXk-fCu";
const MODEL = "claude-opus-5-5";
const DS_URL = "https://api.deepseek.com";
const DS_MODEL = "deepseek-flash"; // DeepSeek V4.1 Flash: text + images, JSON output, tool calls
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
const PLACE_ITEM = obj({
  name: str,
  nameCn: str,
  address: str,
  addressCn: str,
  lat: num,
  lng: num,
  coordSystem: { type: "string", enum: ["WGS84", "GCJ02", "BD09", "none"] },
  type: { type: "string", enum: ["concept", "mode", "luxe", "montres", "cuir", "textile", "bijoux", "musee", "galerie", "jardin", "landmark", "design", "tech", "restaurant", "cafe", "bar", "club", "mall", "lifestyle"] },
  desc: str,
  why: str, // suggestions: why it matches the request
  hours: str,
  price: str, // price level / typical spend if known
  source: str,
  confidence: { type: "string", enum: ["haute", "moyenne", "faible"] },
});
// "precise": one specific place (link, name) · "suggestions": 3–5 real places matching a description · "not_found"
const PLACES_SCHEMA = obj({
  kind: { type: "string", enum: ["precise", "suggestions", "not_found"] },
  message: str,
  places: arr(PLACE_ITEM),
});

const ASK_SCHEMA = obj({
  answer: str,
  refs: arr(obj({ kind: { type: "string", enum: ["place", "pin"] }, id: str })),
});

const ASK_SYSTEM = `Tu es l'assistant du carnet de voyage d'Eliot (fondateur de la marque ORBES) et de son père. Tu réponds à leurs questions à partir du CARNET ci-dessous (programme, lieux, horaires, réservations, notes et statuts, fiches fournisseurs, contacts, lieux ajoutés, check-list, assurance, vols, infos pratiques, météo, position et heure actuelles).
Règles :
- Tu es en LECTURE SEULE : tu ne peux rien modifier, rien réserver, rien envoyer. Si on te demande de changer quelque chose, explique où le faire dans l'app (fiche du lieu, Agenda, Check-list, Compte…).
- Appuie-toi d'abord sur le carnet. Si l'information n'y est pas, dis-le clairement ; tu peux ajouter une connaissance générale sur Shanghai en précisant « hors carnet ».
- Utilise l'heure et la position actuelles fournies pour « maintenant », « près de moi », « demain ». Les distances sont à vol d'oiseau, préviens-en.
- Réponds en français simple, court et concret : 2 à 6 phrases ou une courte liste à puces (lignes commençant par « - »). Pas de titres, pas de tableau.
- refs : la liste des lieux cités dans ta réponse, avec kind = "place" et l'id d'un lieu du programme, ou kind = "pin" et l'id d'un lieu ajouté. N'invente jamais d'id.`;

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

const PLACE_SYSTEM = `Tu ajoutes des lieux à la carte de voyage d'Eliot (fondateur français de la marque ORBES, maroquinerie et mode premium et minimaliste ; aime le design, l'art, les concept stores, la bonne cuisine, les beaux bars, les montres, le cuir et le textile ; attentif aux prix). Il est à Shanghai du 24 au 29 novembre 2026, avec son père.
On t'envoie un lien (Xiaohongshu, Dianping, Instagram, article, Google Maps…), un texte et/ou une capture d'écran.
Décide d'abord :
- kind = "precise" si la demande désigne UN lieu précis (un lien vers un lieu, un nom de lieu, une capture d'un lieu) : retrouve-le et renvoie 1 lieu.
- kind = "suggestions" si c'est une description ou une envie (« un bar à cocktails calme près du Bund », « où acheter du beau cuir », « dim sum ouvert tard ») : renvoie 3 à 5 VRAIS lieux qui y répondent, choisis pour les goûts d'Eliot, ouverts fin 2026 (vérifie qu'ils n'ont pas fermé), du meilleur au moins bon ; why = en une phrase pourquoi ce lieu répond à la demande. Évite les lieux déjà dans son programme (liste fournie) sauf si la demande les vise.
- kind = "not_found" si rien de fiable ; message explique quoi envoyer à la place (ex. une capture d'écran du post si le lien xhslink ne s'ouvre pas).
Pour chaque lieu :
- confirme par la recherche web et la lecture de pages : nom, nom chinois, adresse exacte en chinois et en anglais/pinyin, coordonnées.
- Coordonnées : de préférence WGS-84 (OpenStreetMap, Wikipedia, site officiel). Si elles viennent d'Amap/Gaode, de Dianping ou de Tencent, c'est du GCJ02 ; de Baidu, c'est du BD09 : indique-le dans coordSystem sans convertir. Sans coordonnée fiable : lat = 0, lng = 0, coordSystem = "none".
- desc : une phrase en français sur ce que c'est. hours : horaires si trouvés. price : niveau de prix ou dépense typique si trouvé. source : l'URL la plus fiable consultée.
- Si un lieu « près de » est donné, privilégie ce qui est à distance raisonnable (à pied ou 15 min de taxi).
message : une phrase courte pour Eliot (ex. « 4 propositions autour du Bund »).`;

type Job = {
  task: "photo" | "interpret" | "place" | "ask";
  system: string;
  text: string;
  image?: string;
  schema: Json;
  effort: "low" | "medium";
  research?: boolean;
  maxTokens: number;
};

class Upstream extends Error {
  kind: "busy" | "upstream" | "refusal" | "bad_output" | "bad_request";
  constructor(kind: "busy" | "upstream" | "refusal" | "bad_output" | "bad_request") {
    super(kind);
    this.kind = kind;
  }
}

// ---------------- Claude ----------------
async function runClaude(client: Anthropic, job: Job, deadline: number): Promise<Json> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (job.image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: job.image } });
  content.push({ type: "text", text: job.text });
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content }];
  // server tools can pause a long turn: send it back so the server continues (max 3 times)
  for (let i = 0; i < 4 && deadline - Date.now() > 10_000; i++) {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: job.maxTokens,
        system: job.system,
        output_config: { effort: job.effort, format: { type: "json_schema", schema: job.schema } },
        ...(job.research
          ? { tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 4 }] }
          : {}),
        messages,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      } as Anthropic.Beta.MessageCreateParamsNonStreaming, { timeout: Math.max(5_000, deadline - Date.now()), maxRetries: 0 });
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new Upstream("busy");
      throw new Upstream("upstream");
    }
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    if (res.stop_reason === "refusal") throw new Upstream("refusal");
    const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
    try {
      return JSON.parse(text);
    } catch {
      throw new Upstream("bad_output");
    }
  }
  throw new Upstream("upstream");
}

// ---------------- DeepSeek (OpenAI-compatible chat completions) ----------------
type DsMsg = { role: "system" | "user" | "assistant" | "tool"; content: unknown; tool_calls?: unknown; tool_call_id?: string; reasoning_content?: unknown };

async function dsPost(path: string, body: unknown, key: string, f: typeof fetch, ms = 50_000): Promise<Json> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await f(`${DS_URL}${path}`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    if (r.status === 429) throw new Upstream("busy");
    if (r.status === 400) throw new Upstream("bad_request");
    if (!r.ok) throw new Upstream("upstream");
    return (await r.json()) as Json;
  } catch (e) {
    if (e instanceof Upstream) throw e;
    throw new Upstream("upstream");
  } finally {
    clearTimeout(t);
  }
}

/** Example JSON built from the schema, shown to the model (DeepSeek JSON mode wants a format example). */
function skeleton(s: Json): unknown {
  if (s.enum) return (s.enum as unknown[])[0];
  if (s.type === "object") return Object.fromEntries(Object.entries(s.properties as Record<string, Json>).map(([k, v]) => [k, skeleton(v)]));
  if (s.type === "array") return [skeleton(s.items as Json)];
  if (s.type === "number") return 0;
  if (s.type === "boolean") return false;
  return "";
}
/** Force the model's JSON into the exact shape the app expects (missing fields → empty values). */
function coerce(s: Json, v: unknown): unknown {
  if (s.enum) return (s.enum as unknown[]).includes(v) ? v : (s.enum as unknown[])[(s.enum as unknown[]).length - 1];
  if (s.type === "object") {
    const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
    return Object.fromEntries(Object.entries(s.properties as Record<string, Json>).map(([k, sub]) => [k, coerce(sub, o[k])]));
  }
  if (s.type === "array") return Array.isArray(v) ? v.slice(0, 80).map((x) => coerce(s.items as Json, x)) : [];
  if (s.type === "number") {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : 0;
  }
  if (s.type === "boolean") return v === true || v === "true";
  return v == null ? "" : String(v);
}

const DS_TOOLS = [
  { type: "function", function: { name: "web_search", description: "Recherche web (moteur DeepSeek). Renvoie titres, liens et résumés.", parameters: { type: "object", properties: { query: { type: "string", description: "Requête, 128 caractères max ; opérateurs site: et lang: possibles" } }, required: ["query"] } } },
  { type: "function", function: { name: "web_fetch", description: "Lit une page web et renvoie son texte en Markdown.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } } },
];

async function dsTool(name: string, args: Json, key: string, f: typeof fetch, cap = 20_000): Promise<string> {
  try {
    if (name === "web_search") {
      const q = String(args.query || "").slice(0, 128).trim();
      if (!q) return "requête vide";
      const r = await dsPost("/v1/tools/search", { query: q, count: 6 }, key, f, Math.min(15_000, cap));
      const list = (r.results as Json[] | undefined) || [];
      return JSON.stringify(list.map((x) => ({ title: x.title, url: x.url, summary: String(x.summary || x.snippet || "").slice(0, 700) })));
    }
    if (name === "web_fetch") {
      const url = String(args.url || "");
      if (!/^https?:\/\//.test(url)) return "URL invalide";
      const r = await dsPost("/v1/tools/fetch", { url }, key, f, Math.min(20_000, cap));
      return `${r.title || ""}\n${String(r.content || "").slice(0, 12_000)}`;
    }
  } catch {
    return "Échec de l'outil (page inaccessible ou limite atteinte).";
  }
  return "outil inconnu";
}

async function runDeepSeek(key: string, job: Job, f: typeof fetch, deadline: number): Promise<Json> {
  const left = () => deadline - Date.now();
  const ms = (cap: number) => Math.max(3_000, Math.min(cap, left()));
  const userContent: unknown = job.image
    ? [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${job.image}` } }, { type: "text", text: job.text }]
    : job.text;
  let notes = "";
  if (job.research) {
    // phase 1: research with tools (search / fetch), max 8 rounds
    const msgs: DsMsg[] = [
      { role: "system", content: `${job.system}\nÉtape 1 : fais tes recherches avec les outils web_search et web_fetch (requêtes en chinois et en anglais), puis écris un résumé de ce que tu as trouvé pour chaque lieu retenu (nom, nom chinois, adresses, coordonnées et leur source, horaires, prix, URL de la meilleure source).` },
      { role: "user", content: userContent },
    ];
    // fast mode first; if the API refuses tools without thinking, switch to thinking mode (low effort)
    let thinking = false;
    // keep ~130 s for the last research round + the summary + the JSON answer
    const toolResults: string[] = [];
    for (let round = 0; round < 8 && left() > 130_000; round++) {
      const req = (th: boolean) => dsPost("/chat/completions", { model: DS_MODEL, messages: msgs, tools: DS_TOOLS, max_tokens: 4000, ...(th ? { thinking: { type: "enabled" }, reasoning_effort: "low" } : { thinking: { type: "disabled" } }) }, key, f, ms(50_000));
      let r: Json;
      try {
        r = await req(thinking);
      } catch (e) {
        if (!(e instanceof Upstream && e.kind === "bad_request") || thinking || round > 0) throw e;
        thinking = true;
        r = await req(true);
      }
      const m = ((r.choices as Json[] | undefined)?.[0]?.message || {}) as Json;
      const calls = (m.tool_calls as { id: string; function: { name: string; arguments: string } }[] | undefined) || [];
      if (!calls.length) {
        notes = String(m.content || "");
        break;
      }
      // in thinking mode the reasoning must be sent back with the tool results
      msgs.push({ role: "assistant", content: m.content ?? "", tool_calls: calls, ...(thinking && m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}) });
      const results = await Promise.all(
        calls.slice(0, 4).map(async (c) => {
          let args: Json = {};
          try {
            args = JSON.parse(c.function.arguments || "{}");
          } catch {
            /* bad arguments */
          }
          const content = await dsTool(c.function.name, args, key, f, Math.max(3_000, left() - 90_000));
          toolResults.push(content);
          return { role: "tool" as const, tool_call_id: c.id, content };
        }),
      );
      // every tool call needs an answer, even the ones we skipped
      for (const c of calls.slice(4)) results.push({ role: "tool", tool_call_id: c.id, content: "ignoré (trop d'appels)" });
      msgs.push(...results);
    }
    // stopped by the round / time limit before the model wrote its summary: ask for it now, without tools
    if (!notes && toolResults.length) {
      try {
        msgs.push({ role: "user", content: "Arrête les recherches. Résume maintenant, uniquement à partir des résultats ci-dessus, ce que tu as trouvé pour chaque lieu (nom, nom chinois, adresses, coordonnées et leur source, horaires, prix, URL)." });
        const r = await dsPost("/chat/completions", { model: DS_MODEL, messages: msgs, thinking: { type: "disabled" }, max_tokens: 3000 }, key, f, ms(30_000));
        notes = String(((r.choices as Json[] | undefined)?.[0]?.message as Json | undefined)?.content || "");
      } catch {
        /* fall back to the raw results below */
      }
      if (!notes) notes = toolResults.join("\n\n").slice(-30_000);
    }
    if (!notes && toolResults.length === 0 && job.task === "place") notes = "(aucune recherche n'a pu être faite : n'invente pas d'adresse ni de coordonnées ; mets confidence = faible)";
  }
  // final answer in JSON mode (retry once: an unrecognised JSON comes back as blank text)
  const system = `${job.system}\n\nRéponds UNIQUEMENT avec un objet json valide, exactement de cette forme (mêmes clés, mêmes types) :\n${JSON.stringify(skeleton(job.schema))}`;
  const messages: DsMsg[] = [
    { role: "system", content: system },
    { role: "user", content: notes ? (job.image ? [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${job.image}` } }, { type: "text", text: `${job.text}\n\nRésultats de recherche :\n${notes}` }] : `${job.text}\n\nRésultats de recherche :\n${notes}`) : userContent },
  ];
  for (let attempt = 0; attempt < 2 && left() > 5_000; attempt++) {
    const r = await dsPost("/chat/completions", { model: DS_MODEL, messages, response_format: { type: "json_object" }, thinking: { type: "disabled" }, max_tokens: job.maxTokens }, key, f, ms(60_000));
    const text = String(((r.choices as Json[] | undefined)?.[0]?.message as Json | undefined)?.content || "").trim();
    if (!text) continue;
    try {
      const raw = JSON.parse(text);
      const out = coerce(job.schema, raw) as Json;
      // a malformed "kind" must not hide valid places
      if (job.task === "place" && !["precise", "suggestions", "not_found"].includes(raw?.kind)) {
        const n = (out.places as unknown[]).length;
        out.kind = n > 1 ? "suggestions" : n === 1 ? "precise" : "not_found";
      }
      return out;
    } catch {
      /* retry */
    }
  }
  throw new Upstream("bad_output");
}

const b64ok = (s: unknown): s is string => typeof s === "string" && s.length > 100 && s.length < 6_000_000 && /^[A-Za-z0-9+/=]+$/.test(s);

type Deps = { client?: Anthropic; member?: (t: string) => Promise<boolean>; fetch?: typeof fetch; env?: Record<string, string | undefined> };

export async function handle(req: Request, deps: Deps = {}): Promise<Response> {
  const origin = req.headers.get("origin");
  const env = deps.env || process.env;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "auth", message: "Connectez-vous dans l'onglet Compte pour utiliser cette fonction." }, 401, origin);
  if (!(await (deps.member || isMember)(token).catch(() => false)))
    return json({ error: "auth", message: "Ce compte n'a pas accès à l'espace partagé." }, 403, origin);

  const dsKey = (env.DEEPSEEK_API_KEY || env.DEEPSEEK_KEY || "").trim();
  const claudeKey = (env.ANTHROPIC_API_KEY || "").trim();
  const forced = (env.AI_PROVIDER || "").toLowerCase();
  const provider = forced === "claude" && (claudeKey || deps.client) ? "claude" : dsKey ? "deepseek" : claudeKey || deps.client ? "claude" : null;
  if (!provider) return json({ error: "config", message: "La clé IA n'est pas configurée sur Vercel (DEEPSEEK_API_KEY)." }, 503, origin);

  let body: Json;
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad", message: "Requête illisible." }, 400, origin);
  }

  let job: Job;
  if (body.task === "photo") {
    if (!b64ok(body.image)) return json({ error: "bad", message: "Image manquante ou trop lourde." }, 400, origin);
    job = { task: "photo", system: PHOTO_SYSTEM, text: "Traduis et explique cette photo.", image: body.image, schema: PHOTO_SCHEMA, effort: "medium", maxTokens: 8000 };
  } else if (body.task === "interpret") {
    const text = String(body.text || "").slice(0, 2000).trim();
    const from = body.from === "zh" ? "zh" : "fr";
    if (!text) return json({ error: "bad", message: "Rien à traduire." }, 400, origin);
    const history = Array.isArray(body.history) ? (body.history as { from: string; text: string; translation: string }[]).slice(-6) : [];
    const ctx = history.length ? `Échanges précédents (contexte) :\n${history.map((h) => `${h.from === "zh" ? "Chinois" : "Français"} : ${String(h.text).slice(0, 300)} → ${String(h.translation).slice(0, 300)}`).join("\n")}\n\n` : "";
    job = { task: "interpret", system: INTERPRET_SYSTEM, text: `${ctx}Traduis ${from === "fr" ? "du français vers le chinois" : "du chinois vers le français"} :\n${text}`, schema: INTERPRET_SCHEMA, effort: "low", maxTokens: 2000 };
  } else if (body.task === "place") {
    const url = typeof body.url === "string" ? body.url.slice(0, 1000) : "";
    const text = typeof body.text === "string" ? body.text.slice(0, 3000) : "";
    const image = b64ok(body.image) ? body.image : undefined;
    if (!url && !text && !image) return json({ error: "bad", message: "Collez un lien, décrivez ce que vous cherchez ou ajoutez une capture." }, 400, origin);
    const near = body.near && typeof body.near === "object" ? (body.near as Json) : null;
    const nearTxt = near && Number.isFinite(Number(near.lat)) && Number.isFinite(Number(near.lng)) ? `\nPrès de : ${String(near.label || "ma position").slice(0, 80)} (WGS-84 ${Number(near.lat).toFixed(5)}, ${Number(near.lng).toFixed(5)})` : "";
    const known = Array.isArray(body.known) ? (body.known as unknown[]).slice(0, 120).map((x) => String(x).slice(0, 60)).join(", ") : "";
    job = {
      task: "place",
      system: PLACE_SYSTEM,
      text: `Demande d'Eliot :${url ? `\nLien : ${url}` : ""}${text ? `\nTexte : ${text}` : ""}${image ? "\n(Capture d'écran jointe.)" : ""}${nearTxt}${known ? `\nDéjà dans son programme : ${known}` : ""}`,
      image,
      schema: PLACES_SCHEMA,
      effort: "medium",
      research: true,
      maxTokens: 8000,
    };
  } else if (body.task === "ask") {
    // read-only notebook assistant: no tools at all, it can only read the notebook sent by the app
    const question = String(body.question || "").slice(0, 2000).trim();
    const context = typeof body.context === "string" ? body.context : "";
    if (!question) return json({ error: "bad", message: "Posez une question." }, 400, origin);
    if (!context || context.length > 400_000) return json({ error: "bad", message: "Carnet illisible ou trop gros." }, 400, origin);
    const history = Array.isArray(body.history) ? (body.history as { q: string; a: string }[]).slice(-8) : [];
    const past = history.length ? `Échange précédent :\n${history.map((h) => `Q : ${String(h.q).slice(0, 500)}\nR : ${String(h.a).slice(0, 1500)}`).join("\n")}\n\n` : "";
    job = { task: "ask", system: `${ASK_SYSTEM}\n\nCARNET (JSON) :\n${context}`, text: `${past}Question : ${question}`, schema: ASK_SCHEMA, effort: "medium", maxTokens: 3000 };
  } else return json({ error: "bad", message: "Tâche inconnue." }, 400, origin);

  try {
    // always answer (with CORS headers) before Vercel cuts the function at 300 s
    const deadline = Date.now() + (job.task === "place" ? 270_000 : 90_000);
    const out = provider === "deepseek" ? await runDeepSeek(dsKey, job, deps.fetch || fetch, deadline) : await runClaude(deps.client || new Anthropic({ apiKey: claudeKey, maxRetries: 1 }), job, deadline);
    return json(out, 200, origin);
  } catch (e) {
    const k = e instanceof Upstream ? e.kind : "upstream";
    if (k === "busy") return json({ error: "busy", message: "Trop de demandes en même temps, réessayez dans une minute." }, 429, origin);
    if (k === "refusal") return json({ error: "refusal", message: "Cette demande n'a pas pu être traitée." }, 422, origin);
    if (k === "bad_output") return json({ error: "server", message: "Réponse illisible, réessayez." }, 502, origin);
    return json({ error: "upstream", message: "Le service IA ne répond pas, réessayez." }, 502, origin);
  }
}

export const OPTIONS = (req: Request) => handle(req);
export const POST = (req: Request) => handle(req);
