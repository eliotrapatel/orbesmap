import "../../styles/invite.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invite, invites as listInvites, people as listPeople, sendInviteMessage, whatsappInviteUrl, type Invite, type Person } from "../../lib/share";
import { currentAuthor, toast, useStore, useTrip } from "../../lib/store";
import { t } from "../../lib/i18n";

// Which address each companion of the wizard was invited with, and "Plus tard", on this phone only.
// Kept under "orbes.wizard." so that signing out clears it with the wizard's drafts.
type Saved = { emails: Record<string, string>; later?: boolean };
const KEY = (tripId: string) => `orbes.wizard.invites.${tripId}`;
function readSaved(tripId: string): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(tripId)) || "null") as Saved | null;
    if (v && typeof v === "object" && v.emails && typeof v.emails === "object") return v;
  } catch {
    /* ignore */
  }
  return { emails: {} };
}
function writeSaved(tripId: string, v: Saved) {
  try {
    localStorage.setItem(KEY(tripId), JSON.stringify(v));
  } catch {
    /* ignore: the state simply is not remembered */
  }
}

const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const EMAIL = /^\S+@\S+\.\S+$/;

/**
 * "Qui part avec vous ?": while the trip is being prepared (and in its review), each companion named in the wizard
 * can be invited by e-mail (the same invitation as in "Partager"), then told by the share sheet or WhatsApp.
 * Only those who may invite (the trip's owner) see it; "Plus tard" folds it into one line.
 */
export default function InviteTravellers() {
  const trip = useTrip();
  const session = useStore((s) => Boolean(s.session));
  const role = useStore((s) => s.roles[trip.id]);
  const myName = useStore((s) => (s.profile.name as string) || "");
  // a trip just created here has no role noted yet: its creator is its owner
  const canInvite = session && (role === undefined || role === "owner");

  const [saved, setSaved] = useState<Saved>(() => readSaved(trip.id));
  const [people, setPeople] = useState<Person[]>([]);
  const [pending, setPending] = useState<Invite[]>([]);
  // the row whose e-mail field is open: a companion's name, "+" for someone else
  const [open, setOpen] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  // the row just invited: it says how the person will find the trip
  const [just, setJust] = useState<string | null>(null);

  useEffect(() => {
    setSaved(readSaved(trip.id));
  }, [trip.id]);

  const load = useCallback(async () => {
    try {
      const [p, i] = await Promise.all([listPeople(trip.id), listInvites(trip.id)]);
      setPeople(p);
      setPending(i);
    } catch {
      /* offline, or the trip not on the server yet: the rows show what this phone knows */
    }
  }, [trip.id]);
  useEffect(() => {
    if (canInvite) void load();
  }, [load, canInvite]);

  const save = (v: Saved) => {
    setSaved(v);
    writeSaved(trip.id, v);
  };

  // the wizard's companions, without the account's owner
  const companions = useMemo(() => {
    const mine = new Set([myName, myName.split(/\s+/)[0] || "", currentAuthor() || ""].map(norm).filter(Boolean));
    const seen = new Set<string>();
    return (trip.travellers || []).filter((n) => {
      const k = norm(n);
      if (!k || mine.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [trip.travellers, myName]);

  if (!canInvite) return null;

  // the travellers who joined (not the owner), and the companion each one is
  const joined = people.filter((p) => p.role !== "owner");
  const first = (s: string) => norm(s.split(/\s+/)[0] || "");
  const joinedAs = (name: string) => {
    const e = saved.emails[name]?.toLowerCase();
    return joined.find((p) => (e && p.email.toLowerCase() === e) || (p.name && first(p.name) === first(name)));
  };
  const stateOf = (name: string): "joined" | "invited" | "none" => (joinedAs(name) ? "joined" : saved.emails[name] ? "invited" : "none");
  // invited or joined without a companion's name (from here or from "Partager"): shown as "someone else"
  const mapped = new Set(Object.values(saved.emails).map((e) => e.toLowerCase()));
  const matched = new Set(companions.map(joinedAs).filter(Boolean).map((p) => p!.user_id));
  const others = pending.filter((i) => !mapped.has(i.email.toLowerCase()));
  const othersJoined = joined.filter((p) => !matched.has(p.user_id) && !mapped.has(p.email.toLowerCase()));
  const invitedCount = companions.filter((n) => stateOf(n) !== "none").length + others.length + othersJoined.length;

  const submit = async (name: string | null) => {
    const to = email.trim().toLowerCase();
    if (!EMAIL.test(to) || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await invite(trip.id, to, "editor");
      if (name) save({ ...saved, emails: { ...saved.emails, [name]: to } });
      else setPending((l) => (l.some((i) => i.email === to) ? l : [...l, { email: to, role: "editor", created_at: new Date().toISOString() }]));
      setJust(name || to);
      toast(t("Invitation enregistrée"));
      setOpen(null);
      setEmail("");
      void load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const openRow = (key: string | null) => {
    setOpen(key);
    setEmail("");
    setErr(null);
  };

  const form = (name: string | null) => (
    <form className="inv-form" onSubmit={(e) => { e.preventDefault(); void submit(name); }}>
      <label className="v3-field">
        <span className="sr">{name ? t("Adresse e-mail de {name}", { name }) : t("Adresse e-mail")}</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={name ? t("Adresse e-mail de {name}", { name }) : t("Adresse e-mail de la personne")} autoComplete="off" autoFocus inputMode="email" />
      </label>
      <div className="inv-form-row">
        <button type="button" className="v3-chip" onClick={() => openRow(null)}>{t("Annuler")}</button>
        <button className="v3-chip on" disabled={busy || !EMAIL.test(email.trim())}>{busy ? t("Un instant…") : t("Inviter")}</button>
      </div>
    </form>
  );
  // how the person is told: the phone's share sheet (or a copy), or WhatsApp; `name` null for an address alone
  const tell = (key: string, name: string | null, emailTo: string) => (
    <div className="inv-tell">
      {just === key && (
        <p className="v3-note">
          {name
            ? t("Prévenez {name} : le voyage apparaîtra dès sa connexion avec {email}.", { name, email: emailTo })
            : t("Prévenez cette personne : le voyage apparaîtra dès sa connexion avec cette adresse.")}
        </p>
      )}
      <div className="inv-tell-row">
        <button type="button" className="v3-chip" onClick={() => void sendInviteMessage(trip.title, myName, name || emailTo)}>{t("Envoyer le message")}</button>
        <a className="v3-chip inv-wa" href={whatsappInviteUrl(trip.title, myName)} target="_blank" rel="noopener noreferrer">{t("Par WhatsApp")}</a>
      </div>
    </div>
  );
  const benefit = <p className="v3-note inv-why">{t("Ils voient le programme, la carte et les notes, et peuvent les modifier. Tout reste synchronisé.")}</p>;

  // nobody named in the wizard (or only you): one compact entry
  if (!companions.length && !expanded) {
    return (
      <button type="button" className="v3-glass inv-entry" onClick={() => { setExpanded(true); openRow("+"); }}>
        <span className="v3-grow">
          <b>{t("Partager avec vos compagnons de voyage")}</b>
          <small>{invitedCount > 0 ? (invitedCount > 1 ? t("{n} personnes invitées", { n: invitedCount }) : t("1 personne invitée")) : t("Ils voient le programme, la carte et les notes.")}</small>
        </span>
        <span className="inv-chev" aria-hidden="true">›</span>
      </button>
    );
  }
  // "Plus tard": folded into one line, opened again in one touch
  if (saved.later && !expanded) {
    return (
      <button type="button" className="v3-glass inv-entry" onClick={() => { setExpanded(true); save({ ...saved, later: false }); }}>
        <span className="v3-grow">
          <b>{t("Qui part avec vous ?")}</b>
          <small>{invitedCount > 0 ? (invitedCount > 1 ? t("{n} personnes invitées", { n: invitedCount }) : t("1 personne invitée")) : t("Inviter vos compagnons de voyage")}</small>
        </span>
        <span className="inv-chev" aria-hidden="true">›</span>
      </button>
    );
  }

  return (
    <section className="v3-glass inv-card" aria-label={t("Qui part avec vous ?")}>
      <div className="inv-head">
        <h2 className="v3-d inv-title">{t("Qui part avec vous ?")}</h2>
        <button type="button" className="v3-link inv-later" onClick={() => { setExpanded(false); openRow(null); save({ ...saved, later: true }); }}>{t("Plus tard")}</button>
      </div>
      {benefit}

      {companions.map((name) => {
        const st = stateOf(name);
        const to = saved.emails[name];
        return (
          <div key={name} className="inv-row">
            <div className="inv-line">
              <span className="inv-ini" aria-hidden="true">{name.trim().charAt(0).toUpperCase()}</span>
              <span className="v3-grow inv-name"><b>{name}</b>{to && <small>{to}</small>}</span>
              {st === "joined" ? (
                <span className="v3-tag ok">{t("A rejoint ✓")}</span>
              ) : st === "invited" ? (
                <span className="v3-tag ok">{t("Invité ✓")}</span>
              ) : open !== name ? (
                <button type="button" className="v3-chip inv-go" onClick={() => openRow(name)}>{t("Inviter")}</button>
              ) : null}
            </div>
            {open === name && form(name)}
            {st === "invited" && to && tell(name, name, to)}
          </div>
        );
      })}

      {others.map((i) => (
        <div key={i.email} className="inv-row">
          <div className="inv-line">
            <span className="inv-ini" aria-hidden="true">{i.email.charAt(0).toUpperCase()}</span>
            <span className="v3-grow inv-name"><b>{i.email}</b></span>
            <span className="v3-tag ok">{t("Invité ✓")}</span>
          </div>
          {tell(i.email, null, i.email)}
        </div>
      ))}
      {othersJoined.map((p) => (
        <div key={p.user_id} className="inv-row">
          <div className="inv-line">
            <span className="inv-ini" aria-hidden="true">{(p.name || p.email).charAt(0).toUpperCase()}</span>
            <span className="v3-grow inv-name"><b>{p.name || p.email.split("@")[0]}</b><small>{p.email}</small></span>
            <span className="v3-tag ok">{t("A rejoint ✓")}</span>
          </div>
        </div>
      ))}

      {open === "+" ? (
        <div className="inv-row">{form(null)}</div>
      ) : (
        <button type="button" className="v3-link inv-more" onClick={() => openRow("+")}>{t("Inviter quelqu'un d'autre")}</button>
      )}
      {err && <p className="v3-err">{err}</p>}
    </section>
  );
}
