import { track } from "../../lib/track";
import { useState } from "react";
import { updateProfile, useStore } from "../../lib/store";
import Shell, { Steps } from "./Shell";

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
  const [lang, setLang] = useState<string>(() => (profile.lang as string) || "fr");
  const first = name.trim() || email.split("@")[0];

  const finish = () => {
    updateProfile({ name: name.trim(), travel, interests, pace, budget, lang, onboardedAt: Date.now() });
    track("signup_done");
  };
  const back = step > 1 ? () => setStep(step - 1) : undefined;
  const top = (
    <div className="v3-bar">
      {back ? <button className="v3-tool" onClick={back} aria-label="Retour">‹</button> : <span className="v3-tool ghost" />}
      <Steps n={step} of={3} />
    </div>
  );

  if (step === 1)
    return (
      <Shell ring={false} top={top}>
        <p className="v3-lbl" style={{ marginTop: 22 }}>Faisons connaissance</p>
        <h1 className="v3-d v3-h2">Comment vous appelez-vous ?</h1>
        <input className="v3-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Votre prénom" autoComplete="given-name" aria-label="Votre prénom" />
        <p className="v3-lbl">Comment voyagez-vous ?</p>
        <div className="v3-opts" role="radiogroup" aria-label="Comment voyagez-vous ?">
          {TRAVEL.map((t) => (
            <button key={t.key} role="radio" aria-checked={travel === t.key} className={"v3-opt" + (travel === t.key ? " on" : "")} onClick={() => setTravel(t.key)}>
              <span className="v3-ppl">{t.dots ? Array.from({ length: t.dots }, (_, i) => <i key={i} className={t.key === "family" && i === 2 ? "sm" : ""} />) : <b>◇</b>}</span>
              {t.label}
              {"note" in t && <small> · {t.note}</small>}
              <span className="v3-ck">✓</span>
            </button>
          ))}
        </div>
        <div className="v3-spacer" />
        <button className="v3-btn" disabled={!name.trim()} onClick={() => setStep(2)}>Continuer</button>
      </Shell>
    );

  if (step === 2)
    return (
      <Shell ring={false} top={top}>
        <p className="v3-lbl" style={{ marginTop: 22 }}>Vos goûts</p>
        <h1 className="v3-d v3-h2">Ce que vous aimez, {first}.</h1>
        <p className="v3-lead" style={{ marginTop: 12 }}>Choisissez librement. Chaque voyage s'en sert, et vous pourrez tout changer.</p>
        <div className="v3-chips" style={{ marginTop: 22 }}>
          {INTERESTS.map((x) => {
            const on = interests.includes(x);
            return (
              <button key={x} aria-pressed={on} className={"v3-chip" + (on ? " on" : "")} onClick={() => setInterests((cur) => (cur.includes(x) ? cur.filter((i) => i !== x) : [...cur, x]))}>
                {on && "✓ "}
                {x}
              </button>
            );
          })}
        </div>
        <div className="v3-spacer" />
        <div className="v3-hintrow">
          <span>{interests.length} centre{interests.length > 1 ? "s" : ""} d'intérêt</span>
          <span className="v3-lbl">3 ou plus conseillés</span>
        </div>
        <button className="v3-btn" onClick={() => setStep(3)}>{interests.length ? "Continuer" : "Passer"}</button>
      </Shell>
    );

  return (
    <Shell ring={false} top={top}>
      <p className="v3-lbl" style={{ marginTop: 22 }}>Votre façon</p>
      <h1 className="v3-d v3-h2">Rythme, budget, langue.</h1>
      <div className="v3-opts" role="radiogroup" aria-label="Rythme">
        {PACES.map((p) => (
          <button key={p.key} role="radio" aria-checked={pace === p.key} className={"v3-opt tall" + (pace === p.key ? " on" : "")} onClick={() => setPace(p.key)}>
            <span className="v3-dens">{Array.from({ length: 6 }, (_, i) => <i key={i} className={i < p.bars ? "f" : ""} />)}</span>
            <span className="v3-t">{p.label}<small>{p.note}</small></span>
            <span className="v3-ck">✓</span>
          </button>
        ))}
      </div>
      <p className="v3-lbl" style={{ marginTop: 22 }}>Budget par jour</p>
      <div className="v3-seg" role="radiogroup" aria-label="Budget par jour">
        {BUDGETS.map((b) => (
          <button key={b.key} role="radio" aria-checked={budget === b.key} className={budget === b.key ? "on" : ""} onClick={() => setBudget(b.key)}>{b.label}</button>
        ))}
      </div>
      <p className="v3-note">{BUDGETS.find((b) => b.key === budget)?.note}</p>
      <p className="v3-lbl" style={{ marginTop: 18 }}>Langue des programmes</p>
      <div className="v3-seg" role="radiogroup" aria-label="Langue">
        {[{ k: "fr", l: "Français" }, { k: "en", l: "English" }].map((x) => (
          <button key={x.k} role="radio" aria-checked={lang === x.k} className={lang === x.k ? "on" : ""} onClick={() => setLang(x.k)}>{x.l}</button>
        ))}
      </div>
      <div className="v3-spacer" />
      <button className="v3-btn" onClick={finish}>Terminer</button>
    </Shell>
  );
}
