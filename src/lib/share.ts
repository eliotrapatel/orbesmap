// Sharing a trip: its travellers (owner, editors, readers) and the invitations by e-mail waiting for someone
// to sign in with that address (supabase/saas-3.sql). Online only: these lists are read from the server.
import { supabase } from "./supabase";

export type Person = { user_id: string; email: string; name: string; role: "owner" | "editor" | "viewer" };
export type Invite = { email: string; role: "editor" | "viewer"; created_at: string };

const sb = () => {
  if (!supabase) throw new Error("Partage indisponible hors connexion.");
  return supabase;
};
const fail = (e: { message?: string; code?: string } | null, what: string) => {
  if (!e) return;
  if (e.code === "42501" || /row-level security|permission/i.test(e.message || "")) throw new Error("Seul le propriétaire du voyage peut faire cela.");
  if (/trip_invites|trip_people|accept_invites/.test(e.message || "") && /exist|find/i.test(e.message || "")) throw new Error("Le partage n'est pas encore activé sur le serveur.");
  throw new Error(`${what} n'a pas pu être fait. Vérifiez le réseau et réessayez.`);
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
  if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error("Adresse e-mail invalide.");
  const { error } = await sb().from("trip_invites").upsert({ trip_id: tripId, email: e, role });
  fail(error, "L'invitation");
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
  `${inviter ? `${inviter} vous invite` : "Vous êtes invité"} à rejoindre le voyage « ${tripTitle} » sur ORBES Trips. Ouvrez https://orbesmap.vercel.app et connectez-vous avec cette adresse e-mail : le voyage apparaîtra dans « Mes voyages ».`;
