import { ago, noteKey, notesOf } from "../lib/notes";
import { currentAuthor, useStore } from "../lib/store";
import { SavedInput } from "./ui";

/**
 * One note per person. "Ma note" is mine (editable); the other traveller's note is shown read-only
 * with its author and time; the former shared note stays editable so nothing is lost.
 */
export default function Notes({ rec, legacyText, placeholder, onSave }: { rec: Record<string, unknown> | undefined; legacyText?: string; placeholder: string; onSave: (key: string, text: string) => void }) {
  useStore((s) => s.session); // re-render when signing in / out
  const me = currentAuthor();
  const mineKey = noteKey(me);
  const all = notesOf(rec, me, legacyText);
  const mine = all.find((n) => n.mine);
  const others = all.filter((n) => !n.mine && !n.legacy && n.text.trim());
  const legacy = all.find((n) => n.legacy);
  return (
    <div className="sec">
      <span className="label">Notes</span>
      {mineKey ? (
        <label className="field">
          <span>Ma note{mine?.at ? ` · ${ago(mine.at)}` : ""}</span>
          <SavedInput multiline value={mine?.text || ""} placeholder={placeholder} onSave={(v) => onSave(mineKey, v)} />
        </label>
      ) : (
        !legacy && <SavedInput multiline value="" placeholder={`${placeholder} (connectez-vous pour signer vos notes)`} onSave={(v) => onSave("note", v)} />
      )}
      {others.map((n) => (
        <div key={n.key} className="note-other">
          <span className="note-by">Note de {n.name}{n.at ? ` · ${ago(n.at)}` : ""}</span>
          <p>{n.text}</p>
        </div>
      ))}
      {legacy && (
        <label className="field">
          <span>Note commune{legacy.name ? ` (dernière modif. : ${legacy.name})` : ""}{legacy.at ? ` · ${ago(legacy.at)}` : ""}</span>
          <SavedInput multiline value={legacy.text} placeholder={placeholder} onSave={(v) => onSave("note", v)} />
        </label>
      )}
    </div>
  );
}
