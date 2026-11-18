// Line icons of the concierge, ported from the validated mockup's sprite (saas-v3, direction C).
// Same grid and stroke as src/components/Icons.tsx: 24px, 1.6 stroke, round caps and joins.
import { useId, type ReactNode, type SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const mk = (d: ReactNode) => (p: P) => <svg className="cc-ic" {...base} aria-hidden="true" focusable="false" {...p}>{d}</svg>;

export const CcClose = mk(<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />);
export const CcPlus = mk(<path d="M12 5v14M5 12h14" />);
export const CcCheck = mk(<path d="m5 12.5 4.2 4.2L19 7" />);
export const CcArrow = mk(<path d="M5 12h14M13 6l6 6-6 6" />);
export const CcPlane = mk(<path d="M21 15.5v-1.8l-7.5-4.7V4.4a1.5 1.5 0 0 0-3 0V9L3 13.7v1.8l7.5-2.3v4.6l-2 1.5V21l3.5-1 3.5 1v-1.7l-2-1.5v-4.6z" />);
export const CcBed = mk(<><path d="M3 18.5v-12M3 14h18v4.5M21 14v-2.5A2.5 2.5 0 0 0 18.5 9H11v5" /><circle cx="7" cy="11.2" r="1.7" /></>);
export const CcPin = mk(<><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>);
export const CcLink = mk(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);
export const CcImg = mk(<><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" /></>);
export const CcSpark = mk(<path d="M12 3.5 13.7 10.3 20.5 12 13.7 13.7 12 20.5 10.3 13.7 3.5 12 10.3 10.3z" />);
export const CcSend = mk(<path d="M12 19V5M6 11l6-6 6 6" />);
export const CcMic = mk(<><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></>);
export const CcClock = mk(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>);
export const CcCal = mk(<><rect x="3.5" y="5" width="17" height="15.5" rx="3" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>);
export const CcTrain = mk(<><rect x="6" y="3.5" width="12" height="13" rx="3" /><path d="M6 11h12M9 20l-1.5 1.5M15 20l1.5 1.5M9.5 14h.01M14.5 14h.01" /></>);
export const CcChev = mk(<path d="m9 6 6 6-6 6" />);
/** Not in the mockup's sprite: who travels (two people), drawn on the same grid */
export const CcPeople = mk(<><circle cx="9" cy="8.5" r="3" /><path d="M3.5 19.5c0-3.2 2.4-5.5 5.5-5.5s5.5 2.3 5.5 5.5" /><path d="M15.5 5.7a3 3 0 0 1 0 5.6M17.6 14.3c1.8.8 2.9 2.6 2.9 5.2" /></>);
export const CcBell = mk(<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15zM10 20.5h4" />);
/** Not in the concierge's sprite, taken from the mockup's sprite for the form and the review (#i-back, #i-search, #i-refresh) */
export const CcBack = mk(<path d="m15 6-6 6 6 6" />);
export const CcSearch = mk(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const CcRefresh = mk(<><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>);
export const CcClip = mk(<path d="M9 4.5h6M9 4.5a1.5 1.5 0 0 0 0 3h6a1.5 1.5 0 0 0 0-3M8 5.5H6.5A1.5 1.5 0 0 0 5 7v12a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19V7a1.5 1.5 0 0 0-1.5-1.5H16" />);

// The orbit mark as in the mockup's sprite: #orbit (line 28) for the small avatar, #orbit-lg (line 18) for the large one
const O = "M511.8 740.1C646.7 740.1 747.5 638.8 747.5 512C747.5 384.8 646.7 283.9 511.8 283.9C377.3 283.9 276.5 384.8 276.5 512C276.5 638.8 377.3 740.1 511.8 740.1ZM511.6 676.3C417.1 676.3 344 605.3 344 512.1C344 418.4 417.1 347.4 511.6 347.4C606.6 347.4 679.6 418.4 679.6 512.1C679.6 605.3 606.6 676.3 511.6 676.3Z";
/** The large avatar's mark (the concierge's launch screen): no orbit drawn as an illustration, a horizon: one
 *  hairline across the slot, a point set on it at the centre (the route's point, as on the trip card), on the
 *  40 × 24 grid of the large orbit it replaces (no fill of its own: it sits on any ground) */
function ConciergeHorizon({ w, h }: { w: number; h: number }) {
  return (
    <svg className="cc-orbit cc-horizon" viewBox="0 0 40 24" width={w} height={h} fill="none" aria-hidden="true" focusable="false">
      <path d="M2 12h36" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      <circle cx="20" cy="12" r="2.2" fill="currentColor" />
    </svg>
  );
}

/** width x height in px; `thin` is the large avatar (the horizon mark), else the small orbit mark of the avatars */
export function ConciergeOrbit({ thin, w, h }: { thin?: boolean; w: number; h: number }) {
  const id = useId().replace(/:/g, "");
  if (thin) return <ConciergeHorizon w={w} h={h} />;
  const line = 28;
  return (
    <svg className="cc-orbit" viewBox="116 279 792 466" width={w} height={h} fill="none" aria-hidden="true" focusable="false">
      <defs>
        <mask id={`${id}r`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <rect width="1024" height="1024" fill="#fff" />
          <path d={O} fill="#000" stroke="#000" strokeWidth={thin ? 43.2 : 67.2} />
        </mask>
        <mask id={`${id}o`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <rect width="1024" height="1024" fill="#fff" />
          <path d="M199.9 672.3 A400 112 -18 0 0 858.7 458.3" fill="none" stroke="#000" strokeWidth={thin ? 46.8 : 72.8} />
        </mask>
      </defs>
      <ellipse cx="512" cy="512" rx="400" ry="112" transform="rotate(-18 512 512)" stroke="currentColor" strokeWidth={line} mask={`url(#${id}r)`} />
      <path d={O} fill="currentColor" fillRule="evenodd" mask={`url(#${id}o)`} />
      <path d="M131.6 635.6 A400 112 -18 0 0 892.4 388.4" stroke="currentColor" strokeWidth={line} />
      <circle cx="825.6" cy="485.8" r={thin ? 26.1 : 40.6} fill="currentColor" />
    </svg>
  );
}
