import { describe, it, expect, beforeEach, vi } from "vitest";

// The persist middleware reaches for `localStorage`, which doesn't exist in the
// node test env. Provide an in-memory polyfill BEFORE pageStore is imported
// (vi.hoisted runs before the hoisted module imports).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  // Minimal Storage polyfill for the node test environment.
  globalThis.localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  };
});

vi.mock("../utils/api", () => ({
  updatePage: vi.fn(),
}));
vi.mock("./ragStore", () => ({
  useRAGStore: {
    getState: () => ({
      indexPage: () => Promise.resolve(),
      removePage: () => {},
    }),
  },
}));

import * as api from "../utils/api";
import { usePageStore } from "./pageStore";

const mockUpdatePage = api.updatePage as unknown as ReturnType<typeof vi.fn>;

const content = { time: 1, version: "2.0", blocks: [] };

describe("pageStore.updatePageContent — save-failure propagation (DL-24/25)", () => {
  beforeEach(() => {
    mockUpdatePage.mockReset();
    usePageStore.setState({ saveError: null });
  });

  it("returns true and leaves saveError null on success", async () => {
    mockUpdatePage.mockResolvedValue({ id: "p1", content });
    const ok = await usePageStore
      .getState()
      .updatePageContent("nb", "p1", content, false, "pane1");
    expect(ok).toBe(true);
    expect(usePageStore.getState().saveError).toBeNull();
  });

  it("returns false and records saveError on failure — never throws", async () => {
    mockUpdatePage.mockRejectedValue(new Error("connection refused"));
    let threw = false;
    let ok: boolean | undefined;
    try {
      ok = await usePageStore
        .getState()
        .updatePageContent("nb", "p1", content, false, "pane1");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(ok).toBe(false);
    expect(usePageStore.getState().saveError).toContain("connection refused");
  });

  it("clears a prior saveError once a later save succeeds", async () => {
    mockUpdatePage.mockRejectedValueOnce(new Error("daemon down"));
    await usePageStore.getState().updatePageContent("nb", "p1", content, false, "pane1");
    expect(usePageStore.getState().saveError).not.toBeNull();

    mockUpdatePage.mockResolvedValue({ id: "p1", content });
    const ok = await usePageStore
      .getState()
      .updatePageContent("nb", "p1", content, false, "pane1");
    expect(ok).toBe(true);
    expect(usePageStore.getState().saveError).toBeNull();
  });

  it("clearSaveError resets the banner state", () => {
    usePageStore.setState({ saveError: "boom" });
    usePageStore.getState().clearSaveError();
    expect(usePageStore.getState().saveError).toBeNull();
  });
});
