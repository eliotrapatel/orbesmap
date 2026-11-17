import { useEffect, useRef, useState } from "react";
import { STATUSES, TYPE_LABEL } from "../data/trip";
import type { Place, Trip } from "../data/types";
import { amapDirections, formatMinutes, googleDirections, travelMinutes } from "../lib/geo";
import { isHotel, stopTime } from "../lib/plan";
import { checkVisit, hoursLine, liveStatus } from "../lib/hours";
import { addContact, addPhoto, currentAuthor, deleteContact, deletePhoto, deletePin, photoSrc, toast, updatePin, updatePlace, updateRecord, useStore } from "../lib/store";
import { enrichPin, useEnrich } from "../lib/enrich";
import { fitAll, slotText } from "../lib/slots";
import { parseTime } from "../lib/time";
import Planner, { fitLine, placeAt } from "./Planner";
import Notes from "./Notes";
import { IBack, ICamera, ICheck, IClock, IClose, ICopy, IExpand, IGlobe, INav, IPin, IPlus, ISpeaker, IStar, ITrain, ITrash } from "./Icons";
import { Lightbox, Modal, SavedInput, ShowScreen, compressImage, copy, speak, useEscape, useSheetDrag } from "./ui";
import { GoBlock } from "./Nav";
import type { Mode } from "../lib/route";

export default function PlaceDetail({ trip, place, onBack, onGo, sheetH }: { trip: Trip; place: Place; onBack: () => void; onGo: (m: Mode) => void; sheetH?: string }) {
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
  const job = useEnrich(added?.pinId ?? null);
  const [planning, setPlanning] = useState(false);
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!job.busy) return;
    const t = window.setInterval(() => setSecs(Math.round((Date.now() - job.startedAt) / 1000)), 1000);
    return () => window.clearInterval(t);
  }, [job.busy, job.startedAt]);
  const coords = `${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}`;
  // what is shown to a driver: the Chinese name and address of an added place, the programme's address otherwise
  const driverZh = added ? [added.nameCn, place.cn !== added.nameCn ? place.cn : ""].filter(Boolean).join("\n") : place.cn;
  const scheduledDay = !!day?.scheduled && !!day.dates?.length;
  const timed = scheduledDay && parseTime(place.time) != null;
  const suggestion = !hotel && !timed ? fitAll(trip, place, allStates).best : null;
  const sheetEmpty = !place.desc && !place.highlights.length && !place.tip && !place.metro && !place.website;

  const onFile = async (f?: File) => {
    if (!f) return;
    try {
      if (await addPhoto(place.id, await compressImage(f))) toast("Photo ajoutée");
    } catch {
      toast("Cette image ne peut pas être lue");
    }
  };

  return (
    <section ref={sheet.ref} className="detail glass" style={{ ["--c" as string]: color, ...(sheetH ? { ["--sheet-h" as string]: sheetH } : {}) }} aria-label={place.name}>
      <div className="sheet-grip" data-grip {...sheet.handlers} role="button" aria-label="Glisser vers le bas pour fermer, vers le haut pour agrandir" />
      <div className="detail-scroll scroll" style={{ flex: 1, minHeight: 0, paddingBottom: 28 }}>
        <header className="detail-hero">
          <div className="detail-actions">
            <button className="icon-btn" onClick={onBack} aria-label="Fermer la fiche">
              <IBack />
            </button>
            <button
              className={"icon-btn" + (state.favorite ? " fav-on" : "")}
              aria-pressed={!!state.favorite}
              aria-label={state.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}
              onClick={() => {
                updatePlace(place.id, { favorite: !state.favorite });
                toast(state.favorite ? "Retiré des favoris" : "Ajouté aux favoris");
              }}
            >
              <IStar />
            </button>
            {added && (
              <button
                className="icon-btn"
                aria-label="Supprimer ce lieu"
                onClick={() => {
                  const extra = [photos.length ? `${photos.length} photo${photos.length > 1 ? "s" : ""}` : "", contacts.length ? `${contacts.length} contact${contacts.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" et ");
                  if (!confirm(`Supprimer « ${place.name} »${extra ? ` avec ${extra}` : ""} ?`)) return;
                  photos.forEach((p) => deletePhoto(p.id));
                  contacts.forEach((c) => deleteContact(c.id));
                  deletePin(added.pinId);
                  toast("Lieu supprimé");
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
            <span className="label" style={{ color: "var(--mute)" }}>{TYPE_LABEL[place.type] || place.type}</span>
            {added && place.type !== "ajout" && <span className="label" style={{ color: "var(--mute)" }}>Ajouté</span>}
          </div>
          <h2>{place.name}</h2>
          <div className="sub">
            {place.time ? <span><IClock /> {place.time}</span> : added && !added.nameCn ? <span>{coords}</span> : null}
            {!hotel && <span><INav /> {formatMinutes(minutes)} depuis l'hôtel</span>}
          </div>
          {(live || line || issues.length > 0 || (!line && added?.hoursText)) && (
            <div className="hours-box">
              {live && <span className={"hb-live " + live.tone}><i /> Maintenant à {trip.title} : {live.label}</span>}
              {line && <span className="hb-line">{line}</span>}
              {!line && added?.hoursText && <span className="hb-line">Horaires : {added.hoursText}</span>}
              {issues.map((x, i) => <span key={i} className={"hb-issue " + x.tone}>{x.tone === "bad" ? "⚠ " : x.tone === "warn" ? "! " : ""}{x.text}</span>)}
              {hours?.note && <span className="hb-line">{hours.note}</span>}
            </div>
          )}
        </header>

        {place.cn && (
          <button className="driver" onClick={() => setShow(true)} aria-label="Afficher l'adresse en grand pour le chauffeur">
            <div className="zh" lang="zh-CN">{place.cn}</div>
            {place.address && <div className="en">{place.address}</div>}
            <div className="cta"><IExpand /> Montrer au chauffeur</div>
          </button>
        )}

        <div className="actions" style={place.cn ? undefined : { gridTemplateColumns: "repeat(3, 1fr)" }}>
          <a className="action" href={amapDirections(place)} target="_blank" rel="noopener"><INav /> Amap</a>
          <a className="action" href={googleDirections(place)} target="_blank" rel="noopener"><IPin /> Google</a>
          {place.cn ? (
            <>
              <button className="action" onClick={() => copy(place.cn, "Adresse copiée pour DiDi", toast)}><ICopy /> DiDi</button>
              <button className="action" onClick={() => speak(driverZh) || toast("Lecture vocale indisponible")}><ISpeaker /> Écouter</button>
            </>
          ) : (
            <button className="action" onClick={() => copy(coords, "Coordonnées copiées", toast)}><ICopy /> Copier</button>
          )}
        </div>

        <GoBlock target={place} onGo={onGo} />

        {!hotel && (
          <div className="sec plan-sec">
            <span className="label">Programme</span>
            <div className="plan-now">
              <span className="plan-where">
                <i />
                <b>{day?.dates?.[0] ? day.short : day?.title}</b>
                <span>{place.time ? place.time : scheduledDay ? "sans heure" : day?.theme}</span>
              </span>
              <button className="btn-sm" onClick={() => setPlanning(true)}>{timed ? "Déplacer" : "Placer"}</button>
            </div>
            {suggestion?.ok && !suggestion.tight && (
              <button className="plan-best" style={{ ["--c" as string]: suggestion.day.color }} onClick={() => placeAt(place, suggestion.day.key, slotText(suggestion.start, suggestion.end), trip)}>
                <span className="label">Créneau conseillé</span>
                <b>{suggestion.day.short}, {slotText(suggestion.start, suggestion.end)}</b>
                <small>{fitLine(suggestion)}</small>
                <em>Placer</em>
              </button>
            )}
            {place.orig && (
              <p className="em-small">Programme d'origine : {trip.days.find((d) => d.key === place.orig!.day)?.short}{place.orig.time ? `, ${place.orig.time}` : ""}</p>
            )}
          </div>
        )}

        {!hotel && (
          <div className="sec">
            <span className="label">Suivi</span>
            <div className="seg" role="group" aria-label="Statut">
              {STATUSES.map((s) => (
                <button key={s.key} className={state.status === s.key ? "on" : ""} style={{ ["--c" as string]: s.color }} aria-pressed={state.status === s.key} onClick={() => updatePlace(place.id, { status: state.status === s.key ? null : s.key })}>
                  <i /> {s.label}
                </button>
              ))}
            </div>
            <div className="stars" role="group" aria-label="Note">
              <span className="label">Note</span>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={(state.rating || 0) >= n ? "on" : ""} aria-label={`${n} sur 5`} onClick={() => updatePlace(place.id, { rating: state.rating === n ? 0 : n })}>★</button>
              ))}
            </div>
            <label className="field">
              <span>Rendez-vous</span>
              <SavedInput value={state.appt || ""} placeholder="ex. 10h30, réservation au nom d'Eliot" onSave={(v) => updatePlace(place.id, { appt: v })} />
            </label>
          </div>
        )}

        {hotel && (
          <div className="sec">
            <span className="label">Séjour</span>
            <label className="field">
              <span>Rendez-vous, navette, check-in</span>
              <SavedInput value={state.appt || ""} placeholder="ex. voiture 8h45 devant l'hôtel" onSave={(v) => updatePlace(place.id, { appt: v })} />
            </label>
          </div>
        )}

        {supplier && (
          <div className="sec">
            <span className="label">Fiche fournisseur</span>
            <div className="grid2">
              <label className="field"><span>MOQ</span><SavedInput value={state.moq || ""} placeholder="ex. 50 pcs" onSave={(v) => updatePlace(place.id, { moq: v })} /></label>
              <label className="field"><span>Prix unitaire</span><SavedInput value={state.price || ""} placeholder="ex. 4,20 $" onSave={(v) => updatePlace(place.id, { price: v })} /></label>
              <label className="field"><span>Délai de production</span><SavedInput value={state.lead || ""} placeholder="ex. 15 jours" onSave={(v) => updatePlace(place.id, { lead: v })} /></label>
              <label className="field"><span>Échantillon</span><SavedInput value={state.sample || ""} placeholder="ex. commandé" onSave={(v) => updatePlace(place.id, { sample: v })} /></label>
            </div>
          </div>
        )}

        <div className="sec">
          <span className="label">Le lieu</span>
          {added && sheetEmpty && !job.busy && <p className="em-small">Fiche à compléter : l'IA peut la rédiger (description, points forts, conseil, métro, horaires).</p>}
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
          {added?.why && <p className="em-small">Pourquoi : {added.why}</p>}
          {added?.price && <p className="em-small">Prix : {added.price}</p>}
          {added?.source && /^https?:\/\//.test(added.source) && <p className="em-small"><a href={added.source} target="_blank" rel="noopener">Source</a></p>}
          {added && (
            <div className="enrich">
              {job.busy ? (
                <span className="tr-loading">
                  <span className="spin" /> {job.startedAt ? `Rédaction de la fiche complète… ${secs} s` : "Fiche en attente (une autre est en cours)…"}
                  <small>Vous pouvez fermer la fiche (gardez l'app ouverte).</small>
                </span>
              ) : (
                <>
                  <button className={"btn-sm" + (added.enrichedAt ? "" : " on")} onClick={() => void enrichPin(added.pinId)}>
                    {added.enrichedAt ? "Mettre à jour la fiche avec l'IA" : "Compléter la fiche avec l'IA"}
                  </button>
                  {job.err && <p className="tr-err">{job.err}</p>}
                </>
              )}
            </div>
          )}
        </div>

        <Notes
          rec={state as Record<string, unknown>}
          legacyText={added ? added.note : undefined}
          placeholder={added ? "Stand, contact, prix…" : "Ce que vous avez vu, les prix, les impressions…"}
          onSave={(key, v) => {
            // an added place keeps its former shared note on the pin itself (as before)
            if (added && key === "note") {
              updatePin(added.pinId, { note: v });
              updateRecord(place.id, { noteBy: currentAuthor() });
            } else updateRecord(place.id, key === "note" ? { note: v, noteBy: currentAuthor() } : { [key]: v });
          }}
        />

        <div className="sec">
          <span className="label">Photos</span>
          <div className="photos">
            {photos.map((p) => {
              const src = photoSrc(p);
              return (
                <div className="photo" key={p.id}>
                  {src ? <img src={src} alt="" loading="lazy" onClick={() => setLightbox(src)} /> : null}
                  <button className="x" aria-label="Supprimer la photo" onClick={() => confirm("Supprimer cette photo ?") && deletePhoto(p.id)}>
                    <IClose width={12} height={12} />
                  </button>
                </div>
              );
            })}
            <button className="photo-add" onClick={() => file.current?.click()}>
              <span><ICamera />Ajouter</span>
            </button>
          </div>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </div>

        <div className="sec">
          <span className="label">Contacts</span>
          {contacts.map((c) => {
            const href = c.kind === "wa" ? `https://wa.me/${c.value.replace(/[^0-9]/g, "")}${c.message ? `?text=${encodeURIComponent(c.message)}` : ""}` : `weixin://dl/chat?username=${encodeURIComponent(c.value)}`;
            return (
              <div className="contact" key={c.id}>
                <span className="badge">{c.kind === "wa" ? "WhatsApp" : "WeChat"}</span>
                <a className="contact-main" href={href} target="_blank" rel="noopener">
                  <b>{c.name}</b>
                  <small>{c.value}</small>
                </a>
                <button className="icon-btn" aria-label={`Copier ${c.value}`} onClick={() => copy(c.value, "Copié", toast)}><ICopy /></button>
                <button className="icon-btn" aria-label={`Supprimer ${c.name}`} onClick={() => confirm(`Supprimer le contact ${c.name} ?`) && deleteContact(c.id)}><ITrash /></button>
              </div>
            );
          })}
          <button className="link-btn" onClick={() => setAddingContact(true)}><IPlus /> Ajouter un contact</button>
        </div>

        {added && (
          <div className="sec">
            <span className="label">Nom</span>
            <SavedInput value={place.name} onSave={(v) => v.trim() && updatePin(added.pinId, { name: v.trim() })} />
          </div>
        )}

        {!hotel && (
          <button className={"visit-btn" + (state.visited ? " on" : "")} aria-pressed={!!state.visited} onClick={() => updatePlace(place.id, { visited: !state.visited })}>
            <ICheck /> {state.visited ? "Visité" : "Marquer comme visité"}
          </button>
        )}
      </div>

      {show && <ShowScreen zh={driverZh} sub={place.address ? `${place.name} — ${place.address}` : place.name} onClose={() => setShow(false)} />}
      {planning && <Planner trip={trip} place={place} states={allStates} onClose={() => setPlanning(false)} />}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      {addingContact && (
        <ContactForm
          placeName={place.name}
          onClose={() => setAddingContact(false)}
          onSave={(c) => {
            addContact({ ...c, placeId: place.id });
            setAddingContact(false);
            toast("Contact ajouté");
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
  const [message, setMessage] = useState("Bonjour, je développe la marque ORBES à Paris…");
  const ok = name.trim() && value.trim();
  return (
    <Modal title="Ajouter un contact" intro={placeName} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ name: name.trim(), kind, value: value.trim(), message: kind === "wa" ? message.trim() || undefined : undefined }); }}>
        <div className="seg" style={{ marginTop: 16 }} role="radiogroup" aria-label="Application">
          {(["wc", "wa"] as const).map((k) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? "on" : ""} style={{ ["--c" as string]: "#f6f2ea" }} onClick={() => setKind(k)}>
              {k === "wa" ? "WhatsApp" : "WeChat"}
            </button>
          ))}
        </div>
        <label className="field"><span>Nom</span><input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="ex. Jack, MSX Jewelry" /></label>
        <label className="field">
          <span>{kind === "wa" ? "Numéro WhatsApp" : "Identifiant WeChat"}</span>
          <input className="input" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "wa" ? "+86 138 0000 0000" : "wechat_id"} inputMode={kind === "wa" ? "tel" : "text"} />
        </label>
        {kind === "wa" && <label className="field"><span>Premier message (prérempli)</span><input className="input" value={message} onChange={(e) => setMessage(e.target.value)} /></label>}
        <div className="btn-row">
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
          <button type="submit" className="btn primary" disabled={!ok}>Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
