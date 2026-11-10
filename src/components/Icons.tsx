// Line icons, 24px grid, 1.6 stroke.
import type { SVGProps } from "react";

const base = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
type P = SVGProps<SVGSVGElement>;
const mk = (d: React.ReactNode) => (p: P) => <svg {...base} aria-hidden="true" {...p}>{d}</svg>;

export const IMap = mk(<><path d="M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Z" /><path d="M9 4v13.5M15 6.5V20" /></>);
export const IList = mk(<><path d="M8 6h13M8 12h13M8 18h13" /><circle cx="3.5" cy="6" r=".8" fill="currentColor" /><circle cx="3.5" cy="12" r=".8" fill="currentColor" /><circle cx="3.5" cy="18" r=".8" fill="currentColor" /></>);
export const ICal = mk(<><rect x="3" y="4.5" width="18" height="16.5" rx="2.5" /><path d="M16 2.5v4M8 2.5v4M3 10h18" /></>);
export const ITools = mk(<><circle cx="12" cy="12" r="9" /><path d="M12 7v10M8.5 9.5c0-1.4 1.5-2.5 3.5-2.5s3.5 1 3.5 2.5-1.5 2-3.5 2.5-3.5 1.1-3.5 2.5 1.5 2.5 3.5 2.5 3.5-1.1 3.5-2.5" /></>);
export const IUser = mk(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" /></>);
export const ISearch = mk(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);
export const IClose = mk(<path d="M18 6 6 18M6 6l12 12" />);
export const IBack = mk(<path d="M15 18l-6-6 6-6" />);
export const IStar = mk(<path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9L12 2.8Z" />);
export const INav = mk(<path d="M3 11 21 3l-8 18-2-8-8-2Z" />);
export const ICopy = mk(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>);
export const IGlobe = mk(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" /></>);
export const IPin = mk(<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></>);
export const IPinPlus = mk(<><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" /><path d="M12 7v6M9 10h6" /></>);
export const ITrain = mk(<><rect x="6" y="2.5" width="12" height="15" rx="4" /><path d="M6 10h12M9 21l1.5-3.5M15 21l-1.5-3.5" /></>);
export const IClock = mk(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>);
export const ILocate = mk(<><circle cx="12" cy="12" r="3.5" /><circle cx="12" cy="12" r="8" /><path d="M12 1.5V4M12 20v2.5M1.5 12H4M20 12h2.5" /></>);
export const ICamera = mk(<><path d="M22 18.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h3.5l2-3h5l2 3H20a2 2 0 0 1 2 2Z" /><circle cx="12" cy="13" r="4" /></>);
export const IPlus = mk(<path d="M12 5v14M5 12h14" />);
export const ICheck = mk(<path d="m4.5 12.5 5 5 10-11" />);
export const IChat = mk(<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z" />);
export const IPlane = mk(<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z" />);
export const IDownload = mk(<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5M12 15V3" /></>);
export const IExpand = mk(<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />);
export const IRoute = mk(<><circle cx="6" cy="19" r="2.5" /><circle cx="18" cy="5" r="2.5" /><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5" /></>);
export const ITrash = mk(<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15" />);
export const IStarFill = (p: P) => <svg viewBox="0 0 24 24" aria-hidden="true" {...p}><path fill="currentColor" d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9L12 2.8Z" /></svg>;
