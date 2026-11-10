import { useEffect, useRef, useState, type ReactNode } from "react";
import { onToast } from "../lib/store";
import { IClose } from "./Icons";

export function Modal({ title, intro, onClose, children }: { title: string; intro?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {intro && <p>{intro}</p>}
        {children}
      </div>
    </div>
  );
}

/** Full-screen, high-contrast text to show a driver or a vendor */
export function ShowScreen({ zh, sub, onClose }: { zh: string; sub?: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="show" role="dialog" aria-modal="true" onClick={onClose}>
      <button className="icon-btn close" aria-label="Fermer" onClick={onClose}>
        <IClose />
      </button>
      <div className="zh" lang="zh-CN">{zh}</div>
      {sub && <div className="sub">{sub}</div>}
      <div className="hint">Touchez l'écran pour fermer</div>
    </div>
  );
}

export function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <img src={src} alt="" />
    </div>
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
        t.current = window.setTimeout(() => setMsg(null), 2400);
      }),
    [],
  );
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

/** Text input that saves on blur (and after a short pause while typing) */
export function SavedInput({ value, onSave, multiline, ...rest }: { value: string; onSave: (v: string) => void; multiline?: boolean; placeholder?: string; id?: string; inputMode?: "text" | "decimal" }) {
  const [v, setV] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
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
    timer.current = window.setTimeout(() => commit(x), 800);
  };
  return multiline ? (
    <textarea className="textarea" value={v} onChange={(e) => change(e.target.value)} onBlur={() => commit(v)} {...rest} />
  ) : (
    <input className="input" value={v} onChange={(e) => change(e.target.value)} onBlur={() => commit(v)} {...rest} />
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

export function compressImage(file: File, max = 1024, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width: w, height: h } = img;
        const s = Math.min(1, max / Math.max(w, h));
        w = Math.round(w * s);
        h = Math.round(h * s);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.src = r.result as string;
    };
    r.readAsDataURL(file);
  });
}
