// Several travellers on one trip: a vote on each place (one per person) and comments on each day.
// Votes live in the place's state, one field per person (vote_<author>), so two people voting at the same time never
// overwrite each other; comments are records like the check-list ("_cmt:<id>"), synced and merged field by field.
import { useMemo } from "react";
import { authorName } from "./notes";
import { currentAuthor, getState, updatePlace, updateRecord, useStore } from "./store";
import { track } from "./track";

const keyOf = (author: string) => author.toLowerCase().replace(/[^a-z0-9]/g, "_");
const me = () => currentAuthor() || "moi";
const myName = () => (getState().profile.name as string) || authorName(me());

export type Votes = { up: string[]; down: string[]; mine: 1 | -1 | 0 };
/** Who likes / does not like a place, and this person's vote */
export function votesOf(state: Record<string, unknown> | undefined): Votes {
  const out: Votes = { up: [], down: [], mine: 0 };
  const mine = "vote_" + keyOf(me());
  for (const [k, v] of Object.entries(state || {})) {
    if (!k.startsWith("vote_") || !v || typeof v !== "object") continue;
    const x = v as { v?: number; name?: string };
    const name = x.name || authorName(k.slice(5));
    if (x.v === 1) out.up.push(name);
    else if (x.v === -1) out.down.push(name);
    if (k === mine && (x.v === 1 || x.v === -1)) out.mine = x.v;
  }
  return out;
}
/** Votes for (1) or against (-1) a place; the same vote again takes it back */
export function vote(placeId: string, v: 1 | -1) {
  const k = "vote_" + keyOf(me());
  const cur = (getState().data.places[placeId] as Record<string, unknown> | undefined)?.[k] as { v?: number } | undefined;
  updatePlace(placeId, { [k]: cur?.v === v ? null : { v, name: myName() } } as never);
  if (cur?.v !== v) track("vote", v === 1 ? "for" : "against", getState().tripId);
}

export type Comment = { id: string; day: string; text: string; author: string; name: string; at: number; mine: boolean };
const PREFIX = "_cmt:";
/** Comments of the trip, oldest first (`day` given: that day's only) */
export function commentsOf(records: Record<string, Record<string, unknown>>, day?: string): Comment[] {
  const mine = me();
  const out: Comment[] = [];
  for (const [k, r] of Object.entries(records)) {
    if (!k.startsWith(PREFIX) || !r || r.deleted === true || typeof r.text !== "string" || !r.text.trim()) continue;
    if (day && r.day !== day) continue;
    const author = String(r.author || "");
    out.push({ id: k.slice(PREFIX.length), day: String(r.day || ""), text: r.text, author, name: String(r.name || authorName(author)), at: Number(r.at) || 0, mine: author === mine });
  }
  return out.sort((a, b) => a.at - b.at);
}
export function useComments(day: string): Comment[] {
  const records = useStore((s) => s.data.places);
  return useMemo(() => commentsOf(records as Record<string, Record<string, unknown>>, day), [records, day]);
}
export function addComment(day: string, text: string) {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  updateRecord(PREFIX + id, { day, text: text.trim().slice(0, 1000), author: me(), name: myName(), at: Date.now() });
  track("comment_added", null, getState().tripId);
}
export const deleteComment = (id: string) => updateRecord(PREFIX + id, { deleted: true });
