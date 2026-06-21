// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { mountVim, type VimHarness } from "./harness";
import { leaderBindingFor, leaderKeyLabel } from "../vimLeader";

let h: VimHarness;
afterEach(() => h?.destroy());

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("vimLeader registry", () => {
  it("maps the leader keys to actions", () => {
    expect(leaderBindingFor(" ")?.action).toBe("commandPalette");
    expect(leaderBindingFor("w")?.action).toBe("save");
    expect(leaderBindingFor("z")).toBeUndefined();
  });

  it("labels Space as ␣", () => {
    expect(leaderKeyLabel(" ")).toBe("␣");
    expect(leaderKeyLabel("w")).toBe("w");
  });
});

describe("leader menu (which-key)", () => {
  it("opens on <leader> (Space) in normal mode", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    expect(h.leaderMenu()).toBeNull();
    h.press(" ");
    expect(h.leaderMenu()).not.toBeNull();
    expect(h.leaderMenu()!.bindings.length).toBeGreaterThan(0);
  });

  it("<leader><leader> opens the command palette and closes the menu", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(" ", " ");
    expect(h.commandPaletteOpens()).toBe(1);
    expect(h.leaderMenu()).toBeNull();
  });

  it("<leader>w saves and closes the menu", async () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(" ", "w");
    expect(h.saveCount()).toBe(1);
    expect(h.leaderMenu()).toBeNull();
    await flush();
    expect(h.message()).toBe("written");
  });

  it("Escape closes the menu without running an action", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(" ", "Escape");
    expect(h.leaderMenu()).toBeNull();
    expect(h.commandPaletteOpens()).toBe(0);
    expect(h.saveCount()).toBe(0);
  });

  it("an unbound key dismisses the menu without acting", () => {
    h = mountVim([{ type: "paragraph", content: "hello" }]);
    h.press(" ", "z");
    expect(h.leaderMenu()).toBeNull();
    expect(h.commandPaletteOpens()).toBe(0);
  });

  it("does not open in insert mode (Space types normally)", () => {
    h = mountVim([{ type: "paragraph", content: "" }]);
    h.press("i", " ");
    expect(h.leaderMenu()).toBeNull();
    expect(h.text(0)).toBe(" ");
  });

  it("does not open mid-operator (e.g. d<Space>)", () => {
    h = mountVim([{ type: "paragraph", content: "hello world" }]);
    h.press("d");
    h.press(" ");
    expect(h.leaderMenu()).toBeNull();
  });
});

describe("leader owns the keyboard (capture phase)", () => {
  // On a checklist item, BlockNote's keymaps must not claim Space; the
  // capture-phase listener opens the leader menu before they run. press()
  // drives handleKeyDown directly, so dispatch REAL DOM keydowns here.
  const realKey = (dom: Element, key: string) => {
    const ev = new KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    dom.dispatchEvent(ev);
    return ev;
  };

  it("opens on real Space then <leader><leader> opens the palette — no text inserted", () => {
    h = mountVim([{ type: "checkListItem", content: "task" }]);
    const before = h.blockCount();

    const open = realKey(h.view.dom, " ");
    expect(open.defaultPrevented).toBe(true);
    expect(h.leaderMenu()).not.toBeNull();

    realKey(h.view.dom, " ");
    expect(h.commandPaletteOpens()).toBe(1);
    expect(h.leaderMenu()).toBeNull();
    expect(h.blockCount()).toBe(before);
    expect(h.text(0)).toBe("task"); // no space typed into the item
  });
});
