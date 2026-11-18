import { useEffect, useState } from "react";
import { toast } from "../../lib/store";
import {
  adminAccounts, adminCodes, adminCreateCode, adminFunnel, adminOverview, adminSetCodeActive, adminSetPro, adminUser, adminWaitlist, type Funnel, type UserSheet,
  type AccountRow, type CodeRow, type Overview, type WaitRow,
} from "../../lib/pro";
import Shell from "./Shell";
import { locale, t, tk } from "../../lib/i18n";

type Tab = "figures" | "accounts" | "codes" | "waitlist";
const TABS: [Tab, string][] = [["figures", "Chiffres"], ["accounts", "Comptes"], ["codes", "Codes"], ["waitlist", "Attente"]];
const DURATIONS: [string, number | null][] = [["30 jours", 30], ["90 jours", 90], ["1 an", 365], ["À vie", null]];
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "2-digit", timeZone: "Europe/Paris" }) : "—");
const usd = (n: number) => t("{n} $", { n: (Number(n) || 0).toFixed(2) });
const copy = (text: string, what: string) =>
  navigator.clipboard?.writeText(text).then(() => toast(t("{what} copié", { what: t(what) })), () => toast(t("Copie impossible sur cet appareil")));

/** The admin's screen: figures (accounts, trips, AI cost), accounts (Pro by hand), Pro codes, waiting list */
export default function AdminScreen({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("figures");
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onClose} aria-label={t("Fermer")}>✕</button>
      <span className="v3-grow" style={{ textAlign: "center", color: "var(--soft)", fontSize: 13 }}>{t("Administration")}</span>
      <span className="v3-tool ghost" />
    </div>
  );
  return (
    <Shell className="v3-admin" ring={false} top={top}>
      <div className="v3-seg" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t(label)}</button>
        ))}
      </div>
      {tab === "figures" && <Figures />}
      {tab === "accounts" && <Accounts />}
      {tab === "codes" && <Codes />}
      {tab === "waitlist" && <Waitlist />}
    </Shell>
  );
}

/** Loads once per tab opening; `again` reloads */
function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(null);
    load().then((d) => live && setData(d), (e) => live && setErr((e as Error).message));
    return () => {
      live = false;
    };
  }, [n, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, err, again: () => setN((x) => x + 1) };
}

function Figures() {
  const { data: o, err } = useLoad<Overview>(adminOverview);
  if (err) return <p className="v3-err">{err}</p>;
  if (!o) return <p className="v3-note">{t("Chargement…")}</p>;
  const max = Math.max(0.0001, ...o.days.map((d) => Number(d.usd) || 0));
  const stats: [string, string, string?][] = [
    [t("Comptes"), String(o.accounts), t("+{n} en 7 jours", { n: o.accounts7 })],
    [t("Voyages"), String(o.trips), t("+{n} en 7 jours", { n: o.trips7 })],
    [t("Préparés par l'IA"), String(o.prepared30), t("30 derniers jours")],
    [t("Pro actifs"), String(o.pro), t("codes et accès donnés")],
    [t("Liste d'attente"), String(o.waitlist)],
    [t("IA aujourd'hui"), String(o.aiToday), usd(o.usdToday)],
  ];
  return (
    <>
      <div className="adm-stats">
        {stats.map(([l, v, s]) => (
          <div key={l} className="adm-stat">
            <span className="v3-lbl">{l}</span>
            <b>{v}</b>
            {s && <small>{s}</small>}
          </div>
        ))}
      </div>
      <div className="v3-glass adm-card">
        <div className="adm-head"><span className="v3-lbl">{t("Coût IA, 30 jours")}</span><b>{usd(o.usd30)}</b></div>
        {o.days.length === 0 && <p className="v3-note">{t("Aucune demande à l'IA sur 30 jours.")}</p>}
        <div className="adm-bars" role="img" aria-label={t("Coût IA par jour sur 30 jours, total {total}", { total: usd(o.usd30) })}>
          {o.days.map((d) => (
            <i key={d.day} style={{ height: `${Math.max(3, ((Number(d.usd) || 0) / max) * 100)}%` }} title={t("{day} : {n} demandes, {usd}", { day: day(d.day), n: d.calls, usd: usd(d.usd) })} />
          ))}
        </div>
        <p className="v3-note">{t("Hors espace partagé, dont les demandes sont suivies à part.")}</p>
      </div>
      <Path />
    </>
  );
}

const STEPS: [string, string][] = [
  ["visit", "Visites de la page publique"],
  ["signup_email", "E-mails de connexion envoyés"],
  ["signup_done", "Inscriptions terminées"],
  ["app_open", "Ouvertures de l'app (connecté)"],
  ["trip_created", "Voyages créés"],
  ["trip_validated", "Voyages validés"],
  ["place_added", "Lieux ajoutés à la main"],
  ["invite_sent", "Invitations envoyées"],
  ["export", "Exports"],
  ["pro_screen", "Écran Pro vu"],
  ["waitlist_join", "Liste d'attente rejointe"],
  ["code_redeemed", "Codes activés"],
];
/** The name of each step, in a person's timeline */
const STEP_LABEL: Record<string, string> = {
  visit: "Page publique vue", signup_email: "E-mail de connexion demandé", signup_done: "Inscription terminée", sign_in: "Connexion",
  app_open: "App ouverte", trip_created: "Voyage créé", trip_opened: "Voyage ouvert", trip_validated: "Voyage validé",
  place_added: "Lieu ajouté", invite_sent: "Invitation envoyée", export: "Export", pro_screen: "Écran Pro",
  code_redeemed: "Code Pro activé", waitlist_join: "Liste d'attente rejointe",
};
/** Details of a step and AI uses, in words */
const DETAIL: Record<string, string> = {
  link: "par lien ou nom", map: "sur la carte", pdf: "PDF", csv: "tableur", ics: "calendrier", offline: "carte hors ligne", data: "ses données",
  editor: "peut modifier", viewer: "lecture seule",
};
const AI_TASK: Record<string, string> = {
  outline: "trames", day: "jours préparés", essentials: "essentiels", enrich: "fiches", adjust: "ajustements", intake: "collages",
  extract: "réservations lues", place: "lieux cherchés", ask: "questions", photo: "photos", interpret: "interprète",
};
const when = (iso: string) => new Date(iso).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const PRO_WHY: Record<string, string> = { edit: "modifier un voyage validé", prep: "voyage du mois utilisé", export: "exports et hors ligne", business: "mode affaires", info: "depuis le compte" };

/** The visitor's path over 30 days (anonymous steps, supabase/saas-5.sql) */
function Path() {
  const { data: f } = useLoad<Funnel | null>(adminFunnel);
  if (!f) return null;
  const top = Math.max(1, ...STEPS.map(([k]) => f.steps[k]?.now || 0));
  const pro = Object.entries(f.pro).sort((a, b) => b[1] - a[1]);
  return (
    <div className="v3-glass adm-card">
      <div className="adm-head"><span className="v3-lbl">{t("Parcours, 30 jours")}</span><small className="v3-note" style={{ margin: 0 }}>{t("personnes · 30 j avant")}</small></div>
      <p className="v3-note">{t("Comptes actifs : {n} sur 30 jours, {n7} sur 7 jours.", { n: f.active, n7: f.active7 })}</p>
      <div className="adm-path">
        {STEPS.map(([k, label]) => {
          const s = f.steps[k] || { now: 0, before: 0, people: 0 };
          return (
            <div key={k} className="adm-step">
              <span className="adm-step-bar" style={{ width: `${Math.max(2, (s.now / top) * 100)}%` }} />
              <span className="v3-grow">{t(label)}</span>
              <b>{s.now}</b>
              <small title={t("personnes")}>{s.people || 0}</small>
              <small>{s.before}</small>
            </div>
          );
        })}
      </div>
      <p className="v3-note">{t("Visites : {phones} sur téléphone, {computers} sur ordinateur.", { phones: f.phones, computers: f.computers })}</p>
      {f.refs.length > 0 && <p className="v3-note">{t("Venus de : {list}.", { list: f.refs.map((r) => `${r.ref} (${r.n})`).join(", ") })}</p>}
      {pro.length > 0 && <p className="v3-note">{t("Écran Pro : {list}.", { list: pro.map(([k, n]) => `${t(PRO_WHY[k] || k)} (${n})`).join(", ") })}</p>}
      <p className="v3-note">{t("Le détail de chaque personne est dans Comptes : touchez un compte.")}</p>
    </div>
  );
}

function Accounts() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const { data, err, again } = useLoad<AccountRow[]>(() => adminAccounts(search), [search]);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<AccountRow | null>(null);
  const setPro = async (a: AccountRow, days: number | null) => {
    setBusy(a.user_id);
    try {
      await adminSetPro(a.user_id, days);
      toast(days === 0 ? t("Pro retiré") : t("Pro donné"));
      again();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <form className="v3-field" style={{ marginTop: 14 }} onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
        <span className="sr">{t("Chercher un compte")}</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Chercher (e-mail, prénom)")} inputMode="search" />
      </form>
      {err && <p className="v3-err">{err}</p>}
      {!data && !err && <p className="v3-note">{t("Chargement…")}</p>}
      {data && <p className="v3-note">{data.length > 1 ? t("{n} comptes", { n: data.length }) : t("{n} compte", { n: data.length })}{data.length === 300 ? t(" (les 300 plus récents)") : ""}</p>}
      <div className="adm-list">
        {data?.map((a) => (
          <div key={a.user_id} className="adm-row">
            <button type="button" className="v3-grow adm-main" onClick={() => setOpen(a)} aria-label={t("Voir le compte {email}", { email: a.email })}>
              <b>{a.name || a.email.split("@")[0]}{a.admin && <span className="v3-tag dim" style={{ marginLeft: 6 }}>admin</span>}</b>
              <small>{a.email}</small>
              <small>{t("Inscrit {date}", { date: day(a.created_at) })} · {t("actif {date}", { date: day(a.last_active ?? a.last_seen) })} · {a.trips > 1 ? t("{n} voyages", { n: a.trips }) : t("{n} voyage", { n: a.trips })} · {t("{n} IA/30 j", { n: a.ai30 })}{a.steps30 != null ? ` · ${t("{n} actions/30 j", { n: a.steps30 })}` : ""}{a.waitlisted ? ` · ${t("en attente")}` : ""}</small>
            </button>
            <div className="adm-side">
              {a.pro ? <span className="v3-tag gold">{a.granted ? (a.until ? `Pro → ${day(a.until)}` : t("Pro à vie")) : t("Pro inclus")}</span> : <span className="v3-tag dim">{t("Gratuit")}</span>}
              <select
                aria-label={t("Pro pour {email}", { email: a.email })}
                disabled={busy === a.user_id}
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  void setPro(a, v === "life" ? null : Number(v));
                }}
              >
                <option value="">Pro…</option>
                <option value="30">{t("30 jours")}</option>
                <option value="365">{t("1 an")}</option>
                <option value="life">{t("À vie")}</option>
                {a.granted && <option value="0">{t("Retirer")}</option>}
              </select>
            </div>
          </div>
        ))}
      </div>
      {open && <AccountSheet row={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** One person, in full: profile, plan, trips, AI use, where they came from, every step */
function AccountSheet({ row, onClose }: { row: AccountRow; onClose: () => void }) {
  const { data: u, err } = useLoad<UserSheet>(() => adminUser(row.user_id), [row.user_id]);
  const p = (u?.profile || {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "");
  const titleOf = (id: string | null) => (id ? u?.trips.find((t) => t.id === id)?.title || "" : "");
  const facts: [string, string][] = u
    ? ([
        [t("Prénom"), String(p.name || "")],
        [tk("travel-style", "Voyage"), list(p.travel)],
        [t("Goûts"), list(p.interests)],
        [t("Rythme"), list(p.pace)],
        [t("Budget"), list(p.budget)],
        [t("Langue"), list(p.lang)],
        [t("Inscrit"), when(u.created_at)],
        [t("Dernière connexion"), u.last_seen ? when(u.last_seen) : "—"],
        [t("Première visite"), u.firstSeen ? when(u.firstSeen) : "—"],
        [t("Venu de"), u.firstRef || t("accès direct ou inconnu")],
        [t("Visites avant inscription"), String(u.visitsBefore)],
        ["Pro", u.pro ? (u.grant ? (u.grant.until ? t("jusqu'au {date} ({source})", { date: day(u.grant.until), source: u.grant.source || "" }) : t("à vie ({source})", { source: u.grant.source || "" })) : t("inclus")) : t("non")],
        [t("IA"), t("{calls30} demandes · {usd30} sur 30 j — {calls} · {usd} au total", { calls30: u.ai.calls30, usd30: usd(u.ai.usd30), calls: u.ai.calls, usd: usd(u.ai.usd) })],
      ] as [string, string][]).filter(([, v]) => v)
    : [];
  return (
    <div className="adm-sheet" role="dialog" aria-label={t("Compte {email}", { email: row.email })}>
      <div className="adm-sheet-in">
        <div className="v3-bar">
          <button className="v3-tool" onClick={onClose} aria-label={t("Fermer")}>✕</button>
          <span className="v3-grow" />
        </div>
        <h2 className="v3-d v3-h2" style={{ fontSize: 28 }}>{row.name || row.email.split("@")[0]}</h2>
        <p className="v3-note" style={{ overflowWrap: "anywhere" }}>{row.email}{u && !u.confirmed ? ` · ${t("e-mail non confirmé")}` : ""}</p>
        {err && <p className="v3-err">{err}</p>}
        {!u && !err && <p className="v3-note">{t("Chargement…")}</p>}
        {u && (
          <>
            <dl className="adm-facts">
              {facts.map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            <span className="v3-lbl adm-sub">{t("Voyages ({n})", { n: u.trips.length })}</span>
            <div className="adm-list">
              {u.trips.map((tr) => (
                <div key={tr.id} className="adm-row">
                  <div className="v3-grow adm-main">
                    <b>{tr.title || t("Sans titre")}</b>
                    <small>{tr.dates || ""} · {tr.role === "owner" ? t("créé") : tr.role === "editor" ? t("invité (modifie)") : t("invité (lecture)")} {day(tr.created_at)} · {tr.places > 1 ? t("{n} lieux", { n: tr.places }) : t("{n} lieu", { n: tr.places })} · {tr.status === "done" ? t("validé") : tr.status === "review" ? t("en revue") : tr.status === "preparing" ? t("en préparation") : t("sans préparation")}</small>
                  </div>
                </div>
              ))}
              {!u.trips.length && <p className="v3-note">{t("Aucun voyage.")}</p>}
            </div>
            {Object.keys(u.counts).length > 0 && (
              <>
                <span className="v3-lbl adm-sub">{t("Actions (13 derniers mois)")}</span>
                <div className="adm-counts">
                  {Object.entries(u.counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                    <span key={k} className="v3-tag dim">{t(STEP_LABEL[k] || k)} · {n}</span>
                  ))}
                </div>
              </>
            )}
            {Object.keys(u.ai.tasks).length > 0 && (
              <p className="v3-note">{t("IA par usage : {list}.", { list: Object.entries(u.ai.tasks).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${t(AI_TASK[k] || k)} ${n}`).join(", ") })}</p>
            )}
            <span className="v3-lbl adm-sub">{t("Parcours (200 dernières actions)")}</span>
            <div className="adm-timeline">
              {u.events.map((e, i) => (
                <div key={i} className="adm-ev">
                  <span className="adm-ev-at">{when(e.at)}</span>
                  <span className="v3-grow">
                    {t(STEP_LABEL[e.name] || e.name)}
                    {e.detail ? ` · ${t((e.name === "pro_screen" ? PRO_WHY[e.detail] : DETAIL[e.detail]) || e.detail)}` : ""}
                    {e.trip && titleOf(e.trip) ? ` · ${titleOf(e.trip)}` : ""}
                    {e.ref ? ` · ${t("depuis {ref}", { ref: e.ref })}` : ""}
                  </span>
                  <small>{e.device === "computer" ? t("ordi") : e.device === "phone" ? t("tél.") : ""}</small>
                </div>
              ))}
              {!u.events.length && <p className="v3-note">{t("Aucune action enregistrée pour l'instant.")}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Codes() {
  const { data, err, again } = useLoad<CodeRow[]>(adminCodes);
  const [dur, setDur] = useState(0);
  const [uses, setUses] = useState("1");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const code = await adminCreateCode(DURATIONS[dur][1], Math.max(1, Math.min(100000, Number(uses) || 1)), note);
      setFresh(code);
      setNote("");
      again();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (c: CodeRow) => {
    try {
      await adminSetCodeActive(c.code, !c.active);
      again();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <>
      <div className="v3-glass adm-card">
        <span className="v3-lbl">{t("Nouveau code")}</span>
        <div className="v3-chips" style={{ marginTop: 10 }}>
          {DURATIONS.map(([l], i) => (
            <button key={l} type="button" className={"v3-chip" + (dur === i ? " on" : "")} aria-pressed={dur === i} onClick={() => setDur(i)}>{t(l)}</button>
          ))}
        </div>
        <div className="v3-dates">
          <label className="v3-field col">
            <span>{t("Utilisations")}</span>
            <input value={uses} onChange={(e) => setUses(e.target.value.replace(/\D/g, ""))} inputMode="numeric" maxLength={6} />
          </label>
          <label className="v3-field col">
            <span>{t("Note (pour qui)")}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t("facultatif")} />
          </label>
        </div>
        <button className="v3-btn" style={{ marginTop: 12 }} disabled={busy} onClick={() => void create()}>{busy ? t("Création…") : t("Créer le code")}</button>
        {fresh && (
          <button type="button" className="adm-fresh" onClick={() => copy(fresh, "Code")}>
            <b>{fresh}</b><small>{t("Toucher pour copier")}</small>
          </button>
        )}
        {msg && <p className="v3-err">{msg}</p>}
      </div>
      {err && <p className="v3-err">{err}</p>}
      <div className="adm-list">
        {data?.map((c) => (
          <div key={c.code} className={"adm-row" + (c.active ? "" : " off")}>
            <button type="button" className="v3-grow adm-main" onClick={() => copy(c.code, "Code")} aria-label={t("Copier le code {code}", { code: c.code })}>
              <b className="adm-code">{c.code}</b>
              <small>{c.days ? t("{n} jours", { n: c.days }) : t("À vie")} · {c.uses > 1 ? t("{uses}/{max} utilisés", { uses: c.uses, max: c.max_uses }) : t("{uses}/{max} utilisé", { uses: c.uses, max: c.max_uses })} · {day(c.created_at)}{c.note ? ` · ${c.note}` : ""}</small>
            </button>
            <button type="button" className="v3-chip adm-toggle" onClick={() => void toggle(c)}>{c.active ? t("Désactiver") : t("Réactiver")}</button>
          </div>
        ))}
        {data && !data.length && <p className="v3-note">{t("Aucun code pour l'instant.")}</p>}
      </div>
    </>
  );
}

function Waitlist() {
  const { data, err } = useLoad<WaitRow[]>(adminWaitlist);
  if (err) return <p className="v3-err">{err}</p>;
  if (!data) return <p className="v3-note">{t("Chargement…")}</p>;
  return (
    <>
      <div className="v3-titlerow" style={{ marginTop: 16 }}>
        <span className="v3-lbl">{data.length > 1 ? t("{n} personnes à prévenir", { n: data.length }) : t("{n} personne à prévenir", { n: data.length })}</span>
        {data.length > 0 && <button className="v3-chip" onClick={() => copy(data.map((w) => w.email).join(", "), "Adresses")}>{t("Copier les adresses")}</button>}
      </div>
      <div className="adm-list">
        {data.map((w) => (
          <div key={w.email} className="adm-row">
            <div className="v3-grow adm-main"><b>{w.email}</b><small>{day(w.created_at)}{w.lang ? ` · ${w.lang.toUpperCase()}` : ""}</small></div>
          </div>
        ))}
      </div>
    </>
  );
}

