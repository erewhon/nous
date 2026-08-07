import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WindowContextProvider } from "./contexts/WindowContext";
import { AuthCallback, WebAuthGate } from "./auth/AuthGate";
import { isTauri } from "./utils/platform";
import { dumpPreviousCrumbs, startFreezeDetector } from "./utils/freezeDetector";
// Self-hosted brand faces (bundled .woff2, no runtime CDN) — the "study" identity.
// DM Sans = UI/body, Cormorant Garamond = display/titles, IBM Plex Mono = code/data.
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/600-italic.css";
import "@fontsource/cormorant-garamond/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";

// Dump breadcrumbs from previous session (shows what happened before a crash)
dumpPreviousCrumbs();
// Start monitoring main thread for freezes
startFreezeDetector();

// /auth/callback is outside the /app base path — finish the OIDC code
// exchange before the app (and its stores/daemon clients) boots. The
// Tauri shell never sees either branch below.
const onAuthCallback = !isTauri() && window.location.pathname === "/auth/callback";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {onAuthCallback ? (
      <AuthCallback />
    ) : isTauri() ? (
      <WindowContextProvider>
        <App />
      </WindowContextProvider>
    ) : (
      <WebAuthGate>
        <WindowContextProvider>
          <App />
        </WindowContextProvider>
      </WebAuthGate>
    )}
  </React.StrictMode>
);
