import { useEffect, useRef, useState } from "react";
import type { Trip } from "../data/types";
import { ai, AiError, imageToBase64, type InterpretResult, type PhotoResult } from "../lib/ai";
import { addContact, toast, useStore } from "../lib/store";
import { ICamera, ICopy, IExpand, ISpeaker } from "./Icons";
import { ShowScreen, copy, speak } from "./ui";

// ---------------- speech recognition (Safari/Chrome; iOS needs Siri & Dictation on) ----------------
type SR = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void;
  onend: () => void;
  onerror: (e: { error: string }) => void;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
const SRClass = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
export const canListen = !!SRClass;

const HIST_KEY = "orbes.photo.history";
type Saved = { at: number; r: PhotoResult };
const readHist = (): Saved[] => {
  try {
    return JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
  } catch {
    return [];
  }
};

export default function Translate({ trip }: { trip: Trip }) {
  const [tab, setTab] = useState<"photo" | "talk">("photo");
  return (
    <div>
      <div className="seg tr-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "photo"} className={tab === "photo" ? "on" : ""} style={{ ["--c" as string]: "var(--ink)" }} onClick={() => setTab("photo")}><ICamera /> Photo</button>
        <button role="tab" aria-selected={tab === "talk"} className={tab === "talk" ? "on" : ""} style={{ ["--c" as string]: "var(--ink)" }} onClick={() => setTab("talk")}><ISpeaker /> Conversation</button>
      </div>
      {tab === "photo" ? <PhotoTab trip={trip} /> : <TalkTab />}
    </div>
  );
}

// ---------------- Photo ----------------
function PhotoTab({ trip }: { trip: Trip }) {
  const rate = useStore((s) => s.settings.eurRate) || 7.8;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [res, setRes] = useState<PhotoResult | null>(null);
  const [hist, setHist] = useState<Saved[]>(readHist);
  const [show, setShow] = useState<{ zh: string; sub: string } | null>(null);
  const [placeId, setPlaceId] = useState("");
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const onFile = async (f?: File) => {
    if (!f) return;
    setErr(null);
    setRes(null);
    setPreview(URL.createObjectURL(f));
    setBusy(true);
    try {
      const image = await imageToBase64(f);
      const r = await ai<PhotoResult>("photo", { image });
      setRes(r);
      const next = [{ at: Date.now(), r }, ...readHist()].slice(0, 12);
      setHist(next);
      try {
        localStorage.setItem(HIST_KEY, JSON.stringify(next));
      } catch {
        /* storage full: keep in memory */
      }
    } catch (e) {
      setErr(e instanceof AiError ? e.message : "La traduction a échoué. Réessayez.");
    } finally {
      setBusy(false);
    }
  };

  const eur = (cny: number) => `${(cny / rate).toFixed(cny / rate < 10 ? 1 : 0).replace(".", ",")} €`;
  const c = res?.contact;
  const hasContact = !!c && !!(c.name || c.phone || c.wechat || c.email);
  const places = trip.places.filter((p) => p.type !== "transport");

  return (
    <div className="tr">
      <p className="tr-intro">Menu, panneau, étiquette de cuir ou de tissu, carte de visite : prenez-la en photo, la traduction arrive en quelques secondes.</p>
      <div className="tr-btns">
        <button className="btn primary" onClick={() => cam.current?.click()} disabled={busy}><ICamera /> Prendre une photo</button>
        <button className="btn" onClick={() => lib.current?.click()} disabled={busy}>Choisir une image</button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={lib} type="file" accept="image/*" hidden onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />

      {preview && (busy || res || err) && <img className="tr-prev" src={preview} alt="Photo envoyée" />}
      {busy && <div className="tr-loading"><span className="spin" /> Lecture de la photo…</div>}
      {err && <p className="tr-err">{err}</p>}

      {res && (
        <div className="tr-res">
          <h4>{res.title}</h4>
          {res.summary && <p>{res.summary}</p>}
          {res.picks.length > 0 && (
            <div className="tr-block ok">
              <span className="label">À commander</span>
              {res.picks.map((p) => <p key={p.name}><b>{p.name}</b> · {p.why}</p>)}
            </div>
          )}
          {res.avoid.length > 0 && (
            <div className="tr-block bad">
              <span className="label">À éviter</span>
              {res.avoid.map((p) => <p key={p.name}><b>{p.name}</b> · {p.why}</p>)}
            </div>
          )}
          {res.material && (
            <div className="tr-block">
              <span className="label">Matière et qualité</span>
              <p>{res.material}</p>
            </div>
          )}
          {res.lines.length > 0 && (
            <div className="tr-lines">
              {res.lines.map((l, i) => (
                <button key={i} className="tr-line" onClick={() => setShow({ zh: l.zh, sub: l.fr })} title="Montrer en grand">
                  <span className="tr-fr">{l.fr}{l.note && <small>{l.note}</small>}</span>
                  <span className="tr-zh" lang="zh-CN">{l.zh}</span>
                  {l.price > 0 && <span className="tr-price">{l.price} ¥<small>{eur(l.price)}</small></span>}
                </button>
              ))}
              <p className="tr-hint"><IExpand /> Touchez une ligne pour la montrer en grand (au serveur, au vendeur).</p>
            </div>
          )}
          {hasContact && c && (
            <div className="tr-block">
              <span className="label">Carte de visite</span>
              <p><b>{c.name}</b>{c.role ? ` · ${c.role}` : ""}{c.company ? ` · ${c.company}` : ""}</p>
              {c.phone && <p>Tél. {c.phone}</p>}
              {c.wechat && <p>WeChat {c.wechat}</p>}
              {c.email && <p>{c.email}</p>}
              {(c.address || c.addressCn) && <p>{c.address} <span lang="zh-CN">{c.addressCn}</span></p>}
              <div className="em-actions">
                <select className="input" value={placeId} onChange={(e) => setPlaceId(e.target.value)} aria-label="Lieu où ranger le contact">
                  <option value="">Ranger sur un lieu…</option>
                  {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <button
                  className="btn-sm"
                  disabled={!placeId || !(c.wechat || c.phone)}
                  onClick={() => {
                    addContact({ placeId, name: c.name || c.company || "Contact", kind: c.wechat ? "wc" : "wa", value: c.wechat || c.phone });
                    toast("Contact ajouté à la fiche du lieu");
                  }}
                >
                  Ajouter le contact
                </button>
                <button className="btn-sm" onClick={() => copy([c.name, c.company, c.phone, c.wechat && `WeChat ${c.wechat}`, c.email, c.address].filter(Boolean).join("\n"), "Contact copié", toast)}><ICopy /> Copier</button>
              </div>
            </div>
          )}
        </div>
      )}

      {!busy && !res && hist.length > 0 && (
        <div className="tr-hist">
          <span className="label">Dernières traductions (lisibles sans réseau)</span>
          {hist.map((h) => (
            <button key={h.at} className="tr-histrow" onClick={() => { setRes(h.r); setPreview(null); }}>
              <b>{h.r.title}</b>
              <small>{new Date(h.at).toLocaleString("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</small>
            </button>
          ))}
        </div>
      )}
      {show && <ShowScreen zh={show.zh} sub={show.sub} onClose={() => setShow(null)} />}
    </div>
  );
}

// ---------------- Conversation (face to face) ----------------
type Turn = { id: number; from: "fr" | "zh"; text: string; translation: string; pinyin: string; note: string };

function TalkTab() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [listening, setListening] = useState<"fr" | "zh" | null>(null);
  const [interim, setInterim] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [faceToFace, setFaceToFace] = useState(true);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [frText, setFrText] = useState("");
  const [zhText, setZhText] = useState("");
  const rec = useRef<SR | null>(null);
  const finalText = useRef("");
  const n = useRef(0);
  const interimRef = useRef("");
  interimRef.current = interim;

  useEffect(() => () => rec.current?.abort(), []);

  const translate = async (from: "fr" | "zh", text: string) => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await ai<InterpretResult>("interpret", { from, text: t, history: turns.slice(-6).map((x) => ({ from: x.from, text: x.text, translation: x.translation })) }, 30_000);
      const turn: Turn = { id: ++n.current, from, text: t, ...r };
      setTurns((ts) => [...ts, turn]);
      if (autoSpeak) speak(r.translation, from === "fr" ? "zh-CN" : "fr-FR");
    } catch (e) {
      setErr(e instanceof AiError ? e.message : "La traduction a échoué.");
    } finally {
      setBusy(false);
    }
  };

  const listen = (lang: "fr" | "zh") => {
    if (!SRClass) {
      setErr("La dictée vocale n'est pas disponible sur ce navigateur : tapez le texte. (iPhone : Réglages › Siri, activer « Dictée ».)");
      return;
    }
    if (listening) {
      rec.current?.stop();
      return;
    }
    window.speechSynthesis?.cancel();
    const r = new SRClass();
    r.lang = lang === "fr" ? "fr-FR" : "zh-CN";
    r.interimResults = true;
    r.continuous = false;
    finalText.current = "";
    r.onresult = (e) => {
      let fin = "";
      let mid = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) fin += res[0].transcript;
        else mid += res[0].transcript;
      }
      finalText.current = fin || finalText.current;
      setInterim(fin + mid);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setErr("Micro refusé : autorisez-le pour ce site dans les réglages du navigateur.");
      else if (e.error !== "no-speech" && e.error !== "aborted") setErr("Je n'ai pas compris, réessayez ou tapez le texte.");
    };
    r.onend = () => {
      setListening(null);
      const t = (finalText.current || "").trim() || interimRef.current.trim();
      setInterim("");
      if (t) translate(lang, t);
    };
    rec.current = r;
    setErr(null);
    setListening(lang);
    try {
      r.start();
    } catch {
      setListening(null);
    }
  };
  const last = turns[turns.length - 1];
  return (
    <div className="talk">
      <div className="talk-opts">
        <label><input type="checkbox" checked={faceToFace} onChange={(e) => setFaceToFace(e.target.checked)} /> Face à face (moitié haute retournée)</label>
        <label><input type="checkbox" checked={autoSpeak} onChange={(e) => setAutoSpeak(e.target.checked)} /> Lire la traduction à voix haute</label>
      </div>

      <div className={"talk-pane them" + (faceToFace ? " flip" : "")} lang="zh-CN">
        <div className="talk-big">
          {listening === "zh" ? interim || "请说话…" : last ? (last.from === "fr" ? last.translation : last.text) : "请按下面的按钮说中文"}
        </div>
        {last?.from === "fr" && last.pinyin && <div className="talk-sub">{last.pinyin}</div>}
        <div className="talk-row">
          <button className={"talk-mic" + (listening === "zh" ? " on" : "")} onClick={() => listen("zh")} disabled={busy || listening === "fr"}>
            {listening === "zh" ? "说完了" : "🎤 说中文"}
          </button>
          {last?.from === "fr" && <button className="btn-sm" onClick={() => speak(last.translation, "zh-CN")}>🔊 再听一次</button>}
        </div>
        <form className="talk-type" onSubmit={(e) => { e.preventDefault(); translate("zh", zhText); setZhText(""); }}>
          <input className="input" value={zhText} onChange={(e) => setZhText(e.target.value)} placeholder="或者在这里打字…" />
        </form>
      </div>

      <div className="talk-pane me">
        <div className="talk-big">
          {listening === "fr" ? interim || "Parlez…" : last ? (last.from === "zh" ? last.translation : last.text) : "Appuyez sur le micro et parlez en français."}
        </div>
        {last?.note && <div className="talk-note">{last.note}</div>}
        {busy && <div className="tr-loading"><span className="spin" /> Traduction…</div>}
        {err && <p className="tr-err">{err}</p>}
        <div className="talk-row">
          <button className={"talk-mic" + (listening === "fr" ? " on" : "")} onClick={() => listen("fr")} disabled={busy || listening === "zh"}>
            {listening === "fr" ? "J'ai fini" : "🎤 Je parle"}
          </button>
          {last?.from === "zh" && <button className="btn-sm" onClick={() => speak(last.translation, "fr-FR")}>🔊 Réécouter</button>}
        </div>
        <form className="talk-type" onSubmit={(e) => { e.preventDefault(); translate("fr", frText); setFrText(""); }}>
          <input className="input" value={frText} onChange={(e) => setFrText(e.target.value)} placeholder="Ou tapez en français…" />
        </form>
      </div>

      {turns.length > 1 && (
        <div className="talk-hist">
          <span className="label">Échange</span>
          {turns.slice(0, -1).reverse().map((t) => (
            <div key={t.id} className={"talk-line " + t.from}>
              <span>{t.text}</span>
              <b lang={t.from === "fr" ? "zh-CN" : "fr"}>{t.translation}</b>
            </div>
          ))}
          <button className="btn-sm" onClick={() => setTurns([])}>Effacer l'échange</button>
        </div>
      )}
    </div>
  );
}
