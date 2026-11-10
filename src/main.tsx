import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initAuth, toast } from "./lib/store";
import "./styles.css";

initAuth();

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
    <App />
  </StrictMode>,
);
