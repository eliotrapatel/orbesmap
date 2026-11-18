// Line icons of the concierge, ported from the validated mockup's sprite (saas-v3, direction C).
// Same grid and stroke as src/components/Icons.tsx: 24px, 1.6 stroke, round caps and joins.
import type { ReactNode, SVGProps } from "react";

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
