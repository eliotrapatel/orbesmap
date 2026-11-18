import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import OrbitMark from "./OrbitMark";
import type { Trip } from "../data/types";
import { clock, phase } from "../lib/time";
import { useWeather } from "../lib/weather";
import { useSyncState } from "./Account";
import { ICal, IChevron, IGrid, IInfo, IPlane, ISearch, IUser, ICheck, ITranslate, IChecklist, ISos, IAsk } from "./Icons";
import { WxIcon } from "./WxIcon";
import { useChecklist } from "./Checklist";
import { useStore, useTrips, useCanEdit } from "../lib/store";
import { openHome, openShare } from "./v3/nav";
import { supabaseConfigured } from "../lib/supabase";
import { useOffline } from "../lib/offline";
import { useEscape } from "./ui";
import { t } from "../lib/i18n";
import { setMode } from "../lib/business";

export type ToolKey = "overview" | "agenda" | "ask" | "translate" | "phrases" | "converter" | "expenses" | "checklist" | "flights" | "practical" | "emergency" | "export" | "account";

export const TOOLS: { key: ToolKey; label: string; icon: React.ReactElement; wide?: boolean }[] = [
  { key: "overview", label: "Aperçu", icon: <IGrid />, wide: true },
  { key: "agenda", label: "Agenda", icon: <ICal /> },
  { key: "ask", label: "Concierge", icon: <IAsk /> },
  { key: "translate", label: "Traduire", icon: <ITranslate /> },
  { key: "emergency", label: "Urgence", icon: <ISos /> },
  { key: "converter", label: "Devises", icon: <span style={{ fontWeight: 600, fontSize: 15, lineHeight: 1 }}>¥</span> },
  { key: "expenses", label: "Dépenses", icon: <span style={{ fontWeight: 600, fontSize: 15, lineHeight: 1 }}>€</span> },
  { key: "checklist", label: "Check-list", icon: <IChecklist /> },
  { key: "flights", label: "Vols", icon: <IPlane /> },
  { key: "practical", label: "Infos", icon: <IInfo /> },
  { key: "account", label: "Compte", icon: <IUser /> },
];

/** The tools shown for a trip: "Infos" only when the trip has practical information */
export const toolsFor = (trip: Trip) => TOOLS.filter((tl) => tl.key !== "practical" || !!trip.practical?.length);

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
  const trips = useTrips();
  const signedIn = useStore((s) => !!s.session);
  const canEditTrip = useCanEdit(trip.id);
  useEscape(onClose);
  useEffect(() => {
    const f = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    setTimeout(() => document.addEventListener("mousedown", f), 0);
    return () => document.removeEventListener("mousedown", f);
  }, [onClose]);
  return (
    <div ref={ref} className="menu glass" role="menu" style={{ top: (anchor?.bottom ?? 60) + 8, left: Math.max(8, Math.min(anchor?.left ?? 12, window.innerWidth - 316)) }}>
      {trips.map((tp) => {
        const ph = phase(tp);
        return (
          <button key={tp.id} role="menuitemradio" aria-checked={tp.id === trip.id} className={"menu-item" + (tp.id === trip.id ? " on" : "")} onClick={() => onPick(tp.id)}>
            <span>
              <span className="label">{tp.code}</span>
              <small>
                {tp.title} · {tp.dateLabel} · {ph === "before" ? t("à venir") : ph === "during" ? t("en cours") : t("terminé")}
              </small>
            </span>
            {tp.id === trip.id && <ICheck className="chk" />}
          </button>
        );
      })}
      {signedIn && <button role="menuitem" className="menu-item menu-home" onClick={() => { onClose(); openShare(); }}>
        <span>
          <span className="label">{t("Partager ce voyage")}</span>
          <small>{t("Inviter par e-mail · modifier ou lecture seule")}</small>
        </span>
      </button>}
      {canEditTrip && (
        <button role="menuitemcheckbox" aria-checked={trip.mode === "business"} className="menu-item" onClick={() => { onClose(); setMode(trip, trip.mode === "business" ? "leisure" : "business"); }}>
          <span>
            <span className="label">{t("Mode affaires")} <span className="pro-tag">PRO</span></span>
            <small>{trip.mode === "business" ? t("Activé · fournisseurs, rendez-vous, comptes-rendus") : t("Fournisseurs, rendez-vous, dépenses par fournisseur, comptes-rendus")}</small>
          </span>
          {trip.mode === "business" && <ICheck className="chk" />}
        </button>
      )}
      <button role="menuitem" className="menu-item" onClick={() => { onClose(); openHome(); }}>
        <span>
          <span className="label">{t("Mes voyages")}</span>
          <small>{t("Tous vos voyages · créer un voyage")}</small>
        </span>
      </button>
    </div>
  );
}

/** Always-visible sync state: is everything saved and shared? Tap opens Compte. */
function useOnline() {
  return useSyncExternalStore(
    (f) => {
      window.addEventListener("online", f);
      window.addEventListener("offline", f);
      return () => {
        window.removeEventListener("online", f);
        window.removeEventListener("offline", f);
      };
    },
    () => navigator.onLine,
  );
}

function SyncPill({ onOpen, onOffline }: { onOpen: () => void; onOffline: () => void }) {
  const sync = useSyncState();
  const online = useOnline();
  const map = useOffline();
  const pending = useStore((s) => s.pending);
  const syncedAt = useStore((s) => s.syncedAt);
  const now = useNow(30_000).getTime();
  if (!supabaseConfigured) return null;
  const ago = syncedAt ? Math.max(0, Math.round((now - syncedAt) / 60000)) : null;
  const agoTxt = ago == null ? "" : ago < 1 ? t("à l'instant") : ago < 60 ? t("il y a {n} min", { n: ago }) : t("il y a {n} h", { n: Math.round(ago / 60) });
  const mapHint = map.state === "ready" ? t("carte disponible") : t("carte : seulement les quartiers déjà vus (mode hors ligne désactivé)");
  const s = !online
    ? { tone: "off", short: t("Hors ligne"), long: (pending ? (pending > 1 ? t("Pas de réseau · {n} modifications partiront au retour du réseau", { n: pending }) : t("Pas de réseau · 1 modification partira au retour du réseau")) : t("Pas de réseau · votre voyage est sur ce téléphone")) + " · " + mapHint }
    : sync === "local"
      ? { tone: "off", short: t("Local"), long: t("Sur ce téléphone seulement (pas connecté)") }
      : sync === "denied"
        ? { tone: "bad", short: t("Accès refusé"), long: t("Ce compte n'a pas accès à l'espace partagé") }
        : sync === "syncing"
          ? { tone: "busy", short: pending ? t("Envoi ({n})…", { n: pending }) : t("Synchro…"), long: pending ? (pending > 1 ? t("{n} modifications en cours d'envoi", { n: pending }) : t("{n} modification en cours d'envoi", { n: pending })) : t("Synchronisation en cours…") }
          : sync === "pending" || sync === "error" || pending > 0
            ? { tone: "warn", short: pending ? t("En attente ({n})", { n: pending }) : t("Nouvel essai…"), long: pending ? (pending > 1 ? t("{n} modifications en attente d'envoi (réseau)", { n: pending }) : t("{n} modification en attente d'envoi (réseau)", { n: pending })) : t("Envoi en attente, nouvel essai automatique") }
            : { tone: "ok", short: t("À jour"), long: agoTxt ? t("Synchronisé {ago}", { ago: agoTxt }) : t("Synchronisé") };
  return (
    <button className={"sync-pill " + s.tone} onClick={online ? onOpen : onOffline} title={s.long} aria-label={t("{state}. Ouvrir Compte", { state: s.long })}>
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
  const toolBtn = (tl: (typeof TOOLS)[number], mobile = false) => (
    <button key={tl.key} className={"tool" + (tool === tl.key ? " on" : "")} onClick={() => onTool(tl.key)} aria-pressed={tool === tl.key} title={t(tl.label)}>
      {tl.icon}
      <span className={mobile ? "tool-txt" : "tool-txt"}>{t(tl.label)}</span>
      {tl.key === "account" && (sync === "error" || sync === "pending" || sync === "denied") && <span className="badge-dot" />}
      {tl.key === "checklist" && todo > 0 && ph === "before" && <span className="badge-num">{todo}</span>}
    </button>
  );
  return (
    <>
      <header className="topbar glass">
        <div className="tb-brand">
          <button className="brand-mark" onClick={onHome} aria-label={t("ORBES Trips, retour à l'accueil")}>
            <OrbitMark size={22} />
          </button>
          <span className="tb-sep" aria-hidden="true" />
          <button className="trip-btn" aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => setMenu(menu ? null : e.currentTarget.getBoundingClientRect())}>
            <span className="label">{trip.code}</span>
            <IChevron />
          </button>
          <SyncPill onOpen={() => onTool("account")} onOffline={() => onTool("account")} />
        </div>
        <button className="tb-search" onClick={onSearch} aria-label={t("Rechercher")}>
          <ISearch />
          <span className="tb-s-short">{t("Rechercher")}</span>
          <span className="tb-s-long">{t("Rechercher un lieu, une action…")}</span>
          <span className="kbd">{isMac ? "⌘K" : "Ctrl K"}</span>
        </button>
        <nav className="tb-tools" aria-label={t("Outils")}>{toolsFor(trip).map((tl) => toolBtn(tl))}</nav>
        <div className="tb-meta" aria-label={t("Heure à {city} et à Paris", { city: trip.title })}>
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
      <nav className="m-tools glass" aria-label={t("Outils")}>{toolsFor(trip).map((tl) => toolBtn(tl, true))}</nav>
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
