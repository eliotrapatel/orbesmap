import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initAuth } from "./lib/store";
import "./styles.css";

initAuth();

// app shell offline: only where we can serve a service worker (orbesmap.vercel.app)
if ("serviceWorker" in navigator && location.hostname.endsWith(".vercel.app")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
