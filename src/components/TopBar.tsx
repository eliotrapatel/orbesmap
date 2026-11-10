import { useEffect, useRef, useState } from "react";
import OrbitMark from "./OrbitMark";
import { TRIPS } from "../data/trip";
import type { Trip } from "../data/types";
import { clock, phase } from "../lib/time";
import { useWeather } from "../lib/weather";
import { useSyncState } from "./Account";
import { ICal, IChat, IChevron, IDownload, IGrid, IInfo, IPlane, ISearch, IUser, ICheck, ITranslate, IChecklist, ISos, IAsk } from "./Icons";
import { WxIcon } from "./WxIcon";
import { useChecklist } from "./Checklist";
import { useStore } from "../lib/store";
import { supabaseConfigured } from "../lib/supabase";
import { useEscape } from "./ui";

export type ToolKey = "overview" | "agenda" | "ask" | "translate" | "phrases" | "converter" | "checklist" | "flights" | "practical" | "emergency" | "export" | "account";

export const TOOLS: { key: ToolKey; label: string; icon: React.ReactElement; wide?: boolean }[] = [
  { key: "overview", label: "Aperçu", icon: <IGrid />, wide: true },
  { key: "agenda", label: "Agenda", icon: <ICal /> },
  { key: "ask", label: "Demander", icon: <IAsk /> },
  { key: "translate", label: "Traduire", icon: <ITranslate /> },
  { key: "emergency", label: "Urgence", icon: <ISos /> },
  { key: "phrases", label: "Phrases", icon: <IChat /> },
  { key: "converter", label: "Devises", icon: <span style={{ fontWeight: 600, fontSize: 15, lineHeight: 1 }}>¥</span> },
  { key: "checklist", label: "Check-list", icon: <IChecklist /> },
  { key: "flights", label: "Vols", icon: <IPlane /> },
  { key: "practical", label: "Infos", icon: <IInfo /> },
  { key: "export", label: "Export", icon: <IDownload /> },
  { key: "account", label: "Compte", icon: <IUser /> },
];

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function TripMenu({ trip, onPick, onClose, anchor }: { trip: Trip; onPick: (id: string) => void; onClose: () => void; anchor: DOMRect | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useEffect(() => {
    const f = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    setTimeout(() => document.addEventListener("mousedown", f), 0);
    return () => document.removeEventListener("mousedown", f);
  }, [onClose]);
  return (
    <div ref={ref} className="menu glass" role="menu" style={{ top: (anchor?.bottom ?? 60) + 8, left: Math.max(8, Math.min(anchor?.left ?? 12, window.innerWidth - 316)) }}>
      {TRIPS.map((t) => {
        const ph = phase(t);
        return (
          <button key={t.id} role="menuitemradio" aria-checked={t.id === trip.id} className={"menu-item" + (t.id === trip.id ? " on" : "")} onClick={() => onPick(t.id)}>
            <span>
              <span className="label">{t.code}</span>
              <small>
                {t.title} · {t.dateLabel} · {ph === "before" ? "à venir" : ph === "during" ? "en cours" : "terminé"}
              </small>
            </span>
            {t.id === trip.id && <ICheck className="chk" />}
          </button>
        );
      })}
    </div>
  );
}

/** Always-visible sync state: is everything saved and shared? Tap opens Compte. */
function SyncPill({ onOpen }: { onOpen: () => void }) {
  const sync = useSyncState();
  const pending = useStore((s) => s.pending);
  const syncedAt = useStore((s) => s.syncedAt);
  const now = useNow(30_000).getTime();
  if (!supabaseConfigured) return null;
  const ago = syncedAt ? Math.max(0, Math.round((now - syncedAt) / 60000)) : null;
  const agoTxt = ago == null ? "" : ago < 1 ? "à l'instant" : ago < 60 ? `il y a ${ago} min` : `il y a ${Math.round(ago / 60)} h`;
  const s =
    sync === "local"
      ? { tone: "off", short: "Local", long: "Sur ce téléphone seulement (pas connecté)" }
      : sync === "denied"
        ? { tone: "bad", short: "Accès refusé", long: "Ce compte n'a pas accès à l'espace partagé" }
        : sync === "syncing"
          ? { tone: "busy", short: pending ? `Envoi (${pending})…` : "Synchro…", long: pending ? `${pending} modification${pending > 1 ? "s" : ""} en cours d'envoi` : "Synchronisation en cours…" }
          : sync === "pending" || sync === "error" || pending > 0
            ? { tone: "warn", short: pending ? `En attente (${pending})` : "Nouvel essai…", long: pending ? `${pending} modification${pending > 1 ? "s" : ""} en attente d'envoi (réseau)` : "Envoi en attente, nouvel essai automatique" }
            : { tone: "ok", short: "À jour", long: `Synchronisé${agoTxt ? ` ${agoTxt}` : ""}` };
  return (
    <button className={"sync-pill " + s.tone} onClick={onOpen} title={s.long} aria-label={`${s.long}. Ouvrir Compte`}>
      <i />
      <span className="sp-short">{s.short}</span>
      <span className="sp-long">{s.long}</span>
    </button>
  );
}

export default function TopBar({ trip, tool, onTool, onSearch, onTrip, onHome }: { trip: Trip; tool: ToolKey | null; onTool: (k: ToolKey) => void; onSearch: () => void; onTrip: (id: string) => void; onHome: () => void }) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const now = useNow();
  const wx = useWeather(trip.center[1], trip.center[0], trip.timezone);
  const sync = useSyncState();
  const todo = useChecklist(trip).filter((i) => !i.done).length;
  const ph = phase(trip);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const toolBtn = (t: (typeof TOOLS)[number], mobile = false) => (
    <button key={t.key} className={"tool" + (tool === t.key ? " on" : "")} onClick={() => onTool(t.key)} aria-pressed={tool === t.key} title={t.label}>
      {t.icon}
      <span className={mobile ? "tool-txt" : "tool-txt"}>{t.label}</span>
      {t.key === "account" && (sync === "error" || sync === "pending" || sync === "denied") && <span className="badge-dot" />}
      {t.key === "checklist" && todo > 0 && ph === "before" && <span className="badge-num">{todo}</span>}
    </button>
  );
  return (
    <>
      <header className="topbar glass">
        <div className="tb-brand">
          <button className="brand-mark" onClick={onHome} aria-label="ORBES Trips, retour à l'accueil">
            <OrbitMark size={22} />
          </button>
          <span className="tb-sep" aria-hidden="true" />
          <button className="trip-btn" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}>
            <span className="label">{trip.code}</span>
            <IChevron />
          </button>
          <SyncPill onOpen={() => onTool("account")} />
        </div>
        <button className="tb-search" onClick={onSearch} aria-label="Rechercher">
          <ISearch />
          <span>Rechercher un lieu, une phrase, une action…</span>
          <span className="kbd">{isMac ? "⌘K" : "Ctrl K"}</span>
        </button>
        <nav className="tb-tools" aria-label="Outils">{TOOLS.map((t) => toolBtn(t))}</nav>
        <div className="tb-meta" aria-label={`Heure à ${trip.title} et à Paris`}>
          <span>
            {trip.title} <b>{clock(trip.timezone, now)}</b>
          </span>
          <span>
            Paris <b>{clock("Europe/Paris", now)}</b>
          </span>
          {wx?.now && (
            <span className="wx">
              <WxIcon code={wx.now.code} />
              <b>{wx.now.temp}°</b>
            </span>
          )}
        </div>
      </header>
      <nav className="m-tools glass" aria-label="Outils">{TOOLS.map((t) => toolBtn(t, true))}</nav>
      {menu && (
        <TripMenu
          trip={trip}
          anchor={menu}
          onClose={() => setMenu(null)}
          onPick={(id) => {
            setMenu(null);
            onTrip(id);
          }}
        />
      )}
    </>
  );
}
