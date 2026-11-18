// Sharing a trip: its travellers (owner, editors, readers) and the invitations by e-mail waiting for someone
// to sign in with that address (supabase/saas-3.sql). Online only: these lists are read from the server.
import { supabase } from "./supabase";
import { track } from "./track";
import { t } from "./i18n";
import { toast } from "./store";

export type Person = { user_id: string; email: string; name: string; role: "owner" | "editor" | "viewer" };
export type Invite = { email: string; role: "editor" | "viewer"; created_at: string };

const sb = () => {
  if (!supabase) throw new Error(t("Partage indisponible hors connexion."));
  return supabase;
};
const fail = (e: { message?: string; code?: string } | null, what: string) => {
  if (!e) return;
  if (e.code === "42501" || /row-level security|permission/i.test(e.message || "")) throw new Error(t("Seul le propriétaire du voyage peut faire cela."));
  if (/trip_invites|trip_people|accept_invites/.test(e.message || "") && /exist|find/i.test(e.message || "")) throw new Error(t("Le partage n'est pas encore activé sur le serveur."));
  throw new Error(t("{what} n'a pas pu être fait. Vérifiez le réseau et réessayez.", { what: t(what) }));
};

export async function people(tripId: string): Promise<Person[]> {
  const { data, error } = await sb().rpc("trip_people", { t: tripId });
  fail(error, "La lecture des voyageurs");
  return (data || []) as Person[];
}
export async function invites(tripId: string): Promise<Invite[]> {
  const { data, error } = await sb().from("trip_invites").select("email,role,created_at").eq("trip_id", tripId).order("created_at");
  fail(error, "La lecture des invitations");
  return (data || []) as Invite[];
}
export async function invite(tripId: string, email: string, role: Invite["role"]) {
  const e = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error(t("Adresse e-mail invalide."));
  const uid = (await sb().auth.getSession()).data.session?.user.id;
  const { error } = await sb().from("trip_invites").upsert({ trip_id: tripId, email: e, role, invited_by: uid });
  fail(error, "L'invitation");
  track("invite_sent", role, tripId);
}
export async function removeInvite(tripId: string, email: string) {
  const { error } = await sb().from("trip_invites").delete().eq("trip_id", tripId).eq("email", email);
  fail(error, "Le retrait de l'invitation");
}
export async function removePerson(tripId: string, userId: string) {
  const { error } = await sb().from("trip_members").delete().eq("trip_id", tripId).eq("user_id", userId);
  fail(error, "Le retrait du voyageur");
}
export async function setRole(tripId: string, userId: string, role: "editor" | "viewer") {
  const { error } = await sb().from("trip_members").update({ role }).eq("trip_id", tripId).eq("user_id", userId);
  fail(error, "Le changement de rôle");
}
/** The invitations of this account become trips it can open; returns how many */
export async function acceptInvites(): Promise<number> {
  if (!supabase) return 0;
  const { data, error } = await supabase.rpc("accept_invites");
  if (error) return 0;
  return Number(data) || 0;
}
/** The message to send to someone invited (by any messaging app) */
export const inviteMessage = (tripTitle: string, inviter: string) =>
  inviter
    ? t("{inviter} vous invite à rejoindre le voyage « {title} » sur ORBES Trips. Ouvrez https://orbesmap.vercel.app et connectez-vous avec cette adresse e-mail : le voyage apparaîtra dans « Mes voyages ».", { inviter, title: tripTitle })
    : t("Vous êtes invité à rejoindre le voyage « {title} » sur ORBES Trips. Ouvrez https://orbesmap.vercel.app et connectez-vous avec cette adresse e-mail : le voyage apparaîtra dans « Mes voyages ».", { title: tripTitle });

/** Sends the invitation message by the phone's share sheet when there is one, else copies it
 * (the same way as "Partager" → "Envoyer l'invitation"). `to` names the person in the copy notice. */
export async function sendInviteMessage(tripTitle: string, inviter: string, to: string) {
  const msg = inviteMessage(tripTitle, inviter);
  try {
    if (navigator.share) {
      await navigator.share({ title: `ORBES Trips · ${tripTitle}`, text: msg });
      return;
    }
  } catch (e) {
    // closed by the user: nothing to do; any other failure: the message is copied instead
    if ((e as Error)?.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(msg);
    toast(t("Message copié : envoyez-le à {to}", { to }));
  } catch {
    toast(t("Copie impossible : sélectionnez le message à la main"));
  }
}
/** The same invitation message, ready in WhatsApp (the person is chosen there) */
export const whatsappInviteUrl = (tripTitle: string, inviter: string) =>
  `https://wa.me/?text=${encodeURIComponent(inviteMessage(tripTitle, inviter))}`;
