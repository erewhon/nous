/**
 * Test harness for the BlockNote vim extension (src/components/Editor/vim/).
 *
 * Mounts a real (default-schema) BlockNoteEditor in jsdom with the vim
 * extension enabled, then drives it by feeding keys through ProseMirror's
 * own `someProp("handleKeyDown")` dispatch — the same path the editor uses
 * at runtime, so plugin ordering and `event.preventDefault()` behave
 * faithfully without depending on jsdom's (incomplete) key-event plumbing.
 *
 * Adding a keybinding test
 * ------------------------
 *   const h = mountVim([{ type: "paragraph", content: "hello world" }]);
 *   h.setCursor(0, 0);          // block 0, char offset 0
 *   h.press("d", "w");          // feed a dw sequence
 *   expect(h.text(0)).toBe("world");
 *   h.destroy();
 *
 * `press(...keys)` accepts single characters and the special tokens
 * "<Esc>", "<CR>", "<BS>", "<Tab>", "<Space>", and modifier forms like
 * "<C-r>" / "<C-[>". `type(text)` inserts literal text (use in insert mode).
 *
 * Caveat: `j`/`k` rely on `coordsAtPos`/`posAtCoords`, which return no
 * geometry under jsdom, so in tests they exercise the block-level fallback
 * (move to start of next/prev block), not true visual-line movement.
 */
import { BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { VimExtension } from "../vimExtension";
import type { VimMode } from "../vimTypes";

// jsdom lacks a few globals BlockNote/ProseMirror touch during construction.
function installPolyfills() {
  const g = globalThis as Record<string, unknown>;
  if (typeof g.ResizeObserver === "undefined") {
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof g.matchMedia === "undefined" && typeof window !== "undefined") {
    // @ts-expect-error minimal stub
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  }
}

export interface VimHarness {
  editor: BlockNoteEditor<any, any, any>;
  view: EditorView;
  /** Feed a sequence of keys through the vim handler (normal/visual/insert). */
  press: (...keys: string[]) => void;
  /** Insert literal text at the cursor (simulates insert-mode typing). */
  type: (text: string) => void;
  /** Place the cursor at char `offset` within block `blockIndex`. */
  setCursor: (blockIndex: number, offset: number) => void;
  /** Plain text of a block (default: the block the cursor is in). */
  text: (blockIndex?: number) => string;
  /** Plain text of every top-level block, in order. */
  texts: () => string[];
  /**
   * Like `texts()` but drops a single trailing empty paragraph.
   *
   * BlockNote's `removeBlocks` keeps the document ending in an empty
   * paragraph, so after a `dd`/`dap`/multi-block delete the doc gains a
   * trailing "" block. Use this when asserting on the meaningful content.
   */
  contentTexts: () => string[];
  /** Block types in document order. */
  blockTypes: () => string[];
  /** Number of top-level blocks. */
  blockCount: () => number;
  /** Char offset of the cursor within its block. */
  cursorOffset: () => number;
  /** Index of the block the cursor is in. */
  cursorBlockIndex: () => number;
  /** Current vim mode. */
  mode: () => VimMode;
  /** Current pending-keys string (e.g. "d", "ci"). */
  pending: () => string;
  destroy: () => void;
}

interface ParsedKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const SPECIAL: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  cr: "Enter",
  enter: "Enter",
  bs: "Backspace",
  backspace: "Backspace",
  tab: "Tab",
  space: " ",
};

function parseKey(token: string): ParsedKey {
  let ctrlKey = false;
  let metaKey = false;
  let altKey = false;
  let inner = token;

  // Strip optional angle brackets: "<C-r>" -> "C-r"
  if (inner.length > 2 && inner.startsWith("<") && inner.endsWith(">")) {
    inner = inner.slice(1, -1);
  }

  // Modifier prefixes: C-, M-/D-, A-
  const modMatch = /^([CMDA])-(.+)$/.exec(inner);
  if (modMatch) {
    const mod = modMatch[1];
    inner = modMatch[2];
    if (mod === "C") ctrlKey = true;
    else if (mod === "M" || mod === "D") metaKey = true;
    else if (mod === "A") altKey = true;
  }

  const special = SPECIAL[inner.toLowerCase()];
  const key = special ?? inner;
  // shiftKey is implied for uppercase letters; vim handlers key off `key`
  // directly so this is informational only.
  const shiftKey = key.length === 1 && key !== key.toLowerCase();

  return { key, ctrlKey, metaKey, altKey, shiftKey };
}

export function mountVim(
  initialContent: PartialBlock<any, any, any>[]
): VimHarness {
  installPolyfills();

  let mode: VimMode = "normal";
  let pending = "";

  const editor = BlockNoteEditor.create({
    initialContent,
    extensions: [
      VimExtension({
        enabled: () => true,
        onModeChange: (m) => {
          mode = m;
        },
        onPendingKeysChange: (k) => {
          pending = k;
        },
      }),
    ],
  });

  const container = document.createElement("div");
  document.body.appendChild(container);
  editor.mount(container);

  const view = editor.prosemirrorView as EditorView;

  function blockStartPos(): number {
    return view.state.doc.resolve(view.state.selection.from).start();
  }

  function press(...keys: string[]) {
    for (const token of keys) {
      const { key, ctrlKey, metaKey, altKey, shiftKey } = parseKey(token);
      const event = new KeyboardEvent("keydown", {
        key,
        ctrlKey,
        metaKey,
        altKey,
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      const handled = view.someProp("handleKeyDown", (f) => f(view, event));
      if (handled) continue;

      // Unhandled key: replicate the browser default the vim plugin relies on
      // (insert-mode passthrough for printable chars and Backspace).
      if (mode === "insert") {
        if (key.length === 1 && !ctrlKey && !metaKey && !altKey) {
          view.dispatch(view.state.tr.insertText(key));
        } else if (key === "Backspace") {
          const { from } = view.state.selection;
          const start = view.state.doc.resolve(from).start();
          if (from > start) view.dispatch(view.state.tr.delete(from - 1, from));
        }
      }
    }
  }

  function type(text: string) {
    view.dispatch(view.state.tr.insertText(text));
  }

  function setCursor(blockIndex: number, offset: number) {
    const block = editor.document[blockIndex];
    if (!block) throw new Error(`No block at index ${blockIndex}`);
    editor.setTextCursorPosition(block.id, "start");
    const start = blockStartPos();
    const $start = view.state.doc.resolve(start);
    const target = Math.min(start + offset, $start.end());
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, target))
    );
  }

  function blockText(block: any): string {
    const content = block?.content;
    if (Array.isArray(content)) {
      return content.map((c: any) => c.text ?? "").join("");
    }
    return "";
  }

  function text(blockIndex?: number): string {
    const idx = blockIndex ?? cursorBlockIndex();
    return blockText(editor.document[idx]);
  }

  function texts(): string[] {
    return editor.document.map((b) => blockText(b));
  }

  function contentTexts(): string[] {
    const all = texts();
    if (all.length > 1 && all[all.length - 1] === "") {
      const lastBlock = editor.document[editor.document.length - 1];
      if (lastBlock.type === "paragraph") return all.slice(0, -1);
    }
    return all;
  }

  function blockTypes(): string[] {
    return editor.document.map((b) => b.type);
  }

  function blockCount(): number {
    return editor.document.length;
  }

  function cursorOffset(): number {
    return view.state.selection.from - blockStartPos();
  }

  function cursorBlockIndex(): number {
    const cursor = editor.getTextCursorPosition();
    if (!cursor) return 0;
    return editor.document.findIndex((b) => b.id === cursor.block.id);
  }

  function destroy() {
    try {
      editor.unmount();
    } catch {
      // ignore
    }
    container.remove();
  }

  return {
    editor,
    view,
    press,
    type,
    setCursor,
    text,
    texts,
    contentTexts,
    blockTypes,
    blockCount,
    cursorOffset,
    cursorBlockIndex,
    mode: () => mode,
    pending: () => pending,
    destroy,
  };
}
