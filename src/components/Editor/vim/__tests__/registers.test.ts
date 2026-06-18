// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountVim, type VimHarness } from "./harness";

let h: VimHarness;
afterEach(() => h?.destroy());

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("named registers", () => {
  it('"ayy then "ap pastes from register a', () => {
    h = mountVim([
      { type: "paragraph", content: "one" },
      { type: "paragraph", content: "two" },
    ]);
    h.setCursor(0, 0);
    h.press('"', "a", "y", "y"); // yank "one" into register a
    h.setCursor(1, 0);
    h.press('"', "a", "p"); // paste register a after "two"
    expect(h.contentTexts()).toEqual(["one", "two", "one"]);
  });
});

describe("OS clipboard integration", () => {
  it("a plain yank writes to the clipboard", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.setCursor(0, 0);
    h.press("y", "y");
    expect(h.clipboard.get()).toBe("hello");
  });

  it("a delete writes to the clipboard", () => {
    h = mountVim([
      { type: "paragraph", content: "cut me" },
      { type: "paragraph", content: "keep" },
    ]);
    h.setCursor(0, 0);
    h.press("d", "d");
    expect(h.clipboard.get()).toBe("cut me");
  });

  it('a named yank ("ayy) does NOT touch the clipboard', () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.clipboard.set("untouched");
    h.setCursor(0, 0);
    h.press('"', "a", "y", "y");
    expect(h.clipboard.get()).toBe("untouched");
  });

  it('"+p pastes from the clipboard', async () => {
    h = mountVim([{ type: "paragraph", content: "hi" }]);
    h.clipboard.set("X");
    h.setCursor(0, 0); // on 'h'
    h.press('"', "+", "p"); // paste clipboard after the cursor (async)
    await flush();
    expect(h.text(0)).toBe("hXi");
  });
});

describe("insert-mode Ctrl-r", () => {
  it("inserts the unnamed register", () => {
    h = mountVim([{ type: "paragraph", content: "hi" }]);
    h.setCursor(0, 0);
    h.press("v", "l", "y"); // yank "hi" charwise into unnamed
    h.press("A"); // append at end of line
    h.press("<C-r>", '"'); // insert unnamed register
    h.press("<Esc>");
    expect(h.text(0)).toBe("hihi");
  });
});
