// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountVim, type VimHarness } from "./harness";

let h: VimHarness;
afterEach(() => h?.destroy());

describe("visual mode — entry & transitions", () => {
  it("v enters visual, Escape returns to normal", () => {
    h = mountVim([{ type: "paragraph", content: "abc" }]);
    h.setCursor(0, 0);
    h.press("v");
    expect(h.mode()).toBe("visual");
    h.press("<Esc>");
    expect(h.mode()).toBe("normal");
  });

  it("v toggles off, V switches to visual-line", () => {
    h = mountVim([{ type: "paragraph", content: "abc" }]);
    h.setCursor(0, 0);
    h.press("v");
    h.press("v");
    expect(h.mode()).toBe("normal");
    h.press("v");
    h.press("V");
    expect(h.mode()).toBe("visual-line");
  });
});

describe("visual mode — charwise motions + operators", () => {
  it("v then motions extend the selection; d deletes it (inclusive)", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.setCursor(0, 0);
    h.press("v", "l", "l", "d"); // select h,e,l -> delete "hel"
    expect(h.text(0)).toBe("lo");
    expect(h.mode()).toBe("normal");
  });

  it("v$d deletes to end of line", () => {
    h = mountVim([{ type: "paragraph", content: "hello world" }]);
    h.setCursor(0, 6); // on 'w'
    h.press("v", "$", "d");
    expect(h.text(0)).toBe("hello ");
  });

  it("o swaps the active end so the selection can grow left", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.setCursor(0, 2); // on first 'l'
    h.press("v", "l", "o", "h", "h", "d");
    expect(h.text(0)).toBe("o");
  });
});

describe("visual mode — text objects", () => {
  it("viw selects the inner word; d deletes it", () => {
    h = mountVim([{ type: "paragraph", content: "hello world" }]);
    h.setCursor(0, 2); // inside "hello"
    h.press("v", "i", "w", "d");
    expect(h.text(0)).toBe(" world");
  });
});

describe("visual mode — yank & paste", () => {
  it("charwise y then p pastes after the cursor", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.setCursor(0, 0);
    h.press("v", "l", "l", "y"); // yank "hel"
    expect(h.mode()).toBe("normal");
    h.press("p"); // paste after 'h'
    expect(h.text(0)).toBe("hhelello");
  });

  it("linewise Vy then p duplicates the block (preserving type)", () => {
    h = mountVim([{ type: "heading", content: "Title" }]);
    h.setCursor(0, 0);
    h.press("V", "y");
    h.press("p");
    expect(h.blockTypes().slice(0, 2)).toEqual(["heading", "heading"]);
    expect(h.text(1)).toBe("Title");
  });
});

describe("visual mode — linewise & cross-block", () => {
  it("Vd deletes the whole line", () => {
    h = mountVim([
      { type: "paragraph", content: "one" },
      { type: "paragraph", content: "two" },
    ]);
    h.setCursor(0, 0);
    h.press("V", "d");
    expect(h.contentTexts()).toEqual(["two"]);
  });

  it("a charwise selection spanning blocks (vjd) deletes linewise", () => {
    h = mountVim([
      { type: "paragraph", content: "one" },
      { type: "paragraph", content: "two" },
      { type: "paragraph", content: "three" },
    ]);
    h.setCursor(0, 0);
    h.press("v", "j", "d"); // j falls back to block-level in jsdom
    expect(h.contentTexts()).toEqual(["three"]);
  });
});

describe("visual mode — case operators", () => {
  it("~ toggles case of the selection", () => {
    h = mountVim([{ type: "paragraph", content: "abc" }]);
    h.setCursor(0, 0);
    h.press("v", "l", "l", "~");
    expect(h.text(0)).toBe("ABC");
  });

  it("U uppercases and u lowercases the selection", () => {
    h = mountVim([{ type: "paragraph", content: "abc" }]);
    h.setCursor(0, 0);
    h.press("v", "l", "l", "U");
    expect(h.text(0)).toBe("ABC");

    const h2 = mountVim([{ type: "paragraph", content: "XYZ" }]);
    h2.setCursor(0, 0);
    h2.press("v", "l", "l", "u");
    expect(h2.text(0)).toBe("xyz");
    h2.destroy();
  });
});

describe("visual mode — change", () => {
  it("c deletes the selection and enters insert", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.setCursor(0, 0);
    h.press("v", "l", "l", "c");
    expect(h.mode()).toBe("insert");
    h.type("XYZ");
    h.press("<Esc>");
    expect(h.text(0)).toBe("XYZlo");
  });
});
