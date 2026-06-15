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

vi.mock("./daemon", () => ({ daemonPut: vi.fn() }));

import { daemonPut } from "./daemon";
import {
  enqueueFailedSave,
  enqueueFailedFileSave,
  dequeueSave,
  outboxSize,
  flushOutbox,
} from "./saveOutbox";

const mockPut = daemonPut as unknown as ReturnType<typeof vi.fn>;
const pageContent = {
  time: 1,
  version: "2.0",
  blocks: [{ id: "a", type: "paragraph", data: {} }],
};

describe("saveOutbox (DL-22 / DL-04)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockPut.mockReset();
  });

  it("queues page and file saves, one (latest) per page", () => {
    enqueueFailedSave({ notebookId: "n", pageId: "p1", content: pageContent });
    enqueueFailedSave({ notebookId: "n", pageId: "p1", content: pageContent }); // replace
    enqueueFailedFileSave({ notebookId: "n", pageId: "p2", content: "{}" });
    expect(outboxSize()).toBe(2);
  });

  it("dequeue removes an entry", () => {
    enqueueFailedFileSave({ notebookId: "n", pageId: "p1", content: "{}" });
    dequeueSave("p1");
    expect(outboxSize()).toBe(0);
  });

  it("replays a page entry to the page endpoint and a file entry to /file-content", async () => {
    enqueueFailedSave({
      notebookId: "n",
      pageId: "p1",
      content: pageContent,
      commit: false,
      paneId: "pane1",
    });
    enqueueFailedFileSave({ notebookId: "n", pageId: "p2", content: "{\"rows\":[]}" });
    mockPut.mockResolvedValue({});

    const remaining = await flushOutbox();
    expect(remaining).toBe(0);

    const paths = mockPut.mock.calls.map((c) => c[0] as string);
    expect(paths).toContain("/api/notebooks/n/pages/p1");
    expect(paths).toContain("/api/notebooks/n/pages/p2/file-content");

    // The page body carries blocks (not a stringified blob).
    const pageCall = mockPut.mock.calls.find((c) => c[0] === "/api/notebooks/n/pages/p1");
    expect((pageCall![1] as { blocks: unknown[] }).blocks).toHaveLength(1);
    // The file body carries the raw string content.
    const fileCall = mockPut.mock.calls.find((c) =>
      (c[0] as string).endsWith("/file-content")
    );
    expect((fileCall![1] as { content: string }).content).toBe("{\"rows\":[]}");
  });

  it("keeps entries queued while the daemon is unreachable", async () => {
    enqueueFailedFileSave({ notebookId: "n", pageId: "p1", content: "x" });
    mockPut.mockRejectedValue(new Error("ECONNREFUSED"));
    const remaining = await flushOutbox();
    expect(remaining).toBe(1);
    expect(outboxSize()).toBe(1);
  });

  it("persists in localStorage so a queued save survives a restart", async () => {
    enqueueFailedFileSave({ notebookId: "n", pageId: "p1", content: "x" });
    expect(outboxSize()).toBe(1);
    mockPut.mockResolvedValue({});
    await flushOutbox();
    expect(outboxSize()).toBe(0);
  });
});
