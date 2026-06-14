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

vi.mock("./api", () => ({ updatePage: vi.fn() }));

import * as api from "./api";
import {
  enqueueFailedSave,
  dequeueSave,
  outboxSize,
  flushOutbox,
} from "./saveOutbox";

const mockUpdatePage = api.updatePage as unknown as ReturnType<typeof vi.fn>;
const content = { time: 1, version: "2.0", blocks: [] };

describe("saveOutbox (DL-22)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockUpdatePage.mockReset();
  });

  it("keeps one entry per page (latest wins)", () => {
    enqueueFailedSave({ notebookId: "n", pageId: "p1", content, commit: false });
    enqueueFailedSave({ notebookId: "n", pageId: "p1", content, commit: false });
    enqueueFailedSave({ notebookId: "n", pageId: "p2", content, commit: true });
    expect(outboxSize()).toBe(2);
  });

  it("dequeue removes an entry", () => {
    enqueueFailedSave({ notebookId: "n", pageId: "p1", content, commit: false });
    dequeueSave("p1");
    expect(outboxSize()).toBe(0);
  });

  it("flushes queued saves and removes the ones that succeed", async () => {
    enqueueFailedSave({ notebookId: "n", pageId: "p1", content, commit: false });
    enqueueFailedSave({ notebookId: "n", pageId: "p2", content, commit: false });
    mockUpdatePage.mockResolvedValue({ id: "x" });

    const remaining = await flushOutbox();
    expect(remaining).toBe(0);
    expect(mockUpdatePage).toHaveBeenCalledTimes(2);
    expect(outboxSize()).toBe(0);
  });

  it("keeps entries queued while the daemon is still unreachable", async () => {
    enqueueFailedSave({ notebookId: "n", pageId: "p1", content, commit: false });
    mockUpdatePage.mockRejectedValue(new Error("ECONNREFUSED"));

    const remaining = await flushOutbox();
    expect(remaining).toBe(1);
    expect(outboxSize()).toBe(1);
  });

  it("persists in localStorage so a queued save survives a restart", async () => {
    enqueueFailedSave({ notebookId: "n", pageId: "p1", content, commit: false });
    // The entry lives in localStorage; a later flush (e.g. on next startup)
    // picks it up.
    expect(outboxSize()).toBe(1);
    mockUpdatePage.mockResolvedValue({ id: "x" });
    await flushOutbox();
    expect(outboxSize()).toBe(0);
  });

  it("only clears the entries that succeed when some still fail", async () => {
    enqueueFailedSave({ notebookId: "n", pageId: "p1", content, commit: false });
    enqueueFailedSave({ notebookId: "n", pageId: "p2", content, commit: false });
    // p1 succeeds, p2 fails.
    mockUpdatePage.mockImplementation((_nb: string, pageId: string) =>
      pageId === "p1" ? Promise.resolve({ id: "p1" }) : Promise.reject(new Error("down"))
    );
    const remaining = await flushOutbox();
    expect(remaining).toBe(1);
  });
});
