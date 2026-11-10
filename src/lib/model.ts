import type { Status } from "../data/types";

export interface PlaceState {
  status?: Status | null;
  rating?: number;
  appt?: string;
  moq?: string;
  price?: string;
  lead?: string;
  sample?: string;
  note?: string;
  favorite?: boolean;
  visited?: boolean;
  /** ms epoch of the last change */
  updatedAt?: number;
  /** ms epoch of the last change of each field: two devices editing different fields never overwrite each other */
  fieldsAt?: Record<string, number>;
}

const META = new Set(["updatedAt", "fieldsAt"]);
const at = (s: PlaceState, k: string) => s.fieldsAt?.[k] ?? s.updatedAt ?? 0;

/** Field-by-field merge of two versions of a place state (newest field wins). `localNewer` = local has something remote lacks. */
export function mergePlaceState(local: PlaceState | undefined, remote: PlaceState | undefined): { merged: PlaceState; localNewer: boolean } {
  if (!local) return { merged: remote || {}, localNewer: false };
  if (!remote) return { merged: local, localNewer: true };
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)].filter((k) => !META.has(k)));
  const merged: Record<string, unknown> = {};
  const fieldsAt: Record<string, number> = {};
  let localNewer = false;
  for (const k of keys) {
    const la = k in local ? at(local, k) : -1;
    const ra = k in remote ? at(remote, k) : -1;
    if (la > ra) {
      merged[k] = (local as Record<string, unknown>)[k];
      fieldsAt[k] = la;
      localNewer = true;
    } else {
      merged[k] = (remote as Record<string, unknown>)[k];
      fieldsAt[k] = ra;
    }
  }
  return { merged: { ...(merged as PlaceState), fieldsAt, updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0) }, localNewer };
}

export interface Contact {
  id: string;
  placeId: string;
  name: string;
  kind: "wa" | "wc";
  value: string;
  message?: string;
  createdAt: number;
  /** true once the row exists in Supabase */
  synced?: boolean;
}

export interface Pin {
  id: string;
  name: string;
  lat: number;
  lng: number;
  note?: string;
  updatedAt: number;
  synced?: boolean;
}

export interface Photo {
  id: string;
  placeId: string;
  /** the file is stored on this device (IndexedDB) */
  local?: boolean;
  /** Path in the Supabase "photos" bucket once uploaded */
  path?: string;
  createdAt: number;
  synced?: boolean;
}

/** Everything the user adds to one trip */
export interface Data {
  places: Record<string, PlaceState>;
  contacts: Contact[];
  pins: Pin[];
  photos: Photo[];
}

export interface Settings {
  eurRate: number;
}

export const emptyData = (): Data => ({ places: {}, contacts: [], pins: [], photos: [] });

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

/** Stable UUID-shaped id derived from a string (used for the one-time import of old data) */
export function stableId(seed: string): string {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  const a = hex(h1) + hex(h2) + hex(h1 ^ h2) + hex(Math.imul(h1, h2));
  return `${a.slice(0, 8)}-${a.slice(8, 12)}-4${a.slice(13, 16)}-a${a.slice(17, 20)}-${a.slice(20, 32)}`;
}
