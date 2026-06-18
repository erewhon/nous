// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountVim, type VimHarness } from "./harness";

let h: VimHarness;
afterEach(() => h?.destroy());

describe("vim harness smoke", () => {
  it("mounts in normal mode", () => {
    h = mountVim([{ type: "paragraph", content: "hello world" }]);
    expect(h.mode()).toBe("normal");
    expect(h.text(0)).toBe("hello world");
  });

  it("enters insert mode, types, and escapes", () => {
    h = mountVim([{ type: "paragraph", content: "bar" }]);
    h.setCursor(0, 0);
    h.press("i");
    expect(h.mode()).toBe("insert");
    h.type("foo ");
    h.press("<Esc>");
    expect(h.mode()).toBe("normal");
    expect(h.text(0)).toBe("foo bar");
  });

  it("deletes a char with x", () => {
    h = mountVim([{ type: "paragraph", content: "abc" }]);
    h.setCursor(0, 0);
    h.press("x");
    expect(h.text(0)).toBe("bc");
  });

  it("moves to end of line with $ and start with 0", () => {
    h = mountVim([{ type: "paragraph", content: "abcde" }]);
    h.setCursor(0, 0);
    h.press("$");
    expect(h.cursorOffset()).toBe(4); // last char (normal-mode clamp)
    h.press("0");
    expect(h.cursorOffset()).toBe(0);
  });

  it("deletes a word with dw", () => {
    h = mountVim([{ type: "paragraph", content: "hello world" }]);
    h.setCursor(0, 0);
    h.press("d", "w");
    expect(h.text(0)).toBe("world");
  });

  it("deletes a block with dd", () => {
    h = mountVim([
      { type: "paragraph", content: "one" },
      { type: "paragraph", content: "two" },
    ]);
    h.setCursor(0, 0);
    h.press("d", "d");
    // BlockNote keeps a trailing empty paragraph after a block delete, so
    // assert on the meaningful content rather than the raw block count.
    expect(h.contentTexts()).toEqual(["two"]);
  });

  it("changes inner word with ciw", () => {
    h = mountVim([{ type: "paragraph", content: "hello world" }]);
    h.setCursor(0, 2); // inside "hello"
    h.press("c", "i", "w");
    expect(h.mode()).toBe("insert");
    h.type("HI");
    h.press("<Esc>");
    expect(h.text(0)).toBe("HI world");
  });
});
