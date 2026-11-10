import { useEffect, useMemo, useRef, useState } from "react";
import { TRIPS, TYPE_LABEL } from "../data/trip";
import type { Place, Trip } from "../data/types";
import type { Pin } from "../lib/model";
import { ICube, ILocate, IPin, IPinPlus, ISearch, ISpeaker } from "./Icons";
import { TOOLS, type ToolKey } from "./TopBar";
import { Portal, speak, useEscape } from "./ui";

type Item = { id: string; section: string; title: string; sub?: string; icon: React.ReactNode; run: () => void; text: string };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function CommandPalette(p: {
  trip: Trip;
  pins: Pin[];
  onClose: () => void;
  onPlace: (pl: Place) => void;
  onPin: (pin: Pin) => void;
  onTool: (k: ToolKey) => void;
  onTrip: (id: string) => void;
  onDay: (d: string) => void;
  onToggle3D: () => void;
  onLocate: () => void;
  onAddPin: () => void;
  onZone: (center: [number, number], zoom: number) => void;
}) {
  useEscape(p.onClose);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const items = useMemo<Item[]>(() => {
    const day = (k: string) => p.trip.days.find((d) => d.key === k);
    const out: Item[] = [];
    for (const pl of p.trip.places) {
      const d = day(pl.day);
      out.push({ id: "p:" + pl.id, section: "Lieux", title: pl.name, sub: `${d?.title || ""} · ${TYPE_LABEL[pl.type] || pl.type} · ${pl.address}`, icon: <span className="ic dot" style={{ ["--c" as string]: d?.color }}>{pl.type === "hotel" ? "H" : d?.glyph}</span>, run: () => p.onPlace(pl), text: norm([pl.name, pl.cn, pl.address, pl.desc, TYPE_LABEL[pl.type], ...pl.highlights].join(" ")) });
    }
    for (const pin of p.pins) out.push({ id: "pin:" + pin.id, section: "Mes lieux", title: pin.name, sub: pin.note, icon: <span className="ic"><IPin /></span>, run: () => p.onPin(pin), text: norm(pin.name + " " + (pin.note || "")) });
    for (const d of p.trip.days) out.push({ id: "d:" + d.key, section: "Jours", title: d.title, sub: d.theme, icon: <span className="ic dot" style={{ ["--c" as string]: d.color }}>{d.glyph}</span>, run: () => p.onDay(d.key), text: norm(d.title + " " + d.short + " " + (d.theme || "")) });
    for (const z of p.trip.zones) out.push({ id: "z:" + z.label, section: "Zones", title: z.label, sub: "Centrer la carte", icon: <span className="ic"><ILocate /></span>, run: () => p.onZone(z.center, z.zoom), text: norm("zone quartier ville " + z.label) });
    for (const t of TOOLS) out.push({ id: "t:" + t.key, section: "Outils", title: t.label, icon: <span className="ic">{t.icon}</span>, run: () => p.onTool(t.key), text: norm(t.label + " " + t.key) });
    out.push({ id: "a:3d", section: "Actions", title: "Bâtiments en 3D", sub: "Activer ou couper la vue 3D", icon: <span className="ic"><ICube /></span>, run: p.onToggle3D, text: norm("3d batiments relief vue") });
    out.push({ id: "a:loc", section: "Actions", title: "Ma position", icon: <span className="ic"><ILocate /></span>, run: p.onLocate, text: norm("ma position localisation gps ou suis je") });
    out.push({ id: "a:pin", section: "Actions", title: "Ajouter un lieu sur la carte", icon: <span className="ic"><IPinPlus /></span>, run: p.onAddPin, text: norm("ajouter lieu epingle pin") });
    for (const t of TRIPS) if (t.id !== p.trip.id) out.push({ id: "trip:" + t.id, section: "Voyages", title: `Ouvrir ${t.title}`, sub: t.dateLabel, icon: <span className="ic"><ISearch /></span>, run: () => p.onTrip(t.id), text: norm(`voyage ${t.title} ${t.code}`) });
    for (const g of p.trip.phrases) for (const ph of g.items) out.push({ id: "ph:" + g.title + ph.zh, section: "Phrases", title: ph.fr, sub: `${ph.zh} · ${ph.pinyin}`, icon: <span className="ic"><ISpeaker /></span>, run: () => speak(ph.zh), text: norm(ph.fr + " " + ph.pinyin) + " " + ph.zh });
    return out;
  }, [p]);

  const qq = norm(q.trim());
  const shown = useMemo(() => {
    if (!qq) return items.filter((x) => x.section === "Outils" || x.section === "Jours" || x.section === "Zones" || x.section === "Actions" || x.section === "Voyages");
    const words = qq.split(/\s+/);
    return items
      .map((x) => ({ x, score: words.every((w) => x.text.includes(w) || norm(x.title).includes(w)) ? (norm(x.title).startsWith(words[0]) ? 2 : 1) : 0 }))
      .filter((r) => r.score)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((r) => r.x);
  }, [items, qq]);

  useEffect(() => setI(0), [qq]);
  useEffect(() => {
    list.current?.querySelector(".cmdk-item.on")?.scrollIntoView({ block: "nearest" });
  }, [i]);

  const run = (it?: Item) => {
    if (!it) return;
    p.onClose();
    it.run();
  };

  let lastSection = "";
  return (
    <Portal>
      <div className="cmdk-bg" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
        <div className="cmdk glass" role="dialog" aria-modal="true" aria-label="Recherche">
          <div className="cmdk-input">
            <ISearch />
            <input
              autoFocus
              placeholder="Lieu, quartier, phrase, outil…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(shown.length - 1, x + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
                else if (e.key === "Enter") { e.preventDefault(); run(shown[i]); }
              }}
              aria-activedescendant={shown[i] ? "cmdk-" + i : undefined}
            />
          </div>
          <div className="cmdk-list scroll" ref={list} role="listbox">
            {shown.map((it, n) => {
              const head = it.section !== lastSection ? <span className="cmdk-sec label">{it.section}</span> : null;
              lastSection = it.section;
              return (
                <div key={it.id}>
                  {head}
                  <button id={"cmdk-" + n} role="option" aria-selected={n === i} className={"cmdk-item" + (n === i ? " on" : "")} onMouseMove={() => setI(n)} onClick={() => run(it)}>
                    {it.icon}
                    <span className="grow">
                      <b>{it.title}</b>
                      {it.sub && <small>{it.sub}</small>}
                    </span>
                  </button>
                </div>
              );
            })}
            {!shown.length && <div className="empty"><b>Rien trouvé</b>Essayez un autre mot.</div>}
          </div>
          <div className="cmdk-foot">
            <span>↑↓ naviguer</span>
            <span>↵ ouvrir</span>
            <span>Échap fermer</span>
          </div>
        </div>
      </div>
    </Portal>
  );
}
