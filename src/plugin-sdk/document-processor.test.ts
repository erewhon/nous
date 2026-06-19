// Enabled-state logic + persistence for document processors. The Settings toggle
// relies on `setEnabled` persisting to localStorage and `isProcessorEnabled`
// honoring both each processor's default and the user's disabled set.
import { describe, it, expect, beforeEach, vi } from "vitest";

// localStorage polyfill for the node test env (runs before hoisted imports, so
// the store's loadDisabled() at module-load sees it). Mirrors saveOutbox.test.ts.
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
  DISABLED_STORAGE_KEY,
  fromDaemonDecoration,
  isProcessorEnabled,
  useProcessorSettings,
  type DocumentProcessor,
} from "./document-processor";

const proc = (id: string, defaultEnabled?: boolean): DocumentProcessor => ({
  id,
  title: id,
  triggers: ["edit"],
  defaultEnabled,
  process: () => ({}),
});

beforeEach(() => {
  localStorage.clear();
  useProcessorSettings.setState({ disabled: new Set() });
});

describe("isProcessorEnabled", () => {
  it("is on by default", () => {
    expect(isProcessorEnabled(proc("a"), new Set())).toBe(true);
  });

  it("is off when the processor opts out via defaultEnabled:false", () => {
    expect(isProcessorEnabled(proc("a", false), new Set())).toBe(false);
  });

  it("is off when the user has explicitly disabled it", () => {
    expect(isProcessorEnabled(proc("a"), new Set(["a"]))).toBe(false);
  });
});

describe("useProcessorSettings persistence", () => {
  it("persists disabled ids to localStorage and clears them on re-enable", () => {
    useProcessorSettings.getState().setEnabled("nous.wiki-link", false);
    expect(
      JSON.parse(localStorage.getItem(DISABLED_STORAGE_KEY)!)
    ).toEqual(["nous.wiki-link"]);

    useProcessorSettings.getState().setEnabled("nous.wiki-link", true);
    expect(JSON.parse(localStorage.getItem(DISABLED_STORAGE_KEY)!)).toEqual([]);
  });

  it("a disabled id makes isProcessorEnabled return false", () => {
    useProcessorSettings.getState().setEnabled("a", false);
    const { disabled } = useProcessorSettings.getState();
    expect(isProcessorEnabled(proc("a"), disabled)).toBe(false);
    expect(isProcessorEnabled(proc("b"), disabled)).toBe(true);
  });
});

describe("fromDaemonDecoration (shared daemon↔frontend result type)", () => {
  it("maps a daemon highlight to a block-highlight", () => {
    expect(
      fromDaemonDecoration({
        block_id: "b1",
        type: "highlight",
        background_color: "#eee",
        border_color: "#f00",
        border_width: 2,
      })
    ).toEqual({
      kind: "block-highlight",
      blockId: "b1",
      backgroundColor: "#eee",
      borderColor: "#f00",
      borderWidth: 2,
    });
  });

  it("maps a daemon badge to a block-badge", () => {
    expect(
      fromDaemonDecoration({
        block_id: "b1",
        type: "badge",
        label: "Hard",
        badge_color: "#fff",
        badge_bg: "#333",
        position: "top-left",
      })
    ).toEqual({
      kind: "block-badge",
      blockId: "b1",
      label: "Hard",
      color: "#fff",
      backgroundColor: "#333",
      position: "top-left",
    });
  });

  it("returns null for a badge with no label", () => {
    expect(
      fromDaemonDecoration({ block_id: "b1", type: "badge" })
    ).toBeNull();
  });
});
