import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // guestSchema imports the main app's plugin-sdk (../../../src), whose
    // imports would otherwise resolve against the repo-root node_modules —
    // yielding a second React copy in the bundle (breaks hooks). Force these
    // to resolve from this package's node_modules.
    dedupe: ["react", "react-dom", "@blocknote/core", "@blocknote/react"],
  },
  server: {
    fs: {
      // Allow the dev server to read the shared plugin-sdk sources.
      allow: ["../.."],
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
