// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountVim, type VimHarness } from "./harness";

let h: VimHarness;
afterEach(() => h?.destroy());

// Note: jsdom has no layout, so coordsAtPos is unavailable and moveVertical
// uses its block-level fallback. These tests cover the counted-motion path
// (the batched perf change must still move the right number of lines/blocks).
describe("vertical navigation (j/k) with counts", () => {
  const doc = () => [
    { type: "paragraph" as const, content: "a" },
    { type: "paragraph" as const, content: "b" },
    { type: "paragraph" as const, content: "c" },
    { type: "paragraph" as const, content: "d" },
    { type: "paragraph" as const, content: "e" },
  ];

  it("3j moves down three blocks", () => {
    h = mountVim(doc());
    h.setCursor(0, 0);
    h.press("3", "j");
    expect(h.cursorBlockIndex()).toBe(3);
    expect(h.text()).toBe("d");
  });

  it("2k moves up two blocks", () => {
    h = mountVim(doc());
    h.setCursor(4, 0);
    h.press("2", "k");
    expect(h.cursorBlockIndex()).toBe(2);
    expect(h.text()).toBe("c");
  });

  it("j stops at the last block", () => {
    h = mountVim(doc());
    h.setCursor(4, 0);
    h.press("j");
    expect(h.cursorBlockIndex()).toBe(4);
  });

  it("a large count clamps to the document edge", () => {
    h = mountVim(doc());
    h.setCursor(0, 0);
    h.press("9", "9", "j");
    expect(h.cursorBlockIndex()).toBe(4);
  });
});
