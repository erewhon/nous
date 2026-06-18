// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountVim, type VimHarness } from "./harness";

let h: VimHarness;
afterEach(() => h?.destroy());

describe("marks (m / ` / ')", () => {
  it("`a jumps back to the exact mark position", () => {
    h = mountVim([
      { type: "paragraph", content: "hello" },
      { type: "paragraph", content: "world" },
      { type: "paragraph", content: "  foo" },
    ]);
    h.setCursor(2, 4); // inside "  foo", offset 4
    h.press("m", "a");
    h.setCursor(0, 0);
    h.press("`", "a");
    expect(h.cursorBlockIndex()).toBe(2);
    expect(h.cursorOffset()).toBe(4);
  });

  it("'a jumps to the first non-blank of the mark's line", () => {
    h = mountVim([
      { type: "paragraph", content: "hello" },
      { type: "paragraph", content: "  foo" },
    ]);
    h.setCursor(1, 4);
    h.press("m", "b");
    h.setCursor(0, 0);
    h.press("'", "b");
    expect(h.cursorBlockIndex()).toBe(1);
    expect(h.cursorOffset()).toBe(2); // first non-blank of "  foo"
  });

  it("jumping to an unset mark is a no-op", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.setCursor(0, 3);
    h.press("`", "z");
    expect(h.cursorOffset()).toBe(3);
  });
});

describe("paragraph motions ({ / })", () => {
  const doc = () => [
    { type: "paragraph" as const, content: "a" },
    { type: "paragraph" as const, content: "" },
    { type: "paragraph" as const, content: "b" },
    { type: "paragraph" as const, content: "" },
    { type: "paragraph" as const, content: "c" },
  ];

  it("} jumps to the next empty block, then the last block", () => {
    h = mountVim(doc());
    h.setCursor(0, 0);
    h.press("}");
    expect(h.cursorBlockIndex()).toBe(1);
    h.press("}");
    expect(h.cursorBlockIndex()).toBe(3);
    h.press("}");
    expect(h.cursorBlockIndex()).toBe(4); // no empty after 3 -> last block
  });

  it("{ jumps to the previous empty block, then the first block", () => {
    h = mountVim(doc());
    h.setCursor(4, 0);
    h.press("{");
    expect(h.cursorBlockIndex()).toBe(3);
    h.press("{");
    expect(h.cursorBlockIndex()).toBe(1);
    h.press("{");
    expect(h.cursorBlockIndex()).toBe(0); // no empty before 1 -> first block
  });
});
