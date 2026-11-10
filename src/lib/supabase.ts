import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The publishable (anon) key is public by design: it ships in the page anyway, and access is
// protected by Row Level Security (see supabase/schema.sql). Env vars override these defaults.
const DEFAULT_URL = "https://ifugaqjneprbtigvegeb.supabase.co";
const DEFAULT_KEY = "sb_publishable_0qPu_8XZTLk-l68k2kPUvQ_7UXk-fCu";
const RAW_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || DEFAULT_URL;
const KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || DEFAULT_KEY;

function validUrl(u?: string): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.hostname === "localhost" || url.hostname === "127.0.0.1" ? url.origin : null;
  } catch {
    return null;
  }
}

function make(): SupabaseClient | null {
  const url = validUrl(RAW_URL);
  if (!url || !KEY) {
    if (RAW_URL || KEY) console.warn("[orbes] Supabase configuration is incomplete or invalid — running on this device only.");
    return null;
  }
  try {
    return createClient(url, KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "orbes.auth" },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  } catch (e) {
    console.warn("[orbes] Supabase client could not start — running on this device only.", e);
    return null;
  }
}

export const supabase: SupabaseClient | null = make();
export const supabaseConfigured = Boolean(supabase);
export const PHOTO_BUCKET = "photos";
