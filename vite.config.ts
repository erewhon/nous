/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Vite options tailored for Tauri development
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },

  // Vitest. Default to the Node environment — current tests are pure logic
  // (processors, extraction, resolution, CSS building) with no DOM. Switch to
  // jsdom + @testing-library/react when component/hook tests are added.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
