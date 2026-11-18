import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Root from "./components/v3/Root";
import PasswordRecovery from "./components/v3/PasswordRecovery";
import { initAuth, toast } from "./lib/store";
import { track } from "./lib/track";
import "./styles.css";

// a shared programme's address (/p/<slug>, lot acquisition R10) opened by the installed app (its stored page answers
// every address without asking the server): the address the app reads, /?t=<slug>, before anything is drawn
try {
  const m = /^\/p\/([a-z0-9]{10,24})\/?$/.exec(location.pathname);
  if (m) {
    const q = new URLSearchParams(location.search);
    q.set("t", m[1]);
    history.replaceState(history.state, "", `/?${q.toString()}${location.hash}`);
  }
} catch {
  /* ignore */
}

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
