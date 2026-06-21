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

describe("command-line UI state", () => {
  it("opens on : and tracks the typed buffer", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    expect(h.commandLine()).toBeNull();
    h.press(":");
    expect(h.commandLine()).not.toBeNull();
    expect(h.commandLine()!.buffer).toBe("");
    h.press("w");
    expect(h.commandLine()!.buffer).toBe("w");
  });

  it("offers prefix completions for the typed buffer", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(":", "w");
    expect(h.commandLine()!.completions.map((c) => c.name)).toEqual(["w", "wq"]);
  });

  it("Tab cycles completions and fills the buffer", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(":", "w");
    h.press("Tab"); // first match
    expect(h.commandLine()!.buffer).toBe("w");
    expect(h.commandLine()!.completionIndex).toBe(0);
    h.press("Tab"); // next match
    expect(h.commandLine()!.buffer).toBe("wq");
    expect(h.commandLine()!.completionIndex).toBe(1);
  });

  it("Escape closes the command line", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(":", "w");
    h.press("Escape");
    expect(h.commandLine()).toBeNull();
  });

  it("Enter closes the command line", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(":", "w", "Enter");
    expect(h.commandLine()).toBeNull();
  });

  it("ArrowUp recalls the previous command from history", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(":", "w", "Enter"); // record "w" in history
    h.press(":");
    expect(h.commandLine()!.buffer).toBe("");
    h.press("ArrowUp");
    expect(h.commandLine()!.buffer).toBe("w");
  });
});

describe("command line owns the keyboard (capture phase)", () => {
  // Regression: on a checklist/list item, BlockNote's Enter keymap would split
  // the item before vim saw the key — leaving the popup open and inserting a
  // newline. A capture-phase listener must intercept it first. press() drives
  // handleKeyDown directly, so here we dispatch REAL DOM keydowns.
  const realKey = (dom: Element, key: string) => {
    const ev = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    dom.dispatchEvent(ev);
    return ev;
  };

  it("intercepts Enter on a checklist item — executes :w, no newline", () => {
    h = mountVim([{ type: "checkListItem", content: "task one" }]);
    h.press(":"); // open the command line (normal-mode entry)
    const blocksBefore = h.blockCount();

    realKey(h.view.dom, "w");
    expect(h.commandLine()!.buffer).toBe("w");

    const enter = realKey(h.view.dom, "Enter");
    expect(enter.defaultPrevented).toBe(true); // editor never got the Enter
    expect(h.commandLine()).toBeNull(); // executed + closed
    expect(h.saveCount()).toBe(1); // :w ran
    expect(h.blockCount()).toBe(blocksBefore); // no split / newline
  });
});

describe("line jumps", () => {
  const fiveBlocks = () =>
    mountVim([
      { type: "paragraph", content: "one" },
      { type: "paragraph", content: "two" },
      { type: "paragraph", content: "three" },
      { type: "paragraph", content: "four" },
      { type: "paragraph", content: "five" },
    ]);

  it(":{n} jumps to block n (1-based)", () => {
    h = fiveBlocks();
    h.setCursor(0, 0);
    h.press(":", "3", "Enter");
    expect(h.cursorBlockIndex()).toBe(2);
  });

  it(":$ jumps to the last block", () => {
    h = fiveBlocks();
    h.setCursor(0, 0);
    h.press(":", "$", "Enter");
    expect(h.cursorBlockIndex()).toBe(4);
  });

  it(":{n} out of range clamps to the last block with a message", () => {
    h = fiveBlocks();
    h.setCursor(0, 0);
    h.press(":", "9", "9", "Enter");
    expect(h.cursorBlockIndex()).toBe(4);
    expect(h.message()).toContain("E16");
  });
});
