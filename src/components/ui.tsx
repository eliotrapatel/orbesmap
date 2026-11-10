import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { onToast } from "../lib/store";
import { IClose, ISpeaker } from "./Icons";

/** Overlays are rendered in <body> so they are never trapped inside a transformed panel */
export const Portal = ({ children }: { children: ReactNode }) => createPortal(children, document.body);

// Escape — and the browser / iPhone "back" gesture — close only the topmost overlay (sheet, tool, dialog)
const escStack: (() => void)[] = [];
// one history entry stands for "an overlay is open": back closes the top overlay instead of leaving the app
let hasEntry = false;
let swallow = 0;
let syncTimer: number | undefined;
function syncHistory() {
  window.clearTimeout(syncTimer);
  // after React has mounted / unmounted (switching from one tool to another must not touch history)
  syncTimer = window.setTimeout(() => {
    if (escStack.length && !hasEntry) {
      history.pushState({ ...(history.state || {}), orbesOverlay: true }, "");
      hasEntry = true;
    } else if (!escStack.length && hasEntry) {
      hasEntry = false;
      swallow++;
      history.back();
    }
  }, 0);
}
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented || !escStack.length) return;
    e.preventDefault();
    escStack[escStack.length - 1]();
  });
  window.addEventListener("popstate", () => {
    if (swallow) {
      swallow--;
      return;
    }
    if (!hasEntry) return;
    hasEntry = false;
    escStack[escStack.length - 1]?.();
    syncHistory(); // still another overlay open: a new entry for the next "back"
  });
}
export function useEscape(onClose: () => void) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const h = () => ref.current();
    escStack.push(h);
    syncHistory();
    return () => {
      const i = escStack.lastIndexOf(h);
      if (i >= 0) escStack.splice(i, 1);
      syncHistory();
    };
  }, []);
}

export function Modal({ title, intro, onClose, children, className }: { title: string; intro?: string; onClose: () => void; children: ReactNode; className?: string }) {
  useEscape(onClose);
  return (
    <Portal>
      <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className={"modal" + (className ? " " + className : "")} role="dialog" aria-modal="true" aria-label={title}>
          <h3>{title}</h3>
          {intro && <p>{intro}</p>}
          {children}
        </div>
      </div>
    </Portal>
  );
}

export function speak(text: string, lang = "zh-CN") {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.85;
    const v = synth.getVoices().find((x) => x.lang.replace("_", "-").toLowerCase().startsWith(lang.toLowerCase()));
    if (v) u.voice = v;
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

/** Full-screen, high-contrast Chinese text to show a driver or a vendor (with read-aloud) */
export function ShowScreen({ zh, sub, onClose }: { zh: string; sub?: string; onClose: () => void }) {
  useEscape(onClose);
  return (
    <Portal>
      <div className="show" role="dialog" aria-modal="true" onClick={onClose}>
        <button className="icon-btn close" aria-label="Fermer" onClick={onClose}>
          <IClose />
        </button>
        <div className="zh" lang="zh-CN">{zh}</div>
        {sub && <div className="sub">{sub}</div>}
        <button className="speak" onClick={(e) => { e.stopPropagation(); speak(zh); }}>
          <ISpeaker /> Écouter
        </button>
        <div className="hint">Touchez l'écran pour fermer</div>
      </div>
    </Portal>
  );
}

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEscape(onClose);
  return (
    <Portal>
      <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
        <img src={src} alt="" />
      </div>
    </Portal>
  );
}

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  const t = useRef<number | undefined>(undefined);
  useEffect(
    () =>
      onToast((m) => {
        setMsg(m);
        window.clearTimeout(t.current);
        t.current = window.setTimeout(() => setMsg(null), 2600);
      }),
    [],
  );
  return msg ? (
    <Portal>
      <div className="toast" role="status">{msg}</div>
    </Portal>
  ) : null;
}

/** Text input that saves on blur and after a short pause while typing. Edits are never overwritten mid-typing. */
export function SavedInput({ value, onSave, multiline, ...rest }: { value: string; onSave: (v: string) => void; multiline?: boolean; placeholder?: string; id?: string; inputMode?: "text" | "decimal" }) {
  const [v, setV] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  const last = useRef(value);
  const focused = useRef(false);
  useEffect(() => {
    if (value !== last.current && !focused.current) {
      setV(value);
      last.current = value;
    }
  }, [value]);
  const commit = (x: string) => {
    window.clearTimeout(timer.current);
    if (x !== last.current) {
      last.current = x;
      onSave(x);
    }
  };
  const change = (x: string) => {
    setV(x);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => commit(x), 700);
  };
  const common = {
    value: v,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      if (v !== last.current) commit(v);
      else if (value !== last.current) {
        // a newer value arrived from another device while typing nothing new: show it
        setV(value);
        last.current = value;
      }
    },
    ...rest,
  };
  return multiline ? (
    <textarea className="textarea" {...common} onChange={(e) => change(e.target.value)} />
  ) : (
    <input className="input" {...common} onChange={(e) => change(e.target.value)} />
  );
}

export async function copy(text: string, ok: string, toast: (m: string) => void) {
  try {
    await navigator.clipboard.writeText(text);
    toast(ok);
  } catch {
    toast(text);
  }
}

/** Resize a picture to max 1600 px JPEG (stored on the device in IndexedDB, then uploaded) */
export function compressImage(file: File, max = 1600, quality = 0.8): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/jpeg", quality);
    };
    img.src = url;
  });
}

/** Mobile bottom sheets: drag the grip (or a tool's header) down to close, up to open full height. */
export function useSheetDrag(onClose: () => void) {
  const ref = useRef<HTMLElement>(null);
  const [full, setFull] = useState(false);
  const drag = useRef<{ y0: number; t0: number; dy: number } | null>(null);
  const mobile = () => window.matchMedia("(max-width: 899px)").matches;
  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!mobile() || (e.target as HTMLElement).closest("button,a,input,textarea,select")) return;
      drag.current = { y0: e.clientY, t0: performance.now(), dy: 0 };
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
      if (ref.current) ref.current.style.transition = "none";
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d || !ref.current) return;
      d.dy = e.clientY - d.y0;
      // follows the finger downwards; upwards only a hint (it snaps to full height on release)
      ref.current.style.transform = `translateY(${d.dy > 0 ? d.dy : d.dy / 4}px)`;
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      const el = ref.current;
      if (!d || !el) return;
      const v = d.dy / Math.max(1, performance.now() - d.t0);
      el.style.transition = "transform 0.22s var(--ease)";
      if (d.dy > 90 || (d.dy > 24 && v > 0.6)) {
        el.style.transform = "translateY(100%)";
        window.setTimeout(onClose, 180);
        return;
      }
      el.style.transform = "";
      if (d.dy < -50) setFull(true);
      else if (d.dy > 40 && full) setFull(false);
    },
    onPointerCancel: () => {
      drag.current = null;
      if (ref.current) {
        ref.current.style.transition = "transform 0.22s var(--ease)";
        ref.current.style.transform = "";
      }
    },
  };
  return { ref, full, handlers };
}

/** Glass drawer used by every tool (desktop: right column, mobile: bottom sheet) */
export function Drawer({ kicker, title, onClose, wide, children, sheetH, actions }: { kicker?: string; title: string; onClose: () => void; wide?: boolean; children: ReactNode; sheetH?: string; actions?: ReactNode }) {
  useEscape(onClose);
  const sheet = useSheetDrag(onClose);
  return (
    <section
      ref={sheet.ref}
      className={"drawer glass" + (wide ? " wide" : "") + (sheet.full ? " sheet-full" : "")}
      style={sheetH ? ({ ["--sheet-h" as string]: sheetH } as React.CSSProperties) : undefined}
      aria-label={title}
    >
      <div className="sheet-grip" {...sheet.handlers} role="button" aria-label="Glisser vers le bas pour fermer, vers le haut pour agrandir" />
      <div className="drawer-head" {...sheet.handlers}>
        <div>
          {kicker && <span className="label">{kicker}</span>}
          <h3>{title}</h3>
        </div>
        {actions}
        <button className="icon-btn" onClick={onClose} aria-label="Fermer">
          <IClose />
        </button>
      </div>
      <div className="drawer-body scroll">{children}</div>
    </section>
  );
}
