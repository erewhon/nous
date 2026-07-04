// Daemon base URL + API key resolution for both the Tauri shell (desktop)
// and plain-browser (web-parity) builds.
//
// Desktop: the daemon is always local and the API key comes from the key
// file via the shell. Browser: the daemon may be remote (served behind the
// homelab front door), so the URL and key are configurable.

import { isTauri } from "./platform";

export const DAEMON_URL_STORAGE_KEY = "nous-daemon-url";
export const DAEMON_API_KEY_STORAGE_KEY = "nous-daemon-api-key";

const DEFAULT_DAEMON_URL = "http://localhost:7667";

export interface DaemonUrlEnv {
  /** localStorage override (user-set, survives rebuilds). */
  storedUrl: string | null;
  /** VITE_NOUS_DAEMON_URL build-time value. */
  envUrl: string | undefined;
  /** Running inside the Tauri shell. */
  tauri: boolean;
  /** Production bundle (import.meta.env.PROD). */
  prod: boolean;
  /** window.location.origin. */
  origin: string;
}

/**
 * Pure resolution, in priority order:
 * 1. localStorage override
 * 2. VITE_NOUS_DAEMON_URL build-time env
 * 3. same-origin, but only for a production browser bundle — the daemon
 *    serves the web build itself, so relative origin is correct there,
 *    while a vite dev server origin would be wrong
 * 4. localhost default (desktop, and browser dev against a local daemon)
 */
export function resolveDaemonBaseUrl(env: DaemonUrlEnv): string {
  const stored = env.storedUrl?.trim();
  if (stored) return stripTrailingSlash(stored);

  const fromEnv = env.envUrl?.trim();
  if (fromEnv) return stripTrailingSlash(fromEnv);

  if (!env.tauri && env.prod && /^https?:\/\//.test(env.origin)) {
    return stripTrailingSlash(env.origin);
  }

  return DEFAULT_DAEMON_URL;
}

/** ws(s):// form of a daemon base URL. */
export function toDaemonWsUrl(baseUrl: string): string {
  return baseUrl.replace(/^http/, "ws");
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function safeStorageGet(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function getDaemonBaseUrl(): string {
  return resolveDaemonBaseUrl({
    storedUrl: safeStorageGet(DAEMON_URL_STORAGE_KEY),
    envUrl: import.meta.env.VITE_NOUS_DAEMON_URL,
    tauri: isTauri(),
    prod: import.meta.env.PROD,
    origin: typeof window !== "undefined" ? window.location.origin : "",
  });
}

/**
 * Synchronous browser-side key read (localStorage). For sync call sites
 * like asset URL building; Tauri callers use loadDaemonApiKey instead.
 */
export function getStoredDaemonApiKey(): string | null {
  return safeStorageGet(DAEMON_API_KEY_STORAGE_KEY);
}

/**
 * Load the daemon API key. Tauri asks the shell (key file on disk);
 * browsers use the localStorage knob. Null means no auth (daemon on
 * localhost with auth disabled).
 */
export async function loadDaemonApiKey(): Promise<string | null> {
  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string | null>("get_daemon_api_key");
    } catch (err) {
      console.warn("[daemon] Failed to load API key:", err);
      return null;
    }
  }
  return safeStorageGet(DAEMON_API_KEY_STORAGE_KEY);
}
