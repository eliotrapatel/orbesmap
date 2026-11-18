import { useEffect, useState } from "react";
import { toast } from "../../lib/store";
import {
  adminAccounts, adminCodes, adminCreateCode, adminFunnel, adminOverview, adminSetCodeActive, adminAi, adminSetPro, adminUser, adminWaitlist, type AiRow, type Funnel, type UserSheet,
  type AccountRow, type CodeRow, type Overview, type WaitRow,
} from "../../lib/pro";
import Shell from "./Shell";
import { overview, partnerCsv, people, personasOf, totalSpend, type Person } from "../../lib/insights";
import { EXPENSE_CATEGORIES } from "../../lib/business";
import { TYPE_LABEL } from "../../data/trip";
import { locale, t, tk } from "../../lib/i18n";
import { currencyAffix, lastDays } from "../../lib/peakData";
import { PeakSlot } from "./ui/PeakCard";
import { adminChannels, adminCohorts, adminUserSources, pct, span, type CohortPeriod, type Cohorts, type Channels, type UserSources } from "../../lib/measure";
import { CHANNELS } from "../../lib/source";
import "../../styles/measure.css";

type Tab = "figures" | "profiles" | "accounts" | "codes" | "waitlist";
const TABS: [Tab, string][] = [["figures", "Chiffres"], ["profiles", "Profils"], ["accounts", "Comptes"], ["codes", "Codes"], ["waitlist", "Attente"]];
const DURATIONS: [string, number | null][] = [["30 jours", 30], ["90 jours", 90], ["1 an", 365], ["À vie", null]];
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "2-digit", timeZone: "Europe/Paris" }) : "—");
const usd = (n: number) => t("{n} $", { n: (Number(n) || 0) < 0.1 && Number(n) > 0 ? (Number(n) || 0).toFixed(4) : (Number(n) || 0).toFixed(2) });
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
      {tab === "profiles" && <Profiles />}
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
  const [span, setSpan] = useState<7 | 30>(30);
  if (err) return <p className="v3-err">{err}</p>;
  if (!o) return <p className="v3-note">{t("Chargement…")}</p>;
  // the AI cost per UTC day (the only per-day figure the server gives; sign-ups per day do not exist yet)
  const today = new Date().toISOString().slice(0, 10);
  const s = lastDays(o.days.map((d) => ({ day: String(d.day), value: Number(d.usd) || 0 })), span, today);
  const callsBy = new Map(o.days.map((d) => [String(d.day).slice(0, 10), Number(d.calls) || 0]));
  const calls = s.days.reduce((n, d) => n + (callsBy.get(d) ?? 0), 0);
  const total = s.values.reduce((a, b) => a + b, 0);
  const aff = currencyAffix(locale(), "USD");
  // the same precision as usd(): 4 decimals under $0.10, so a week of cheap requests never reads 0,00 $
  const decOf = (n: number) => (n > 0 && n < 0.1 ? 4 : 2);
  const usdFr = (n: number) => {
    const v = Number(n) || 0;
    const d = decOf(v);
    return `${aff.prefix}${new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v)}${aff.suffix}`;
  };
  const labels = s.days.map((d) => t("{day} · {n} demandes", { day: day(d), n: callsBy.get(d) ?? 0 }));
  const caption =
    calls === 0
      ? span === 7 ? t("Aucune demande à l'IA sur 7 jours.") : t("Aucune demande à l'IA sur 30 jours.")
      : total > 0
        ? t("{n} demandes · le jour le plus cher : {day}, {usd}", { n: calls, day: day(s.days[s.peakIndex]), usd: usdFr(s.values[s.peakIndex]) })
        : t("{n} demandes", { n: calls });
  const p7 = t("7 jours");
  const p30 = t("30 jours");
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
      {o.days.length === 0 ? (
        <div className="v3-glass adm-card">
          <div className="adm-head"><span className="v3-lbl">{t("Coût IA, 30 jours")}</span><b>{usd(o.usd30)}</b></div>
          <p className="v3-note">{t("Aucune demande à l'IA sur 30 jours.")}</p>
          <p className="v3-note">{t("Hors espace partagé, dont les demandes sont suivies à part.")}</p>
        </div>
      ) : (
        <>
          <figure className="adm-peak" aria-label={t("Coût IA par jour sur {n} jours, total {total}", { n: span, total: usdFr(total) })}>
            <PeakSlot
              mode={total > 0 ? "chart" : "number"}
              data={s.values}
              labels={labels}
              value={total}
              decimals={decOf(total)}
              valuePrefix={aff.prefix}
              valueSuffix={aff.suffix}
              locale={locale()}
              trend="none"
              title={t("Coût IA")}
              caption={caption}
              periods={[p7, p30]}
              period={span === 7 ? p7 : p30}
              onPeriodChange={(p) => setSpan(p === p7 ? 7 : 30)}
              periodLabel={t("Période")}
              formatValue={usdFr}
            />
          </figure>
          <p className="v3-note">{t("Hors espace partagé, dont les demandes sont suivies à part.")}</p>
        </>
      )}
      <Path />
      <CohortView />
      <SourcesView />
      <AiBySteps />
    </>
  );
}

const AI_STEP: Record<string, string> = {
  intake: "Lecture du collage", concierge: "Échange avec le concierge", extract: "Lecture d'une réservation", outline: "Trame du voyage", essentials: "Essentiel pratique", day: "Préparation d'un jour",
  adjust: "Ajustement", enrich: "Fiche complète", place: "Recherche d'un lieu", ask: "Question à l'assistant", photo: "Photo traduite", interpret: "Interprète", inbound: "Réservation transférée",
};
const nf = (n: number) => new Intl.NumberFormat(locale()).format(Math.round(n));

/** Everyone's AI over 30 days, per step: requests, tokens, web searches, time, cost */
function AiBySteps() {
  const { data, err } = useLoad<AiRow[]>(() => adminAi(undefined, 720));
  if (err) return <p className="v3-note">{err}</p>;
  if (!data?.length) return null;
  const by = new Map<string, { n: number; ko: number; tin: number; tout: number; s: number; ms: number; usd: number }>();
  for (const r of data) {
    const x = by.get(r.task) || { n: 0, ko: 0, tin: 0, tout: 0, s: 0, ms: 0, usd: 0 };
    x.n++;
    if (!r.ok) x.ko++;
    x.tin += (r.tokens_cached || 0) + (r.tokens_in || 0);
    x.tout += r.tokens_out || 0;
    x.s += (r.searches || 0) + (r.fetches || 0);
    x.ms += r.ms || 0;
    x.usd += Number(r.usd) || 0;
    by.set(r.task, x);
  }
  const rows = [...by].sort((a, b) => b[1].usd - a[1].usd);
  return (
    <div className="v3-glass adm-card">
      <span className="v3-lbl">{t("IA par étape, 30 jours")}</span>
      <div className="adm-table">
        <div className="adm-tr adm-th"><span>{t("Étape")}</span><span>{t("Demandes")}</span><span>{t("Tokens lus / écrits")}</span><span>{t("Web")}</span><span>{t("Durée moy.")}</span><span>{t("Coût")}</span></div>
        {rows.map(([k, x]) => (
          <div key={k} className="adm-tr">
            <span>{t(AI_STEP[k] || k)}</span><span>{x.n}{x.ko ? ` (${x.ko} ✗)` : ""}</span><span>{nf(x.tin)} / {nf(x.tout)}</span><span>{x.s}</span>
            <span>{(x.ms / x.n / 1000).toFixed(1)} s</span><span>{usd(x.usd)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** One account's AI requests, one by one */
function AiDetail({ userId }: { userId: string }) {
  const { data, err } = useLoad<AiRow[]>(() => adminAi(userId, 24 * 90), [userId]);
  if (err) return <p className="v3-note">{err}</p>;
  if (!data?.length) return null;
  return (
    <>
      <span className="v3-lbl adm-sub">{t("Détail de l'IA (90 jours, {n} demandes)", { n: data.length })}</span>
      <div className="adm-timeline">
        {data.slice(0, 100).map((r, i) => (
          <div key={i} className="adm-ev">
            <span className="adm-ev-at">{when(r.at)}</span>
            <span className="v3-grow">
              {t(AI_STEP[r.task] || r.task)}{r.trip ? ` · ${r.trip}` : ""}{r.ok ? "" : ` · ✗ ${r.error || ""}`}
              <small style={{ display: "block" }}>
                {r.tokens_in != null ? t("{a} lus ({c} en cache) · {b} écrits", { a: nf((r.tokens_in || 0) + (r.tokens_cached || 0)), c: nf(r.tokens_cached || 0), b: nf(r.tokens_out || 0) }) : ""}
                {r.searches || r.fetches ? ` · ${t("{s} recherches, {f} pages", { s: r.searches || 0, f: r.fetches || 0 })}` : ""}
                {r.ms ? ` · ${(r.ms / 1000).toFixed(1)} s` : ""}{r.model ? ` · ${r.model}` : ""}
              </small>
            </span>
            <small>{usd(Number(r.usd))}</small>
          </div>
        ))}
      </div>
    </>
  );
}

const STEPS: [string, string][] = [
  ["visit", "Visites de la page publique"],
  ["signup_email", "E-mails de connexion envoyés"],
  ["signup_submitted", "Inscriptions envoyées"],
  ["signup_done", "Inscriptions terminées (ancien nom)"],
  ["onboarding_done", "Accueils terminés"],
  ["app_open", "Ouvertures de l'app (connecté)"],
  ["trip_created", "Voyages créés"],
  ["prep_started", "Préparations lancées"],
  ["prep_ready", "Préparations prêtes"],
  ["trip_validated", "Voyages validés"],
  ["place_added", "Lieux ajoutés à la main"],
  ["invite_sent", "Invitations envoyées"],
  ["invite_accepted", "Invitations acceptées"],
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
  link_opened: "Lien public créé", public_view: "Programme partagé vu", trip_copied: "Voyage copié", expense_added: "Dépense ajoutée",
  place_opened: "Lieu ouvert", tool_opened: "Outil ouvert", status_set: "Statut changé", note_written: "Note écrite", photo_added: "Photo ajoutée",
  vote: "Vote", comment_added: "Commentaire", checklist_done: "Check-list cochée", language_changed: "Langue changée", alerts_changed: "Alertes changées",
  search: "Recherche", adjust_asked: "Ajustement demandé", day_redone: "Jour régénéré",
  // the measured path (supabase/saas-12.sql) and the steps of the other lots
  signup_submitted: "Inscription envoyée", onboarding_done: "Accueil terminé", email_confirmed: "E-mail confirmé",
  create_started: "Création commencée", first_day_opened: "Premier jour ouvert", paywall_closed: "Écran Pro fermé",
  landing_cta: "Bouton de la page d'accueil", public_link_created: "Lien public créé", public_cta_clicked: "Bouton du programme partagé",
  trip_shared_whatsapp: "Partagé par WhatsApp", prep_started: "Préparation lancée", prep_ready: "Préparation prête", prep_failed: "Préparation échouée",
  invite_accepted: "Invitation acceptée", check_email_shown: "Écran « vérifiez vos e-mails »", confirm_resent: "E-mail de confirmation renvoyé",
  quota_seen: "Limite vue", manual_trip_created: "Voyage créé à la main", validate_explained: "Validation expliquée",
  trip_pass_granted: "Pass offert", pass_granted: "Pass offert", pass_removed: "Pass retiré", ai_budget_hit: "Limite IA atteinte",
  landing_destination: "Destination choisie sur l'accueil", invite_email_sent: "E-mail d'invitation envoyé", reminder_sent: "Rappel envoyé",
  offline_ready: "Hors ligne prêt", offline_reminder_sent: "Rappel hors ligne envoyé", offline_used: "Utilisé hors ligne",
  confirm_screen: "Écran de confirmation", landing_intent: "Intention sur l'accueil", intent_applied: "Intention reprise",
  public_copy_click: "Copie du programme partagé", app_redirect: "Redirection vers l'app", confirm_reminder: "Rappel de confirmation",
  mail_sent: "E-mail envoyé", push_sent: "Notification envoyée", invite_opened: "Invitation ouverte",
  mail_unsubscribed: "Désabonnement des e-mails", link_preview: "Aperçu du lien",
};
/** The names used before 18 Nov 2026, still readable */
const OLD_NAME = new Set(["signup_done", "link_opened"]);
/** Details of a step and AI uses, in words */
const DETAIL: Record<string, string> = {
  link: "par lien ou nom", map: "sur la carte", pdf: "PDF", csv: "tableur", ics: "calendrier", offline: "carte hors ligne", data: "ses données",
  editor: "peut modifier", viewer: "lecture seule",
  new: "nouvelle", resume: "reprise", cap: "limite du jour", stopped: "arrêtée", ai: "erreur de l'IA", days: "jours manquants",
  quota: "limite atteinte", signin: "connexion", signup: "création de compte", brand_cta: "« Préparez votre voyage »", concierge: "concierge",
  invite: "invitation",
};
const AI_TASK: Record<string, string> = {
  outline: "trames", day: "jours préparés", essentials: "essentiels", enrich: "fiches", adjust: "ajustements", intake: "collages",
  extract: "réservations lues", place: "lieux cherchés", ask: "questions", photo: "photos", interpret: "interprète",
};
const when = (iso: string) => new Date(iso).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" });
const PRO_WHY: Record<string, string> = { edit: "modifier un voyage validé", prep: "voyage du mois utilisé", export: "exports et hors ligne", business: "mode affaires", info: "depuis le compte", cap: "limite IA du jour" };

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
              {a.pro ? <span className="v3-tag pro">{a.granted ? (a.until ? `Pro → ${day(a.until)}` : t("Pro à vie")) : t("Pro inclus")}</span> : <span className="v3-tag dim">{t("Gratuit")}</span>}
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
  // where the account came from (supabase/saas-12.sql; hidden before it runs)
  const { data: src } = useLoad<UserSources | null>(() => adminUserSources(row.user_id).catch(() => null), [row.user_id]);
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
        ...(src
          ? ([
              [t("Première source"), src.firstSrc ? `${t(CHANNELS[src.firstSrc] || src.firstSrc)}${src.firstSrcAt ? ` · ${when(src.firstSrcAt)}` : ""}` : "—"],
              [t("Recommandé par"), src.referredBy ? (src.referredBy.name ? `${src.referredBy.name} (${src.referredBy.email})` : src.referredBy.email) : "—"],
            ] as [string, string][])
          : []),
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
            <Traveller userId={row.user_id} />
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
            <AiDetail userId={row.user_id} />
            <span className="v3-lbl adm-sub">{t("Parcours (200 dernières actions)")}</span>
            <div className="adm-timeline">
              {u.events.map((e, i) => (
                <div key={i} className="adm-ev">
                  <span className="adm-ev-at">{when(e.at)}</span>
                  <span className="v3-grow">
                    {t(STEP_LABEL[e.name] || e.name)}{OLD_NAME.has(e.name) ? ` ${t("(ancien nom)")}` : ""}
                    {e.detail ? ` · ${e.name === "prep_ready" && /^\d+$/.test(e.detail) ? span(Number(e.detail)) : t((e.name === "pro_screen" || e.name === "paywall_closed" ? PRO_WHY[e.detail] : DETAIL[e.detail]) || e.detail)}` : ""}
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


const eur = (n: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

/** Everyone: spending per category, destinations, airlines, cities, devices, personas; the partners' export */
function Profiles() {
  const { data, err } = useLoad<Person[]>(() => people());
  const [persona, setPersona] = useState("");
  if (err) return <p className="v3-err">{err}</p>;
  if (!data) return <p className="v3-note">{t("Chargement…")}</p>;
  const o = overview(data);
  const exp = partnerCsv(data, persona || undefined);
  const download = () => {
    const url = URL.createObjectURL(new Blob(["\ufeff" + exp.csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `orbes-trips-profils${persona ? `-${persona.toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : ""}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const bars = (rows: [string, number][], fmt: (n: number) => string = String) => {
    const max = Math.max(1, ...rows.map((r) => r[1]));
    return (
      <div className="adm-path">
        {rows.map(([k, v]) => (
          <div key={k} className="adm-step"><span className="adm-step-bar" style={{ width: `${Math.max(2, (v / max) * 100)}%` }} /><span className="v3-grow">{k}</span><b>{fmt(v)}</b></div>
        ))}
        {!rows.length && <p className="v3-note">{t("Pas encore de données.")}</p>}
      </div>
    );
  };
  return (
    <>
      <div className="adm-stats">
        <div className="adm-stat"><span className="v3-lbl">{t("Dépenses suivies")}</span><b>{eur(o.total)}</b><small>{t("{n} voyages", { n: o.trips })}</small></div>
        <div className="adm-stat"><span className="v3-lbl">{t("Par voyage")}</span><b>{eur(o.perTrip)}</b><small>{t("{e} par jour", { e: eur(o.perDay) })}</small></div>
      </div>
      <div className="v3-glass adm-card">
        <span className="v3-lbl">{t("Dépenses par catégorie")}</span>
        {bars(EXPENSE_CATEGORIES.map((c) => [`${c.icon} ${t(c.label)}`, Number(o.cat[c.key]) || 0] as [string, number]).filter((r) => r[1] > 0), eur)}
      </div>
      <div className="v3-glass adm-card">
        <span className="v3-lbl">{t("Personas")}</span>
        {bars(o.personas.map(([k, v]) => [t(k), v] as [string, number]))}
      </div>
      <div className="v3-glass adm-card"><span className="v3-lbl">{t("Destinations")}</span>{bars(o.dest)}</div>
      <div className="v3-glass adm-card"><span className="v3-lbl">{t("Compagnies aériennes")}</span>{bars(o.air)}{o.cabin.length > 0 && <p className="v3-note">{t("Classes : {list}", { list: o.cabin.map(([k, v]) => `${k} (${v})`).join(", ") })}</p>}</div>
      <div className="v3-glass adm-card"><span className="v3-lbl">{t("Villes des utilisateurs")}</span>{bars(o.city)}{o.os.length > 0 && <p className="v3-note">{t("Appareils : {list}", { list: o.os.map(([k, v]) => `${k} (${v})`).join(", ") })}</p>}</div>
      <div className="v3-glass adm-card">
        <span className="v3-lbl">{t("Export pour les partenaires")}</span>
        <p className="v3-note">{t("Une ligne par personne : profil, voyages, dépenses par catégorie, vols, hôtels, personas. Les personnes qui ont refusé les offres partenaires n'y figurent pas.")}</p>
        <select className="adm-select" value={persona} onChange={(e) => setPersona(e.target.value)} aria-label={t("Persona")}>
          <option value="">{t("Tout le monde")}</option>
          {o.personas.map(([k]) => <option key={k} value={k}>{t(k)}</option>)}
        </select>
        <button className="v3-btn" style={{ marginTop: 10 }} disabled={!exp.rows} onClick={download}>{exp.rows > 1 ? t("Télécharger le CSV ({n} personnes)", { n: exp.rows }) : t("Télécharger le CSV ({n} personne)", { n: exp.rows })}</button>
      </div>
    </>
  );
}

/** One person's traveller profile: personas, spending, flights, hotels, places, cities, devices */
function Traveller({ userId }: { userId: string }) {
  const { data } = useLoad<Person[]>(() => people(userId), [userId]);
  const p = data?.[0];
  if (!p) return null;
  const pr = p.profile || {};
  const facts: [string, string][] = ([
    [t("Ville de départ"), String(pr.home || "")],
    [t("Âge"), String(pr.age || "")],
    [t("Voyages par an"), String(pr.tripsPerYear || "")],
    [t("Connu par"), String(pr.heard || "")],
    [t("Offres partenaires"), pr.partnerOptOut === true ? t("refusées") : t("acceptées")],
    [t("Villes"), p.seen.cities.map((c) => `${c.city}${c.country ? ` (${c.country})` : ""}`).join(", ")],
    [t("Appareils"), [...Object.keys(p.seen.os || {}), ...Object.keys(p.seen.browsers || {})].join(", ")],
    [t("Dépenses suivies"), `${eur(totalSpend(p))} (${p.expenses})`],
  ] as [string, string][]).filter(([, v]) => v);
  return (
    <>
      <span className="v3-lbl adm-sub">{t("Profil voyageur")}</span>
      <div className="adm-counts">{personasOf(p).map((x) => <span key={x} className="v3-tag gold">{t(x)}</span>)}</div>
      <dl className="adm-facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {totalSpend(p) > 0 && (
        <div className="adm-counts" style={{ marginTop: 10 }}>
          {EXPENSE_CATEGORIES.filter((c) => p.spend?.[c.key]).map((c) => <span key={c.key} className="v3-tag dim">{c.icon} {t(c.label)} · {eur(Number(p.spend[c.key]))}</span>)}
        </div>
      )}
      {p.flights.length > 0 && <p className="v3-note">{t("Vols : {list}", { list: p.flights.map((f) => [f.code, f.from && f.to ? `${f.from}→${f.to}` : "", f.cabin, f.price ? `${f.price} ${f.currency || ""}` : ""].filter(Boolean).join(" ")).join(" · ") })}</p>}
      {p.hotels.some((h) => h.name && !/à préciser|to be confirmed/i.test(h.name)) && <p className="v3-note">{t("Hôtels : {list}", { list: p.hotels.filter((h) => h.name && !/à préciser|to be confirmed/i.test(h.name)).map((h) => [h.name, h.nights ? t("{n} nuits", { n: h.nights }) : "", h.price ? `${h.price} ${h.currency || ""}` : ""].filter(Boolean).join(" ")).join(" · ") })}</p>}
      {Object.keys(p.places || {}).length > 0 && <p className="v3-note">{t("Lieux : {list}", { list: Object.entries(p.places).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${t(TYPE_LABEL[k as keyof typeof TYPE_LABEL] || k)} ${v}`).join(", ") })}</p>}
    </>
  );
}

// ---------- the measure of the path (R03, R11; supabase/saas-12.sql) ----------
const COHORT_STEPS: [keyof CohortPeriod, string][] = [
  ["visits", "Visites"], ["signups", "Inscriptions"], ["confirmed", "E-mail confirmé"], ["onboarded", "Accueil terminé"],
  ["started", "Préparation lancée"], ["ready", "Préparation prête"], ["validated", "Voyage validé"], ["second", "Second voyage"],
];
const num = (n: number) => new Intl.NumberFormat(locale()).format(Number(n) || 0);
const pctText = (n: number, of: number) => {
  const p = pct(n, of);
  return p == null ? "—" : t("{p} %", { p });
};
/** A period's name: the month, or the week by its Monday (Paris time) */
const periodName = (start: string, unit: "month" | "week") => {
  const d = new Date(`${start}T12:00:00Z`);
  return unit === "month"
    ? d.toLocaleDateString(locale(), { month: "long", year: "numeric", timeZone: "UTC" })
    : t("Semaine du {date}", { date: d.toLocaleDateString(locale(), { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) });
};
const NOT_YET = "Lancez supabase/saas-12.sql pour voir ces chiffres.";

/** The path by sign-up month (or week): each step in numbers and in % of the step before, activation, time, returns */
function CohortView() {
  const [unit, setUnit] = useState<"month" | "week" | null>(null);
  const [pick, setPick] = useState(0);
  const { data, err } = useLoad<Cohorts | null>(() => adminCohorts(unit || "month", 12), [unit]);
  // the default unit is the one the server suggests (week once sign-ups pass ~50 a week)
  useEffect(() => {
    if (unit === null && data?.suggest === "week") setUnit("week");
  }, [unit, data]);
  const head = (u: "month" | "week") => (
    <div className="adm-head msr-head">
      <span className="v3-lbl">{t("Parcours par inscription")}</span>
      <div className="msr-unit" role="group" aria-label={t("Période")}>
        {(["month", "week"] as const).map((k) => (
          <button key={k} type="button" className={u === k ? "on" : ""} aria-pressed={u === k} onClick={() => { setUnit(k); setPick(0); }}>{k === "month" ? t("Mois") : t("Semaine")}</button>
        ))}
      </div>
    </div>
  );
  if (err) return <div className="v3-glass adm-card">{head(unit || "month")}<p className="v3-note">{err}</p></div>;
  if (data === null) return <div className="v3-glass adm-card">{head(unit || "month")}<p className="v3-note">{t(NOT_YET)}</p></div>;
  if (!data) return <div className="v3-glass adm-card">{head(unit || "month")}<p className="v3-note">{t("Chargement…")}</p></div>;
  const u = data.unit;
  const periods = data.periods || [];
  const p = periods[Math.min(pick, periods.length - 1)];
  const since = Object.values(data.since || {}).sort()[0];
  if (!p) return <div className="v3-glass adm-card">{head(u)}<p className="v3-note">{t("Aucune inscription pour l'instant.")}</p></div>;
  const top = Math.max(1, ...COHORT_STEPS.map(([k]) => Number(p[k]) || 0));
  return (
    <div className="v3-glass adm-card">
      {head(u)}
      <label className="sr" htmlFor="msr-period">{t("Période")}</label>
      <select id="msr-period" className="adm-select" value={pick} onChange={(e) => setPick(Number(e.target.value))}>
        {periods.map((x, i) => (
          <option key={x.start} value={i}>{periodName(x.start, u)} · {t("{n} inscriptions", { n: x.signups })}</option>
        ))}
      </select>
      <div className="adm-path">
        {COHORT_STEPS.map(([k, label], i) => {
          const v = Number(p[k]) || 0;
          const before = i > 0 ? Number(p[COHORT_STEPS[i - 1][0]]) || 0 : null;
          return (
            <div key={k} className="adm-step">
              <span className="adm-step-bar" style={{ width: `${Math.max(2, (v / top) * 100)}%` }} />
              <span className="v3-grow">{t(label)}</span>
              <b>{num(v)}</b>
              <small className="msr-pct" title={before == null ? undefined : t("{p} % de l'étape d'avant", { p: pct(v, before) ?? "—" })}>{before == null ? "" : pctText(v, before)}</small>
            </div>
          );
        })}
      </div>
      <p className="v3-note">{t("Activation (voyage validé en 7 jours) : {n} sur {of} · {p} %", { n: num(p.activated), of: num(p.signups), p: pct(p.activated, p.signups) ?? "—" })}</p>
      <p className="v3-note">{t("Temps médian jusqu'au premier programme : {d}", { d: span(p.medianS) })} <span className="msr-quiet">{t("Préparations faites par le serveur seulement.")}</span></p>
      <p className="v3-note">{t("Retour à J7 : {n} sur {of} · à J30 : {m} sur {of2}", { n: num(p.back7), of: num(p.back7Of), m: num(p.back30), of2: num(p.back30Of) })}</p>
      <p className="v3-note msr-quiet">{t("Visites : personnes vues pour la première fois sur la période.")}</p>
      {since && <p className="v3-note msr-quiet">{t("Noms d'étapes changés le {date} ; les anciens restent lisibles.", { date: day(since) })}</p>}
      {periods.length > 1 && (
        <div className="msr-scroll" role="region" aria-label={t("Toutes les périodes")} tabIndex={0}>
          <div className="msr-tr msr-th">
            <span>{t("Période")}</span>
            {COHORT_STEPS.map(([k, label]) => <span key={k}>{t(label)}</span>)}
            <span>{t("Activation")}</span>
          </div>
          {periods.map((x) => (
            <div key={x.start} className="msr-tr">
              <span>{periodName(x.start, u)}</span>
              {COHORT_STEPS.map(([k]) => <span key={k}>{num(Number(x[k]) || 0)}</span>)}
              <span>{pctText(x.activated, x.signups)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Where people come from: per channel of the links (visits, sign-ups, activations, returns), and who brings them */
function SourcesView() {
  const [days, setDays] = useState<30 | 90>(30);
  const { data, err } = useLoad<Channels | null>(() => adminChannels(days), [days]);
  const head = (
    <div className="adm-head msr-head">
      <span className="v3-lbl">{t("Sources, {n} jours", { n: days })}</span>
      <div className="msr-unit" role="group" aria-label={t("Période")}>
        {([30, 90] as const).map((k) => (
          <button key={k} type="button" className={days === k ? "on" : ""} aria-pressed={days === k} onClick={() => setDays(k)}>{t("{n} j", { n: k })}</button>
        ))}
      </div>
    </div>
  );
  if (err) return <div className="v3-glass adm-card">{head}<p className="v3-note">{err}</p></div>;
  if (data === null) return <div className="v3-glass adm-card">{head}<p className="v3-note">{t(NOT_YET)}</p></div>;
  if (!data) return <div className="v3-glass adm-card">{head}<p className="v3-note">{t("Chargement…")}</p></div>;
  const rows = data.channels || [];
  const sharers = data.sharers || [];
  return (
    <div className="v3-glass adm-card">
      {head}
      {rows.length === 0 ? (
        <p className="v3-note">{t("Aucune source pour l'instant.")}</p>
      ) : (
        <div className="msr-scroll" role="region" aria-label={t("Sources, {n} jours", { n: days })} tabIndex={0}>
          <div className="msr-tr msr-src msr-th">
            <span>{t("Source")}</span><span>{t("Visites")}</span><span>{t("Inscriptions")}</span><span>{t("Activations")}</span><span>{t("Retours")}</span>
          </div>
          {rows.map((r) => (
            <div key={r.src} className="msr-tr msr-src">
              <span>{t(CHANNELS[r.src] || r.src)}</span><span>{num(r.visits)}</span><span>{num(r.signups)}</span><span>{num(r.activations)}</span><span>{num(r.returns)}</span>
            </div>
          ))}
        </div>
      )}
      {sharers.length > 0 && (
        <>
          <span className="v3-lbl adm-sub">{t("Recommandé par")}</span>
          <div className="adm-list">
            {sharers.map((x) => (
              <p key={x.email} className="v3-note msr-sharer" title={x.email}>{t("{name} : {v} visites, {s} inscriptions", { name: x.name || x.email, v: num(x.visits), s: num(x.signups) })}</p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
