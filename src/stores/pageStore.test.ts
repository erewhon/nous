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
  listPages: vi.fn(),
  getPage: vi.fn(),
}));
vi.mock("./ragStore", () => ({
  useRAGStore: {
    getState: () => ({
      indexPage: () => Promise.resolve(),
      removePage: () => {},
    }),
  },
}));

// refreshPages dynamically imports notebookStore for the selected notebook.
const notebookState = vi.hoisted(() => ({
  selectedNotebookId: null as string | null,
}));
vi.mock("./notebookStore", () => ({
  useNotebookStore: {
    getState: () => ({
      selectedNotebookId: notebookState.selectedNotebookId,
      notebooks: [],
    }),
  },
}));

import * as api from "../utils/api";
import { usePageStore, type PaneTab } from "./pageStore";
import type { Page } from "../types/page";

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

const mockListPages = api.listPages as unknown as ReturnType<typeof vi.fn>;
const mockGetPage = api.getPage as unknown as ReturnType<typeof vi.fn>;

function page(id: string, notebookId: string, title = id): Page {
  return { id, notebookId, title, updatedAt: "2026-01-01" } as unknown as Page;
}

function tab(pageId: string, notebookId?: string): PaneTab {
  return { pageId, title: pageId, isPinned: false, notebookId };
}

describe("pageStore panes — stale-tab reconciliation after notebook switch", () => {
  beforeEach(() => {
    mockListPages.mockReset();
    mockGetPage.mockReset();
    notebookState.selectedNotebookId = "A";
    usePageStore.setState({
      pages: [],
      panes: [{ id: "pane-main", pageId: null, tabs: [] }],
      activePaneId: "pane-main",
      selectedPageId: null,
    });
  });

  it("loadPages claims legacy tabs, drops deleted ones, preserves foreign ones", async () => {
    mockListPages.mockResolvedValue([page("a1", "A"), page("a2", "A")]);
    usePageStore.setState({
      panes: [
        {
          id: "pane-main",
          pageId: "b9", // stale: belongs to notebook B
          tabs: [
            tab("a1"), // legacy, page exists in A → claimed
            tab("gone"), // legacy, page missing → dropped
            tab("a2", "A"), // tagged A, exists → kept
            tab("a-deleted", "A"), // tagged A, missing → dropped
            tab("b9", "B"), // tagged B → preserved untouched
          ],
        },
      ],
    });

    await usePageStore.getState().loadPages("A");

    const pane = usePageStore.getState().panes[0];
    expect(pane.tabs.map((t) => t.pageId)).toEqual(["a1", "a2", "b9"]);
    expect(pane.tabs[0].notebookId).toBe("A"); // legacy tab claimed
    expect(pane.tabs[2].notebookId).toBe("B"); // foreign tab untouched
    // Active page retargeted off the foreign id onto A's most recent tab,
    // and selectedPageId follows the active pane.
    expect(pane.pageId).toBe("a2");
    expect(usePageStore.getState().selectedPageId).toBe("a2");
  });

  it("loadPages reactivates this notebook's most recent tab after a switch-back", async () => {
    mockListPages.mockResolvedValue([page("a1", "A"), page("a2", "A")]);
    // Simulate returning to notebook A: pageId was nulled while visiting B,
    // but A's tabs survived in the store.
    usePageStore.setState({
      panes: [
        {
          id: "pane-main",
          pageId: null,
          tabs: [tab("a1", "A"), tab("a2", "A"), tab("b9", "B")],
        },
      ],
    });

    await usePageStore.getState().loadPages("A");

    const pane = usePageStore.getState().panes[0];
    expect(pane.pageId).toBe("a2"); // most recent tab of A
    expect(usePageStore.getState().selectedPageId).toBe("a2");
  });

  it("loadPages retargets to null when no tab of this notebook remains", async () => {
    mockListPages.mockResolvedValue([]);
    usePageStore.setState({
      panes: [
        { id: "pane-main", pageId: "b9", tabs: [tab("b9", "B")] },
      ],
    });

    await usePageStore.getState().loadPages("A");

    const pane = usePageStore.getState().panes[0];
    expect(pane.tabs.map((t) => t.pageId)).toEqual(["b9"]);
    expect(pane.pageId).toBeNull();
    expect(usePageStore.getState().selectedPageId).toBeNull();
  });

  it("openTabInPane stamps the page's notebookId on the new tab", () => {
    usePageStore.setState({ pages: [page("a1", "A")] });
    usePageStore.getState().openTabInPane("pane-main", "a1", "a1");
    expect(usePageStore.getState().panes[0].tabs[0].notebookId).toBe("A");
  });

  it("removePageLocal closes the page's tab everywhere and retargets panes", () => {
    usePageStore.setState({
      pages: [page("a1", "A"), page("a2", "A")],
      panes: [
        {
          id: "pane-main",
          pageId: "a2",
          tabs: [tab("a1", "A"), tab("a2", "A")],
        },
        { id: "pane-2", pageId: "a2", tabs: [tab("a2", "A")] },
      ],
      selectedPageId: "a2",
    });

    usePageStore.getState().removePageLocal("a2");

    const [main, second] = usePageStore.getState().panes;
    expect(main.tabs.map((t) => t.pageId)).toEqual(["a1"]);
    expect(main.pageId).toBe("a1");
    expect(second.tabs).toEqual([]);
    expect(second.pageId).toBeNull();
    // selectedPageId follows the active pane instead of wedging on the
    // deleted id.
    expect(usePageStore.getState().selectedPageId).toBe("a1");
  });
});

describe("pageStore.refreshPages — notebook-scoped lookups (404 storm fix)", () => {
  beforeEach(() => {
    mockGetPage.mockReset();
    notebookState.selectedNotebookId = "A";
    usePageStore.setState({
      pages: [],
      panes: [{ id: "pane-main", pageId: null, tabs: [] }],
      activePaneId: "pane-main",
      selectedPageId: null,
    });
  });

  it("skips unknown ids that belong to another notebook — no fetch at all", async () => {
    await usePageStore.getState().refreshPages(["forge-page"], "B");
    expect(mockGetPage).not.toHaveBeenCalled();
  });

  it("fetches unknown ids of the selected notebook against that notebook", async () => {
    mockGetPage.mockResolvedValue(page("a3", "A"));
    await usePageStore.getState().refreshPages(["a3"], "A");
    expect(mockGetPage).toHaveBeenCalledExactlyOnceWith("A", "a3");
    expect(usePageStore.getState().pages.map((p) => p.id)).toContain("a3");
  });

  it("treats a 404 as terminal — one attempt, no retry, no throw", async () => {
    mockGetPage.mockRejectedValue(new Error("404 page not found"));
    await usePageStore.getState().refreshPages(["deleted"], "A");
    expect(mockGetPage).toHaveBeenCalledTimes(1);
    expect(usePageStore.getState().pages).toEqual([]);
  });

  it("still refreshes known pages using their own notebookId", async () => {
    usePageStore.setState({ pages: [page("a1", "A")] });
    const fresh = { ...page("a1", "A"), updatedAt: "2026-02-01" };
    mockGetPage.mockResolvedValue(fresh);
    await usePageStore.getState().refreshPages(["a1"], "A");
    expect(mockGetPage).toHaveBeenCalledWith("A", "a1");
  });
});
