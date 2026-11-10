import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Account from "./components/Account";
import Agenda from "./components/Agenda";
import CommandPalette from "./components/CommandPalette";
import DayBar from "./components/DayBar";
import { ICube, ILink, ILocate, IPinPlus } from "./components/Icons";
import AddPlace, { type Found } from "./components/AddPlace";
import Checklist from "./components/Checklist";
import Emergency from "./components/Emergency";
import Translate from "./components/Translate";
import Landing from "./components/Landing";
import MapView, { type FocusRequest } from "./components/MapView";
import Overview from "./components/Overview";
import PinDetail, { PinForm } from "./components/PinDetail";
import PlaceDetail from "./components/PlaceDetail";
import PlaceList, { type Filter } from "./components/PlaceList";
import TopBar, { TOOLS, type ToolKey } from "./components/TopBar";
import { Converter, ExportPanel, Flights, Phrases, Practical } from "./components/Tools";
import { Drawer, Toaster } from "./components/ui";
import type { Place } from "./data/types";
import { km, optimizeOrder } from "./lib/geo";
import { dayStops } from "./lib/plan";
import { addPin, switchTrip, toast, updateRecord, useStore, useTrip } from "./lib/store";
import { ensureCompass, getLoc, onLocateError, resumeLocate, setFollow, startLocate, stopLocate, useLoc } from "./lib/locate";
import type { Mode } from "./lib/route";
import { NavCard, PointCard, useNavigation, type NavState, type NavTarget } from "./components/Nav";

type Sel = { kind: "place" | "pin"; id: string } | null;
type Snap = "peek" | "half" | "full";
const DESKTOP = "(min-width: 900px)";

function useDesktop() {
  const [d, setD] = useState(() => window.matchMedia(DESKTOP).matches);
  useEffect(() => {
    const m = window.matchMedia(DESKTOP);
    const f = () => setD(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return d;
}

type LL = [number, number];
const boundsOf = (pts: { lat: number; lng: number }[]): [LL, LL] => [
  [Math.min(...pts.map((p) => p.lng)), Math.min(...pts.map((p) => p.lat))],
  [Math.max(...pts.map((p) => p.lng)), Math.max(...pts.map((p) => p.lat))],
];

export default function App() {
  const desktop = useDesktop();
  const trip = useTrip();
  const data = useStore((s) => s.data);
  // landing shown when the app is opened (not on every reload of the same session)
  const firstOpen = (() => {
    try {
      return !sessionStorage.getItem("orbes.entered");
    } catch {
      return true;
    }
  })();
  const [landing, setLanding] = useState(firstOpen);
  // the landing overlay stays mounted a little longer than the landing map mode, for its fade-out
  const [landingOverlay, setLandingOverlay] = useState(firstOpen);
  const [landingKey, setLandingKey] = useState(0);
  const overlayTimer = useRef<number | undefined>(undefined);
  const [day, setDay] = useState("all");
  const [filter, setFilter] = useState<Filter>({ types: new Set(), fav: false, todo: false });
  const [sel, setSel] = useState<Sel>(null);
  const [tool, setTool] = useState<ToolKey | null>(null);
  const [route, setRoute] = useState<{ day: string; order: Place[] } | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [pinMode, setPinMode] = useState(false);
  const [pendingPin, setPendingPin] = useState<LL | null>(null);
  const [addLink, setAddLink] = useState(false);
  const [pendingFound, setPendingFound] = useState<Found | null>(null);
  const fix = useLoc((s) => s.fix);
  const follow = useLoc((s) => s.follow);
  const locStatus = useLoc((s) => s.status);
  const [nav, setNav] = useState<NavState>(null);
  const [point, setPoint] = useState<LL | null>(null);
  const navInfo = useNavigation(nav);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [threeD, setThreeD] = useState(false);
  const [cmdk, setCmdk] = useState(false);
  const [snap, setSnap] = useState<Snap>("peek");
  const [vh, setVh] = useState(window.innerHeight);
  const n = useRef(0);
  // any camera move asked by the app (open a place, a day, a zone…) stops "follow me"
  const fly = useCallback((f: Omit<FocusRequest, "n">) => {
    setFollow(false);
    setFocus({ ...f, n: ++n.current });
  }, []);

  useEffect(() => {
    const f = () => setVh(window.innerHeight);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  // ⌘K / Ctrl K
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (!landing) setCmdk((v) => !v);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [landing]);

  const tripBounds = useCallback(() => {
    const core = trip.places.filter((p) => Math.abs(p.lat - trip.center[1]) < 0.35 && Math.abs(p.lng - trip.center[0]) < 0.45);
    return boundsOf(core.length ? core : trip.places);
  }, [trip]);

  useEffect(() => {
    if (!firstOpen) fly({ bounds: tripBounds(), pitch: 0, duration: 0 });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // reset view state when the trip changes
  useEffect(() => {
    setSnap("peek");
    setDay("all");
    setSel(null);
    setRoute(null);
    setFilter({ types: new Set(), fav: false, todo: false });
    if (!landing) fly({ bounds: tripBounds(), pitch: 0, duration: 1600 });
  }, [trip.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // a deleted pin (e.g. removed on another device) closes its panel
  useEffect(() => {
    if (sel?.kind === "pin" && !data.pins.some((p) => p.id === sel.id)) setSel(null);
  }, [data.pins, sel]);

  // ---- filtering ----
  const visible = useMemo(
    () =>
      trip.places.filter((p) => {
        const s = data.places[p.id];
        return (day === "all" || p.day === day) && (!filter.fav || s?.favorite) && (!filter.todo || !s?.visited) && (!filter.types.size || filter.types.has(p.type));
      }),
    [trip, day, filter, data.places],
  );
  const visibleIds = useMemo(() => new Set(visible.map((p) => p.id)), [visible]);
  const dayColor = useCallback((k: string) => trip.days.find((d) => d.key === k)?.color || "#f6f2ea", [trip]);
  const dayGlyph = useCallback((k: string) => trip.days.find((d) => d.key === k)?.glyph || "•", [trip]);

  // ---- layout ----
  const rightOpen = Boolean(sel || tool);
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  const toolWide = TOOLS.find((t) => t.key === tool)?.wide;
  const rightW = !rightOpen ? 0 : tool ? Math.min(toolWide ? 860 : 560, vw - 372 - 48) : 440;
  const peekPx = 172;
  const sheetFull = vh - 72; // mobile sheet height (viewport minus top bar)
  const snapPx: Record<Snap, number> = { peek: peekPx, half: Math.round(vh * 0.52), full: sheetFull };
  const DETAIL_VH = 0.64;
  const rawPad = desktop
    ? { top: nav || point ? 260 : 130, bottom: 30, left: 372 + 36, right: rightOpen ? rightW + 36 : 70 }
    : { top: nav || point ? 300 : 170, bottom: rightOpen ? Math.round(vh * DETAIL_VH) : snapPx[snap], left: 20, right: 20 };
  // insets can never eat the whole map (fitBounds would do nothing)
  const fitAxis = (a: number, b: number, size: number) => {
    const max = Math.max(0, size - 150);
    return a + b <= max ? [a, b] : [Math.round((a * max) / (a + b)), Math.round((b * max) / (a + b))];
  };
  const [pt, pb] = fitAxis(rawPad.top, rawPad.bottom, vh);
  const [pl, pr] = fitAxis(rawPad.left, rawPad.right, vw);
  const padding = { top: pt, bottom: pb, left: pl, right: pr };

  // ---- actions ----
  const openPlace = useCallback(
    (p: Place) => {
      setSel({ kind: "place", id: p.id });
      setTool(null);
      fly({ center: [p.lng, p.lat], zoom: threeD ? 16 : 14.6 });
    },
    [fly, threeD],
  );

  const showDay = useCallback(
    (d: string) => {
      setDay(d);
      setSel(null);
      if (d === "all") {
        setRoute(null);
        if (!desktop) setSnap("peek");
        fly({ bounds: tripBounds() });
        return;
      }
      const dd = trip.days.find((x) => x.key === d);
      const stops = trip.places.filter((p) => p.day === d);
      setRoute(dd?.scheduled ? { day: d, order: dayStops(trip, d, data.places).filter((p) => p.type !== "hotel") } : null);
      if (stops.length) fly(stops.length === 1 ? { center: [stops[0].lng, stops[0].lat], zoom: 14 } : { bounds: boundsOf(stops) });
      if (!desktop) setSnap("peek");
    },
    [trip, data.places, fly, tripBounds, desktop],
  );

  const optimize = useCallback(
    (d: string) => {
      const order = optimizeOrder(trip.hotel, trip.places.filter((p) => p.day === d && p.type !== "hotel"));
      let total = 0;
      let prev: { lat: number; lng: number } = trip.hotel;
      order.forEach((p) => {
        total += km(prev, p);
        prev = p;
      });
      setDay(d);
      setSel(null);
      setTool(null);
      setRoute({ day: d, order });
      fly({ bounds: boundsOf([...order, trip.hotel]) });
      if (!desktop) setSnap("peek");
      toast(`Meilleur ordre : ${order.length} arrêts, ${Math.round(total)} km depuis l'hôtel (numéros sur la carte)`);
    },
    [trip, fly, desktop],
  );

  // live location: off → on and follow me → (map moved by hand) follow again → off
  useEffect(() => {
    onLocateError(toast);
    void resumeLocate();
  }, []);
  const toggleLocate = useCallback(() => {
    const st = getLoc();
    ensureCompass(true);
    if (st.status === "off" || st.status === "denied" || st.status === "unavailable") {
      toast("Recherche de votre position…");
      startLocate(true);
    } else if (st.status === "searching") {
      setFollow(true);
      toast("Recherche de votre position…");
    } else if (!st.follow || Date.now() - st.followSince < 1500) setFollow(true);
    else if (nav) setFollow(false);
    else {
      stopLocate();
      toast("Localisation arrêtée");
    }
  }, [nav]);
  // "Autour de moi" goes away with the location
  useEffect(() => {
    if (locStatus === "off") setFilter((f) => (f.near ? { ...f, near: false } : f));
  }, [locStatus]);

  const startNav = useCallback(
    (target: NavTarget, mode: Mode) => {
      setNav({ target, mode });
      setPoint(null);
      setSel(null);
      setTool(null);
      if (!desktop) setSnap("peek");
      ensureCompass(true);
      const f = getLoc().fix;
      if (f) fly({ bounds: boundsOf([f, target]) });
      else startLocate(true);
    },
    [desktop, fly],
  );
  const stale = useLoc((s) => s.stale);
  // in a car (> ~15 km/h) the GPS course is the direction; on foot the compass (read inside the map)
  const me = useMemo(
    () => (fix ? { lng: fix.lng, lat: fix.lat, acc: fix.acc, course: fix.speed != null && fix.speed > 4 ? fix.heading : null, stale } : null),
    [fix, stale],
  );
  const navCoords = navInfo?.coords;
  const navLine = useMemo(
    () => navCoords ?? (nav && fix ? ([[fix.lng, fix.lat], [nav.target.lng, nav.target.lat]] as LL[]) : null),
    [navCoords, nav, fix],
  );

  // a place found from a link / screenshot becomes one of "my places", with its Chinese address
  const saveFound = useCallback(
    (f: Found, ll: LL) => {
      const pin = addPin({ name: f.name || f.nameCn || "Lieu", lng: ll[0], lat: ll[1] });
      updateRecord(`_pin:${pin.id}`, { nameCn: f.nameCn, address: f.address, addressCn: f.addressCn, desc: f.desc, hours: f.hours, source: f.source, day: f.day, type: f.type });
      setSel({ kind: "pin", id: pin.id });
      setTool(null);
      fly({ center: ll, zoom: 15.5 });
      toast(`« ${f.name || f.nameCn} » ajouté sur la carte`);
    },
    [fly],
  );

  const openTool = (k: ToolKey) => {
    setTool((t) => (t === k ? null : k));
    setSel(null);
  };

  // ---- mobile list sheet drag ----
  const sideRef = useRef<HTMLElement>(null);
  const drag = useRef<{ y0: number; h0: number; t0: number; moved: boolean } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    if (desktop || (e.target as HTMLElement).closest("button:not(.sheet-grip),a,input")) return;
    drag.current = { y0: e.clientY, h0: snapPx[snap], t0: performance.now(), moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !sideRef.current) return;
    const dy = e.clientY - d.y0;
    if (Math.abs(dy) > 4) d.moved = true;
    sideRef.current.classList.add("dragging");
    sideRef.current.style.setProperty("--sheet-h", `${Math.max(peekPx - 40, Math.min(snapPx.full, d.h0 - dy))}px`);
  };
  const endDrag = (e: React.PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    const el = sideRef.current;
    if (!d || !el) return;
    el.classList.remove("dragging");
    el.style.setProperty("--sheet-h", `${snapPx[snap]}px`);
    if (cancelled) return;
    const dy = e.clientY - d.y0;
    if (!d.moved) {
      setSnap((s) => (s === "peek" ? "half" : s === "half" ? "full" : "half"));
      return;
    }
    const v = dy / Math.max(1, performance.now() - d.t0);
    const h = d.h0 - dy;
    let next: Snap;
    if (v > 0.6) next = d.h0 >= snapPx.full - 5 ? "half" : "peek";
    else if (v < -0.6) next = d.h0 <= snapPx.peek + 5 ? "half" : "full";
    else next = (Object.entries(snapPx) as [Snap, number][]).reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a))[0];
    setSnap(next);
  };

  const selectedPlace = sel?.kind === "place" ? trip.places.find((p) => p.id === sel.id) : undefined;
  const selectedPin = sel?.kind === "pin" ? data.pins.find((p) => p.id === sel.id) : undefined;
  const toolDef = TOOLS.find((t) => t.key === tool);
  const detailSheet = desktop ? undefined : `${Math.round(DETAIL_VH * 100)}vh`;
  const toolSheet = desktop ? undefined : `${sheetFull}px`;

  return (
    <div
      className={"app" + (desktop && rightOpen ? " desk-right" : "")}
      style={{ ["--sheet-peek" as string]: `${desktop ? 0 : snapPx[snap]}px`, ["--right-w" as string]: `${rightW}px`, ["--sheet-hidden" as string]: `${desktop ? 0 : Math.max(0, sheetFull - snapPx[snap])}px` } as React.CSSProperties}
    >
      <MapView
        trip={trip}
        places={trip.places}
        states={data.places}
        visibleIds={visibleIds}
        pins={data.pins}
        selected={sel}
        route={route?.order ?? null}
        routeColor={route ? dayColor(route.day) : "#f6f2ea"}
        focus={focus}
        padding={landing ? { top: 0, bottom: 0, left: 0, right: 0 } : padding}
        pinMode={pinMode}
        me={me}
        follow={follow}
        navLine={navLine}
        navMode={nav?.mode ?? null}
        point={point}
        onUserPan={() => setFollow(false)}
        onLongPress={(ll) => {
          if (landing || pinMode || nav) return;
          setPoint(ll);
        }}
        threeD={threeD}
        landing={landing}
        dayColor={dayColor}
        dayGlyph={dayGlyph}
        onSelect={(kind, id) => {
          if (pinMode || landing) return;
          if (kind === "place") {
            const p = trip.places.find((x) => x.id === id);
            if (p) openPlace(p);
          } else {
            setSel({ kind, id });
            setTool(null);
          }
        }}
        onMapClick={(ll) => {
          if (landing) return;
          if (pinMode) {
            setPinMode(false);
            if (pendingFound) {
              saveFound(pendingFound, ll);
              setPendingFound(null);
            } else setPendingPin(ll);
            return;
          }
          if (point) setPoint(null);
          else if (sel) setSel(null);
          else if (!desktop && snap !== "peek") setSnap("peek");
        }}
        onBasemapError={setBasemapFailed}
      />

      {!landing && (
        <>
          <TopBar
            trip={trip}
            tool={tool}
            onTool={openTool}
            onSearch={() => setCmdk(true)}
            onTrip={switchTrip}
            onHome={() => {
              setSel(null);
              setTool(null);
              setThreeD(false);
              window.clearTimeout(overlayTimer.current);
              setLandingKey((k) => k + 1);
              setLanding(true);
              setLandingOverlay(true);
            }}
          />
          {nav ? (
            <NavCard nav={nav} info={navInfo} onMode={(m) => setNav({ ...nav, mode: m })} onClose={() => { setNav(null); setFollow(false); }} />
          ) : point ? (
            <PointCard
              point={{ lng: point[0], lat: point[1] }}
              onGo={(m) => startNav({ lng: point[0], lat: point[1], name: "Point choisi" }, m)}
              onPin={() => { setPendingPin(point); setPoint(null); }}
              onClose={() => setPoint(null)}
            />
          ) : (
            <DayBar trip={trip} day={day} onDay={showDay} />
          )}

          <aside ref={sideRef} className="side glass" style={desktop ? undefined : ({ ["--sheet-h" as string]: `${snapPx[snap]}px` } as React.CSSProperties)} aria-label="Lieux du voyage">
            <div className="sheet-grip" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={(e) => endDrag(e, false)} onPointerCancel={(e) => endDrag(e, true)} role="button" aria-label="Agrandir ou réduire la liste" />
            <div className="side-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={(e) => endDrag(e, false)} onPointerCancel={(e) => endDrag(e, true)}>
              <span className="label">{trip.subtitle}</span>
              <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em", marginTop: 4 }}>{trip.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--soft)" }}>
                {trip.dateLabel} · {trip.hotel.name}
              </div>
            </div>
            <div className="side-body scroll">
              <PlaceList
                trip={trip}
                places={visible}
                states={data.places}
                pins={data.pins}
                selectedId={sel?.id ?? null}
                query=""
                filter={filter}
                onFilter={setFilter}
                onOpen={openPlace}
                onOpenPin={(p) => {
                  setSel({ kind: "pin", id: p.id });
                  setTool(null);
                  fly({ center: [p.lng, p.lat], zoom: 15 });
                }}
              />
            </div>
          </aside>

          {selectedPlace && !tool && <PlaceDetail key={selectedPlace.id} trip={trip} place={selectedPlace} onBack={() => setSel(null)} onGo={(m) => startNav(selectedPlace, m)} sheetH={detailSheet} />}
          {selectedPin && !tool && <PinDetail key={selectedPin.id} trip={trip} pin={selectedPin} onBack={() => setSel(null)} onGo={(m) => startNav(selectedPin, m)} sheetH={detailSheet} />}

          {toolDef && (
            <Drawer kicker={trip.code} title={toolDef.key === "converter" ? "Convertisseur" : toolDef.label} wide={toolDef.wide} onClose={() => setTool(null)} sheetH={toolSheet}>
              {tool === "overview" && (
                <Overview
                  trip={trip}
                  states={data.places}
                  onShowDay={(d) => {
                    setTool(null);
                    showDay(d);
                  }}
                />
              )}
              {tool === "agenda" && (
                <Agenda
                  trip={trip}
                  states={data.places}
                  pins={data.pins}
                  onOpen={openPlace}
                  onOpenPin={(p) => {
                    setSel({ kind: "pin", id: p.id });
                    setTool(null);
                    fly({ center: [p.lng, p.lat], zoom: 15 });
                  }}
                  onShowDay={(d) => {
                    setTool(null);
                    showDay(d);
                  }}
                  onOptimize={optimize}
                />
              )}
              {tool === "translate" && <Translate trip={trip} />}
              {tool === "checklist" && <Checklist trip={trip} />}
              {tool === "emergency" && <Emergency trip={trip} />}
              {tool === "phrases" && <Phrases trip={trip} />}
              {tool === "converter" && <Converter />}
              {tool === "flights" && <Flights trip={trip} />}
              {tool === "practical" && <Practical trip={trip} />}
              {tool === "export" && <ExportPanel trip={trip} />}
              {tool === "account" && <Account />}
            </Drawer>
          )}

          <div className="mapctl">
            <div className="zones">
              {trip.zones.map((z) => (
                <button key={z.label} className="zone glass" onClick={() => fly({ center: z.center, zoom: z.zoom })}>
                  {z.label}
                </button>
              ))}
            </div>
            <div className="ctl-group glass">
              <button
                className={"ctl" + (locStatus === "on" || locStatus === "searching" ? (follow ? " on" : " half") : "")}
                onClick={toggleLocate}
                aria-pressed={locStatus === "on"}
                aria-label={locStatus === "off" ? "Afficher ma position" : follow ? (nav ? "Ne plus me suivre" : "Arrêter la localisation") : "Me suivre"}
                title={locStatus === "off" ? "Ma position" : follow ? (nav ? "Ne plus me suivre" : "Arrêter la localisation") : "Me suivre"}
              >
                <ILocate />
              </button>
              <button className={"ctl" + (pinMode ? " on" : "")} onClick={() => { setPendingFound(null); setPinMode((v) => !v); }} aria-pressed={pinMode} aria-label="Ajouter un lieu sur la carte" title="Ajouter un lieu">
                <IPinPlus />
              </button>
              <button className="ctl" onClick={() => setAddLink(true)} aria-label="Ajouter un lieu depuis un lien ou une capture" title="Depuis un lien ou une capture">
                <ILink />
              </button>
              <button className={"ctl" + (threeD ? " on" : "")} onClick={() => setThreeD((v) => !v)} aria-pressed={threeD} aria-label="Bâtiments en 3D" title="Vue 3D">
                <ICube />
              </button>
            </div>
          </div>

          {pinMode && (
            <div className="banner glass" role="status">
              {pendingFound ? `Touchez la carte à l'endroit de « ${pendingFound.name || pendingFound.nameCn} »` : "Touchez la carte pour placer le lieu"}
              <button onClick={() => { setPinMode(false); setPendingFound(null); }}>Annuler</button>
            </div>
          )}
          {basemapFailed && !pinMode && (
            <div className="banner glass" role="status" style={{ pointerEvents: "none" }}>
              Fond de carte lent ou indisponible. Les lieux restent affichés.
            </div>
          )}
        </>
      )}

      {landingOverlay && (
        <Landing
          key={landingKey}
          trip={trip}
          onPick={switchTrip}
          onEnter={() => {
            setLanding(false);
            try {
              sessionStorage.setItem("orbes.entered", "1");
            } catch {
              /* ignore */
            }
            window.clearTimeout(overlayTimer.current);
            overlayTimer.current = window.setTimeout(() => setLandingOverlay(false), 900);
            fly({ bounds: tripBounds(), pitch: 0, duration: 2600 });
          }}
        />
      )}

      {cmdk && (
        <CommandPalette
          trip={trip}
          pins={data.pins}
          onClose={() => setCmdk(false)}
          onPlace={openPlace}
          onPin={(p) => {
            setSel({ kind: "pin", id: p.id });
            setTool(null);
            fly({ center: [p.lng, p.lat], zoom: 15 });
          }}
          onTool={(k) => {
            setTool(k);
            setSel(null);
          }}
          onTrip={switchTrip}
          onDay={showDay}
          onZone={(center, zoom) => fly({ center, zoom })}
          onToggle3D={() => setThreeD((v) => !v)}
          onLocate={toggleLocate}
          onAddPin={() => setPinMode(true)}
          onAddLink={() => setAddLink(true)}
        />
      )}

      {addLink && (
        <AddPlace
          trip={trip}
          onClose={() => setAddLink(false)}
          onAdd={(f) => {
            setAddLink(false);
            if (f.ll) saveFound(f, f.ll);
            else {
              setPendingFound(f);
              setSel(null);
              setTool(null);
              setPinMode(true);
            }
          }}
        />
      )}
      {pendingPin && (
        <PinForm
          onClose={() => setPendingPin(null)}
          onSave={(name, note) => {
            const pin = addPin({ name, note: note || undefined, lng: pendingPin[0], lat: pendingPin[1] });
            setPendingPin(null);
            setSel({ kind: "pin", id: pin.id });
            toast(`« ${name} » ajouté`);
          }}
        />
      )}
      <Toaster />
    </div>
  );
}
