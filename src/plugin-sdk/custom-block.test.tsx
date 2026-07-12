// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

// Node 25 defines a globalThis.localStorage getter that yields undefined
// without --localstorage-file, shadowing jsdom's. Polyfill before imports
// (same convention as blockFormatConverter.image.test.ts).
vi.hoisted(() => {
  const mem = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

import { render, screen, cleanup, act } from "@testing-library/react";
import type { CustomBlockContribution } from "./custom-block";
import {
  registerCustomBlock,
  getCustomBlocks,
  getCustomBlock,
  isCustomBlockEnabled,
  setCustomBlockEnabled,
  getDisabledCustomBlocks,
  CUSTOM_BLOCKS_DISABLED_KEY,
} from "./custom-block";
import { CustomBlockHost, setCustomBlockEditorContext } from "./custom-block-spec";

function contribution(
  overrides: Partial<CustomBlockContribution> & { id: string },
): CustomBlockContribution {
  return {
    title: overrides.id,
    propSchema: { value: { default: "" } },
    Render: ({ props }) => <div data-testid="render">{props.value}</div>,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  // Reset persisted disabled state between tests.
  for (const id of [...getDisabledCustomBlocks()]) {
    setCustomBlockEnabled(id, true);
  }
  localStorage.removeItem(CUSTOM_BLOCKS_DISABLED_KEY);
});

describe("custom block registry", () => {
  it("registers and looks up by id, idempotently", () => {
    const first = contribution({ id: "test-reg", title: "First" });
    const second = contribution({ id: "test-reg", title: "Second" });
    registerCustomBlock(first);
    registerCustomBlock(second);
    expect(getCustomBlock("test-reg")?.title).toBe("Second");
    expect(
      getCustomBlocks().filter((c) => c.id === "test-reg"),
    ).toHaveLength(1);
  });

  it("returns undefined for unknown ids", () => {
    expect(getCustomBlock("never-registered")).toBeUndefined();
  });
});

describe("enabled state", () => {
  it("defaults from the contribution, honors overrides, persists", () => {
    const onByDefault = contribution({ id: "en-a" });
    const offByDefault = contribution({ id: "en-b", defaultEnabled: false });

    expect(isCustomBlockEnabled(onByDefault, getDisabledCustomBlocks())).toBe(true);
    expect(isCustomBlockEnabled(offByDefault, getDisabledCustomBlocks())).toBe(false);

    setCustomBlockEnabled("en-a", false);
    expect(isCustomBlockEnabled(onByDefault, getDisabledCustomBlocks())).toBe(false);
    expect(
      JSON.parse(localStorage.getItem(CUSTOM_BLOCKS_DISABLED_KEY)!),
    ).toContain("en-a");

    setCustomBlockEnabled("en-a", true);
    expect(isCustomBlockEnabled(onByDefault, getDisabledCustomBlocks())).toBe(true);
  });
});

describe("CustomBlockHost", () => {
  const editor = () => ({ isEditable: true, updateBlock: vi.fn() });

  beforeEach(() => {
    localStorage.removeItem(CUSTOM_BLOCKS_DISABLED_KEY);
  });

  it("renders the contribution with its props", () => {
    const c = contribution({ id: "host-a" });
    render(
      <CustomBlockHost
        contribution={c}
        block={{ props: { value: "hello" } }}
        editor={editor()}
      />,
    );
    expect(screen.getByTestId("render").textContent).toBe("hello");
  });

  it("updateProps wraps editor.updateBlock", () => {
    const c = contribution({
      id: "host-b",
      Render: ({ updateProps }) => (
        <button onClick={() => updateProps({ value: "next" })}>go</button>
      ),
    });
    const ed = editor();
    const block = { props: { value: "" } };
    render(<CustomBlockHost contribution={c} block={block} editor={ed} />);
    screen.getByText("go").click();
    expect(ed.updateBlock).toHaveBeenCalledWith(block, {
      props: { value: "next" },
    });
  });

  it("passes readOnly from editor.isEditable", () => {
    const c = contribution({
      id: "host-c",
      Render: ({ readOnly }) => <div>{readOnly ? "ro" : "rw"}</div>,
    });
    render(
      <CustomBlockHost
        contribution={c}
        block={{ props: {} }}
        editor={{ isEditable: false, updateBlock: vi.fn() }}
      />,
    );
    expect(screen.getByText("ro")).toBeTruthy();
  });

  it("provides registered editor context and empty ctx otherwise", () => {
    const c = contribution({
      id: "host-d",
      Render: ({ ctx }) => <div>{ctx.pageId ?? "none"}</div>,
    });
    const registered = editor();
    setCustomBlockEditorContext(registered, { pageId: "p-1" });
    const { unmount } = render(
      <CustomBlockHost contribution={c} block={{ props: {} }} editor={registered} />,
    );
    expect(screen.getByText("p-1")).toBeTruthy();
    unmount();

    render(
      <CustomBlockHost contribution={c} block={{ props: {} }} editor={editor()} />,
    );
    expect(screen.getByText("none")).toBeTruthy();
  });

  it("renders a placeholder while disabled and restores on re-enable", () => {
    const c = contribution({ id: "host-e", title: "Fancy Block" });
    render(
      <CustomBlockHost
        contribution={c}
        block={{ props: { value: "kept" } }}
        editor={editor()}
      />,
    );
    expect(screen.getByTestId("render")).toBeTruthy();

    act(() => setCustomBlockEnabled("host-e", false));
    expect(screen.queryByTestId("render")).toBeNull();
    expect(
      screen.getByText(/Fancy Block is disabled — enable in Settings/),
    ).toBeTruthy();

    act(() => setCustomBlockEnabled("host-e", true));
    expect(screen.getByTestId("render").textContent).toBe("kept");
  });
});
