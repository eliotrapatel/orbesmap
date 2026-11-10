// Opening hours: live status ("Ouvert · ferme à 18h") and checks of a planned visit
// (closed that day, after the last entry, reservation needed…).
export type Hours = {
  always: boolean;
  /** closed days, 0 = Sunday … 6 = Saturday */
  closed: number[];
  open: string;
  close: string;
  lastEntry: string;
  breaks: { from: string; to: string }[];
  byDay: { day: number; open: string; close: string }[];
  reservation: string;
  confidence: "sûr" | "probable" | "inconnu";
  note: string;
};
export type Issue = { tone: "bad" | "warn" | "info"; text: string };

const DAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export const hm = (s?: string): number | null => {
  const m = s?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? +m[1] * 60 + +m[2] : null;
};
export const fmtH = (min: number) => {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
};

/** Opening window for a weekday: null = closed, "always" = open access */
export function windowFor(h: Hours, dow: number): { open: number; close: number } | null | "always" {
  if (h.always) return "always";
  if (h.closed.includes(dow)) return null;
  const d = h.byDay.find((b) => b.day === dow);
  const open = hm(d?.open ?? h.open);
  const close = hm(d?.close ?? h.close);
  if (open == null || close == null) return null;
  return { open, close: close <= open ? close + 24 * 60 : close };
}
const known = (h: Hours) => h.always || hm(h.open) != null || h.byDay.length > 0 || h.closed.length > 0;

/** Weekday + minutes now in the trip's timezone */
function nowIn(tz: string, d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const wd = parts.find((p) => p.type === "weekday")!.value;
  const hh = +parts.find((p) => p.type === "hour")!.value;
  const mm = +parts.find((p) => p.type === "minute")!.value;
  return { dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), min: hh * 60 + mm };
}

/** Live status shown on a place */
export function liveStatus(h: Hours | undefined, tz: string, d = new Date()): { label: string; tone: "ok" | "warn" | "bad" } | null {
  if (!h || !known(h)) return null;
  const { dow, min } = nowIn(tz, d);
  const w = windowFor(h, dow);
  if (w === "always") return { label: "Accès libre", tone: "ok" };
  // still open from yesterday's late hours (bars)
  const y = windowFor(h, (dow + 6) % 7);
  if (y && y !== "always" && y.close > 24 * 60 && min < y.close - 24 * 60) return { label: `Ouvert · ferme à ${fmtH(y.close)}`, tone: "ok" };
  if (!w) {
    for (let i = 1; i <= 7; i++) {
      const n = windowFor(h, (dow + i) % 7);
      if (n && n !== "always") return { label: `Fermé aujourd'hui · ouvre ${i === 1 ? "demain" : DAYS[(dow + i) % 7]} à ${fmtH(n.open)}`, tone: "bad" };
    }
    return { label: "Fermé", tone: "bad" };
  }
  if (min < w.open) return { label: `Fermé · ouvre à ${fmtH(w.open)}`, tone: "warn" };
  if (min >= w.close) return { label: `Fermé · fermait à ${fmtH(w.close)}`, tone: "bad" };
  const br = h.breaks.map((b) => ({ from: hm(b.from), to: hm(b.to) })).find((b) => b.from != null && b.to != null && min >= b.from && min < b.to);
  if (br) return { label: `Pause · rouvre à ${fmtH(br.to!)}`, tone: "warn" };
  const last = hm(h.lastEntry);
  if (last != null && min >= last) return { label: `Dernière entrée passée (${fmtH(last)}) · ferme à ${fmtH(w.close)}`, tone: "bad" };
  if (w.close - min <= 60) return { label: `Ferme bientôt · ${fmtH(w.close)}`, tone: "warn" };
  return { label: `Ouvert · ferme à ${fmtH(w.close)}${last != null ? ` (dernière entrée ${fmtH(last)})` : ""}`, tone: "ok" };
}

/** Problems with a visit planned on `dateISO` at `start` minutes (null = no time) */
export function checkVisit(h: Hours | undefined, dateISO: string | undefined, start: number | null): Issue[] {
  const out: Issue[] = [];
  if (!h) return out;
  if (h.reservation) out.push({ tone: "info", text: `Réservation : ${h.reservation}` });
  if (!known(h)) {
    out.push({ tone: "info", text: "Horaires à vérifier la veille" });
    return out;
  }
  if (!dateISO) return out;
  const dow = new Date(`${dateISO}T12:00:00Z`).getUTCDay();
  const w = windowFor(h, dow);
  if (w === "always") return out;
  if (!w) {
    out.unshift({ tone: "bad", text: `Fermé le ${DAYS[dow]}` });
    return out;
  }
  if (start != null) {
    const last = hm(h.lastEntry);
    if (start < w.open) out.unshift({ tone: "warn", text: `Ouvre à ${fmtH(w.open)} (prévu ${fmtH(start)})` });
    else if (start >= w.close) out.unshift({ tone: "bad", text: `Fermé à cette heure : ferme à ${fmtH(w.close)}` });
    else if (last != null && start > last) out.unshift({ tone: "bad", text: `Dernière entrée ${fmtH(last)} (prévu ${fmtH(start)})` });
    else {
      const br = h.breaks.map((b) => ({ from: hm(b.from), to: hm(b.to) })).find((b) => b.from != null && b.to != null && start >= b.from && start < b.to);
      if (br) out.unshift({ tone: "warn", text: `En pause de ${fmtH(br.from!)} à ${fmtH(br.to!)}` });
      else if (w.close - start < 45) out.unshift({ tone: "warn", text: `Ferme à ${fmtH(w.close)} : peu de temps sur place` });
    }
  }
  if (h.confidence === "inconnu") out.push({ tone: "info", text: "Horaires non confirmés : vérifiez la veille" });
  return out;
}

/** "Mar–dim 10h–18h · dernière entrée 17h" */
export function hoursLine(h: Hours | undefined): string {
  if (!h || !known(h)) return "";
  if (h.always) return "Accès libre";
  const o = hm(h.open), c = hm(h.close);
  const days = h.closed.length ? `Fermé le ${h.closed.map((d) => DAYS[d]).join(", ")} · ` : "Tous les jours · ";
  const base = o != null && c != null ? `${fmtH(o)}–${fmtH(c)}` : "";
  const br = h.breaks.length ? ` (pause ${h.breaks.map((b) => `${fmtH(hm(b.from) ?? 0)}–${fmtH(hm(b.to) ?? 0)}`).join(", ")})` : "";
  const le = hm(h.lastEntry) != null ? ` · dernière entrée ${fmtH(hm(h.lastEntry)!)}` : "";
  return `${days}${base}${br}${le}`;
}
