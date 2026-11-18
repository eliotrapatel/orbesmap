import { useCallback, useEffect, useState } from "react";
import { invite, inviteMessage, invites as listInvites, people as listPeople, removeInvite, removePerson, setRole, type Invite, type Person } from "../../lib/share";
import { pull, toast, useStore, useTrip } from "../../lib/store";
import Shell from "./Shell";

const ROLE = { owner: "Propriétaire", editor: "Peut modifier", viewer: "Lecture seule" } as const;

/** "Partager ce voyage": who travels with you, invitations by e-mail, roles */
export default function ShareTrip({ onClose }: { onClose: () => void }) {
  const trip = useTrip();
  const me = useStore((s) => s.session?.user.id);
  const myName = useStore((s) => (s.profile.name as string) || "");
  const member = useStore((s) => s.member);
  const myRole = useStore((s) => s.roles[trip.id]);
  const canManage = myRole === "owner" || (member === true && !myRole);
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
    } catch {
      /* closed by the user */
      return;
    }
    try {
      await navigator.clipboard.writeText(msg);
      toast(`Message copié : envoyez-le à ${to}`);
    } catch {
      toast("Copie impossible : sélectionnez le message à la main");
    }
  };

  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onClose} aria-label="Fermer">✕</button>
      <span className="v3-grow" style={{ textAlign: "center", color: "var(--soft)", fontSize: 13 }}>Partager</span>
      <span className="v3-tool ghost" />
    </div>
  );
  return (
    <Shell ring={false} top={top}>
      <h1 className="v3-d v3-h2" style={{ marginTop: 16 }}>Qui voyage avec vous ?</h1>
      <p className="v3-lead" style={{ marginTop: 10 }}>{trip.title} · {trip.dateLabel}</p>

      {canManage && (
        <form className="v3-glass" style={{ padding: 14, marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }} onSubmit={(e) => { e.preventDefault(); const to = email.trim(); void act(async () => { await invite(trip.id, to, role); setLastInvite(to); setEmail(""); }, "Invitation enregistrée"); }}>
          <label className="v3-field">
            <span className="sr">Adresse e-mail</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Adresse e-mail de la personne" autoComplete="email" />
          </label>
          <div className="v3-seg" role="radiogroup" aria-label="Rôle" style={{ marginTop: 0 }}>
            {(["editor", "viewer"] as const).map((r) => <button type="button" key={r} role="radio" aria-checked={role === r} className={role === r ? "on" : ""} onClick={() => setRoleNew(r)}>{ROLE[r]}</button>)}
          </div>
          <button className="v3-btn" disabled={busy || !/^\S+@\S+\.\S+$/.test(email.trim())}>Inviter</button>
          {lastInvite && (
            <div className="v3-msg">
              <p>Envoyez-lui ce message : dès qu'elle se connecte avec <b>{lastInvite}</b>, le voyage apparaît chez elle.</p>
              <button type="button" className="v3-btn ghost" style={{ marginTop: 8 }} onClick={() => void send(lastInvite)}>Envoyer l'invitation</button>
            </div>
          )}
        </form>
      )}
      {err && <p className="v3-err">{err}</p>}

      <p className="v3-lbl" style={{ marginTop: 22 }}>Voyageurs</p>
      {!list.length && !err && <p className="v3-note">{member && !myRole ? "Les deux personnes de l'espace partagé voient déjà ce voyage." : "Vous seul pour l'instant."}</p>}
      {list.map((p) => (
        <div key={p.user_id} className="v3-card on" style={{ cursor: "default" }}>
          <span className="v3-grow"><b>{p.name || p.email.split("@")[0]}{p.user_id === me ? " (vous)" : ""}</b><small>{p.email}</small></span>
          {canManage && p.role !== "owner" && p.user_id !== me ? (
            <>
              <select className="v3-select" value={p.role} aria-label={`Rôle de ${p.email}`} onChange={(e) => void act(() => setRole(trip.id, p.user_id, e.target.value as "editor" | "viewer"), "Rôle changé")}>
                <option value="editor">{ROLE.editor}</option>
                <option value="viewer">{ROLE.viewer}</option>
              </select>
              <button className="v3-x" aria-label={`Retirer ${p.email}`} onClick={() => void act(() => removePerson(trip.id, p.user_id), "Voyageur retiré")}>✕</button>
            </>
          ) : (
            <span className="v3-tag dim">{ROLE[p.role]}</span>
          )}
        </div>
      ))}

      {pending.length > 0 && <p className="v3-lbl" style={{ marginTop: 22 }}>Invitations en attente</p>}
      {pending.map((i) => (
        <div key={i.email} className="v3-card" style={{ opacity: 1, cursor: "default" }}>
          <span className="v3-grow"><b>{i.email}</b><small>{ROLE[i.role]} · pas encore connecté</small></span>
          {canManage && <button className="v3-chip" style={{ height: 32 }} onClick={() => void send(i.email)}>Renvoyer</button>}
          {canManage && <button className="v3-x" aria-label={`Annuler l'invitation de ${i.email}`} onClick={() => void act(() => removeInvite(trip.id, i.email), "Invitation annulée")}>✕</button>}
        </div>
      ))}

      {myRole && myRole !== "owner" && me && (
        <button className="v3-link" style={{ marginTop: 26 }} onClick={() => { if (confirm(`Quitter le voyage « ${trip.title} » ? Il disparaîtra de vos voyages.`)) void act(async () => { await removePerson(trip.id, me); onClose(); void pull(); }, "Vous avez quitté le voyage"); }}>
          Quitter ce voyage
        </button>
      )}
      <div className="v3-spacer" />
    </Shell>
  );
}
