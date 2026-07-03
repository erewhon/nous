// HTTP client for the Nous daemon API.
//
// All reads/writes for notebook/page/folder/etc. data should go through this
// module rather than Tauri commands. The daemon is the single writer; events
// are broadcast via WebSocket to all connected clients.
//
// Base URL and API key resolution live in daemonConfig.ts — on desktop this
// is localhost:7667 + the shell-provided key; in the web-parity build both
// are configurable (localStorage / build env / same-origin).

import { getDaemonBaseUrl, loadDaemonApiKey } from "./daemonConfig";

const DAEMON_BASE_URL = getDaemonBaseUrl();

let cachedApiKey: string | null | undefined = undefined;
let keyLoadPromise: Promise<string | null> | null = null;

/**
 * Load the daemon API key (shell key file on desktop, localStorage in the
 * browser). Cached after first load. Returns null if auth is disabled
 * (no key — daemon is on localhost without auth).
 */
async function loadApiKey(): Promise<string | null> {
  if (cachedApiKey !== undefined) return cachedApiKey;
  if (keyLoadPromise) return keyLoadPromise;

  keyLoadPromise = loadDaemonApiKey().then((key) => {
    cachedApiKey = key;
    keyLoadPromise = null;
    return key;
  });

  return keyLoadPromise;
}

/**
 * Preload the API key at app startup. Optional — other calls will load lazily.
 */
export async function initDaemonClient(): Promise<void> {
  await loadApiKey();
}

export class DaemonError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "DaemonError";
    this.status = status;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const key = await loadApiKey();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

/** Bound write requests so a down/hung daemon can't block a save forever (DL-22). */
const WRITE_TIMEOUT_MS = 20000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new DaemonError(`Request timed out after ${timeoutMs}ms`, 0);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function unwrap<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      if (body?.error) msg = body.error;
    } catch {
      // non-JSON error body
      try {
        msg = await resp.text();
      } catch {
        // ignore
      }
    }
    throw new DaemonError(msg, resp.status);
  }
  // Some endpoints return raw text (e.g. markdown) — caller handles that
  const body = await resp.json();
  // Envelope: { data: T } or { error: string }
  return (body?.data ?? body) as T;
}

export async function daemonGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${DAEMON_BASE_URL}${path}`, {
    method: "GET",
    headers: await authHeaders(),
  });
  return unwrap<T>(resp);
}

export async function daemonGetText(path: string): Promise<string> {
  const resp = await fetch(`${DAEMON_BASE_URL}${path}`, {
    method: "GET",
    headers: await authHeaders(),
  });
  if (!resp.ok) {
    throw new DaemonError(`HTTP ${resp.status}`, resp.status);
  }
  return resp.text();
}

export async function daemonPost<T>(path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = await authHeaders();
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const resp = await fetchWithTimeout(
    `${DAEMON_BASE_URL}${path}`,
    {
      method: "POST",
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    WRITE_TIMEOUT_MS
  );
  return unwrap<T>(resp);
}

export async function daemonPut<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetchWithTimeout(
    `${DAEMON_BASE_URL}${path}`,
    {
      method: "PUT",
      headers: {
        ...(await authHeaders()),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    WRITE_TIMEOUT_MS
  );
  return unwrap<T>(resp);
}

export async function daemonDelete<T = void>(path: string): Promise<T> {
  const resp = await fetch(`${DAEMON_BASE_URL}${path}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  return unwrap<T>(resp);
}

export { DAEMON_BASE_URL };
