import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

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
  buildDaemonAssetUrl,
  resolveAssetUrl,
  unresolveAssetUrl,
} from "./assetUrl";
import {
  DAEMON_API_KEY_STORAGE_KEY,
  DAEMON_URL_STORAGE_KEY,
} from "./daemonConfig";

const NB = "24560359-564f-4407-8e7d-5122f99a7061";
const BASE = "http://daemon.test:7667";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(DAEMON_URL_STORAGE_KEY, BASE);
});

describe("buildDaemonAssetUrl", () => {
  it("builds a daemon URL without a token when no key is set", () => {
    expect(buildDaemonAssetUrl(NB, "photo.png")).toBe(
      `${BASE}/api/notebooks/${NB}/assets/photo.png`
    );
  });

  it("appends the API key as ?token=", () => {
    localStorage.setItem(DAEMON_API_KEY_STORAGE_KEY, "rw:secret");
    expect(buildDaemonAssetUrl(NB, "photo.png")).toBe(
      `${BASE}/api/notebooks/${NB}/assets/photo.png?token=rw%3Asecret`
    );
  });

  it("encodes raw filenames exactly once, even when pre-encoded", () => {
    expect(buildDaemonAssetUrl(NB, "my photo.png")).toContain(
      "/assets/my%20photo.png"
    );
    expect(buildDaemonAssetUrl(NB, "my%20photo.png")).toContain(
      "/assets/my%20photo.png"
    );
    // Nested paths keep their slashes
    expect(buildDaemonAssetUrl(NB, "audio/clip.mp3")).toContain(
      "/assets/audio/clip.mp3"
    );
  });
});

describe("resolveAssetUrl (browser)", () => {
  it("maps Joplin-import asset://{nb}/{file} URLs", () => {
    expect(resolveAssetUrl(`asset://${NB}/pic.png`)).toBe(
      `${BASE}/api/notebooks/${NB}/assets/pic.png`
    );
  });

  it("maps Tauri asset://localhost convertFileSrc output", () => {
    const encoded = encodeURIComponent(
      `/home/u/.local/share/nous/notebooks/${NB}/assets/pic.png`
    );
    expect(resolveAssetUrl(`asset://localhost/${encoded}`)).toBe(
      `${BASE}/api/notebooks/${NB}/assets/pic.png`
    );
  });

  it("maps http://asset.localhost convertFileSrc output", () => {
    expect(
      resolveAssetUrl(
        `http://asset.localhost/home/u/nous/notebooks/${NB}/assets/pic.png`
      )
    ).toBe(`${BASE}/api/notebooks/${NB}/assets/pic.png`);
  });

  it("maps raw absolute paths under a notebook assets dir", () => {
    expect(
      resolveAssetUrl(`/library/notebooks/${NB}/assets/audio/clip.mp3`)
    ).toBe(`${BASE}/api/notebooks/${NB}/assets/audio/clip.mp3`);
  });

  it("leaves external URLs, orphaned imports, and unmappable paths alone", () => {
    expect(resolveAssetUrl("https://example.com/pic.png")).toBe(
      "https://example.com/pic.png"
    );
    // Notion-import relative path with no on-disk file — passes through
    expect(resolveAssetUrl("Thor/Untitled.png")).toBe("Thor/Untitled.png");
    // Absolute path outside any notebook assets dir
    expect(resolveAssetUrl("/tmp/videos/clip.mp4")).toBe(
      "/tmp/videos/clip.mp4"
    );
    expect(resolveAssetUrl("")).toBe("");
  });

  it("includes the token when a key is configured", () => {
    localStorage.setItem(DAEMON_API_KEY_STORAGE_KEY, "rw:secret");
    expect(resolveAssetUrl(`asset://${NB}/pic.png`)).toBe(
      `${BASE}/api/notebooks/${NB}/assets/pic.png?token=rw%3Asecret`
    );
  });
});

describe("unresolveAssetUrl", () => {
  it("converts a daemon asset URL (with token) back to asset:// form", () => {
    expect(
      unresolveAssetUrl(
        `${BASE}/api/notebooks/${NB}/assets/pic.png?token=rw%3Asecret`
      )
    ).toBe(`asset://${NB}/pic.png`);
  });

  it("handles host-relative daemon URLs and nested paths", () => {
    expect(
      unresolveAssetUrl(`/api/notebooks/${NB}/assets/audio/clip.mp3`)
    ).toBe(`asset://${NB}/audio/clip.mp3`);
  });

  it("leaves everything else unchanged", () => {
    expect(unresolveAssetUrl("https://example.com/pic.png")).toBe(
      "https://example.com/pic.png"
    );
    expect(unresolveAssetUrl(`asset://${NB}/pic.png`)).toBe(
      `asset://${NB}/pic.png`
    );
    expect(unresolveAssetUrl("")).toBe("");
  });

  it("round-trips with resolveAssetUrl", () => {
    localStorage.setItem(DAEMON_API_KEY_STORAGE_KEY, "rw:secret");
    const stored = `asset://${NB}/pics/photo.png`;
    expect(unresolveAssetUrl(resolveAssetUrl(stored))).toBe(stored);
  });
});
