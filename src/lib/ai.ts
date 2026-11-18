// Calls the ORBES AI relay (api/ai.ts on Vercel). Only members of the shared space can use it.
import { supabase } from "./supabase";
import { currentTrip, getState, pullPlan, requestPro } from "./store";
import { t as tr } from "./i18n";

/** Who the AI helps and for which trip (profile + current trip), sent with every request */
function aiContext() {
  const p = getState().profile;
  const t = currentTrip();
  return { who: { name: p.name, interests: p.interests, travel: p.travel, pace: p.pace, budget: p.budget, lang: p.lang }, trip: { id: t.id, title: t.title, dates: t.dateLabel }, lang: t.lang };
}

const ENDPOINT = (() => {
  const h = location.hostname;
  // the relay lives on the orbesmap Vercel project; theorbes.com/maps only serves the page
  return h.endsWith(".vercel.app") ? "/api/ai" : "https://orbesmap.vercel.app/api/ai";
})();

export class AiError extends Error {}

export type PhotoResult = {
  kind: "menu" | "panneau" | "etiquette" | "carte" | "ticket" | "autre";
  title: string;
  summary: string;
  lines: { zh: string; fr: string; price: number; note: string }[];
  picks: { name: string; why: string }[];
  avoid: { name: string; why: string }[];
  material: string;
  contact: { name: string; company: string; role: string; phone: string; wechat: string; email: string; address: string; addressCn: string };
};
export type InterpretResult = { translation: string; pinyin: string; note: string };
export type PlaceItem = {
  name: string;
  nameCn: string;
  address: string;
  addressCn: string;
  lat: number;
  lng: number;
  coordSystem: "WGS84" | "GCJ02" | "BD09" | "none";
  type: string;
  desc: string;
  why: string;
  hours: string;
  price: string;
  source: string;
  confidence: "haute" | "moyenne" | "faible";
};
export type PlacesResult = { kind: "precise" | "suggestions" | "not_found"; message: string; places: PlaceItem[] };
/** Full sheet of an added place (same fields as the programme's places + structured hours) */
export type EnrichResult = {
  nameCn: string;
  address: string;
  addressCn: string;
  type: string;
  desc: string;
  highlights: string[];
  tip: string;
  metro: string;
  website: string;
  durationMin: number;
  price: string;
  hours: { always: boolean; closed: number[]; open: string; close: string; lastEntry: string; breaks: { from: string; to: string }[]; byDay: { day: number; open: string; close: string }[]; reservation: string; confidence: string; note: string };
  source: string;
  confidence: "haute" | "moyenne" | "faible";
};

export type AiTask = "photo" | "interpret" | "place" | "ask" | "enrich" | "balance" | "extract" | "intake" | "outline" | "day" | "adjust" | "essentials";

/** A booking or appointment at a fixed time (read from a confirmation or the paste box) */
export type FixedItem = { kind: "reservation" | "rendez-vous" | "billet" | "autre"; name: string; date: string; time: string; endTime: string; address: string; notes: string; price?: number; currency?: string };
export type ExtractResult = {
  flights: { code: string; airline: string; from: string; to: string; fromCity: string; toCity: string; departAt: string; arriveAt: string; terminal: string; cabin?: string; price?: number; currency?: string }[];
  hotel: { name: string; address: string; addressCn: string; checkIn: string; checkOut: string; nights?: number; price?: number; currency?: string };
  bookingPrice?: number;
  bookingCurrency?: string;
  fixed: FixedItem[];
  notes: string;
};
export type IntakeResult = { places: { name: string; city: string; why: string; mustSee: boolean; source: string }[]; fixed: FixedItem[]; wishes: string[]; summary: string };
export type OutlineResult = { days: { date: string; theme: string; area: string; include: string[]; fixed: string[] }[]; notes: string };
export type DayPlace = {
  name: string; nameCn: string; address: string; addressCn: string; lat: number; lng: number; coordSystem: "WGS84" | "GCJ02" | "BD09" | "none";
  type: string; start: string; end: string; desc: string; why: string; tip: string; metro: string; website: string; source: string; fixed: boolean; confidence: "haute" | "moyenne" | "faible";
};
export type DayResult = { theme: string; places: DayPlace[] };
export type AdjustResult = { message: string; changes: { action: "remove" | "move" | "retime" | "add"; day: string; name: string; toDay: string; start: string; end: string; query: string; why: string }[] };
export type EssentialsResult = {
  lang: { code: string; name: string; speech: string };
  checklist: { text: string; due: string; group: string }[];
  phrases: { title: string; items: { local: string; romanized: string; fr: string }[] }[];
  emergency: { label: string; number: string; note: string }[];
  consulate: { name: string; address: string; phone: string; emergency: string; website: string };
  practical: { title: string; text: string }[];
};

export async function ai<T>(task: AiTask, payload: Record<string, unknown>, timeoutMs = 60_000, signal?: AbortSignal): Promise<T> {
  if (!navigator.onLine) throw new AiError(tr("Pas de réseau : cette fonction a besoin d'Internet."));
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
  if (!token) throw new AiError(tr("Connectez-vous dans l'onglet Compte pour utiliser cette fonction."));
  const ctl = new AbortController();
  let timedOut = false;
  const t = window.setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, timeoutMs);
  const onAbort = () => ctl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  // stopped while the session / image was being prepared: do not send the request
  if (signal?.aborted) {
    window.clearTimeout(t);
    throw new AiError(tr("Recherche arrêtée."));
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...(task === "balance" ? {} : aiContext()), task, ...payload }),
      signal: ctl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // a validated trip's programme, or the free trip of the month already used: the Pro screen opens
      if (body.error === "pro") requestPro(task === "outline" ? "prep" : "edit");
      throw new AiError(body.message ? tr(String(body.message)) : tr("Le service ne répond pas, réessayez."));
    }
    // the free trip of the month is now used: the account's plan says so
    if (task === "outline") void pullPlan();
    return body as T;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if ((e as Error)?.name === "AbortError") throw new AiError(timedOut ? tr("Trop long : le réseau est peut-être lent. Réessayez.") : tr("Recherche arrêtée."));
    throw new AiError(tr("Le service est injoignable (réseau ou VPN ?). Réessayez."));
  } finally {
    window.clearTimeout(t);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Photo → base64 JPEG small enough to send fast on mobile data (~150–300 KB). */
export function imageToBase64(file: Blob, max = 1400, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AiError(tr("Cette image ne peut pas être lue.")));
    };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", quality).split(",")[1]);
    };
    img.src = url;
  });
}
