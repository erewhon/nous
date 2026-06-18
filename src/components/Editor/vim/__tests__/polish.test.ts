// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountVim, type VimHarness } from "./harness";

let h: VimHarness;
afterEach(() => h?.destroy());

describe("normal-mode cursor stays within the line (EOL clamp)", () => {
  it("$ lands on the last char, not past it", () => {
    h = mountVim([{ type: "paragraph", content: "abcde" }]);
    h.setCursor(0, 0);
    h.press("$");
    expect(h.cursorOffset()).toBe(4);
  });

  it("l cannot move past the last char and does not wrap blocks", () => {
    h = mountVim([
      { type: "paragraph", content: "abc" },
      { type: "paragraph", content: "def" },
    ]);
    h.setCursor(0, 2); // last char of block 0
    h.press("l");
    expect(h.cursorBlockIndex()).toBe(0);
    expect(h.cursorOffset()).toBe(2);
  });

  it("x on the last char clamps the cursor back", () => {
    h = mountVim([{ type: "paragraph", content: "abc" }]);
    h.setCursor(0, 2);
    h.press("x");
    expect(h.text(0)).toBe("ab");
    expect(h.cursorOffset()).toBe(1);
  });
});

describe("insert-mode editing keys", () => {
  it("Ctrl-w deletes the word before the cursor", () => {
    h = mountVim([{ type: "paragraph", content: "foo bar" }]);
    h.setCursor(0, 7); // end
    h.press("i");
    h.press("<C-w>");
    expect(h.text(0)).toBe("foo ");
    expect(h.mode()).toBe("insert");
  });

  it("Ctrl-u deletes back to the line start", () => {
    h = mountVim([{ type: "paragraph", content: "foo bar" }]);
    h.setCursor(0, 7);
    h.press("i");
    h.press("<C-u>");
    expect(h.text(0)).toBe("");
  });
});
