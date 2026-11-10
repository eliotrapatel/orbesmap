// Calls the ORBES AI relay (api/ai.ts on Vercel). Only members of the shared space can use it.
import { supabase } from "./supabase";

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

export async function ai<T>(task: "photo" | "interpret" | "place", payload: Record<string, unknown>, timeoutMs = 60_000): Promise<T> {
  if (!navigator.onLine) throw new AiError("Pas de réseau : cette fonction a besoin d'Internet.");
  const token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : null;
  if (!token) throw new AiError("Connectez-vous dans l'onglet Compte pour utiliser cette fonction.");
  const ctl = new AbortController();
  const t = window.setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ task, ...payload }),
      signal: ctl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new AiError(body.message || "Le service ne répond pas, réessayez.");
    return body as T;
  } catch (e) {
    if (e instanceof AiError) throw e;
    if ((e as Error)?.name === "AbortError") throw new AiError("Trop long : le réseau est peut-être lent. Réessayez.");
    throw new AiError("Le service est injoignable (réseau ou VPN ?). Réessayez.");
  } finally {
    window.clearTimeout(t);
  }
}

/** Photo → base64 JPEG small enough to send fast on mobile data (~150–300 KB). */
export function imageToBase64(file: Blob, max = 1400, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AiError("Cette image ne peut pas être lue."));
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
