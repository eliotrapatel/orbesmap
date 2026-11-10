// Mobile bottom sheets: the sheet follows the finger 1:1 (transform only, no layout work per frame),
// is released with the finger's speed onto the nearest resting height (or closes), with a soft
// resistance past the ends. A drag starts on the handle (grip / header) or from the content:
// pulling down while the content is scrolled to the top, or pushing up while the sheet is not at
// full height (it grows before the content scrolls), like the iPhone's own sheets.
//
// CSS contract: on mobile the sheet is as tall as its full height and is moved down by
// translateY(100% - visible height). Visible height = var(--drag-h) while the gesture owns it,
// otherwise the owner's var(--sheet-h).
import { useEffect, useRef, type RefObject } from "react";

const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const isMobileSheet = () => window.matchMedia("(max-width: 899px)").matches;

export type SheetConfig = {
  /** resting visible heights in px, lowest first */
  snaps: () => number[];
  /** the sheet settled on snaps()[i] */
  onSnap: (i: number, h: number) => void;
  /** pulling below the lowest height closes the sheet */
  onClose?: () => void;
  /** touch on the handle without moving */
  onTap?: () => void;
  /** the owner renders the resting height itself (var(--sheet-h)): drop --drag-h once settled */
  controlled?: boolean;
  /** scrollable content that can start a drag */
  body?: string;
};

/** soft resistance past the ends: tends to 64 px */
const rubber = (x: number) => 64 * (1 - Math.exp(-x / 180));

export class SheetGesture {
  readonly el: HTMLElement;
  private cfg: () => SheetConfig;
  private y0 = 0;
  private h0 = 0;
  private h = 0;
  private samples: { t: number; y: number }[] = [];
  private active = false;
  private moved = false;
  private timer = 0;

  constructor(el: HTMLElement, cfg: () => SheetConfig) {
    this.el = el;
    this.cfg = cfg;
  }

  get dragging() {
    return this.active;
  }

  /** resting heights, never taller than the sheet itself (notch, safe areas) */
  snaps(): number[] {
    const cap = this.el.offsetHeight || Infinity;
    const out: number[] = [];
    for (const s of this.cfg().snaps()) {
      const v = Math.min(s, cap);
      if (!out.length || v - out[out.length - 1] > 8) out.push(v);
    }
    return out.length ? out : [cap];
  }

  /** height of the sheet actually on screen, even in the middle of an animation */
  visible(): number {
    const r = this.el.getBoundingClientRect();
    const parent = (this.el.offsetParent as HTMLElement | null)?.getBoundingClientRect();
    return Math.max(0, (parent ? parent.bottom : window.innerHeight) - r.top);
  }

  start(y: number) {
    window.clearTimeout(this.timer);
    this.active = true;
    this.moved = false;
    this.y0 = y;
    this.h0 = this.h = this.visible();
    // the opening slide-in would override the finger: stop it where it is (read the position first)
    for (const a of this.el.getAnimations()) if (typeof CSSAnimation !== "undefined" && a instanceof CSSAnimation) a.cancel();
    this.samples = [{ t: performance.now(), y }];
    this.el.style.transition = "none";
    this.paint(this.h); // freezes a sheet caught mid-animation where it is
    this.el.classList.add("sheet-dragging");
  }

  move(y: number) {
    if (!this.active) return;
    const now = performance.now();
    this.samples.push({ t: now, y });
    while (this.samples.length > 2 && now - this.samples[0].t > 100) this.samples.shift();
    const dy = y - this.y0;
    if (Math.abs(dy) > 3) this.moved = true;
    const snaps = this.snaps();
    const min = snaps[0];
    const max = snaps[snaps.length - 1];
    let h = this.h0 - dy;
    if (h > max) h = max + rubber(h - max);
    if (h < min && !this.cfg().onClose) h = min - rubber(min - h);
    this.h = Math.max(0, h);
    this.paint(this.h);
  }

  end(cancelled = false) {
    if (!this.active) return;
    this.active = false;
    this.el.classList.remove("sheet-dragging");
    const cfg = this.cfg();
    const snaps = this.snaps();
    const nearest = (h: number) => snaps.reduce((best, s, i) => (Math.abs(s - h) < Math.abs(snaps[best] - h) ? i : best), 0);
    const i0 = nearest(this.h0);
    if (!this.moved) {
      // a tap: back to rest, then let the owner react
      this.el.style.transition = "";
      if (cfg.controlled) this.el.style.removeProperty("--drag-h");
      else this.paint(snaps[i0]);
      if (!cancelled) cfg.onTap?.();
      return;
    }
    // speed at the moment of release (px/ms, positive when the sheet grows): a finger held still
    // before lifting has no speed, so the sheet stays where it was put
    const now = performance.now();
    const last = this.samples[this.samples.length - 1];
    const recent = this.samples.filter((p) => now - p.t <= 100);
    let v = 0;
    if (recent.length >= 2 && now - last.t < 50 && last.t > recent[0].t) v = -(last.y - recent[0].y) / (last.t - recent[0].t);
    const projected = this.h + v * 220;
    const min = snaps[0];
    const pulled = min - this.h;
    // closing is the step below the lowest height: a clear pull, or a downward flick from it
    if (cfg.onClose && !cancelled && (projected < min - 140 || pulled > 110 || (v < -0.35 && i0 === 0 && pulled > 16))) {
      this.animateTo(0, v, cfg.onClose);
      return;
    }
    let i = cancelled ? i0 : nearest(projected);
    // a clear flick always moves one step in its direction
    if (!cancelled && v > 0.35 && i <= i0 && i0 < snaps.length - 1) i = i0 + 1;
    if (!cancelled && v < -0.35 && i >= i0 && i0 > 0) i = i0 - 1;
    this.snapTo(i, v);
  }

  /** settle on snaps()[i] (also used for taps, resizes and programmatic moves) */
  snapTo(i: number, v = 0) {
    const snaps = this.snaps();
    const k = Math.max(0, Math.min(snaps.length - 1, i));
    this.cfg().onSnap(k, snaps[k]);
    this.animateTo(snaps[k], v);
  }

  /** forget everything (the sheet unmounts or is reused) */
  dispose() {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.active = false;
    this.el.style.transition = "";
    this.el.style.removeProperty("--drag-h");
    this.el.classList.remove("sheet-dragging");
  }

  private animateTo(h: number, v: number, done?: () => void) {
    const dist = Math.abs(h - this.h);
    let d = Math.min(440, Math.max(200, 170 + dist * 0.42));
    if (Math.abs(v) > 0.8) d = Math.max(170, d * 0.78); // a fast flick lands faster
    this.el.style.transition = `transform ${Math.round(d)}ms ${EASE}`;
    this.h = h;
    this.paint(h);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (!this.el.isConnected) return;
      this.el.style.transition = "";
      if (this.cfg().controlled && h > 0) this.el.style.removeProperty("--drag-h");
      done?.();
    }, d + 30);
  }

  private paint(h: number) {
    this.el.style.setProperty("--drag-h", `${Math.round(h * 10) / 10}px`);
  }
}

const BLOCK = "input,textarea,select,[contenteditable],.no-sheet-drag";

/** Gesture for one sheet: handlers for the handle elements + drag from the content. */
export function useSheetGesture(ref: RefObject<HTMLElement | null>, cfg: SheetConfig) {
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const g = useRef<SheetGesture | null>(null);
  const pid = useRef<number | null>(null);
  const get = () => {
    const el = ref.current;
    if (!el) return null;
    if (!g.current || g.current.el !== el) {
      g.current?.dispose();
      g.current = new SheetGesture(el, () => cfgRef.current);
    }
    return g.current;
  };

  // drag from the content (touch only: the browser's own scrolling is kept unless we take the gesture).
  // Attached as soon as the content exists (the list sheet only appears after the home page).
  const attached = useRef<{ body: HTMLElement; off: () => void } | null>(null);
  useEffect(() => {
    const el = ref.current;
    const sel = cfgRef.current.body;
    const body = el && sel ? el.querySelector<HTMLElement>(sel) : null;
    if (attached.current?.body === body) return;
    attached.current?.off();
    attached.current = el && body ? { body, off: bindContent(el, body) } : null;
  });
  useEffect(
    () => () => {
      attached.current?.off();
      attached.current = null;
      g.current?.dispose();
      g.current = null;
    },
    [],
  );

  const bindContent = (el: HTMLElement, body: HTMLElement) => {
    // one finger, followed by its identifier; a second finger never breaks a drag in progress
    let s: { id: number; x: number; y: number; target: Element; decided: boolean; take: boolean } | null = null;
    const scrolledAbove = (t: Element) => {
      for (let n: Element | null = t; n && n !== el; n = n.parentElement) if (n.scrollTop !== 0) return true; // < 0: iOS top bounce
      return false;
    };
    const finger = (list: TouchList) => (s ? Array.from(list).find((k) => k.identifier === s!.id) : undefined);
    const onStart = (e: TouchEvent) => {
      if (s) {
        if (!s.take) s = null; // a second finger before any decision: not a sheet drag
        return;
      }
      if (!isMobileSheet() || e.touches.length !== 1 || g.current?.dragging) return;
      const t = e.changedTouches[0];
      s = { id: t.identifier, x: t.clientX, y: t.clientY, target: e.target as Element, decided: false, take: false };
    };
    const onMove = (e: TouchEvent) => {
      if (!s) return;
      const t = finger(e.touches);
      if (!t) return;
      if (!s.decided) {
        const dx = t.clientX - s.x;
        const dy = t.clientY - s.y;
        if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
        s.decided = true;
        // a move the browser already treats as scrolling cannot be taken back
        if (!e.cancelable || Math.abs(dx) > Math.abs(dy) || s.target.closest(BLOCK)) return;
        const gs = get();
        if (!gs) return;
        const snaps = gs.snaps();
        const notFull = gs.visible() < snaps[snaps.length - 1] - 2;
        if ((dy > 0 && !scrolledAbove(s.target)) || (dy < 0 && notFull)) {
          s.take = true;
          gs.start(s.y);
        }
      }
      if (s.take) {
        if (e.cancelable) e.preventDefault();
        get()?.move(t.clientY);
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (!s || !finger(e.changedTouches)) return;
      if (s.take) get()?.end(e.type === "touchcancel");
      s = null;
    };
    body.addEventListener("touchstart", onStart, { passive: true });
    body.addEventListener("touchmove", onMove, { passive: false });
    body.addEventListener("touchend", onEnd);
    body.addEventListener("touchcancel", onEnd);
    return () => {
      body.removeEventListener("touchstart", onStart);
      body.removeEventListener("touchmove", onMove);
      body.removeEventListener("touchend", onEnd);
      body.removeEventListener("touchcancel", onEnd);
    };
  };

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!isMobileSheet() || e.button > 0 || pid.current !== null || g.current?.dragging) return;
      if ((e.target as HTMLElement).closest("button:not(.sheet-grip),a," + BLOCK)) return;
      pid.current = e.pointerId;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      get()?.start(e.clientY);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.pointerId === pid.current && g.current?.dragging) g.current.move(e.clientY);
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (e.pointerId !== pid.current) return;
      pid.current = null;
      g.current?.end(false);
    },
    onPointerCancel: (e: React.PointerEvent) => {
      if (e.pointerId !== pid.current) return;
      pid.current = null;
      g.current?.end(true);
    },
  };
  return { handlers, gesture: get };
}
