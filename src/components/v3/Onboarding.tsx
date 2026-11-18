import { track } from "../../lib/track";
import { useState } from "react";
import { updateProfile, useStore } from "../../lib/store";
import Shell, { Steps } from "./Shell";
import { t, getLang, setLang as setAppLang, type Lang } from "../../lib/i18n";

export const TRAVEL = [
  { key: "solo", label: "Solo", dots: 1 },
  { key: "duo", label: "À deux", dots: 2 },
  { key: "friends", label: "Entre amis", dots: 3 },
  { key: "family", label: "En famille", dots: 3 },
  { key: "business", label: "Affaires", note: "salons, rendez-vous", dots: 0 },
] as const;
export const INTERESTS = ["Cuisine", "Art", "Design", "Shopping", "Vie nocturne", "Nature", "Histoire", "Architecture", "Bien-être", "Artisanat", "Cafés", "Marchés", "Musées", "Musique live", "Photographie", "Mode"];
export const PACES = [
  { key: "relaxed", label: "Tranquille", note: "2 à 3 lieux par jour, de longues pauses", bars: 2 },
  { key: "balanced", label: "Équilibré", note: "4 à 5 lieux, une soirée prévue", bars: 4 },
  { key: "packed", label: "Dense", note: "6 lieux et plus, du matin à la nuit", bars: 6 },
] as const;
export const BUDGETS = [
  { key: 1, label: "€", note: "Moins de 60 € par jour et par personne, hors hôtel" },
  { key: 2, label: "€€", note: "Environ 60 à 120 € par jour et par personne, hors hôtel" },
  { key: 3, label: "€€€", note: "Environ 120 à 250 € par jour et par personne, hors hôtel" },
  { key: 4, label: "€€€€", note: "Plus de 250 € par jour et par personne, hors hôtel" },
] as const;

/** First sign-in of an account: who you are and how you travel (3 short steps); everything can change later */
export default function Onboarding() {
  const profile = useStore((s) => s.profile);
  const email = useStore((s) => s.session?.user.email) || "";
  const meta = useStore((s) => s.session?.user.user_metadata) as Record<string, string> | undefined;
  const [step, setStep] = useState(1);
  const [name, setName] = useState(() => (profile.name as string) || meta?.given_name || meta?.full_name?.split(" ")[0] || "");
  const [travel, setTravel] = useState<string>(() => (profile.travel as string) || "duo");
  const [interests, setInterests] = useState<string[]>(() => (profile.interests as string[]) || []);
  const [pace, setPace] = useState<string>(() => (profile.pace as string) || "balanced");
  const [budget, setBudget] = useState<number>(() => Number(profile.budget) || 3);
  const [lang, setLang] = useState<string>(() => (profile.lang as string) || getLang());
  const first = name.trim() || email.split("@")[0];
  const [home, setHome] = useState<string>(() => (profile.home as string) || "");
  const [age, setAge] = useState<string>(() => (profile.age as string) || "");
  const [freq, setFreq] = useState<string>(() => (profile.tripsPerYear as string) || "");
  const [heard, setHeard] = useState<string>(() => (profile.heard as string) || "");

  const finish = () => {
    updateProfile({ name: name.trim(), travel, interests, pace, budget, lang, home: home.trim(), age, tripsPerYear: freq, heard, onboardedAt: Date.now() });
    track("signup_done");
  };
  const back = step > 1 ? () => setStep(step - 1) : undefined;
  const top = (
    <div className="v3-bar">
      {back ? <button className="v3-tool" onClick={back} aria-label={t("Retour")}>‹</button> : <span className="v3-tool ghost" />}
      <Steps n={step} of={4} />
    </div>
  );

  if (step === 1)
    return (
      <Shell ring={false} top={top}>
        <p className="v3-lbl" style={{ marginTop: 22 }}>{t("Faisons connaissance")}</p>
        <h1 className="v3-d v3-h2">{t("Comment vous appelez-vous ?")}</h1>
        <input className="v3-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Votre prénom")} autoComplete="given-name" aria-label={t("Votre prénom")} />
        <p className="v3-lbl">{t("Comment voyagez-vous ?")}</p>
        <div className="v3-opts" role="radiogroup" aria-label={t("Comment voyagez-vous ?")}>
          {TRAVEL.map((o) => (
            <button key={o.key} role="radio" aria-checked={travel === o.key} className={"v3-opt" + (travel === o.key ? " on" : "")} onClick={() => setTravel(o.key)}>
              <span className="v3-ppl">{o.dots ? Array.from({ length: o.dots }, (_, i) => <i key={i} className={o.key === "family" && i === 2 ? "sm" : ""} />) : <b>◇</b>}</span>
              {t(o.label)}
              {"note" in o && <small> · {t(o.note)}</small>}
              <span className="v3-ck">✓</span>
            </button>
          ))}
        </div>
        <div className="v3-spacer" />
        <button className="v3-btn" disabled={!name.trim()} onClick={() => setStep(2)}>{t("Continuer")}</button>
      </Shell>
    );

  if (step === 2)
    return (
      <Shell ring={false} top={top}>
        <p className="v3-lbl" style={{ marginTop: 22 }}>{t("Vos goûts")}</p>
        <h1 className="v3-d v3-h2">{t("Ce que vous aimez, {first}.", { first })}</h1>
        <p className="v3-lead" style={{ marginTop: 12 }}>{t("Choisissez librement. Chaque voyage s'en sert, et vous pourrez tout changer.")}</p>
        <div className="v3-chips" style={{ marginTop: 22 }}>
          {INTERESTS.map((x) => {
            const on = interests.includes(x);
            return (
              <button key={x} aria-pressed={on} className={"v3-chip" + (on ? " on" : "")} onClick={() => setInterests((cur) => (cur.includes(x) ? cur.filter((i) => i !== x) : [...cur, x]))}>
                {on && "✓ "}
                {t(x)}
              </button>
            );
          })}
        </div>
        <div className="v3-spacer" />
        <div className="v3-hintrow">
          <span>{interests.length > 1 ? t("{n} centres d'intérêt", { n: interests.length }) : t("{n} centre d'intérêt", { n: interests.length })}</span>
          <span className="v3-lbl">{t("3 ou plus conseillés")}</span>
        </div>
        <button className="v3-btn" onClick={() => setStep(3)}>{interests.length ? t("Continuer") : t("Passer")}</button>
      </Shell>
    );

  if (step === 4)
    return (
      <Shell ring={false} top={top}>
        <p className="v3-lbl" style={{ marginTop: 22 }}>{t("Facultatif")}</p>
        <h1 className="v3-d v3-h2">{t("Un peu plus sur vous.")}</h1>
        <p className="v3-note">{t("Pour des programmes et des offres qui vous ressemblent.")}</p>
        <label className="v3-field col" style={{ marginTop: 16 }}>
          <span>{t("Ville ou aéroport de départ")}</span>
          <input value={home} onChange={(e) => setHome(e.target.value)} placeholder={t("ex. Paris, CDG")} maxLength={60} autoComplete="address-level2" />
        </label>
        <p className="v3-lbl" style={{ marginTop: 18 }}>{t("Âge")}</p>
        <div className="v3-chips" style={{ marginTop: 10 }}>
          {AGES.map((a) => <button key={a} type="button" className={"v3-chip" + (age === a ? " on" : "")} aria-pressed={age === a} onClick={() => setAge(age === a ? "" : a)}>{a}</button>)}
        </div>
        <p className="v3-lbl" style={{ marginTop: 18 }}>{t("Voyages par an")}</p>
        <div className="v3-chips" style={{ marginTop: 10 }}>
          {FREQS.map((f) => <button key={f.k} type="button" className={"v3-chip" + (freq === f.k ? " on" : "")} aria-pressed={freq === f.k} onClick={() => setFreq(freq === f.k ? "" : f.k)}>{t(f.l)}</button>)}
        </div>
        <p className="v3-lbl" style={{ marginTop: 18 }}>{t("Comment nous avez-vous connus ?")}</p>
        <div className="v3-chips" style={{ marginTop: 10 }}>
          {HEARD.map((h) => <button key={h.k} type="button" className={"v3-chip" + (heard === h.k ? " on" : "")} aria-pressed={heard === h.k} onClick={() => setHeard(heard === h.k ? "" : h.k)}>{t(h.l)}</button>)}
        </div>
        <div className="v3-spacer" />
        <button className="v3-btn" onClick={finish}>{t("Terminer")}</button>
      </Shell>
    );

  return (
    <Shell ring={false} top={top}>
      <p className="v3-lbl" style={{ marginTop: 22 }}>{t("Votre façon")}</p>
      <h1 className="v3-d v3-h2">{t("Rythme, budget, langue.")}</h1>
      <div className="v3-opts" role="radiogroup" aria-label={t("Rythme")}>
        {PACES.map((p) => (
          <button key={p.key} role="radio" aria-checked={pace === p.key} className={"v3-opt tall" + (pace === p.key ? " on" : "")} onClick={() => setPace(p.key)}>
            <span className="v3-dens">{Array.from({ length: 6 }, (_, i) => <i key={i} className={i < p.bars ? "f" : ""} />)}</span>
            <span className="v3-t">{t(p.label)}<small>{t(p.note)}</small></span>
            <span className="v3-ck">✓</span>
          </button>
        ))}
      </div>
      <p className="v3-lbl" style={{ marginTop: 22 }}>{t("Budget par jour")}</p>
      <div className="v3-seg" role="radiogroup" aria-label={t("Budget par jour")}>
        {BUDGETS.map((b) => (
          <button key={b.key} role="radio" aria-checked={budget === b.key} className={budget === b.key ? "on" : ""} onClick={() => setBudget(b.key)}>{b.label}</button>
        ))}
      </div>
      <p className="v3-note">{t(BUDGETS.find((b) => b.key === budget)?.note || "")}</p>
      <p className="v3-lbl" style={{ marginTop: 18 }}>{t("Langue")}</p>
      <div className="v3-seg" role="radiogroup" aria-label={t("Langue")}>
        {[{ k: "fr", l: "Français" }, { k: "en", l: "English" }].map((x) => (
          <button key={x.k} role="radio" aria-checked={lang === x.k} className={lang === x.k ? "on" : ""} onClick={() => { setLang(x.k); setAppLang(x.k as Lang); }}>{x.l}</button>
        ))}
      </div>
      <div className="v3-spacer" />
      <button className="v3-btn" onClick={() => setStep(4)}>{t("Continuer")}</button>
    </Shell>
  );
}

const AGES = ["18–24", "25–34", "35–44", "45–54", "55–64", "65+"];
const FREQS: { k: string; l: string }[] = [{ k: "1", l: "1 par an" }, { k: "2-3", l: "2 à 3" }, { k: "4-6", l: "4 à 6" }, { k: "7+", l: "7 ou plus" }];
const HEARD: { k: string; l: string }[] = [
  { k: "instagram", l: "Instagram" }, { k: "tiktok", l: "TikTok" }, { k: "friend", l: "Un ami" }, { k: "search", l: "Recherche Google" },
  { k: "press", l: "Presse ou blog" }, { k: "other", l: "Autre" },
];
