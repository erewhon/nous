import { describe, it, expect, beforeEach, vi } from "vitest";

// localStorage polyfill for the node test env (runs before hoisted imports).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  };
});

import {
  resolveDaemonBaseUrl,
  toDaemonWsUrl,
  loadDaemonApiKey,
  DAEMON_API_KEY_STORAGE_KEY,
  type DaemonUrlEnv,
} from "./daemonConfig";

function env(overrides: Partial<DaemonUrlEnv> = {}): DaemonUrlEnv {
  return {
    storedUrl: null,
    envUrl: undefined,
    tauri: false,
    prod: false,
    origin: "",
    ...overrides,
  };
}

describe("resolveDaemonBaseUrl", () => {
  it("defaults to localhost with nothing configured", () => {
    expect(resolveDaemonBaseUrl(env())).toBe("http://localhost:7667");
  });

  it("defaults to localhost in the Tauri shell even for prod builds", () => {
    expect(
      resolveDaemonBaseUrl(env({ tauri: true, prod: true, origin: "tauri://localhost" }))
    ).toBe("http://localhost:7667");
  });

  it("uses same-origin for a production browser bundle", () => {
    expect(
      resolveDaemonBaseUrl(env({ prod: true, origin: "https://nous.example.bcc.sh" }))
    ).toBe("https://nous.example.bcc.sh");
  });

  it("ignores origin in browser dev (vite dev server is not the daemon)", () => {
    expect(
      resolveDaemonBaseUrl(env({ prod: false, origin: "http://localhost:1420" }))
    ).toBe("http://localhost:7667");
  });

  it("ignores non-http origins", () => {
    expect(
      resolveDaemonBaseUrl(env({ prod: true, origin: "file://" }))
    ).toBe("http://localhost:7667");
  });

  it("prefers the build-time env URL over same-origin", () => {
    expect(
      resolveDaemonBaseUrl(
        env({ envUrl: "https://daemon.example", prod: true, origin: "https://app.example" })
      )
    ).toBe("https://daemon.example");
  });

  it("prefers the localStorage override over everything", () => {
    expect(
      resolveDaemonBaseUrl(
        env({
          storedUrl: "http://192.168.1.5:7667",
          envUrl: "https://daemon.example",
          prod: true,
          origin: "https://app.example",
        })
      )
    ).toBe("http://192.168.1.5:7667");
  });

  it("strips trailing slashes and ignores blank values", () => {
    expect(resolveDaemonBaseUrl(env({ storedUrl: "https://d.example/" }))).toBe(
      "https://d.example"
    );
    expect(resolveDaemonBaseUrl(env({ storedUrl: "  ", envUrl: " " }))).toBe(
      "http://localhost:7667"
    );
  });
});

describe("toDaemonWsUrl", () => {
  it("maps http to ws and https to wss", () => {
    expect(toDaemonWsUrl("http://localhost:7667")).toBe("ws://localhost:7667");
    expect(toDaemonWsUrl("https://nous.example.bcc.sh")).toBe("wss://nous.example.bcc.sh");
  });
});

describe("loadDaemonApiKey (browser path)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the localStorage key when set", async () => {
    localStorage.setItem(DAEMON_API_KEY_STORAGE_KEY, "test-key-123");
    await expect(loadDaemonApiKey()).resolves.toBe("test-key-123");
  });

  it("returns null when no key is stored", async () => {
    await expect(loadDaemonApiKey()).resolves.toBeNull();
  });
});
