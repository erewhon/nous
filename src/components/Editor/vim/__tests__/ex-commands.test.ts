// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountVim, type VimHarness } from "./harness";

let h: VimHarness;
afterEach(() => h?.destroy());

// Let queued microtasks (the requestSave().then(...) chain) settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("ex commands", () => {
  it(":w calls the real save path and echoes 'written'", async () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(":", "w", "Enter");
    expect(h.saveCount()).toBe(1);
    await flush();
    expect(h.message()).toBe("written");
  });

  it(":wq and :x also save", async () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(":", "w", "q", "Enter");
    h.press(":", "x", "Enter");
    expect(h.saveCount()).toBe(2);
    await flush();
    expect(h.message()).toBe("written");
  });

  it(":w reports failure when the save rejects", async () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.failNextSave();
    h.press(":", "w", "Enter");
    expect(h.saveCount()).toBe(1);
    await flush();
    expect(h.message()).toBe("E212: save failed");
  });

  it("unknown ex command reports an error and does not save", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(":", "f", "o", "o", "Enter");
    expect(h.saveCount()).toBe(0);
    expect(h.message()).toBe("E492: Not an editor command: foo");
  });

  it("Escape cancels the command line without saving", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(":", "w", "Escape");
    expect(h.saveCount()).toBe(0);
    expect(h.pending()).toBe("");
  });

  it(":q is a no-op (single-page editor, nothing to close)", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(":", "q", "Enter");
    expect(h.saveCount()).toBe(0);
    expect(h.message()).toBe("");
  });
});
