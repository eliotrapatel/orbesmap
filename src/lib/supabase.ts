import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// The anon key is public by design: access is protected by Row Level Security (see supabase/schema.sql).
const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(URL && KEY);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(URL!, KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "orbes.auth" },
    })
  : null;

export const PHOTO_BUCKET = "photos";
