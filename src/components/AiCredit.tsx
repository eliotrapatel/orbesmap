import { useEffect, useState } from "react";
import { ai, AiError } from "../lib/ai";

type Row = { at: number; task: string; by: string; hit: number; miss: number; out: number; search: number; fetch: number; usd: number; ok: boolean };
type Bal = { is_available: boolean; balance_infos: { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }[] };
type Res = { provider: string; balance: Bal | null; history: Row[] | null; totals: { total: number; week: number; byPerson: Record<string, number>; calls: number } | null };

const TASK: Record<string, string> = { photo: "Traduction photo", interpret: "Interprète", place: "Ajout de lieu", ask: "Demander au carnet" };
const money = (n: number, cur = "USD") => {
  const d = n === 0 || n >= 1 ? 2 : n >= 0.001 ? 3 : 4; // small AI costs stay readable
  return `${n.toFixed(d).replace(".", ",")} ${cur === "CNY" ? "¥" : "$"}`;
};
const who = (by: string) => (/^eliot/i.test(by) ? "Eliot" : /^bertrand/i.test(by) ? "Papa" : by);
const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")} k` : String(n));

/** DeepSeek balance (official API) + history of our own AI calls (logged by the relay, estimated cost). */
export default function AiCredit() {
  const [res, setRes] = useState<Res | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await ai<Res>("balance", {}, 20_000));
    } catch (e) {
      setErr(e instanceof AiError ? e.message : "Solde indisponible.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    load();
    // network back (eSIM, VPN): try again
    const on = () => load();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, []);

  const b = res?.balance?.balance_infos?.[0];
  const h = res?.history || [];
  const histOk = !!res?.history;
  const now = Date.now();
  const sum = (rows: Row[]) => rows.reduce((t, r) => t + (r.usd || 0), 0);
  const today = new Date().toDateString();
  const dayRows = h.filter((r) => new Date(r.at).toDateString() === today);
  const weekRows = h.filter((r) => now - r.at < 7 * 864e5);
  // totals over every call come from the relay; the list below shows the 300 latest
  const t = res?.totals;
  const byPerson = Object.entries(
    Object.entries(t?.byPerson || {}).reduce<Record<string, number>>((m, [p, v]) => ((m[who(p)] = (m[who(p)] || 0) + v), m), {}),
  );
  const days = [...new Set(h.map((r) => new Date(r.at).toDateString()))];

  return (
    <div className="card ai-credit">
      <button className="ai-head" onClick={() => (res ? setOpen((o) => !o) : load())} aria-expanded={open}>
        <span>
          <span className="label">Crédit IA (DeepSeek)</span>
          <b>{b ? money(Number(b.total_balance), b.currency) : busy ? "…" : "—"}</b>
          {b && <small>{res?.balance?.is_available ? "Solde disponible" : "Solde épuisé : rechargez sur platform.deepseek.com"}</small>}
          {!b && res && <small>Solde indisponible pour le moment</small>}
        </span>
        <span className="ai-chev">{!res ? (busy ? "…" : "Réessayer") : open ? "Masquer" : "Historique"}</span>
      </button>
      {err && <p className="tr-err">{err}</p>}
      {open && res && (
        <div className="ai-hist">
          {t ? (
            <div className="ai-totals">
              <span>Aujourd'hui<b>{money(sum(dayRows))}</b></span>
              <span>7 jours<b>{money(t.week ?? sum(weekRows))}</b></span>
              <span>Total ({t.calls} appels)<b>{money(t.total)}</b></span>
            </div>
          ) : (
            <p className="tr-err">Totaux indisponibles pour le moment : touchez Actualiser.</p>
          )}
          {byPerson.length > 0 && <p className="em-small">Par personne : {byPerson.map(([p, v]) => `${p} ${money(v)}`).join(" · ")}</p>}
          {!histOk && <p className="tr-err">Historique indisponible pour le moment : touchez Actualiser.</p>}
          {histOk && !h.length && <p className="em-small">Aucune dépense enregistrée pour l'instant.</p>}
          {histOk && h.length >= 300 && <p className="em-small">Détail : les 300 derniers appels.</p>}
          {days.map((d) => (
            <section key={d} className="ai-day">
              <span className="label">{new Date(d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · {money(sum(h.filter((r) => new Date(r.at).toDateString() === d)))}</span>
              {h.filter((r) => new Date(r.at).toDateString() === d).map((r) => (
                <div key={r.at + r.task} className="ai-row">
                  <span className="ai-time">{new Date(r.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                  <span className="ai-main">
                    <b>{TASK[r.task] || r.task}{r.ok ? "" : " (échec)"}</b>
                    <small>{who(r.by)} · {tokens(r.hit + r.miss)} lus{r.hit ? ` (dont ${tokens(r.hit)} en cache)` : ""} · {tokens(r.out)} écrits{r.search + r.fetch ? ` · ${r.search + r.fetch} recherche${r.search + r.fetch > 1 ? "s" : ""} web` : ""}</small>
                  </span>
                  <span className="ai-cost">{money(r.usd || 0)}</span>
                </div>
              ))}
            </section>
          ))}
          <div className="em-actions">
            <button className="btn-sm" onClick={load} disabled={busy}>{busy ? "Mise à jour…" : "Actualiser"}</button>
          </div>
          <p className="em-small">Solde : donné par DeepSeek. Dépenses : estimées par l'app pour chaque appel, au tarif officiel (heures pleines et creuses), à partir des jetons réellement consommés. Le détail exact reste sur platform.deepseek.com.</p>
        </div>
      )}
    </div>
  );
}
