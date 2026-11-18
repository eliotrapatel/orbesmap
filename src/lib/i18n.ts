// French / English. The French text is the key: t("Mes voyages") gives "My trips" in English, the same text in French.
// The language is the account's (profile "lang", set at onboarding or in the account menu); before signing in, the
// one chosen on the public page, else the phone's. English texts live in src/i18n/en/*.ts ({ "français": "English" }).
import { getState, updateProfile, useStore } from "./store";
import { supabase } from "./supabase";
import { track } from "./track";

export type Lang = "fr" | "en";

const files = import.meta.glob<{ default: Record<string, string> }>("../i18n/en/*.ts", { eager: true });
const EN: Record<string, string> = Object.assign({}, ...Object.values(files).map((m) => m.default));

const LANG_KEY = "orbes.lang";
const deviceLang = (): Lang => {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    /* ignore */
  }
  return (navigator.language || "fr").toLowerCase().startsWith("fr") ? "fr" : "en";
};
const langOfProfile = (p: Record<string, unknown>): Lang | null => (p.lang === "en" || p.lang === "fr" ? p.lang : null);

/** The language shown now */
export function getLang(): Lang {
  return langOfProfile(getState().profile) || deviceLang();
}
/** Re-renders when the language changes */
export const useLang = (): Lang => useStore((s) => langOfProfile(s.profile) || deviceLang());

/** Changes the language (the account's when signed in, this device's otherwise) */
export function setLang(l: Lang) {
  track("language_changed", l);
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* ignore */
  }
  if (getState().session) {
    updateProfile({ lang: l });
    // the sign-in e-mails read the account's language (supabase/email-templates.md)
    void supabase?.auth.updateUser({ data: { lang: l } }).catch(() => undefined);
  } else location.reload();
}

/** The text in the language shown; {name} in the text is replaced by vars.name */
export function t(fr: string, vars?: Record<string, string | number | null | undefined>): string {
  let s = getLang() === "en" ? (EN[fr] ?? fr) : fr;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] == null ? m : String(vars[k])));
  return s;
}
/** Same as t(), for a French word with two meanings: the English comes from `id` (e.g. "pricing" for "Prix") */
export function tk(id: string, fr: string): string {
  return getLang() === "en" ? (EN[id] ?? EN[fr] ?? fr) : fr;
}
/** The locale for dates and numbers */
export const locale = (): string => (getLang() === "en" ? "en-GB" : "fr-FR");
