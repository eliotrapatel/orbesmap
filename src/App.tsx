import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Account from "./components/Account";
import Agenda, { dayStops } from "./components/Agenda";
import { ICal, IList, ILocate, IPinPlus, ISearch, ITools, IUser, IClose } from "./components/Icons";
import Intro from "./components/Intro";
import MapView, { type FocusRequest } from "./components/MapView";
import PinDetail, { PinForm } from "./components/PinDetail";
import PlaceDetail from "./components/PlaceDetail";
import PlaceList from "./components/PlaceList";
import Tools from "./components/Tools";
import { Toaster } from "./components/ui";
import { DAYS, DAY_BY_KEY, PLACES, QUICK_ZONES, TRIP } from "./data/trip";
import type { DayKey, Place } from "./data/types";
import { km, optimizeOrder } from "./lib/geo";
import { addPin, toast, useStore } from "./lib/store";
import monogram from "./assets/monogram.png";

type Tab = "places" | "agenda" | "tools" | "account";
type Sel = { kind: "place" | "pin"; id: string } | null;
type Snap = "peek" | "half" | "full";

const INTRO_KEY = "orbes.v2.intro";
const isDesktop = () => window.matchMedia("(min-width: 900px)").matches;

function useDesktop() {
  const [d, setD] = useState(isDesktop);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 900px)");
    const f = () => setD(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return d;
}

function safeBottom(): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px);visibility:hidden";
  document.body.appendChild(probe);
  const h = probe.getBoundingClientRect().height;
  probe.remove();
  return h;
}

function countdown(): { big: string; small: string } {
  const now = Date.now();
  const start = new Date(TRIP.start + "T00:00:00+08:00").getTime();
  const end = new Date(TRIP.end + "T23:59:00+08:00").getTime();
  if (now < start) return { big: `J-${Math.ceil((start - now) / 864e5)}`, small: "avant le départ" };
  if (now <= end) return { big: `Jour ${Math.floor((now - start) / 864e5) + 1}`, small: "sur place" };
  return { big: "Juin 2026", small: "voyage terminé" };
}

export default function App() {
  const desktop = useDesktop();
  const data = useStore((s) => s.data);
  const [intro, setIntro] = useState(() => {
    try {
      return !localStorage.getItem(INTRO_KEY);
    } catch {
      return false;
    }
  });
  const [tab, setTab] = useState<Tab>("places");
  const [day, setDay] = useState<"all" | DayKey>("all");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState<Sel>(null);
  const [route, setRoute] = useState<{ day: DayKey; order: Place[] } | null>(null);
  // Start framed on the Guangzhou places (Dongguan and Shenzhen are one tap away).
  const [focus, setFocus] = useState<FocusRequest | null>(() => {
    const gz = PLACES.filter((p) => p.lat > 23.05);
    const lngs = gz.map((p) => p.lng);
    const lats = gz.map((p) => p.lat);
    return { n: 0, bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]] };
  });
  const [pinMode, setPinMode] = useState(false);
  const [pendingPin, setPendingPin] = useState<[number, number] | null>(null);
  const [me, setMe] = useState<[number, number] | null>(null);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [snap, setSnap] = useState<Snap>("peek");
  const [vh, setVh] = useState(window.innerHeight);
  const watchId = useRef<number | null>(null);
  const firstFix = useRef(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const sb = useMemo(safeBottom, []);

  useEffect(() => {
    const f = () => setVh(window.innerHeight);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  // ---- filtering ----
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      PLACES.filter(
        (p) =>
          (day === "all" || p.day === day) &&
          (!q || [p.name, p.desc, p.address, p.cn, p.type, ...(p.highlights || []), data.places[p.id]?.note || ""].some((t) => t.toLowerCase().includes(q))),
      ),
    [day, q, data.places],
  );
  const visibleIds = useMemo(() => new Set(filtered.map((p) => p.id)), [filtered]);

  // ---- sheet geometry (mobile) ----
  const panelH = vh - 56 - (desktop ? 0 : 0);
  const snapPx: Record<Snap, number> = { peek: 180 + sb, half: Math.round(vh * 0.56), full: panelH };
  const sheetH = desktop ? 0 : snapPx[snap];
  const padding = desktop ? { top: 0, bottom: 0, left: 408 + 12, right: 60 } : { top: 0, bottom: Math.min(sheetH, snapPx.half), left: 0, right: 0 };

  const n = useRef(0);
  const fly = useCallback((f: Omit<FocusRequest, "n">) => setFocus({ ...f, n: ++n.current }), []);

  const openPlace = useCallback(
    (p: Place) => {
      setSel({ kind: "place", id: p.id });
      setTab("places");
      if (!desktop) setSnap((s) => (s === "full" ? "full" : "half"));
      fly({ center: [p.lng, p.lat], zoom: 14 });
      bodyRef.current?.scrollTo({ top: 0 });
    },
    [desktop, fly],
  );

  const showDay = useCallback(
    (d: "all" | DayKey) => {
      setDay(d);
      setSel(null);
      if (d === "all") {
        setRoute(null);
        return;
      }
      const stops = PLACES.filter((p) => p.day === d);
      setRoute(DAY_BY_KEY[d].scheduled ? { day: d, order: dayStops(d, data.places) } : null);
      if (stops.length) {
        const lngs = stops.map((p) => p.lng);
        const lats = stops.map((p) => p.lat);
        fly(stops.length === 1 ? { center: [stops[0].lng, stops[0].lat], zoom: 14 } : { bounds: [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]] });
      }
    },
    [data.places, fly],
  );

  const optimize = useCallback(
    (d: DayKey) => {
      const order = optimizeOrder(TRIP.hotel, PLACES.filter((p) => p.day === d));
      let total = 0;
      let prev: { lat: number; lng: number } = TRIP.hotel;
      order.forEach((p) => {
        total += km(prev, p);
        prev = p;
      });
      setDay(d);
      setSel(null);
      setRoute({ day: d, order });
      const lngs = order.map((p) => p.lng);
      const lats = order.map((p) => p.lat);
      fly({ bounds: [[Math.min(...lngs, TRIP.hotel.lng), Math.min(...lats, TRIP.hotel.lat)], [Math.max(...lngs, TRIP.hotel.lng), Math.max(...lats, TRIP.hotel.lat)]] });
      if (!desktop) setSnap("peek");
      toast(`Ordre conseillé : ${order.map((p) => p.name.split(/ [—-] /)[0]).join(", ")} (${Math.round(total)} km)`);
    },
    [desktop, fly],
  );

  const toggleLocate = () => {
    if (watchId.current != null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      setMe(null);
      return;
    }
    if (!("geolocation" in navigator)) return toast("La localisation n'est pas disponible sur cet appareil");
    toast("Recherche de votre position…");
    firstFix.current = true;
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const ll: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setMe(ll);
        if (firstFix.current) {
          firstFix.current = false;
          fly({ center: ll, zoom: 15 });
        }
      },
      (err) => {
        if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
        watchId.current = null;
        setMe(null);
        toast(err.code === 1 ? "Localisation refusée : autorisez-la dans les réglages du navigateur" : "Position introuvable, réessayez dehors");
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
  };
  useEffect(() => () => { if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); }, []);

  // ---- sheet drag (mobile) ----
  const drag = useRef<{ y0: number; h0: number; t0: number; moved: boolean } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onDown = (e: React.PointerEvent) => {
    if (desktop) return;
    if ((e.target as HTMLElement).closest("input,button:not(.sheet-grip),a")) return;
    drag.current = { y0: e.clientY, h0: sheetH, t0: performance.now(), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !panelRef.current) return;
    const dy = e.clientY - d.y0;
    if (Math.abs(dy) > 4) d.moved = true;
    const h = Math.max(snapPx.peek - 40, Math.min(panelH, d.h0 - dy));
    panelRef.current.classList.add("dragging");
    panelRef.current.style.setProperty("--sheet-h", `${h}px`);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !panelRef.current) return;
    panelRef.current.classList.remove("dragging");
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      setSnap((s) => (s === "peek" ? "half" : s === "half" ? "full" : "half"));
      panelRef.current.style.setProperty("--sheet-h", `${sheetH}px`);
      return;
    }
    const v = dy / Math.max(1, performance.now() - d.t0); // px/ms, positive = down
    const h = d.h0 - dy;
    let next: Snap;
    if (v > 0.6) next = d.h0 >= snapPx.full - 5 ? "half" : "peek";
    else if (v < -0.6) next = d.h0 <= snapPx.peek + 5 ? "half" : "full";
    else next = (Object.entries(snapPx) as [Snap, number][]).reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a))[0];
    setSnap(next);
    panelRef.current.style.setProperty("--sheet-h", `${snapPx[next]}px`);
  };

  const selectedPlace = sel?.kind === "place" ? PLACES.find((p) => p.id === sel.id) : undefined;
  const selectedPin = sel?.kind === "pin" ? data.pins.find((p) => p.id === sel.id) : undefined;
  const cd = countdown();

  const tabs: { key: Tab; label: string; icon: React.ReactElement }[] = [
    { key: "places", label: "Lieux", icon: <IList /> },
    { key: "agenda", label: "Agenda", icon: <ICal /> },
    { key: "tools", label: "Outils", icon: <ITools /> },
    { key: "account", label: "Compte", icon: <IUser /> },
  ];

  return (
    <div className="app" style={{ ["--sheet-peek" as string]: desktop ? "0px" : `${snapPx.peek}px` }}>
      <MapView
        places={PLACES}
        states={data.places}
        visibleIds={visibleIds}
        pins={data.pins}
        selected={sel}
        route={route?.order ?? null}
        routeColor={route ? DAY_BY_KEY[route.day].color : "#000"}
        focus={focus}
        padding={padding}
        pinMode={pinMode}
        me={me}
        onSelect={(kind, id) => {
          if (pinMode) return;
          if (kind === "place") {
            const p = PLACES.find((x) => x.id === id);
            if (p) openPlace(p);
          } else {
            setSel({ kind, id });
            setTab("places");
            if (!desktop) setSnap((s) => (s === "full" ? "full" : "half"));
          }
        }}
        onMapClick={(ll) => {
          if (pinMode) {
            setPinMode(false);
            setPendingPin(ll);
            return;
          }
          if (sel) setSel(null);
          if (!desktop && snap !== "peek") setSnap("peek");
        }}
        onBasemapError={setBasemapFailed}
      />

      <div className="mapctl">
        <button className={"ctl" + (me ? " on" : "")} onClick={toggleLocate} aria-pressed={!!me} aria-label="Ma position" title="Ma position">
          <ILocate />
        </button>
        <button className={"ctl" + (pinMode ? " on" : "")} onClick={() => setPinMode((v) => !v)} aria-pressed={pinMode} aria-label="Ajouter un lieu sur la carte" title="Ajouter un lieu">
          <IPinPlus />
        </button>
        <div className="zones">
          {QUICK_ZONES.map((z) => (
            <button key={z.label} className="zone" onClick={() => fly({ center: z.center, zoom: z.zoom })}>
              {z.label}
            </button>
          ))}
        </div>
      </div>

      {pinMode && (
        <div className="banner" role="status">
          Touchez la carte pour placer le lieu
          <button onClick={() => setPinMode(false)}>Annuler</button>
        </div>
      )}
      {basemapFailed && !pinMode && (
        <div className="banner" role="status" style={{ background: "#fff", color: "var(--ink)" }}>
          Fond de carte indisponible sans réseau. Les lieux restent affichés.
        </div>
      )}

      <aside
        ref={panelRef}
        className="panel"
        style={{ ["--sheet-h" as string]: `${sheetH}px` }}
        aria-label="Panneau du voyage"
      >
        <div className="sheet-grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="button" aria-label="Agrandir ou réduire le panneau" />
        <div className="panel-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {desktop && (
            <div className="brand">
              <img src={monogram} alt="ORBES" />
              <div className="brand-txt">
                <div className="brand-title">{TRIP.title}</div>
                <div className="brand-sub">{TRIP.subtitle}, 7 au 13 juin 2026</div>
              </div>
              <div className="countdown">
                <b>{cd.big}</b>
                {cd.small}
              </div>
            </div>
          )}
          {(tab === "places" && !sel) && (
            <>
              <label className="search" style={desktop ? undefined : { marginTop: 0 }}>
                <ISearch />
                <span className="sr">Rechercher un lieu</span>
                <input
                  type="search"
                  value={query}
                  placeholder="Rechercher un lieu, une matière, une note…"
                  onChange={(e) => setQuery(e.target.value)}
                  onFocus={() => !desktop && setSnap("full")}
                />
                {query && (
                  <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Effacer" onClick={() => setQuery("")}>
                    <IClose />
                  </button>
                )}
              </label>
              <div className="chips" role="group" aria-label="Filtrer par jour">
                <button className={"chip" + (day === "all" ? " on" : "")} aria-pressed={day === "all"} onClick={() => showDay("all")}>
                  Tout
                </button>
                {DAYS.map((d) => (
                  <button key={d.key} className={"chip" + (day === d.key ? " on" : "")} aria-pressed={day === d.key} style={{ ["--c" as string]: d.color }} onClick={() => showDay(day === d.key ? "all" : d.key)}>
                    <i />
                    {d.short}
                  </button>
                ))}
              </div>
            </>
          )}
          {!(tab === "places" && !sel) && !desktop && <div style={{ height: 4 }} />}
          {tab !== "places" && (
            <h2 style={{ fontFamily: "var(--serif)", fontWeight: 500, fontSize: 28, marginTop: desktop ? 18 : 0 }}>{tabs.find((t) => t.key === tab)!.label}</h2>
          )}
        </div>

        <div className="panel-body" ref={bodyRef}>
          {tab === "places" && selectedPlace && <PlaceDetail key={selectedPlace.id} place={selectedPlace} onBack={() => setSel(null)} />}
          {tab === "places" && selectedPin && <PinDetail key={selectedPin.id} pin={selectedPin} onBack={() => setSel(null)} />}
          {tab === "places" && !sel && (
            <PlaceList places={filtered} states={data.places} pins={data.pins} selectedId={null} query={query} total={PLACES.filter((p) => p.id !== "hotel").length} onOpen={openPlace} onOpenPin={(p) => { setSel({ kind: "pin", id: p.id }); fly({ center: [p.lng, p.lat], zoom: 15 }); }} />
          )}
          {tab === "agenda" && <Agenda states={data.places} onOpen={openPlace} onShowDay={(d) => { showDay(d); setTab("places"); if (!desktop) setSnap("peek"); }} onOptimize={optimize} />}
          {tab === "tools" && <Tools />}
          {tab === "account" && <Account />}
        </div>

      </aside>

      <nav className="tabbar" aria-label="Sections">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={"tab" + (tab === t.key ? " on" : "")}
            aria-current={tab === t.key ? "page" : undefined}
            onClick={() => {
              if (tab === t.key) {
                if (t.key === "places" && sel) setSel(null);
                else if (!desktop) setSnap((s) => (s === "peek" ? "half" : "peek"));
                return;
              }
              setTab(t.key);
              if (!desktop && snap === "peek" && t.key !== "places") setSnap("full");
              bodyRef.current?.scrollTo({ top: 0 });
            }}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      {pendingPin && (
        <PinForm
          onClose={() => setPendingPin(null)}
          onSave={(name, note) => {
            const pin = addPin({ name, note: note || undefined, lng: pendingPin[0], lat: pendingPin[1] });
            setPendingPin(null);
            setSel({ kind: "pin", id: pin.id });
            setTab("places");
            toast(`« ${name} » ajouté`);
          }}
        />
      )}
      <Toaster />
      {intro && (
        <Intro
          onDone={() => {
            setIntro(false);
            try {
              localStorage.setItem(INTRO_KEY, "1");
            } catch {
              /* ignore */
            }
          }}
        />
      )}
    </div>
  );
}
