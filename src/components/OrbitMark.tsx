import { useId } from "react";

// ORBES Trips mark: the O of the ORBES wordmark (Gravesend Sans) and its orbit, same drawing as the app icon.
// Drawn with masks (not a background-coloured outline) so it stays clean over glass, the map or any ground.
const O =
  "M511.8 740.1C646.7 740.1 747.5 638.8 747.5 512C747.5 384.8 646.7 283.9 511.8 283.9C377.3 283.9 276.5 384.8 276.5 512C276.5 638.8 377.3 740.1 511.8 740.1ZM511.6 676.3C417.1 676.3 344 605.3 344 512.1C344 418.4 417.1 347.4 511.6 347.4C606.6 347.4 679.6 418.4 679.6 512.1C679.6 605.3 606.6 676.3 511.6 676.3Z";
const FRONT = "M131.6 635.6 A400 112 -18 0 0 892.4 388.4"; // part of the orbit passing in front of the O
const GAP = "M199.9 672.3 A400 112 -18 0 0 858.7 458.3"; // where the front of the orbit cuts the O

/** height in px; the mark is about 1.7 times wider than tall */
export default function OrbitMark({ size = 22, title }: { size?: number; title?: string }) {
  const id = useId().replace(/:/g, "");
  const w = size >= 64 ? 18 : 28; // orbit line, thicker when small so it stays visible
  return (
    <svg
      className="orbit-mark"
      viewBox="116 279 792 466"
      height={size}
      width={Math.round((size * 792) / 466)}
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <mask id={`${id}r`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <rect width="1024" height="1024" fill="#fff" />
          <path d={O} fill="#000" stroke="#000" strokeWidth={w * 2.4} />
        </mask>
        <mask id={`${id}o`} maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">
          <rect width="1024" height="1024" fill="#fff" />
          <path d={GAP} stroke="#000" strokeWidth={w * 2.6} />
        </mask>
      </defs>
      <ellipse cx="512" cy="512" rx="400" ry="112" transform="rotate(-18 512 512)" stroke="currentColor" strokeWidth={w} mask={`url(#${id}r)`} />
      <path d={O} fill="currentColor" fillRule="evenodd" mask={`url(#${id}o)`} />
      <path d={FRONT} stroke="currentColor" strokeWidth={w} />
      <circle cx="825.6" cy="485.8" r={w * 1.45} fill="currentColor" />
    </svg>
  );
}
