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
  /** ms epoch of the last local change, used to resolve sync conflicts */
  updatedAt?: number;
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
  /** Local copy (compressed JPEG data URL) — present until uploaded, kept as offline cache */
  dataUrl?: string;
  /** Path in the Supabase "photos" bucket once uploaded */
  path?: string;
  createdAt: number;
  synced?: boolean;
}

export interface Settings {
  eurRate: number;
}

export interface Data {
  places: Record<string, PlaceState>;
  contacts: Contact[];
  pins: Pin[];
  photos: Photo[];
  settings: Settings;
}

export const emptyData = (): Data => ({
  places: {},
  contacts: [],
  pins: [],
  photos: [],
  settings: { eurRate: 7.7 },
});

export const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
