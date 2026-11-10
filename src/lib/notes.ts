// One note per person: each traveller writes in their own field (note_<author>), so the field-by-field
// merge never lets one person's note overwrite the other's. The former shared "note" field is kept and
// shown as "Note commune" so nothing written before is lost.
export type NoteEntry = { key: string; author: string; name: string; text: string; at?: number; mine: boolean; legacy: boolean };

/** Record key of an author's note */
export const noteKey = (author?: string | null) => (author ? "note_" + author.toLowerCase().replace(/[^a-z0-9]/g, "_") : null);

/** "eliot.rapatel" → "Eliot", "bertrandrapatel" → "Papa" */
export function authorName(author: string): string {
  if (/^eliot/i.test(author)) return "Eliot";
  if (/^bertrand/i.test(author)) return "Papa";
  return author || "Sans nom";
}

/**
 * All notes of a place state / record. `legacyText` lets pins pass their old note column.
 * Mine first, then the others, then the former shared note.
 */
export function notesOf(rec: Record<string, unknown> | undefined, me?: string | null, legacyText?: string): NoteEntry[] {
  const r = rec || {};
  const fa = (r.fieldsAt || {}) as Record<string, number>;
  const mine = noteKey(me);
  const out: NoteEntry[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (!k.startsWith("note_") || typeof v !== "string") continue;
    const author = k.slice(5);
    out.push({ key: k, author, name: authorName(author), text: v, at: fa[k], mine: k === mine, legacy: false });
  }
  out.sort((a, b) => Number(b.mine) - Number(a.mine) || a.name.localeCompare(b.name));
  const old = (legacyText ?? (r.note as string | undefined)) || "";
  if (old) {
    const by = (r.noteBy as string | undefined) || "";
    out.push({ key: "note", author: by, name: by ? authorName(by) : "", text: old, at: fa.note, mine: false, legacy: true });
  }
  return out;
}

/** "Eliot : … / Papa : …" for exports and the calendar */
export function notesText(rec: Record<string, unknown> | undefined, legacyText?: string, sep = " / "): string {
  return notesOf(rec, null, legacyText)
    .filter((n) => n.text.trim())
    .map((n) => `${n.legacy ? (n.name ? `${n.name} (commune)` : "Commune") : n.name} : ${n.text.trim()}`)
    .join(sep);
}

export function ago(at?: number): string {
  if (!at) return "";
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return new Date(at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
