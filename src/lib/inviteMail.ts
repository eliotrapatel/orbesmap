// The invitation sent by the server (api/mail.ts, lot cycle R09): an e-mail with a private link to the trip, and the
// same link in the message the inviter sends himself (share sheet, WhatsApp). Before supabase/saas-14.sql (or
// without network) the answer says so and the app keeps today's message (lib/share.ts, unchanged).
import { supabase } from "./supabase";
import { apiUrl } from "./ai";
import { getLang, t } from "./i18n";
import { sendInviteMessage, whatsappInviteUrl } from "./share";
import { toast } from "./store";

export type InviteMailResult = { link: string | null; sent: boolean; fallback: boolean; optout: boolean; capped: boolean; failed: boolean; already: boolean };
const none = (over: Partial<InviteMailResult> = {}): InviteMailResult => ({ link: null, sent: false, fallback: false, optout: false, capped: false, failed: false, already: false, ...over });

/** Sends the invitation e-mail (`send`), or only asks for the trip's link; the invitation itself must exist (invite()) */
export async function sendInvite(tripId: string, email: string, send: boolean): Promise<InviteMailResult> {
  if (!supabase) return none({ fallback: true });
  const ctl = new AbortController();
  const tm = window.setTimeout(() => ctl.abort(), 12000);
  try {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    if (!token) return none({ fallback: true });
    const r = await fetch(apiUrl("mail"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: send ? "invite" : "link", trip: tripId, email: email.trim().toLowerCase(), lang: getLang() }),
      signal: ctl.signal,
    });
    // the function not deployed yet: today's message
    if (r.status === 404 && !(r.headers.get("content-type") || "").includes("json")) return none({ fallback: true });
    const j = (await r.json().catch(() => ({}))) as Partial<InviteMailResult> & { error?: string };
    if (j.fallback) return none({ fallback: true });
    const link = typeof j.link === "string" && j.link.startsWith("https://") ? j.link : null;
    if (!r.ok || !link) return none({ failed: send, fallback: !link });
    return none({ link, sent: !!j.sent, optout: !!j.optout, capped: !!j.capped, failed: !!j.failed, already: !!j.already });
  } catch {
    return none({ failed: send, fallback: true });
  } finally {
    window.clearTimeout(tm);
  }
}

/** The invitation message with the trip's own link */
export const inviteText = (title: string, inviter: string, link: string) =>
  inviter ? t("{inviter} vous invite à rejoindre le voyage « {title} » sur ORBES Trips : {link}", { inviter, title, link }) : t("Vous êtes invité à rejoindre le voyage « {title} » sur ORBES Trips : {link}", { title, link });
export const whatsappUrl = (title: string, inviter: string, link: string | null) => (link ? `https://wa.me/?text=${encodeURIComponent(inviteText(title, inviter, link))}` : whatsappInviteUrl(title, inviter));

/** The phone's share sheet (else a copy), with the link when there is one, else today's message */
export async function shareInvite(title: string, inviter: string, to: string, link: string | null) {
  if (!link) return sendInviteMessage(title, inviter, to);
  const msg = inviteText(title, inviter, link);
  try {
    if (navigator.share) {
      await navigator.share({ title: `ORBES Trips · ${title}`, text: msg });
      return;
    }
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(msg);
    toast(t("Message copié : envoyez-le à {to}", { to }));
  } catch {
    toast(t("Copie impossible : sélectionnez le message à la main"));
  }
}

/** The line under an invitation once the server answered (null = today's line) */
export function inviteNote(r: InviteMailResult | undefined, email: string): string | null {
  if (!r || r.fallback) return null;
  if (r.sent || r.already) return t("E-mail envoyé à {email}. Le voyage s'ouvrira dès son inscription.", { email });
  if (r.capped) return t("Limite d'e-mails du jour atteinte : envoyez-lui le lien vous-même.");
  if (r.optout) return t("Cette personne ne reçoit plus nos e-mails : envoyez-lui le lien vous-même.");
  if (r.failed) return t("L'e-mail n'a pas pu partir : envoyez-lui le lien vous-même.");
  return null;
}
