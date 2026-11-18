import { useEffect, useState } from "react";
import { addInbound, alertPrefs, disablePush, dismissInbound, enablePush, inboundAddress, inboundItems, pushBlocker, pushEnabled, setAlertPrefs, type InboundItem } from "../../lib/alerts";
import { t } from "../../lib/i18n";
import { currentTrip, toast, useStore } from "../../lib/store";

/** Alerts (morning e-mail, notifications on this phone) and the address to forward bookings to */
export function AlertsBlock() {
  useStore((s) => s.profile.alerts);
  const prefs = alertPrefs();
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [addr, setAddr] = useState<string | null>(null);
  useEffect(() => {
    void pushEnabled().then(setOn, () => setOn(false));
    void inboundAddress().then(setAddr, () => setAddr(null));
  }, []);
  const blocker = pushBlocker();
  const togglePush = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (on) {
        await disablePush();
        setOn(false);
      } else {
        await enablePush();
        setOn(true);
        toast(t("Notifications activées sur ce téléphone"));
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="alerts-block">
      <span className="v3-lbl">{t("Alertes")}</span>
      <label className="alerts-row">
        <span className="v3-grow"><b>{t("E-mail du matin")}</b><small>{t("Chaque jour du voyage vers 7 h 30 : la journée, les horaires, les lieux fermés.")}</small></span>
        <input type="checkbox" checked={prefs.email} onChange={(e) => setAlertPrefs({ email: e.target.checked })} />
      </label>
      <div className="alerts-row">
        <span className="v3-grow"><b>{t("Notifications sur ce téléphone")}</b><small>{blocker || t("Le résumé du matin et un rappel 30 minutes avant chaque lieu.")}</small></span>
        {!blocker && <button type="button" className="v3-chip" disabled={busy || on === null} onClick={() => void togglePush()}>{on ? t("Désactiver") : t("Activer")}</button>}
      </div>
      {err && <p className="v3-err">{err}</p>}
      {addr && (
        <div className="alerts-inbound">
          <b>{t("Transférez vos réservations")}</b>
          <small>{t("Envoyez à cette adresse vos confirmations de vol, d'hôtel ou de réservation : elles arrivent dans le voyage, prêtes à être ajoutées.")}</small>
          <button type="button" className="pub-link-url" onClick={() => navigator.clipboard?.writeText(addr).then(() => toast(t("Adresse copiée")), () => undefined)}>{addr}</button>
        </div>
      )}
    </div>
  );
}

/** Bookings received by e-mail, to add to the open trip */
export function InboundInbox() {
  const [items, setItems] = useState<InboundItem[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const tripId = useStore((s) => s.tripId);
  useEffect(() => {
    void inboundItems().then(setItems);
  }, [tripId]);
  if (!items.length) return null;
  return (
    <div className="card inbox">
      <h4>{t("Réservations reçues")}</h4>
      {items.map((it) => {
        const x = it.extracted || {};
        const what = [
          ...(x.flights || []).map((f) => `✈ ${f.code} ${f.from}→${f.to}`),
          ...(x.hotel?.name ? [`🏨 ${x.hotel.name}`] : []),
          ...(x.fixed || []).map((f) => `• ${f.name}${f.date ? ` (${f.date}${f.time ? ` ${f.time}` : ""})` : ""}`),
        ];
        return (
          <div key={it.id} className="inbox-item">
            <b>{it.subject || t("Sans objet")}</b>
            <small>{it.from_addr}</small>
            <p>{what.length ? what.join(" · ") : t("Rien de reconnu dans cet e-mail.")}</p>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn" disabled={busy === it.id} onClick={async () => { await dismissInbound(it.id); setItems(items.filter((y) => y.id !== it.id)); }}>{t("Ignorer")}</button>
              <button className="btn primary" disabled={busy === it.id || !what.length} onClick={async () => {
                setBusy(it.id);
                try {
                  const r = await addInbound(it, currentTrip());
                  toast(r.manual.length ? t("{n} ajouté(s) · à placer à la main : {list}", { n: r.added, list: r.manual.join(", ") }) : t("{n} ajouté(s) au voyage", { n: r.added }));
                  setItems(items.filter((y) => y.id !== it.id));
                } finally {
                  setBusy(null);
                }
              }}>{busy === it.id ? t("Ajout…") : t("Ajouter au voyage")}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
