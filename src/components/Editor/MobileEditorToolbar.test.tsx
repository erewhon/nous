// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import {
  MobileEditorToolbar,
  computeKeyboardInset,
  nextHeadingCycle,
  type ToolbarEditor,
} from "./MobileEditorToolbar";

afterEach(cleanup);

describe("computeKeyboardInset", () => {
  it("is the gap between layout and visual viewport", () => {
    // 844 window, keyboard shrinks visual viewport to 500 with no scroll
    expect(computeKeyboardInset(844, 500, 0)).toBe(344);
  });
  it("is zero when the keyboard is closed", () => {
    expect(computeKeyboardInset(844, 844, 0)).toBe(0);
  });
  it("never goes negative (URL-bar quirks)", () => {
    expect(computeKeyboardInset(844, 850, 0)).toBe(0);
  });
});

describe("nextHeadingCycle", () => {
  it("cycles paragraph → h1 → h2 → h3 → paragraph", () => {
    expect(nextHeadingCycle({ type: "paragraph" })).toEqual({
      type: "heading",
      props: { level: 1 },
    });
    expect(nextHeadingCycle({ type: "heading", props: { level: 1 } })).toEqual({
      type: "heading",
      props: { level: 2 },
    });
    expect(nextHeadingCycle({ type: "heading", props: { level: 3 } })).toEqual({
      type: "paragraph",
    });
  });
});

function mockEditor(blockType = "paragraph"): ToolbarEditor {
  return {
    toggleStyles: vi.fn(),
    getTextCursorPosition: vi.fn(() => ({
      block: { id: "b1", type: blockType },
    })),
    updateBlock: vi.fn(),
    nestBlock: vi.fn(),
    unnestBlock: vi.fn(),
    moveBlocksUp: vi.fn(),
    moveBlocksDown: vi.fn(),
    focus: vi.fn(),
  };
}

function setup(blockType?: string) {
  const editorHost = document.createElement("div");
  editorHost.id = "bn-editor-test";
  document.body.appendChild(editorHost);

  const editor = mockEditor(blockType);
  render(<MobileEditorToolbar editor={editor} containerId="bn-editor-test" />);

  // Toolbar only shows while focus is inside the editor container
  act(() => {
    editorHost.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  });
  return { editor, editorHost };
}

function press(label: string) {
  const btn = document.querySelector(
    `button[aria-label="${label}"]`
  ) as HTMLButtonElement;
  expect(btn).not.toBeNull();
  act(() => {
    // jsdom has no PointerEvent constructor; React dispatches onPointerDown
    // by event type, so a plain Event works.
    btn.dispatchEvent(
      new Event("pointerdown", { bubbles: true, cancelable: true })
    );
  });
}

describe("MobileEditorToolbar", () => {
  it("is hidden until the editor has focus", () => {
    const container = document.createElement("div");
    container.id = "bn-editor-test";
    document.body.appendChild(container);
    render(
      <MobileEditorToolbar editor={mockEditor()} containerId="bn-editor-test" />
    );
    expect(document.querySelector(".mobile-editor-toolbar")).toBeNull();
    document.body.removeChild(container);
  });

  it("toggles bold via editor.toggleStyles", () => {
    const { editor, editorHost } = setup();
    press("Bold");
    expect(editor.toggleStyles).toHaveBeenCalledWith({ bold: true });
    document.body.removeChild(editorHost);
  });

  it("turns a paragraph into a checklist item and back", () => {
    const first = setup("paragraph");
    press("Checklist");
    expect(first.editor.updateBlock).toHaveBeenCalledWith(
      { id: "b1", type: "paragraph" },
      { type: "checkListItem" }
    );
    document.body.removeChild(first.editorHost);
    cleanup();

    const second = setup("checkListItem");
    press("Checklist");
    expect(second.editor.updateBlock).toHaveBeenCalledWith(
      { id: "b1", type: "checkListItem" },
      { type: "paragraph" }
    );
    document.body.removeChild(second.editorHost);
  });

  it("moves blocks and indents via the editor API", () => {
    const { editor, editorHost } = setup();
    press("Move block up");
    press("Move block down");
    press("Increase indent");
    press("Decrease indent");
    expect(editor.moveBlocksUp).toHaveBeenCalled();
    expect(editor.moveBlocksDown).toHaveBeenCalled();
    expect(editor.nestBlock).toHaveBeenCalled();
    expect(editor.unnestBlock).toHaveBeenCalled();
    document.body.removeChild(editorHost);
  });
});
