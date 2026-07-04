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

import { editorJsToBlockNote, blockNoteToEditorJs } from "./blockFormatConverter";
import {
  DAEMON_API_KEY_STORAGE_KEY,
  DAEMON_URL_STORAGE_KEY,
} from "./daemonConfig";
import type { EditorData } from "../types/page";

const NB = "24560359-564f-4407-8e7d-5122f99a7061";
const BASE = "http://daemon.test:7667";

function imageDoc(url: string): EditorData {
  return {
    time: 1,
    version: "2.28.0",
    blocks: [
      { id: "img-1", type: "image", data: { file: { url }, caption: "cap" } },
    ],
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(DAEMON_URL_STORAGE_KEY, BASE);
  localStorage.setItem(DAEMON_API_KEY_STORAGE_KEY, "rw:secret");
});

describe("image block asset URL conversion (browser)", () => {
  it("resolves stored asset:// references to daemon URLs for rendering", () => {
    const bn = editorJsToBlockNote(imageDoc(`asset://${NB}/pic.png`));
    expect(bn[0].type).toBe("image");
    expect(bn[0].props.url).toBe(
      `${BASE}/api/notebooks/${NB}/assets/pic.png?token=rw%3Asecret`
    );
  });

  it("persists the stable asset:// form, never the token-bearing URL", () => {
    const bn = editorJsToBlockNote(imageDoc(`asset://${NB}/pic.png`));
    const back = blockNoteToEditorJs(bn);
    const file = (back.blocks[0].data as { file: { url: string } }).file;
    expect(file.url).toBe(`asset://${NB}/pic.png`);
    expect(file.url).not.toContain("token");
  });

  it("leaves external image URLs untouched in both directions", () => {
    const url = "https://example.com/pic.png";
    const bn = editorJsToBlockNote(imageDoc(url));
    expect(bn[0].props.url).toBe(url);
    const back = blockNoteToEditorJs(bn);
    expect((back.blocks[0].data as { file: { url: string } }).file.url).toBe(
      url
    );
  });
});
