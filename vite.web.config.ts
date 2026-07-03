import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Browser (web-parity) build of the desktop frontend — same app, no Tauri
// shell. Served by the daemon at /app (see "Feature: Web Frontend Parity").
//
// Build:   just web-build      → dist-web/
// Dev:     just web-dev        → http://localhost:5180/app/ (local daemon)
// Preview: just web-preview    → serves dist-web/
//
// Daemon URL/API key knobs are documented in DEVELOPMENT.md (localStorage
// "nous-daemon-url" / "nous-daemon-api-key", or VITE_NOUS_DAEMON_URL at
// build time; production bundles default to same-origin).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "/app/",
  build: {
    outDir: "dist-web",
  },
  clearScreen: false,
  server: {
    port: 5180,
  },
});
