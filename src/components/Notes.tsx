import { ago, noteKey, notesOf } from "../lib/notes";
import { currentAuthor, useStore } from "../lib/store";
import { SavedInput } from "./ui";
import { t } from "../lib/i18n";

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
      <span className="label">{t("Notes")}</span>
      {mineKey && (
        <label className="field">
          <span>{t("Ma note")}{mine?.at ? ` · ${ago(mine.at)}` : ""}</span>
          <SavedInput multiline value={mine?.text || ""} placeholder={placeholder} onSave={(v) => onSave(mineKey, v)} />
        </label>
      )}
      {others.map((n) => (
        <div key={n.key} className="note-other">
          <span className="note-by">{t("Note de {name}", { name: n.name })}{n.at ? ` · ${ago(n.at)}` : ""}</span>
          <p>{n.text}</p>
        </div>
      ))}
      {/* signed out: always the same single field (the shared note), so the keyboard never closes mid-typing */}
      {(legacy || !mineKey) && (
        <label className="field">
          <span>
            {legacy ? `${legacy.name ? t("Note commune (dernière modif. : {name})", { name: legacy.name }) : t("Note commune")}${legacy.at ? ` · ${ago(legacy.at)}` : ""}` : t("Note (connectez-vous pour signer vos notes)")}
          </span>
          <SavedInput multiline value={legacy?.text || ""} placeholder={placeholder} onSave={(v) => onSave("note", v)} />
        </label>
      )}
    </div>
  );
}
