import "../../styles/brand.css";
import { useEffect, useState } from "react";
import { appHome } from "../../lib/export";
import type { Place } from "../../data/types";
import { TYPE_LABEL } from "../../data/trip";
import { dayStops } from "../../lib/plan";
import { addDays, dateLabel } from "../../lib/newTrip";
import { copyTrip, fetchPublic, rememberCopy, type PublicTrip } from "../../lib/publicTrip";
import { useStore } from "../../lib/store";
import { track } from "../../lib/track";
import OrbitMark from "../OrbitMark";
import Shell from "./Shell";
import { t } from "../../lib/i18n";

const leave = (hash = "") => location.assign(location.pathname + hash);
const today = () => new Date().toISOString().slice(0, 10);

/** A trip's programme opened from its public link: read only, without an account; "Copier ce voyage" */
export default function PublicTripPage({ slug, copyNow }: { slug: string; copyNow: boolean }) {
  const signedIn = useStore((s) => !!s.session);
  const authReady = useStore((s) => s.authReady);
  const [pub, setPub] = useState<PublicTrip | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  useEffect(() => {
    let live = true;
    fetchPublic(slug).then(
      (p) => {
        if (!live) return;
        setPub(p);
        if (p) track("public_view", slug);
      },
      (e) => live && (setPub(null), setErr((e as Error).message)),
    );
    return () => {
      live = false;
    };
  }, [slug]);
  useEffect(() => {
    if (copyNow && signedIn && pub) setCopying(true);
  }, [copyNow, signedIn, pub]);

  const top = (
    <div className="v3-bar">
      <button type="button" className="v3-brand" onClick={() => leave()} aria-label={t("ORBES Trips, accueil")}><OrbitMark size={20} /><span>ORBES Trips</span></button>
      <span className="v3-grow" />
      <button type="button" className="v3-toplink" onClick={() => leave()}>{signedIn ? t("Mes voyages") : t("Se connecter")}</button>
    </div>
  );
  if (pub === undefined) return <Shell ring={false} top={top}><p className="v3-note" style={{ marginTop: 40 }}>{t("Chargement du programme…")}</p></Shell>;
  if (!pub)
    return (
      <Shell ring={false} top={top}>
        <h1 className="v3-d v3-h2" style={{ marginTop: 40 }}>{t("Ce lien n'est plus actif.")}</h1>
        <p className="v3-lead" style={{ marginTop: 12 }}>{err || t("Son propriétaire l'a désactivé, ou l'adresse est incomplète.")}</p>
        <div className="v3-spacer" />
        <button className="v3-btn" onClick={() => leave()}>{t("Découvrir ORBES Trips")}</button>
      </Shell>
    );
  const trip = pub.trip;
  const days = trip.days.filter((d) => d.scheduled && d.dates?.length);
  const ideas = trip.places.filter((p) => !days.some((d) => d.key === p.day));
  const count = trip.places.length;
  const copy = () => {
    if (!signedIn) {
      rememberCopy(slug);
      leave();
      return;
    }
    setCopying(true);
  };
  return (
    <Shell ring={false} top={top} className="v3-public-trip">
      <p className="v3-lbl" style={{ marginTop: 18 }}>{t("Programme partagé")}</p>
      <h1 className="v3-d v3-h1" style={{ marginBottom: 8 }}>{trip.title}</h1>
      <p className="v3-lead">{days.length > 1 ? t("{n} jours", { n: days.length }) : t("{n} jour", { n: days.length })} · {count > 1 ? t("{n} lieux", { n: count }) : t("{n} lieu", { n: count })}{trip.dateLabel ? ` · ${trip.dateLabel}` : ""}</p>

      {days.map((d) => {
        const stops = dayStops(trip, d.key, {});
        if (!stops.length) return null;
        return (
          <section key={d.key} className="pt-day">
            <div className="pt-dayhead" style={{ ["--c" as string]: d.color }}>
              <i />
              <span className="v3-grow"><b className="v3-d">{d.theme || d.title}</b><small>{d.title}{d.short ? ` · ${d.short}` : ""}</small></span>
            </div>
            {stops.map((p) => <Stop key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />)}
          </section>
        );
      })}
      {ideas.length > 0 && (
        <section className="pt-day">
          <div className="pt-dayhead"><i /><span className="v3-grow"><b className="v3-d">{t("Pistes")}</b><small>{t("À voir si le temps le permet")}</small></span></div>
          {ideas.map((p) => <Stop key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />)}
        </section>
      )}

      <footer className="br-pub">
        <p className="br-pub-by"><OrbitMark size={14} /><span>{t("Préparé avec ORBES Trips")}</span></p>
        <a className="v3-btn ghost br-pub-cta" href={appHome()} onClick={() => track("link_opened", "brand_cta")}>{t("Préparez votre voyage")}</a>
      </footer>

      <div className="pt-cta">
        <button className="v3-btn" disabled={!authReady} onClick={copy}>{t("Copier ce voyage")}</button>
        <p className="v3-fine">{t("Dans vos voyages, avec vos dates")} · {signedIn ? t("gratuit") : t("un compte gratuit suffit")}</p>
      </div>
      {copying && <CopySheet pub={pub} onClose={() => setCopying(false)} />}
    </Shell>
  );
}

function Stop({ p, open, onToggle }: { p: Place; open: boolean; onToggle: () => void }) {
  const maps = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  return (
    <div className={"pt-stop" + (open ? " open" : "")}>
      <button type="button" className="pt-stop-head" onClick={onToggle} aria-expanded={open}>
        <span className="v3-tm">{p.time ? p.time.split("–")[0] : "—"}</span>
        <span className="v3-grow">
          <b>{p.name}</b>
          <small>{[p.type !== "ajout" ? t(TYPE_LABEL[p.type]) : "", p.time].filter(Boolean).join(" · ")}</small>
        </span>
        <span className="pt-chev" aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="pt-stop-body">
          {p.desc && <p>{p.desc}</p>}
          {p.why && <p className="pt-why">{p.why}</p>}
          {p.highlights && p.highlights.length > 0 && <ul>{p.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>}
          {p.tip && <p className="pt-why">{t("Conseil : {tip}", { tip: p.tip })}</p>}
          {p.hoursText && <p className="pt-meta">{t("Horaires : {hours}", { hours: p.hoursText })}</p>}
          {p.price && <p className="pt-meta">{t("Prix : {price}", { price: p.price })}</p>}
          {(p.address || p.cn) && <p className="pt-meta">{p.address}{p.cn ? ` · ${p.cn}` : ""}</p>}
          <a className="v3-link" href={maps} target="_blank" rel="noopener">{t("Voir sur la carte")}</a>
        </div>
      )}
    </div>
  );
}

/** Choose the first day, then the programme becomes one of this account's trips */
function CopySheet({ pub, onClose }: { pub: PublicTrip; onClose: () => void }) {
  const n = Math.max(1, pub.trip.days.filter((d) => d.scheduled && d.dates?.length).length);
  const srcStart = pub.trip.start;
  const [start, setStart] = useState(srcStart && srcStart > today() ? srcStart : addDays(today(), 30));
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(start);
  const end = valid ? addDays(start, n - 1) : "";
  return (
    <div className="v3-acct-wrap pt-sheet-wrap" onClick={onClose}>
      <div className="v3-glass pt-sheet" role="dialog" aria-label={t("Copier ce voyage")} onClick={(e) => e.stopPropagation()}>
        <span className="v3-lbl">{t("Copier ce voyage")}</span>
        <h2 className="v3-d" style={{ fontSize: 26, marginTop: 8 }}>{pub.trip.title}</h2>
        <p className="v3-note">{n > 1 ? t("{n} jours", { n }) : t("{n} jour", { n })} · {t("le programme, les lieux et leurs fiches arrivent dans vos voyages.")}</p>
        <label className="v3-field col" style={{ marginTop: 14 }}>
          <span>{t("Premier jour")}</span>
          <input type="date" value={start} min={today()} onChange={(e) => setStart(e.target.value)} />
        </label>
        {valid && <p className="v3-note">{dateLabel(start, end)}</p>}
        <button
          className="v3-btn"
          style={{ marginTop: 14 }}
          disabled={!valid}
          onClick={() => {
            const id = copyTrip(pub, start);
            location.assign(`${location.pathname}#${id}`);
          }}
        >
          {t("Copier dans mes voyages")}
        </button>
        <button type="button" className="v3-link" onClick={onClose}>{t("Annuler")}</button>
      </div>
    </div>
  );
}
