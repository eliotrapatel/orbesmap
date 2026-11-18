import { useCallback, useEffect, useState } from "react";
import { invite, inviteMessage, invites as listInvites, people as listPeople, removeInvite, removePerson, setRole, type Invite, type Person } from "../../lib/share";
import { pull, toast, useStore, useTrip } from "../../lib/store";
import Shell from "./Shell";
import { closeLink, linkOf, linkUrl, openLink, shareUrl } from "../../lib/publicTrip";
import { t } from "../../lib/i18n";

const ROLE = { owner: "Propriétaire", editor: "Peut modifier", viewer: "Lecture seule" } as const;

/** "Partager ce voyage": who travels with you, invitations by e-mail, roles */
export default function ShareTrip({ onClose }: { onClose: () => void }) {
  const trip = useTrip();
  const me = useStore((s) => s.session?.user.id);
  const myName = useStore((s) => (s.profile.name as string) || "");
  const myRole = useStore((s) => s.roles[trip.id]);
  const canManage = myRole === "owner";
  const [list, setList] = useState<Person[]>([]);
  const [pending, setPending] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRoleNew] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, i] = await Promise.all([listPeople(trip.id), listInvites(trip.id)]);
      setList(p);
      setPending(i);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [trip.id]);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (f: () => Promise<void>, done?: string) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
      if (done) toast(done);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const msg = inviteMessage(trip.title, myName);
  const send = async (to: string) => {
    // the phone's share sheet when there is one, else the message is copied
    try {
      if (navigator.share) {
        await navigator.share({ title: `ORBES Trips · ${trip.title}`, text: msg });
        return;
      }
    } catch (e) {
      // closed by the user: nothing to do; any other failure: the message is copied instead
      if ((e as Error)?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(msg);
      toast(t("Message copié : envoyez-le à {to}", { to }));
    } catch {
      toast(t("Copie impossible : sélectionnez le message à la main"));
    }
  };

  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onClose} aria-label={t("Fermer")}>✕</button>
      <span className="v3-grow" style={{ textAlign: "center", color: "var(--soft)", fontSize: 13 }}>{t("Partager")}</span>
      <span className="v3-tool ghost" />
    </div>
  );
  return (
    <Shell ring={false} top={top}>
      <h1 className="v3-d v3-h2" style={{ marginTop: 16 }}>{t("Qui voyage avec vous ?")}</h1>
      <p className="v3-lead" style={{ marginTop: 10 }}>{trip.title} · {trip.dateLabel}</p>

      {canManage && (
        <form className="v3-glass" style={{ padding: 14, marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }} onSubmit={(e) => { e.preventDefault(); const to = email.trim(); void act(async () => { await invite(trip.id, to, role); setLastInvite(to); setEmail(""); }, t("Invitation enregistrée")); }}>
          <label className="v3-field">
            <span className="sr">{t("Adresse e-mail")}</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t("Adresse e-mail de la personne")} autoComplete="email" />
          </label>
          <div className="v3-seg" role="radiogroup" aria-label={t("Rôle")} style={{ marginTop: 0 }}>
            {(["editor", "viewer"] as const).map((r) => <button type="button" key={r} role="radio" aria-checked={role === r} className={role === r ? "on" : ""} onClick={() => setRoleNew(r)}>{t(ROLE[r])}</button>)}
          </div>
          <button className="v3-btn" disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}>{t("Inviter")}</button>
          {lastInvite && (
            <div className="v3-msg">
              <p>{t("Envoyez-lui ce message : dès qu'elle se connecte avec")} <b>{lastInvite}</b>{t(", le voyage apparaît chez elle.")}</p>
              <button type="button" className="v3-btn ghost" style={{ marginTop: 8 }} onClick={() => void send(lastInvite)}>{t("Envoyer l'invitation")}</button>
            </div>
          )}
        </form>
      )}
      {err && <p className="v3-err">{err}</p>}
      {canManage && <PublicLink tripId={trip.id} title={trip.title} />}

      <p className="v3-lbl" style={{ marginTop: 22 }}>{t("Voyageurs")}</p>
      {!list.length && !err && <p className="v3-note">{t("Vous seul pour l'instant.")}</p>}
      {list.map((p) => (
        <div key={p.user_id} className="v3-card on" style={{ cursor: "default" }}>
          <span className="v3-grow"><b>{p.name || p.email.split("@")[0]}{p.user_id === me ? t(" (vous)") : ""}</b><small>{p.email}</small></span>
          {canManage && p.role !== "owner" && p.user_id !== me ? (
            <>
              <select className="v3-select" value={p.role} aria-label={t("Rôle de {email}", { email: p.email })} onChange={(e) => void act(() => setRole(trip.id, p.user_id, e.target.value as "editor" | "viewer"), t("Rôle changé"))}>
                <option value="editor">{t(ROLE.editor)}</option>
                <option value="viewer">{t(ROLE.viewer)}</option>
              </select>
              <button className="v3-x" aria-label={t("Retirer {name}", { name: p.email })} onClick={() => void act(() => removePerson(trip.id, p.user_id), t("Voyageur retiré"))}>✕</button>
            </>
          ) : (
            <span className="v3-tag dim">{t(ROLE[p.role])}</span>
          )}
        </div>
      ))}

      {pending.length > 0 && <p className="v3-lbl" style={{ marginTop: 22 }}>{t("Invitations en attente")}</p>}
      {pending.map((i) => (
        <div key={i.email} className="v3-card" style={{ opacity: 1, cursor: "default" }}>
          <span className="v3-grow"><b>{i.email}</b><small>{t(ROLE[i.role])} · {t("pas encore connecté")}</small></span>
          {canManage && <button className="v3-chip" style={{ height: 32 }} onClick={() => void send(i.email)}>{t("Renvoyer")}</button>}
          {canManage && <button className="v3-x" aria-label={t("Annuler l'invitation de {email}", { email: i.email })} onClick={() => void act(() => removeInvite(trip.id, i.email), t("Invitation annulée"))}>✕</button>}
        </div>
      ))}

      {myRole && myRole !== "owner" && me && (
        <button className="v3-link" style={{ marginTop: 26 }} onClick={() => { if (confirm(t("Quitter le voyage « {title} » ? Il disparaîtra de vos voyages.", { title: trip.title }))) void act(async () => { await removePerson(trip.id, me); onClose(); void pull(); }, t("Vous avez quitté le voyage")); }}>
          {t("Quitter ce voyage")}
        </button>
      )}
      <div className="v3-spacer" />
    </Shell>
  );
}

/** The programme's public link: open it, copy or share it, close it */
function PublicLink({ tripId, title }: { tripId: string; title: string }) {
  const [link, setLink] = useState<{ slug: string; active: boolean } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    linkOf(tripId).then((l) => live && setLink(l), (e) => live && (setLink(null), setErr((e as Error).message)));
    return () => {
      live = false;
    };
  }, [tripId]);
  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await f();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const url = link?.active ? linkUrl(link.slug) : null;
  const share = async () => {
    if (!url || !link) return;
    // the address shared says where it comes from; the one shown stays short
    const sent = shareUrl(link.slug);
    const text = t("Le programme de « {title} » sur ORBES Trips", { title });
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: sent });
        return;
      } catch {
        /* closed, or not possible: copied instead */
      }
    }
    try {
      await navigator.clipboard.writeText(sent);
      toast(t("Lien copié"));
    } catch {
      toast(t("Copie impossible sur cet appareil"));
    }
  };
  return (
    <div className="v3-glass pub-link">
      <span className="v3-lbl">{t("Lien public")}</span>
      <p className="v3-note" style={{ marginTop: 6 }}>{t("Toute personne qui a le lien voit le programme (jours, lieux, horaires), sans compte, et peut le copier dans ses voyages. Jamais l'hôtel, les vols, les notes, les photos ni les voyageurs.")}</p>
      {link === undefined && <p className="v3-note">{t("Chargement…")}</p>}
      {url ? (
        <>
          <button type="button" className="pub-link-url" onClick={() => void share()}>{url.replace(/^https:\/\//, "")}</button>
          <div className="pub-link-row">
            <button type="button" className="v3-btn" disabled={busy} onClick={() => void share()}>{t("Partager le lien")}</button>
            <button type="button" className="v3-chip" disabled={busy} onClick={() => void run(async () => { await closeLink(tripId); setLink({ slug: link!.slug, active: false }); toast(t("Lien désactivé")); })}>{t("Désactiver")}</button>
          </div>
        </>
      ) : (
        link !== undefined && (
          <button type="button" className="v3-btn ghost" style={{ marginTop: 10 }} disabled={busy} onClick={() => void run(async () => { const slug = await openLink(tripId); setLink({ slug, active: true }); })}>
            {busy ? t("Un instant…") : link ? t("Réactiver le lien public") : t("Créer un lien public")}
          </button>
        )
      )}
      {err && <p className="v3-err">{err}</p>}
    </div>
  );
}
