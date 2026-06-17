/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare global {
  namespace Cloudflare {
    interface Env {
      CollabServer: DurableObjectNamespace<
        import("../src/index").CollabServer
      >;
      COLLAB_HMAC_SECRET: string;
      COLLAB_MANIFESTS?: KVNamespace;
    }
  }
}

export {};
