// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountVim, type VimHarness } from "./harness";

let h: VimHarness;
afterEach(() => h?.destroy());

describe("word motions split on punctuation (w/b/e)", () => {
  it("w stops at punctuation runs", () => {
    h = mountVim([{ type: "paragraph", content: "foo.bar baz" }]);
    h.setCursor(0, 0);
    h.press("w");
    expect(h.cursorOffset()).toBe(3); // on "."
    h.press("w");
    expect(h.cursorOffset()).toBe(4); // start of "bar"
    h.press("w");
    expect(h.cursorOffset()).toBe(8); // start of "baz"
  });

  it("e lands on the last char of each word/punct run", () => {
    h = mountVim([{ type: "paragraph", content: "foo.bar" }]);
    h.setCursor(0, 0);
    h.press("e");
    expect(h.cursorOffset()).toBe(2); // "foo" -> 'o'
    h.press("e");
    expect(h.cursorOffset()).toBe(3); // "." run
    h.press("e");
    expect(h.cursorOffset()).toBe(6); // "bar" -> 'r'
  });

  it("b walks back over punctuation boundaries", () => {
    h = mountVim([{ type: "paragraph", content: "foo.bar" }]);
    h.setCursor(0, 6); // on 'r'
    h.press("b");
    expect(h.cursorOffset()).toBe(4); // start of "bar"
    h.press("b");
    expect(h.cursorOffset()).toBe(3); // "."
    h.press("b");
    expect(h.cursorOffset()).toBe(0); // start of "foo"
  });
});

describe("WORD motions are whitespace-delimited (W/B/E)", () => {
  it("W skips punctuation, only whitespace separates", () => {
    h = mountVim([{ type: "paragraph", content: "foo.bar baz" }]);
    h.setCursor(0, 0);
    h.press("W");
    expect(h.cursorOffset()).toBe(8); // start of "baz"
  });

  it("E goes to end of the whole WORD", () => {
    h = mountVim([{ type: "paragraph", content: "foo.bar baz" }]);
    h.setCursor(0, 0);
    h.press("E");
    expect(h.cursorOffset()).toBe(6); // end of "foo.bar"
  });

  it("B goes to start of the whole WORD", () => {
    h = mountVim([{ type: "paragraph", content: "foo.bar baz" }]);
    h.setCursor(0, 6); // on 'r'
    h.press("B");
    expect(h.cursorOffset()).toBe(0);
  });
});

describe("Y — yank line", () => {
  it("Y then p duplicates the line", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.setCursor(0, 0);
    h.press("Y");
    h.press("p");
    expect(h.contentTexts()).toEqual(["hello", "hello"]);
  });
});

describe("~ — toggle case", () => {
  it("toggles a char and advances", () => {
    h = mountVim([{ type: "paragraph", content: "abc" }]);
    h.setCursor(0, 0);
    h.press("~");
    expect(h.text(0)).toBe("Abc");
    expect(h.cursorOffset()).toBe(1);
    h.press("~");
    expect(h.text(0)).toBe("ABc");
  });

  it("honors a count (3~)", () => {
    h = mountVim([{ type: "paragraph", content: "abc" }]);
    h.setCursor(0, 0);
    h.press("3", "~");
    expect(h.text(0)).toBe("ABC");
  });
});

describe("count after an operator", () => {
  it("d2w deletes two words", () => {
    h = mountVim([{ type: "paragraph", content: "one two three four" }]);
    h.setCursor(0, 0);
    h.press("d", "2", "w");
    expect(h.text(0)).toBe("three four");
  });

  it("2d3w multiplies counts (= 6 words)", () => {
    h = mountVim([{ type: "paragraph", content: "a b c d e f g h" }]);
    h.setCursor(0, 0);
    h.press("2", "d", "3", "w");
    expect(h.text(0)).toBe("g h");
  });
});

describe("operator + find is inclusive (df/dt)", () => {
  it("df deletes up to and including the target", () => {
    h = mountVim([{ type: "paragraph", content: "abc,def" }]);
    h.setCursor(0, 0);
    h.press("d", "f", ",");
    expect(h.text(0)).toBe("def");
  });

  it("dt deletes up to (and including the char before) the target", () => {
    h = mountVim([{ type: "paragraph", content: "abc,def" }]);
    h.setCursor(0, 0);
    h.press("d", "t", ",");
    expect(h.text(0)).toBe(",def");
  });
});

describe("linewise paste preserves block type", () => {
  it("yy on a heading then p pastes a heading, not a paragraph", () => {
    h = mountVim([
      { type: "heading", content: "Title" },
      { type: "paragraph", content: "body" },
    ]);
    h.setCursor(0, 0);
    h.press("y", "y");
    h.press("p");
    expect(h.blockTypes().slice(0, 3)).toEqual([
      "heading",
      "heading",
      "paragraph",
    ]);
    expect(h.text(1)).toBe("Title");
  });
});
