/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Daemon base URL baked into a web-parity build (overrides same-origin). */
  readonly VITE_NOUS_DAEMON_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
