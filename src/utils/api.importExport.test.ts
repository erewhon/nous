// @vitest-environment jsdom
//
// Browser fallbacks for the markdown import/export flows: in a plain
// browser these must go through the daemon HTTP API instead of Tauri
// invoke + native file dialogs.
import { describe, it, expect, vi, beforeEach } from "vitest";

const daemonGetText = vi.fn();
const daemonPost = vi.fn();
vi.mock("./daemon", () => ({
  daemonGet: vi.fn(),
  daemonGetText: (...a: unknown[]) => daemonGetText(...a),
  daemonPost: (...a: unknown[]) => daemonPost(...a),
  daemonPut: vi.fn(),
  daemonDelete: vi.fn(),
}));
vi.mock("./platform", () => ({
  isTauri: () => false,
}));

import { exportPageToMarkdown, importMarkdown } from "./api";
import { downloadTextFile, safeFilename } from "./download";
import { pickFiles } from "./pickFiles";

beforeEach(() => vi.clearAllMocks());

describe("markdown export/import browser branches", () => {
  it("exports via the daemon ?format=markdown route", async () => {
    daemonGetText.mockResolvedValue("# Hello");
    const md = await exportPageToMarkdown("nb-1", "pg-1");
    expect(md).toBe("# Hello");
    expect(daemonGetText).toHaveBeenCalledWith(
      "/api/notebooks/nb-1/pages/pg-1?format=markdown"
    );
  });

  it("imports via the daemon import/markdown route", async () => {
    daemonPost.mockResolvedValue({ id: "new-page" });
    const page = await importMarkdown("nb-1", "# Doc", "Doc.md", "f-1");
    expect(page).toEqual({ id: "new-page" });
    expect(daemonPost).toHaveBeenCalledWith(
      "/api/notebooks/nb-1/import/markdown",
      { markdown: "# Doc", filename: "Doc.md", folderId: "f-1", sectionId: null }
    );
  });
});

describe("downloadTextFile", () => {
  it("triggers an anchor download with the blob URL", () => {
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL,
      revokeObjectURL,
    });
    const clicked: HTMLAnchorElement[] = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this);
      });

    downloadTextFile("page.md", "# Hello", "text/markdown;charset=utf-8");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("page.md");
    expect(clicked[0].href).toContain("blob:mock-url");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    // The transient anchor must not linger in the DOM
    expect(document.body.querySelector("a")).toBeNull();

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe("safeFilename", () => {
  it("strips path and shell separators", () => {
    expect(safeFilename('a/b\\c:d*e?f"g<h>i|j')).toBe("a-b-c-d-e-f-g-h-i-j");
  });
  it("falls back when everything is stripped", () => {
    expect(safeFilename("  ")).toBe("untitled");
  });
});

describe("pickFiles", () => {
  it("resolves the chosen files on change", async () => {
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});

    const promise = pickFiles({ accept: ".md", multiple: true });
    const input = document.body.querySelector(
      "input[type=file]"
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.accept).toBe(".md");
    expect(input.multiple).toBe(true);

    const file = new File(["# hi"], "hi.md", { type: "text/markdown" });
    Object.defineProperty(input, "files", { value: [file] });
    input.onchange?.(new Event("change"));

    const files = await promise;
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("hi.md");
    // Input cleaned up
    expect(document.body.querySelector("input[type=file]")).toBeNull();

    clickSpy.mockRestore();
  });

  it("resolves empty when the dialog is cancelled (focus returns)", async () => {
    vi.useFakeTimers();
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});

    const promise = pickFiles();
    window.dispatchEvent(new Event("focus"));
    vi.advanceTimersByTime(400);

    const files = await promise;
    expect(files).toEqual([]);

    clickSpy.mockRestore();
    vi.useRealTimers();
  });
});
