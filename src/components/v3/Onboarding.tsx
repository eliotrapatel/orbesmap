import { track } from "../../lib/track";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { updateProfile, useStore } from "../../lib/store";
import Shell, { Steps } from "./Shell";
import { t, getLang, setLang as setAppLang, type Lang } from "../../lib/i18n";
import { EscGuard, ghostOut } from "../ui";
import { IBack, ICheck } from "../Icons";

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

// the budget rows say their amount only: "per person, excluding hotel" is said once under the title
const BUDGET_ROWS: Record<number, string> = { 1: "Moins de 60\u00a0€", 2: "60 à 120\u00a0€", 3: "120 à 250\u00a0€", 4: "Plus de 250\u00a0€" };
/** French typesetting in the big titles: the "?" or ":" never ends up alone on the last line */
const nb = (s: string) => s.replace(/ ([?!:;»])/g, "\u00a0$1");

const STEPS = 6;
// a single choice moves on by itself, just after the tick is seen
const AUTO_NEXT_MS = 340;

/**
 * First sign-in of an account: who you are and how you travel, one decision per step (the choices are preselected,
 * a single choice moves on by itself, Enter continues, Back / Escape / the back gesture return a step).
 * Everything can change later; what is saved, and when, is unchanged.
 */
export default function Onboarding() {
  const profile = useStore((s) => s.profile);
  const email = useStore((s) => s.session?.user.email) || "";
  const meta = useStore((s) => s.session?.user.user_metadata) as Record<string, string> | undefined;
  const [step, setStep] = useState(1);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  // read by the step that leaves, at the moment it leaves (the new direction is already set then)
  const dirRef = useRef(dir);
  dirRef.current = dir;
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
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => window.clearTimeout(timer.current);
  }, []);
  // the first step arrives with the screen itself; the next ones slide
  const moved = useRef(false);
  const go = (n: number) => {
    moved.current = true;
    window.clearTimeout(timer.current);
    setDir(n < step ? "back" : "fwd");
    setStep(n);
  };
  const canNext = step !== 1 || !!name.trim();
  const next = () => {
    if (!canNext) return;
    if (step >= STEPS) finish();
    else go(step + 1);
  };
  const back = step > 1 ? () => go(step - 1) : undefined;
  /** a single choice: shown as chosen, then the next step */
  const choose = (set: () => void) => {
    set();
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => go(step + 1), AUTO_NEXT_MS);
  };
  // Enter continues (a focused button keeps its own Enter)
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.isComposing || e.defaultPrevented || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      // only on this page (a screen opened above it keeps its own Enter)
      if (el && el !== document.body && !el.closest(".fl-onb")) return;
      if (el && el.closest("button, a, textarea, select, [role=button], [contenteditable=true]")) return;
      e.preventDefault();
      nextRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // the language on screen decides what the button offers; what is saved follows the choice
  const otherLang = getLang() === "fr" ? "en" : "fr";
  const top = (
    <div className="v3-bar fl-onb-bar">
      {back ? (
        <button type="button" className="v3-tool" onClick={back} aria-label={t("Retour")}>
          <IBack />
        </button>
      ) : (
        <span className="v3-tool ghost" />
      )}
      <Steps n={step} of={STEPS} />
      <button
        type="button"
        className="v3-toplink fl-onb-lang"
        lang={otherLang}
        onClick={() => {
          setLang(otherLang);
          setAppLang(otherLang as Lang);
        }}
      >
        {otherLang === "en" ? "English" : "Français"}
      </button>
    </div>
  );

  let body: ReactNode;
  if (step === 1)
    body = (
      <>
        <p className="v3-lbl">{t("Faisons connaissance")}</p>
        <h1 className="v3-d v3-h2" tabIndex={-1}>{nb(t("Comment vous appelez-vous ?"))}</h1>
        <input
          className="v3-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("Votre prénom")}
          autoComplete="given-name"
          autoCapitalize="words"
          enterKeyHint="next"
          aria-label={t("Votre prénom")}
          autoFocus={!name}
          maxLength={40}
        />
      </>
    );
  else if (step === 2)
    body = (
      <>
        <p className="v3-lbl">{t("Enchanté, {first}.", { first })}</p>
        <h1 className="v3-d v3-h2" tabIndex={-1}>{nb(t("Comment voyagez-vous ?"))}</h1>
        <div className="v3-opts" role="radiogroup" aria-label={t("Comment voyagez-vous ?")}>
          {TRAVEL.map((o) => (
            <button type="button" key={o.key} role="radio" aria-checked={travel === o.key} className={"v3-opt" + (travel === o.key ? " on" : "")} onClick={() => choose(() => setTravel(o.key))}>
              <span className="v3-ppl">{o.dots ? Array.from({ length: o.dots }, (_, i) => <i key={i} className={o.key === "family" && i === 2 ? "sm" : ""} />) : <Diamond />}</span>
              <span className="fl-opt-t">
                {t(o.label)}
                {"note" in o && <small> · {t(o.note)}</small>}
              </span>
              <span className="v3-ck"><ICheck /></span>
            </button>
          ))}
        </div>
      </>
    );
  else if (step === 3)
    body = (
      <>
        <p className="v3-lbl">{t("Vos goûts")}</p>
        <h1 className="v3-d v3-h2" tabIndex={-1}>{nb(t("Ce que vous aimez, {first}.", { first }))}</h1>
        <p className="v3-lead" style={{ marginTop: 12 }}>{t("Choisissez librement. Chaque voyage s'en sert, et vous pourrez tout changer.")}</p>
        <div className="v3-chips" style={{ marginTop: 22 }}>
          {INTERESTS.map((x) => {
            const on = interests.includes(x);
            return (
              <button type="button" key={x} aria-pressed={on} className={"v3-chip fl-chip" + (on ? " on" : "")} onClick={() => setInterests((cur) => (cur.includes(x) ? cur.filter((i) => i !== x) : [...cur, x]))}>
                <ICheck className="fl-chip-ck" />
                {t(x)}
              </button>
            );
          })}
        </div>
      </>
    );
  else if (step === 4)
    body = (
      <>
        <p className="v3-lbl">{t("Votre façon")}</p>
        <h1 className="v3-d v3-h2" tabIndex={-1}>{nb(t("Quel rythme ?"))}</h1>
        <div className="v3-opts" role="radiogroup" aria-label={t("Rythme")}>
          {PACES.map((p) => (
            <button type="button" key={p.key} role="radio" aria-checked={pace === p.key} className={"v3-opt tall" + (pace === p.key ? " on" : "")} onClick={() => choose(() => setPace(p.key))}>
              <span className="v3-dens">{Array.from({ length: 6 }, (_, i) => <i key={i} className={i < p.bars ? "f" : ""} />)}</span>
              <span className="v3-t">{t(p.label)}<small>{t(p.note)}</small></span>
              <span className="v3-ck"><ICheck /></span>
            </button>
          ))}
        </div>
      </>
    );
  else if (step === 5)
    body = (
      <>
        <p className="v3-lbl">{t("Votre façon")}</p>
        <h1 className="v3-d v3-h2" tabIndex={-1}>{nb(t("Quel budget par jour ?"))}</h1>
        <p className="v3-lead" style={{ marginTop: 12 }}>{t("Par personne, hors hôtel.")}</p>
        <div className="v3-opts" role="radiogroup" aria-label={t("Budget par jour")}>
          {BUDGETS.map((b) => (
            <button type="button" key={b.key} role="radio" aria-checked={budget === b.key} className={"v3-opt tall" + (budget === b.key ? " on" : "")} onClick={() => choose(() => setBudget(b.key))}>
              <span className="fl-eur" aria-hidden="true">{"€€€€".split("").map((c, i) => <i key={i} className={i < b.key ? "f" : ""}>{c}</i>)}</span>
              <span className="v3-t"><span className="sr">{b.label}</span>{t(BUDGET_ROWS[b.key])}</span>
              <span className="v3-ck"><ICheck /></span>
            </button>
          ))}
        </div>
      </>
    );
  else
    body = (
      <>
        <p className="v3-lbl">{t("Facultatif")}</p>
        <h1 className="v3-d v3-h2" tabIndex={-1}>{nb(t("Un peu plus sur vous."))}</h1>
        <p className="v3-lead" style={{ marginTop: 12 }}>{t("Pour des programmes et des offres qui vous ressemblent.")}</p>
        <label className="v3-field col" style={{ marginTop: 16 }}>
          <span>{t("Ville ou aéroport de départ")}</span>
          <input value={home} onChange={(e) => setHome(e.target.value)} placeholder={t("Par ex. Paris ou CDG")} maxLength={60} autoComplete="address-level2" enterKeyHint="done" />
        </label>
        <p className="v3-lbl" style={{ marginTop: 18 }}>{t("Âge")}</p>
        <div className="v3-chips" style={{ marginTop: 10 }}>
          {AGES.map((a) => <button key={a} type="button" className={"v3-chip" + (age === a ? " on" : "")} aria-pressed={age === a} onClick={() => setAge(age === a ? "" : a)}>{a}</button>)}
        </div>
        <p className="v3-lbl" style={{ marginTop: 18 }}>{t("Voyages par an")}</p>
        <div className="v3-chips" style={{ marginTop: 10 }}>
          {FREQS.map((f) => <button key={f.k} type="button" className={"v3-chip" + (freq === f.k ? " on" : "")} aria-pressed={freq === f.k} onClick={() => setFreq(freq === f.k ? "" : f.k)}>{t(f.l)}</button>)}
        </div>
        <p className="v3-lbl" style={{ marginTop: 18 }}>{nb(t("Comment nous avez-vous connus ?"))}</p>
        <div className="v3-chips" style={{ marginTop: 10 }}>
          {HEARD.map((h) => <button key={h.k} type="button" className={"v3-chip" + (heard === h.k ? " on" : "")} aria-pressed={heard === h.k} onClick={() => setHeard(heard === h.k ? "" : h.k)}>{t(h.l)}</button>)}
        </div>
      </>
    );

  return (
    <Shell ring={false} top={top} className="fl-onb">
      {back && <EscGuard on={back} />}
      <Pane key={step} dir={moved.current ? dir : "still"} getDir={() => dirRef.current}>{body}</Pane>
      <div className="v3-spacer" />
      {/* the action stays in place from one step to the next: only its words change */}
      <div className="fl-foot">
        {step === 3 && (
          <div className="v3-hintrow">
            <span className="num">{interests.length > 1 ? t("{n} centres d'intérêt", { n: interests.length }) : t("{n} centre d'intérêt", { n: interests.length })}</span>
            <span className="v3-lbl">{t("3 ou plus conseillés")}</span>
          </div>
        )}
        {step === 1 ? (
          <button type="button" className="v3-btn" disabled={!name.trim()} onClick={next}>{t("Continuer")}</button>
        ) : step === 3 ? (
          <button type="button" className={"v3-btn" + (interests.length ? "" : " ghost")} onClick={next}>{interests.length ? t("Continuer") : t("Passer")}</button>
        ) : step === STEPS ? (
          <button type="button" className="v3-btn" onClick={finish}>{home.trim() || age || freq || heard ? t("Terminer") : t("Passer et terminer")}</button>
        ) : (
          <button type="button" className="v3-btn" onClick={next}>{t("Continuer")}</button>
        )}
      </div>
    </Shell>
  );
}

/** One step: it slides in from the side it comes from, the previous one leaves the other way */
function Pane({ dir, getDir, children }: { dir: "fwd" | "back" | "still"; getDir: () => "fwd" | "back"; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    // each step starts at its top
    const page = el?.closest<HTMLElement>(".v3");
    if (page && page.scrollTop) page.scrollTop = 0;
    // focus was inside the step that left (a choice that moved on by itself, Enter in the field): it goes to the new
    // step's question, so a keyboard or a screen reader carries on from here
    const lost = !document.activeElement || document.activeElement === document.body;
    if (el && dir !== "still" && lost) el.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    return () => {
      if (!el) return;
      // leaving: held where it was (out of the flow, so the next step takes its place at once)
      const box = { top: el.offsetTop, left: el.offsetLeft, width: el.offsetWidth, height: el.offsetHeight };
      // the step that replaces this one says which way we went
      const fwd = getDir() !== "back";
      ghostOut(el, (copy) => {
        copy.classList.remove("fwd", "back");
        copy.classList.add("still");
        Object.assign(copy.style, { position: "absolute", top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px`, margin: "0" });
        return copy.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: `translateX(${fwd ? -24 : 24}px)` }], { duration: 160, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" });
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={ref} className={"fl-pane " + dir}>
      {children}
    </div>
  );
}

function Diamond() {
  return (
    <svg className="fl-diamond" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M6 1.2 10.8 6 6 10.8 1.2 6Z" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

const AGES = ["18–24", "25–34", "35–44", "45–54", "55–64", "65+"];
const FREQS: { k: string; l: string }[] = [{ k: "1", l: "1 par an" }, { k: "2-3", l: "2 à 3" }, { k: "4-6", l: "4 à 6" }, { k: "7+", l: "7 ou plus" }];
const HEARD: { k: string; l: string }[] = [
  { k: "instagram", l: "Instagram" }, { k: "tiktok", l: "TikTok" }, { k: "friend", l: "Un ami" }, { k: "search", l: "Recherche Google" },
  { k: "press", l: "Presse ou blog" }, { k: "other", l: "Autre" },
];
