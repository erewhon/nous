import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { WindowContextProvider } from "./contexts/WindowContext";
import { dumpPreviousCrumbs, startFreezeDetector } from "./utils/freezeDetector";
import "./index.css";

// Dump breadcrumbs from previous session (shows what happened before a crash)
dumpPreviousCrumbs();
// Start monitoring main thread for freezes
startFreezeDetector();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WindowContextProvider>
      <App />
    </WindowContextProvider>
  </React.StrictMode>
);
