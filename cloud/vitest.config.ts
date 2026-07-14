import { defineConfig } from "vitest/config";

// Query helpers are tested against an in-memory better-sqlite3 D1 shim
// (src/db/testD1.ts) in the plain node environment — no Workers runtime needed.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
