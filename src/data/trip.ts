// Labels shared by every trip.
import type { PlaceType, Status } from "./types";
export { TRIPS, TRIP_BY_ID, defaultTrip } from "./trips";

export const TYPE_LABEL: Record<PlaceType, string> = {
  bijoux: "Bijoux", mode: "Mode", fabricant: "Fabricant", salon: "Salon", lifestyle: "Lifestyle",
  bar: "Bar", hotel: "Hôtel", packaging: "Packaging", textile: "Textile", landmark: "Lieu mythique",
  restaurant: "Restaurant", mall: "Shopping", cashmere: "Cachemire", concept: "Concept store",
  luxe: "Luxe", montres: "Horlogerie", cuir: "Maroquinerie", musee: "Musée", galerie: "Galerie",
  jardin: "Jardin", design: "Design", tech: "Tech", cafe: "Café", club: "Club", transport: "Transport",
};

export const STATUSES: { key: Status; label: string; color: string }[] = [
  { key: "todo", label: "À contacter", color: "#7D8288" },
  { key: "scheduled", label: "RDV pris", color: "#B7791F" },
  { key: "visited", label: "Visité", color: "#2F5A86" },
  { key: "sample", label: "Échantillon reçu", color: "#2B7363" },
];

export const dayMap = (days: { key: string }[]) => Object.fromEntries(days.map((d) => [d.key, d]));
