// The photo of a place or a trip, in the NUIT treatment (a two-ink night print, set in CSS over the plain stored
// file: src/styles/photos.css), and the typographic stand-ins when there is none. Spans only: they sit inside buttons.
import { useState, type CSSProperties, type ReactNode } from "react";
import type { PhotoRef, PlacePhoto, TripCover } from "../data/types";
import { isNone, isRef } from "../lib/photoData";
import { photoUrl } from "../lib/placePhotos";
import { t } from "../lib/i18n";
import "../styles/photos.css";

type PhProps = { photo: PhotoRef; size: "s" | "l"; ar?: string; focus?: string; flat?: boolean; className?: string; onFail?: () => void; children?: ReactNode };

/** A photo frame: the picture fades in once loaded; a picture that fails to load calls `onFail` */
export function Ph({ photo, size, ar, focus, flat, className, onFail, children }: PhProps) {
  const [shown, setShown] = useState(false);
  const style = { ...(ar ? { ["--ar" as string]: ar } : {}), ...(focus ? { ["--focus" as string]: focus } : {}) } as CSSProperties;
  return (
    <span className={"ph" + (flat ? " flat" : "") + (shown ? " in" : "") + (className ? ` ${className}` : "")} style={style}>
      <img src={photoUrl(size === "s" ? photo.thumb : photo.path)} alt="" decoding="async" loading="lazy" onLoad={() => setShown(true)} onError={() => onFail?.()} />
      <i className="ph-grain" />
      {children}
    </span>
  );
}

/** A small square photo in a list; without one, the place's initial or its stop number */
export function PhThumb({ photo, label, size = 48 }: { photo?: PlacePhoto; label: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size } as CSSProperties;
  if (isRef(photo) && !failed)
    return (
      <span className="ph-thumb" style={style} aria-hidden="true">
        <Ph photo={photo} size="s" ar="1/1" flat onFail={() => setFailed(true)} />
      </span>
    );
  return (
    <span className="ph-thumb ph-none" style={style} aria-hidden="true" title={isNone(photo) ? t("Aucune photo trouvée") : undefined}>
      <span>{label}</span>
    </span>
  );
}

/** The photo band at the top of a trip's card; without a photo (or if it fails to load), the card's top as it is */
export function Band({ cover, top }: { cover?: TripCover; top: ReactNode }) {
  const [failed, setFailed] = useState(false);
  if (!isRef(cover) || failed) return <>{top}</>;
  return (
    <span className="ph-band">
      <Ph photo={cover} size="l" ar="16/9" focus="50% 40%" onFail={() => setFailed(true)}>
        <i className="ph-band-top" />
        <i className="ph-band-fade" />
      </Ph>
      {top}
    </span>
  );
}

/** Whether a trip's band shows (the card's class follows it) */
export const hasBand = (cover?: TripCover) => isRef(cover);
