import type { ReactNode } from "react";
import { AccountSections } from "./AccountScreen";

// The account's helpers now live with the account screen (AccountScreen.tsx); kept here for the screens that import them.
export { confirmAndDelete, useProLine } from "./AccountScreen";

/** The account's sections (plan, alerts, bookings, language, password, privacy, administration, deletion).
 *  `variant` = the map app's "Compte" panel or the v3 screens */
export default function AccountActions({ variant = "v3", status, trip }: { variant?: "v3" | "app"; status?: ReactNode; trip?: ReactNode }) {
  return <AccountSections variant={variant} status={status} trip={trip} />;
}
