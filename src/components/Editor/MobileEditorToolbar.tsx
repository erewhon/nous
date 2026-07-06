import { useEffect, useState } from "react";
import "./mobile-editor.css";

// Fixed formatting bar pinned above the virtual keyboard (mobile spec §3).
// BlockNote's floating selection toolbar is unusable under a thumb, and the
// hover side-menu never appears on touch — so block actions (turn-into,
// indent, move) live here too. This deliberately replaces the spec's
// long-press block menu: long-press in contenteditable is how mobile
// browsers start text selection, and hijacking it breaks selection.

/** The slice of the BlockNote editor the toolbar drives (mockable in tests). */
export interface ToolbarEditor {
  toggleStyles(styles: Record<string, boolean>): void;
  getTextCursorPosition(): { block: { id: string; type: string; props?: Record<string, unknown> } };
  updateBlock(
    block: { id: string },
    update: { type?: string; props?: Record<string, unknown> }
  ): void;
  nestBlock(): void;
  unnestBlock(): void;
  moveBlocksUp(): void;
  moveBlocksDown(): void;
  focus(): void;
}

/**
 * Distance from the layout-viewport bottom to the top of the virtual
 * keyboard. 0 when the keyboard is closed. Exported for tests.
 */
export function computeKeyboardInset(
  innerHeight: number,
  visualHeight: number,
  visualOffsetTop: number
): number {
  return Math.max(0, Math.round(innerHeight - visualHeight - visualOffsetTop));
}

/** paragraph → h1 → h2 → h3 → paragraph. Exported for tests. */
export function nextHeadingCycle(block: {
  type: string;
  props?: Record<string, unknown>;
}): { type: string; props?: Record<string, unknown> } {
  if (block.type !== "heading") return { type: "heading", props: { level: 1 } };
  const level = Number(block.props?.level ?? 1);
  if (level >= 3) return { type: "paragraph" };
  return { type: "heading", props: { level: level + 1 } };
}

function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () =>
      setInset(computeKeyboardInset(window.innerHeight, vv.height, vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return inset;
}

function ToolbarButton({
  label,
  onAct,
  children,
}: {
  label: string;
  onAct: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="mobile-editor-toolbar-btn"
      aria-label={label}
      // pointerdown + preventDefault keeps focus (and the keyboard) in the
      // editor — a click would blur it and collapse the keyboard.
      onPointerDown={(e) => {
        e.preventDefault();
        onAct();
      }}
    >
      {children}
    </button>
  );
}

interface MobileEditorToolbarProps {
  editor: ToolbarEditor;
  /** The editor wrapper element — the bar shows while focus is inside it. */
  containerId: string;
}

export function MobileEditorToolbar({ editor, containerId }: MobileEditorToolbarProps) {
  const inset = useKeyboardInset();
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const container = document.getElementById(containerId);
    if (!container) return;
    let blurTimer: ReturnType<typeof setTimeout> | null = null;
    const onFocusIn = () => {
      if (blurTimer) clearTimeout(blurTimer);
      setFocused(true);
    };
    const onFocusOut = () => {
      // Grace period: refocusing (e.g. after a toolbar action) shouldn't flicker.
      blurTimer = setTimeout(() => setFocused(false), 150);
    };
    container.addEventListener("focusin", onFocusIn);
    container.addEventListener("focusout", onFocusOut);
    return () => {
      container.removeEventListener("focusin", onFocusIn);
      container.removeEventListener("focusout", onFocusOut);
      if (blurTimer) clearTimeout(blurTimer);
    };
  }, [containerId]);

  if (!focused) return null;

  const toggleListType = (type: "bulletListItem" | "checkListItem") => {
    const block = editor.getTextCursorPosition().block;
    editor.updateBlock(block, {
      type: block.type === type ? "paragraph" : type,
    });
    editor.focus();
  };

  return (
    <div
      className="mobile-editor-toolbar"
      style={{ bottom: inset }}
      role="toolbar"
      aria-label="Formatting"
    >
      <ToolbarButton label="Bold" onAct={() => editor.toggleStyles({ bold: true })}>
        <strong>B</strong>
      </ToolbarButton>
      <ToolbarButton label="Italic" onAct={() => editor.toggleStyles({ italic: true })}>
        <em>I</em>
      </ToolbarButton>
      <ToolbarButton
        label="Heading"
        onAct={() => {
          const block = editor.getTextCursorPosition().block;
          editor.updateBlock(block, nextHeadingCycle(block));
          editor.focus();
        }}
      >
        H
      </ToolbarButton>
      <ToolbarButton label="Bullet list" onAct={() => toggleListType("bulletListItem")}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M8 6h13M8 12h13M8 18h13" />
          <circle cx="4" cy="6" r="1" fill="currentColor" />
          <circle cx="4" cy="12" r="1" fill="currentColor" />
          <circle cx="4" cy="18" r="1" fill="currentColor" />
        </svg>
      </ToolbarButton>
      <ToolbarButton label="Checklist" onAct={() => toggleListType("checkListItem")}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="5" width="6" height="6" rx="1" />
          <path d="m4.5 8 1.5 1.5L9 6.5M12 8h9M12 16h9" />
          <rect x="3" y="13" width="6" height="6" rx="1" />
        </svg>
      </ToolbarButton>
      <ToolbarButton label="Decrease indent" onAct={() => { editor.unnestBlock(); editor.focus(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M7 8 3 12l4 4M11 6h10M11 12h10M11 18h10" />
        </svg>
      </ToolbarButton>
      <ToolbarButton label="Increase indent" onAct={() => { editor.nestBlock(); editor.focus(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m3 8 4 4-4 4M11 6h10M11 12h10M11 18h10" />
        </svg>
      </ToolbarButton>
      <ToolbarButton label="Move block up" onAct={() => { editor.moveBlocksUp(); editor.focus(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </ToolbarButton>
      <ToolbarButton label="Move block down" onAct={() => { editor.moveBlocksDown(); editor.focus(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      </ToolbarButton>
    </div>
  );
}
