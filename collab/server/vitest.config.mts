import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // Load the Durable Object bindings + migrations from the real config so
      // tests exercise the same CollabServer DO that ships to production.
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // HMAC secret used by tests to mint valid session tokens. Test-only;
        // never the production secret (that lives in a deployed env var).
        bindings: {
          COLLAB_HMAC_SECRET:
            "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
        },
      },
    }),
  ],
});
