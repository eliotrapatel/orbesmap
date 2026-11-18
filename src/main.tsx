import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Root from "./components/v3/Root";
import PasswordRecovery from "./components/v3/PasswordRecovery";
import { initAuth, toast } from "./lib/store";
import { track } from "./lib/track";
import "./styles.css";

initAuth();

// sent here from theorbes.com/maps (index.html, lot acquisition R08): counted once
try {
  if (sessionStorage.getItem("orbes.from") === "maps") {
    sessionStorage.removeItem("orbes.from");
    track("app_redirect", "maps");
  }
} catch {
  /* ignore */
}

// app shell offline: only where we can serve a service worker (orbesmap.vercel.app)
if ("serviceWorker" in navigator && location.hostname.endsWith(".vercel.app")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  // the stored page opened instantly; a newer version was downloaded in the background
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data?.type === "orbes-update") toast("Nouvelle version de l'app prête : elle s'ouvrira au prochain lancement");
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
    {/* "Choisissez un nouveau mot de passe" after a reset link, over any screen */}
    <PasswordRecovery />
  </StrictMode>,
);
