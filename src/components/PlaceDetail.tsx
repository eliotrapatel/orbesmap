import { useEffect, useRef, useState } from "react";
import { STATUSES, TYPE_LABEL } from "../data/trip";
import type { Place, Trip } from "../data/types";
import { amapDirections, formatMinutes, googleDirections, travelMinutes } from "../lib/geo";
import { isHotel, stopTime } from "../lib/plan";
import { checkVisit, hoursLine, liveStatus } from "../lib/hours";
import { addContact, addPhoto, currentAuthor, deleteContact, deletePhoto, deletePin, photoSrc, toast, updateDef, updatePin, updatePlace, updateRecord, useCanEdit, useStore, needPro, requestPro, useProgrammeLocked, getState } from "../lib/store";
import { enrichPlace, restorePrevSheet, useEnrich } from "../lib/enrich";
import EditSheet from "./EditSheet";
import { fitAll, slotText } from "../lib/slots";
import { parseTime } from "../lib/time";
import Planner, { fitLine, placeAt } from "./Planner";
import { removeFromProgramme } from "./RemovedList";
import Notes from "./Notes";
import { IBack, ICamera, ICheck, IClock, IClose, ICopy, IEdit, IExpand, IGlobe, INav, IPin, IPlus, ISpeaker, IStar, ITrain, ITrash } from "./Icons";
import { Lightbox, Modal, SavedInput, ShowScreen, compressImage, copy, speak, useEscape, useSheetDrag } from "./ui";
import { GoBlock } from "./Nav";
import type { Mode } from "../lib/route";
import { t, locale } from "../lib/i18n";
import { money, useBusiness, useExpenses } from "../lib/business";
import { exportReport } from "../lib/export";

export default function PlaceDetail({ trip, place, onBack, onGo, sheetH, onMovePoint }: { trip: Trip; place: Place; onBack: () => void; onGo: (m: Mode) => void; sheetH?: string; onMovePoint?: () => void }) {
  const state = useStore((s) => s.data.places[place.id]) || {};
  useEscape(onBack);
  const sheet = useSheetDrag(onBack, sheetH);
  const allContacts = useStore((s) => s.data.contacts);
  const allPhotos = useStore((s) => s.data.photos);
  useStore((s) => s.photoUrls);
  const contacts = allContacts.filter((c) => c.placeId === place.id);
  const photos = allPhotos.filter((p) => p.placeId === place.id);
  const day = trip.days.find((d) => d.key === place.day);
  const color = day?.color || "#f6f2ea";
  const [show, setShow] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [addingContact, setAddingContact] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const supplier = place.type === "fabricant";
  const hotel = isHotel(trip, place);
  const minutes = travelMinutes(trip.hotel, place);
  const allStates = useStore((s) => s.data.places);
  const hours = trip.hours?.[place.id];
  const live = liveStatus(hours, trip.timezone);
  const issues = checkVisit(hours, day?.dates?.[0], stopTime(place, allStates));
  const line = hoursLine(hours);
  // places added in the app share this sheet; what only they have
  const added = place.added;
  const job = useEnrich(hotel ? null : place.id);
  const [planning, setPlanning] = useState(false);
  // a reader of a shared trip sees the sheet without anything to change
  const canEdit = useCanEdit();
  const locked = useProgrammeLocked();
  const business = useBusiness(trip);
  const [editing, setEditing] = useState(false);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!job.busy) return;
    const t = window.setInterval(() => setSecs(Math.round((Date.now() - job.startedAt) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [job.busy, job.startedAt]);
  const coords = `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
  // what is shown to a driver: the Chinese name and address of an added place, the programme's address otherwise
  const driverZh = [place.nameCn, place.cn !== place.nameCn ? place.cn : ""].filter(Boolean).join("\n");
  const scheduledDay = !!day?.scheduled && !!day.dates?.length;
  const timed = scheduledDay && parseTime(place.time) != null;
  const suggestion = !hotel && !timed ? fitAll(trip, place, allStates).best : null;
  const sheetEmpty = !place.desc && !place.highlights.length && !place.tip && !place.metro && !place.website;

  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      if (await addPhoto(place.id, await compressImage(f))) toast(t("Photo ajoutée"));
    } catch {
      toast(t("Cette image ne peut pas être lue"));
    }
  };

  return (
    <section ref={sheet.ref} className="detail glass" style={{ ["--c" as string]: color, ...(sheetH ? { ["--sheet-h" as string]: sheetH } : {}) }} aria-label={place.name}>
      <div className="sheet-grip" data-grip {...sheet.handlers} role="button" aria-label={t("Glisser vers le bas pour fermer, vers le haut pour agrandir")} />
      <div className="detail-scroll scroll" style={{ flex: 1, minHeight: 0, paddingBottom: 28 }}>
        <header className="detail-hero">
          <div className="detail-actions">
            <button className="icon-btn" onClick={onBack} aria-label={t("Fermer la fiche")}>
              <IBack />
            </button>
            {canEdit && <button
              className={"icon-btn" + (state.favorite ? " fav-on" : "")}
              aria-pressed={!!state.favorite}
              aria-label={state.favorite ? t("Retirer des favoris") : t("Ajouter aux favoris")}
              onClick={() => {
                updatePlace(place.id, { favorite: !state.favorite });
                toast(state.favorite ? t("Retiré des favoris") : t("Ajouté aux favoris"));
              }}
            >
              <IStar />
            </button>}
            {canEdit && (
              <button className="icon-btn" aria-label={t("Modifier la fiche")} onClick={() => !needPro() && setEditing(true)}>
                <IEdit />
              </button>
            )}
            {!hotel && canEdit && (
              <button
                className="icon-btn"
                aria-label={t("Supprimer ce lieu")}
                onClick={() => {
                  if (needPro()) return;
                  const extra = [photos.length ? (photos.length > 1 ? t("{n} photos", { n: photos.length }) : t("{n} photo", { n: photos.length })) : "", contacts.length ? (contacts.length > 1 ? t("{n} contacts", { n: contacts.length }) : t("{n} contact", { n: contacts.length })) : ""].filter(Boolean).join(` ${t("et")} `);
                  if (!confirm(extra ? t("Supprimer définitivement « {name} » avec {extra} ?\nPour le sortir du programme en pouvant le remettre plus tard, utilisez plutôt « Retirer du programme ».", { name: place.name, extra }) : t("Supprimer définitivement « {name} » ?\nPour le sortir du programme en pouvant le remettre plus tard, utilisez plutôt « Retirer du programme ».", { name: place.name }))) return;
                  photos.forEach((p) => deletePhoto(p.id));
                  contacts.forEach((c) => deleteContact(c.id));
                  // the record stays as "deleted" so the other phone does not bring the place back
                  updateDef(place.id, { deleted: true });
                  if (added?.pinId) deletePin(added.pinId);
                  toast(t("Lieu supprimé"));
                  onBack();
                }}
              >
                <ITrash />
              </button>
            )}
          </div>
          <div className="kicker">
            <span className="sdot" />
            <span className="label">{day?.title || ""}</span>
            <span className="label" style={{ color: "var(--mute)" }}>{t(TYPE_LABEL[place.type] || place.type)}</span>
            {added && place.type !== "ajout" && <span className="label" style={{ color: "var(--mute)" }}>{t("Ajouté")}</span>}
          </div>
          <h2>{place.name}</h2>
          <div className="sub">
            {place.time ? <span><IClock /> {place.time}</span> : !place.cn ? <span>{coords}</span> : null}
            {!hotel && <span><INav /> {t("{time} depuis l'hôtel", { time: formatMinutes(minutes) })}</span>}
          </div>
          {(live || line || issues.length > 0 || (!line && place.hoursText)) && (
            <div className="hours-box">
              {live && <span className={"hb-live " + live.tone}><i /> {t("Maintenant à {city} : {status}", { city: trip.title, status: live.label })}</span>}
              {line && <span className="hb-line">{line}</span>}
              {!line && place.hoursText && <span className="hb-line">{t("Horaires : {hours}", { hours: place.hoursText })}</span>}
              {issues.map((x, i) => <span key={i} className={"hb-issue " + x.tone}>{x.tone === "bad" ? "⚠ " : x.tone === "warn" ? "! " : ""}{x.text}</span>)}
              {hours?.note && <span className="hb-line">{hours.note}</span>}
            </div>
          )}
        </header>

        {place.cn && (
          <button className="driver" onClick={() => setShow(true)} aria-label={t("Afficher l'adresse en grand pour le chauffeur")}>
            <div className="zh" lang="zh-CN">{place.cn}</div>
            {place.address && <div className="en">{place.address}</div>}
            <div className="cta"><IExpand /> {t("Montrer au chauffeur")}</div>
          </button>
        )}

        <div className="actions" style={place.cn ? undefined : { gridTemplateColumns: "repeat(3, 1fr)" }}>
          <a className="action" href={amapDirections(place)} target="_blank" rel="noopener"><INav /> Amap</a>
          <a className="action" href={googleDirections(place)} target="_blank" rel="noopener"><IPin /> Google</a>
          {place.cn ? (
            <>
              <button className="action" onClick={() => copy(place.cn, t("Adresse copiée pour DiDi"), toast)}><ICopy /> DiDi</button>
              <button className="action" onClick={() => speak(driverZh) || toast(t("Lecture vocale indisponible"))}><ISpeaker /> {t("Écouter")}</button>
            </>
          ) : (
            <button className="action" onClick={() => copy(coords, t("Coordonnées copiées"), toast)}><ICopy /> {t("Copier")}</button>
          )}
        </div>

        <GoBlock target={place} onGo={onGo} />

        {!hotel && canEdit && (
          <div className="sec plan-sec">
            <span className="label">{t("Programme")}</span>
            <div className="plan-now">
              <span className="plan-where">
                <i />
                <b>{day?.dates?.[0] ? day.short : day?.title}</b>
                <span>{place.time ? place.time : scheduledDay ? t("sans heure") : day?.theme}</span>
              </span>
              <button className="btn-sm" onClick={() => !needPro() && setPlanning(true)}>{timed ? t("Déplacer") : t("Placer")}</button>
            </div>
            {suggestion?.ok && !suggestion.tight && (
              <button className="plan-best" style={{ ["--c" as string]: suggestion.day.color }} onClick={() => placeAt(place, suggestion.day.key, slotText(suggestion.start, suggestion.end), trip)}>
                <span className="label">{t("Créneau conseillé")}</span>
                <b>{suggestion.day.short}, {slotText(suggestion.start, suggestion.end)}</b>
                <small>{fitLine(suggestion)}</small>
                <em>{t("Placer")}</em>
              </button>
            )}
            {place.orig && (
              <p className="em-small">{t("Programme d'origine : {day}", { day: `${trip.days.find((d) => d.key === place.orig!.day)?.short ?? ""}${place.orig.time ? `, ${place.orig.time}` : ""}` })}</p>
            )}
            <button className="link-btn plan-remove" onClick={() => removeFromProgramme(place) && onBack()}>{t("Retirer du programme")}</button>
            {locked && <button className="pro-note" onClick={() => requestPro("edit")}><span className="pro-tag">PRO</span> {t("Voyage validé : modifier le programme est réservé à Pro.")}</button>}
          </div>
        )}

        {!hotel && canEdit && (
          <div className="sec">
            <span className="label">{t("Suivi")}</span>
            <div className="seg" role="group" aria-label={t("Statut")}>
              {STATUSES.filter((s) => !s.business || business).map((s) => (
                <button key={s.key} className={state.status === s.key ? "on" : ""} style={{ ["--c" as string]: s.color }} aria-pressed={state.status === s.key} onClick={() => updatePlace(place.id, { status: state.status === s.key ? null : s.key })}>
                  <i /> {t(s.label)}
                </button>
              ))}
            </div>
            <div className="stars" role="group" aria-label={t("Note")}>
              <span className="label">{t("Note")}</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={(state.rating || 0) >= n ? "on" : ""} aria-label={t("{n} sur 5", { n })} onClick={() => updatePlace(place.id, { rating: state.rating === n ? 0 : n })}>★</button>
              ))}
            </div>
            <label className="field">
              <span>{t("Rendez-vous")}</span>
              <SavedInput value={state.appt || ""} placeholder={t("ex. 10h30, réservation au nom d'Eliot")} onSave={(v) => updatePlace(place.id, { appt: v })} />
            </label>
          </div>
        )}

        {hotel && (
          <div className="sec">
            <span className="label">{t("Séjour")}</span>
            <label className="field">
              <span>{t("Rendez-vous, navette, check-in")}</span>
              <SavedInput value={state.appt || ""} placeholder={t("ex. voiture 8h45 devant l'hôtel")} onSave={(v) => updatePlace(place.id, { appt: v })} />
            </label>
          </div>
        )}

        {(supplier || (business && place.type !== "transport")) && !hotel && (
          <div className="sec">
            <span className="label">{t("Fiche fournisseur")}</span>
            {business && <label className="field"><span>{t("Produits")}</span><SavedInput value={state.products || ""} placeholder={t("ex. sacs en cuir, petite maroquinerie")} onSave={(v) => updatePlace(place.id, { products: v })} /></label>}
            <div className="grid2">
              <label className="field"><span>MOQ</span><SavedInput value={state.moq || ""} placeholder={t("ex. 50 pcs")} onSave={(v) => updatePlace(place.id, { moq: v })} /></label>
              <label className="field"><span>{t("Prix unitaire")}</span><SavedInput value={state.price || ""} placeholder={t("ex. 4,20 $")} onSave={(v) => updatePlace(place.id, { price: v })} /></label>
              <label className="field"><span>{t("Délai de production")}</span><SavedInput value={state.lead || ""} placeholder={t("ex. 15 jours")} onSave={(v) => updatePlace(place.id, { lead: v })} /></label>
              <label className="field"><span>{t("Échantillon")}</span><SavedInput value={state.sample || ""} placeholder={t("ex. commandé")} onSave={(v) => updatePlace(place.id, { sample: v })} /></label>
            </div>
            {business && <SupplierMoney trip={trip} placeId={place.id} />}
          </div>
        )}

        <div className="sec">
          <span className="label">{t("Le lieu")}</span>
          {!hotel && sheetEmpty && !job.busy && <p className="em-small">{t("Fiche à compléter : l'IA peut la rédiger (description, points forts, conseil, métro, horaires).")}</p>}
          {place.desc && <p>{place.desc}</p>}
          {place.highlights.length > 0 && (
            <ul className="hl">
              {place.highlights.map((h) => <li key={h}>{h}</li>)}
            </ul>
          )}
          {place.tip && <div className="tip">{place.tip}</div>}
          <div className="facts">
            {place.metro && <div className="fact"><ITrain /><span>{place.metro}</span></div>}
            {place.website && (
              <div className="fact">
                <IGlobe />
                <a href={place.website} target="_blank" rel="noopener">{place.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a>
              </div>
            )}
          </div>
          {place.why && <p className="em-small">{t("Pourquoi : {why}", { why: place.why })}</p>}
          {place.price && <p className="em-small">{t("Prix : {price}", { price: place.price })}</p>}
          {place.source && /^https?:\/\//.test(place.source) && <p className="em-small"><a href={place.source} target="_blank" rel="noopener">{t("Source")}</a></p>}
          {!hotel && canEdit && (
            <div className="enrich">
              {job.busy ? (
                <span className="tr-loading">
                  <span className="spin" /> {job.startedAt ? t("Rédaction de la fiche complète… {n} s", { n: secs }) : t("Fiche en attente (une autre est en cours)…")}
                  <small>{t("Vous pouvez fermer la fiche (gardez l'app ouverte).")}</small>
                </span>
              ) : (
                <>
                  <div className="enrich-btns">
                    <button className={"btn-sm" + (sheetEmpty ? " on" : "")} onClick={() => void enrichPlace(place.id)}>
                      {sheetEmpty ? t("Compléter la fiche avec l'IA") : t("Mettre à jour la fiche avec l'IA")}
                    </button>
                    <button className="btn-sm" onClick={() => setEditing(true)}>{t("Modifier la fiche")}</button>
                  </div>
                  {place.hasPrev && <button className="link-btn plan-remove" onClick={() => restorePrevSheet(place.id)}>{t("Revenir à la fiche d'avant la mise à jour")}</button>}
                  {job.err && <p className="tr-err">{job.err}</p>}
                </>
              )}
            </div>
          )}
        </div>

        {canEdit && (
        <Notes
            rec={state as Record<string, unknown>}
            legacyText={added ? added.note : undefined}
            placeholder={added ? t("Stand, contact, prix…") : t("Ce que vous avez vu, les prix, les impressions…")}
            onSave={(key, v) => {
              // an added place keeps its former shared note on the pin itself (as before)
              if (added?.pinId && key === "note") {
                updatePin(added.pinId, { note: v });
                updateRecord(place.id, { noteBy: currentAuthor() });
              } else updateRecord(place.id, key === "note" ? { note: v, noteBy: currentAuthor() } : { [key]: v });
            }}
          />
        )}

        <div className="sec">
          <span className="label">{t("Photos")}</span>
          <div className="photos">
            {photos.map((p) => {
              const src = photoSrc(p);
              return (
                <div className="photo" key={p.id}>
                  {src ? <img src={src} alt="" loading="lazy" onClick={() => setLightbox(src)} /> : null}
                  {canEdit && <button className="x" aria-label={t("Supprimer la photo")} onClick={() => confirm(t("Supprimer cette photo ?")) && deletePhoto(p.id)}>
                    <IClose width={12} height={12} />
                  </button>}
                </div>
              );
            })}
            {canEdit && <button className="photo-add" onClick={() => file.current?.click()}>
              <span><ICamera />{t("Ajouter")}</span>
            </button>}
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        <div className="sec">
          <span className="label">{t("Contacts")}</span>
          {contacts.map((c) => {
            const href = c.kind === "wa" ? `https://wa.me/${c.value.replace(/[^0-9]/g, "")}${c.message ? `?text=${encodeURIComponent(c.message)}` : ""}` : `weixin://dl/chat?username=${encodeURIComponent(c.value)}`;
            return (
              <div className="contact" key={c.id}>
                <span className="badge">{c.kind === "wa" ? "WhatsApp" : "WeChat"}</span>
                <a className="contact-main" href={href} target="_blank" rel="noopener">
                  <b>{c.name}</b>
                  <small>{c.value}</small>
                </a>
                <button className="icon-btn" aria-label={t("Copier {value}", { value: c.value })} onClick={() => copy(c.value, t("Copié"), toast)}><ICopy /></button>
                {canEdit && <button className="icon-btn" aria-label={t("Supprimer {name}", { name: c.name })} onClick={() => confirm(t("Supprimer le contact {name} ?", { name: c.name })) && deleteContact(c.id)}><ITrash /></button>}
              </div>
            );
          })}
          {canEdit && <button className="link-btn" onClick={() => setAddingContact(true)}><IPlus /> {t("Ajouter un contact")}</button>}
        </div>


        {!hotel && canEdit && (
          <button className={"visit-btn" + (state.visited ? " on" : "")} aria-pressed={!!state.visited} onClick={() => updatePlace(place.id, { visited: !state.visited })}>
            <ICheck /> {state.visited ? t("Visité") : t("Marquer comme visité")}
          </button>
        )}
      </div>

      {show && <ShowScreen zh={driverZh} sub={place.address ? `${place.name} — ${place.address}` : place.name} onClose={() => setShow(false)} />}
      {planning && <Planner trip={trip} place={place} states={allStates} onClose={() => setPlanning(false)} />}
      {editing && <EditSheet trip={trip} place={place} onClose={() => setEditing(false)} onMovePoint={onMovePoint ? () => { setEditing(false); onMovePoint(); } : undefined} />}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      {addingContact && (
        <ContactForm
          placeName={place.name}
          onClose={() => setAddingContact(false)}
          onSave={(c) => {
            addContact({ ...c, placeId: place.id });
            setAddingContact(false);
            toast(t("Contact ajouté"));
          }}
        />
      )}
    </section>
  );
}

function ContactForm({ placeName, onClose, onSave }: { placeName: string; onClose: () => void; onSave: (c: { name: string; kind: "wa" | "wc"; value: string; message?: string }) => void }) {
  const [kind, setKind] = useState<"wa" | "wc">("wc");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState(() => t("Bonjour, je développe la marque ORBES à Paris…"));
  const ok = name.trim() && value.trim();
  return (
    <Modal title={t("Ajouter un contact")} intro={placeName} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ name: name.trim(), kind, value: value.trim(), message: kind === "wa" ? message.trim() || undefined : undefined }); }}>
        <div className="seg" style={{ marginTop: 16 }} role="radiogroup" aria-label={t("Application")}>
          {(["wc", "wa"] as const).map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} style={{ ["--c" as string]: "#f6f2ea" }} onClick={() => setKind(k)}>
              {k === "wa" ? "WhatsApp" : "WeChat"}
            </button>
          ))}
        </div>
        <label className="field"><span>{t("Nom")}</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ex. Jack, MSX Jewelry")} /></label>
        <label className="field">
          <span>{kind === "wa" ? t("Numéro WhatsApp") : t("Identifiant WeChat")}</span>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "wa" ? "+86 138 0000 0000" : "wechat_id"} inputMode={kind === "wa" ? "tel" : "text"} />
        </label>
        {kind === "wa" && <label className="field"><span>{t("Premier message (prérempli)")}</span><input className="input" value={message} onChange={(e) => setMessage(e.target.value)} /></label>}
        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose}>{t("Annuler")}</button>
          <button type="submit" className="btn primary" disabled={!ok}>{t("Enregistrer")}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Business mode: what was spent at this supplier, and its report */
function SupplierMoney({ trip, placeId }: { trip: Trip; placeId: string }) {
  const list = useExpenses().filter((e) => e.placeId === placeId);
  const totals = new Map<string, number>();
  for (const e of list) totals.set(e.currency, (totals.get(e.currency) || 0) + e.amount);
  return (
    <div className="sup-money">
      <span className="em-small">
        {list.length
          ? t("Dépensé ici : {sum} ({n} dépense(s))", { sum: [...totals].map(([c, v]) => money(v, c, locale())).join(" + "), n: list.length })
          : t("Aucune dépense chez ce fournisseur. Ajoutez-en depuis l'outil Dépenses.")}
      </span>
      <button className="btn-sm" onClick={() => { if (!exportReport(trip, getState().data, placeId)) toast(t("Autorisez les fenêtres pop-up pour imprimer le PDF")); }}>{t("Compte-rendu PDF")}</button>
    </div>
  );
}
