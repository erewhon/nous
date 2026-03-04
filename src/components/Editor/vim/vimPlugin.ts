/**
 * ProseMirror plugin implementing vim keybinding state machine.
 *
 * Manages mode transitions (normal/insert/visual), count prefix accumulation,
 * and key dispatch to command handlers. Always registered but checks an
 * `enabled` callback to allow runtime toggling without editor recreation.
 */
import { Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { BlockNoteEditor } from "@blocknote/core";
import { DEFAULT_VIM_STATE, type VimMode, type VimState } from "./vimTypes";
import * as cmd from "./vimCommands";

export const VIM_PLUGIN_KEY = new PluginKey<VimState>("vim");

interface VimPluginOptions {
  bnEditor: BlockNoteEditor<any, any, any>;
  enabled: () => boolean;
  onModeChange: (mode: VimMode) => void;
  onPendingKeysChange: (keys: string) => void;
}

export function createVimPlugin(options: VimPluginOptions): Plugin<VimState> {
  const { bnEditor, enabled, onModeChange, onPendingKeysChange } = options;

  // Mutable state — ProseMirror plugin state is immutable by convention,
  // but for vim we need high-frequency mutation (pending keys, count) without
  // triggering full PM state updates. We keep a mutable copy and sync to
  // PM state only on mode changes (which affect decorations).
  let vim: VimState = { ...DEFAULT_VIM_STATE };

  // Track `jj` escape sequence timing
  let lastJTime = 0;

  function setMode(view: EditorView, mode: VimMode) {
    if (vim.mode === mode) return;
    const prev = vim.mode;
    vim = { ...vim, mode, pendingKeys: "", count: 0 };
    onModeChange(mode);
    onPendingKeysChange("");

    // Toggle CSS class on the wrapper for caret hiding
    const wrapper = view.dom.closest(".bn-editor-wrapper");
    if (wrapper) {
      if (mode === "normal" || mode === "visual") {
        wrapper.classList.add("vim-normal-mode");
      } else {
        wrapper.classList.remove("vim-normal-mode");
      }
    }

    // When entering insert mode, make sure contenteditable is focused
    if (mode === "insert") {
      view.focus();
    }

    // When returning to normal mode from insert, clamp cursor
    if (mode === "normal" && prev === "insert") {
      cmd.clampCursorToContent(view, view.state);
    }

    // Force decoration update by dispatching an empty transaction
    view.dispatch(view.state.tr);
  }

  function setPendingKeys(keys: string) {
    vim = { ...vim, pendingKeys: keys };
    onPendingKeysChange(keys);
  }

  function resetPending() {
    vim = { ...vim, pendingKeys: "", count: 0 };
    onPendingKeysChange("");
  }

  return new Plugin<VimState>({
    key: VIM_PLUGIN_KEY,

    state: {
      init: () => ({ ...DEFAULT_VIM_STATE }),
      apply: () => vim,
    },

    props: {
      handleKeyDown(view: EditorView, event: KeyboardEvent): boolean {
        if (!enabled()) return false;

        // Never intercept modifier-only keys
        if (
          event.key === "Shift" ||
          event.key === "Control" ||
          event.key === "Alt" ||
          event.key === "Meta"
        ) {
          return false;
        }

        // Let Ctrl/Cmd shortcuts through (except vim-specific ones)
        if (
          (event.ctrlKey || event.metaKey) &&
          vim.mode !== "insert"
        ) {
          // Vim-specific Ctrl combos
          if (event.key === "r") {
            // Ctrl+R = redo
            event.preventDefault();
            cmd.redo(view);
            resetPending();
            return true;
          }
          if (event.key === "[") {
            // Ctrl+[ = Escape
            event.preventDefault();
            setMode(view, "normal");
            return true;
          }
          // Let all other Ctrl/Cmd combos pass through
          return false;
        }

        if (vim.mode === "insert") {
          return handleInsertMode(view, event);
        }
        if (vim.mode === "normal") {
          return handleNormalMode(view, event);
        }
        // visual mode: treat like normal for now
        if (vim.mode === "visual") {
          return handleNormalMode(view, event);
        }

        return false;
      },

      // In normal mode, prevent default text input behavior
      handleTextInput(
        _view: EditorView,
        _from: number,
        _to: number,
        _text: string,
      ): boolean {
        if (!enabled()) return false;
        return vim.mode === "normal" || vim.mode === "visual";
      },
    },
  });

  // ─── Insert mode handler ──────────────────────────────────────────────

  function handleInsertMode(
    view: EditorView,
    event: KeyboardEvent,
  ): boolean {
    // Escape → normal
    if (event.key === "Escape") {
      event.preventDefault();
      setMode(view, "normal");
      return true;
    }

    // Ctrl+[ → normal (same as Escape)
    if (event.ctrlKey && event.key === "[") {
      event.preventDefault();
      setMode(view, "normal");
      return true;
    }

    // jj → normal (quick escape)
    if (event.key === "j") {
      const now = Date.now();
      if (now - lastJTime < 200) {
        event.preventDefault();
        // Delete the first 'j' that was already typed
        const { from } = view.state.selection;
        if (from > view.state.doc.resolve(from).start()) {
          view.dispatch(view.state.tr.delete(from - 1, from));
        }
        setMode(view, "normal");
        lastJTime = 0;
        return true;
      }
      lastJTime = now;
      return false;
    }

    lastJTime = 0;
    return false; // Let all other keys pass through for normal editing
  }

  // ─── Normal mode handler ──────────────────────────────────────────────

  function handleNormalMode(
    view: EditorView,
    event: KeyboardEvent,
  ): boolean {
    event.preventDefault();
    const key = event.key;
    const pending = vim.pendingKeys;

    // ── Pending states ──────────────────────────────────────────────

    // r{char} — replace character
    if (pending === "r") {
      if (key.length === 1) {
        cmd.replaceChar(view, key);
        vim = { ...vim, lastCommand: `r${key}` };
      }
      resetPending();
      return true;
    }

    // f/F/t/T{char} — find character
    if (
      pending === "f" ||
      pending === "F" ||
      pending === "t" ||
      pending === "T"
    ) {
      if (key.length === 1) {
        const isForward = pending === "f" || pending === "t";
        const isTo = pending === "t" || pending === "T";
        if (isForward) {
          cmd.findCharForward(view, key, vim, isTo);
        } else {
          cmd.findCharBackward(view, key, vim, isTo);
        }
        vim = {
          ...vim,
          lastFindChar: key,
          lastFindDirection: isForward ? "forward" : "backward",
          lastFindType: isTo ? "to" : "find",
          lastCommand: `${pending}${key}`,
        };
      }
      resetPending();
      return true;
    }

    // d{motion} — delete with motion (only dd for now)
    if (pending === "d") {
      if (key === "d") {
        const yanked = cmd.deleteBlock(bnEditor, vim);
        vim = { ...vim, register: yanked, lastCommand: "dd" };
      }
      resetPending();
      return true;
    }

    // y{motion} — yank with motion (only yy for now)
    if (pending === "y") {
      if (key === "y") {
        const yanked = cmd.yankBlock(bnEditor, vim);
        vim = { ...vim, register: yanked, lastCommand: "yy" };
      }
      resetPending();
      return true;
    }

    // c{motion} — change with motion (only cc for now)
    if (pending === "c") {
      if (key === "c") {
        cmd.changeLine(view);
        vim = { ...vim, lastCommand: "cc" };
        resetPending();
        setMode(view, "insert");
        return true;
      }
      resetPending();
      return true;
    }

    // g{motion} — g-prefix commands
    if (pending === "g") {
      if (key === "g") {
        cmd.moveDocStart(bnEditor);
        vim = { ...vim, lastCommand: "gg" };
      }
      resetPending();
      return true;
    }

    // ── Count prefix ────────────────────────────────────────────────
    if (key >= "1" && key <= "9") {
      vim = { ...vim, count: vim.count * 10 + parseInt(key, 10) };
      setPendingKeys((vim.pendingKeys || "") + key);
      return true;
    }
    if (key === "0" && vim.count > 0) {
      vim = { ...vim, count: vim.count * 10 };
      setPendingKeys((vim.pendingKeys || "") + key);
      return true;
    }

    // ── Mode switching ──────────────────────────────────────────────
    if (key === "i") {
      resetPending();
      setMode(view, "insert");
      return true;
    }
    if (key === "a") {
      // Move cursor right by 1, then insert
      cmd.moveRight(view, bnEditor, { ...vim, count: 1 });
      resetPending();
      setMode(view, "insert");
      return true;
    }
    if (key === "I") {
      cmd.moveFirstNonWhitespace(view);
      resetPending();
      setMode(view, "insert");
      return true;
    }
    if (key === "A") {
      cmd.moveLineEnd(view);
      resetPending();
      setMode(view, "insert");
      return true;
    }
    if (key === "o") {
      cmd.openLine(bnEditor, "after");
      resetPending();
      setMode(view, "insert");
      return true;
    }
    if (key === "O") {
      cmd.openLine(bnEditor, "before");
      resetPending();
      setMode(view, "insert");
      return true;
    }
    if (key === "Escape") {
      resetPending();
      setMode(view, "normal");
      return true;
    }

    // ── Motions ─────────────────────────────────────────────────────
    if (key === "h") {
      cmd.moveLeft(view, bnEditor, vim);
      resetPending();
      return true;
    }
    if (key === "l") {
      cmd.moveRight(view, bnEditor, vim);
      resetPending();
      return true;
    }
    if (key === "j") {
      cmd.moveDown(view, bnEditor, vim);
      resetPending();
      return true;
    }
    if (key === "k") {
      cmd.moveUp(view, bnEditor, vim);
      resetPending();
      return true;
    }
    if (key === "w") {
      cmd.moveWordForward(view, bnEditor, vim);
      resetPending();
      return true;
    }
    if (key === "b") {
      cmd.moveWordBackward(view, bnEditor, vim);
      resetPending();
      return true;
    }
    if (key === "e") {
      cmd.moveWordEnd(view, bnEditor, vim);
      resetPending();
      return true;
    }
    if (key === "0") {
      cmd.moveLineStart(view);
      resetPending();
      return true;
    }
    if (key === "^") {
      cmd.moveFirstNonWhitespace(view);
      resetPending();
      return true;
    }
    if (key === "$") {
      cmd.moveLineEnd(view);
      resetPending();
      return true;
    }
    if (key === "G") {
      if (vim.count > 0) {
        // {count}G — go to block number (1-indexed)
        const doc = bnEditor.document;
        const idx = Math.min(vim.count - 1, doc.length - 1);
        if (idx >= 0 && doc[idx]) {
          bnEditor.setTextCursorPosition(doc[idx].id, "start");
        }
      } else {
        cmd.moveDocEnd(bnEditor);
      }
      resetPending();
      return true;
    }

    // ── Operator-pending prefixes ───────────────────────────────────
    if (key === "d") {
      setPendingKeys("d");
      return true;
    }
    if (key === "y") {
      setPendingKeys("y");
      return true;
    }
    if (key === "c") {
      setPendingKeys("c");
      return true;
    }
    if (key === "g") {
      setPendingKeys("g");
      return true;
    }
    if (key === "r") {
      setPendingKeys("r");
      return true;
    }
    if (key === "f") {
      setPendingKeys("f");
      return true;
    }
    if (key === "F") {
      setPendingKeys("F");
      return true;
    }
    if (key === "t") {
      setPendingKeys("t");
      return true;
    }
    if (key === "T") {
      setPendingKeys("T");
      return true;
    }

    // ── Editing commands ────────────────────────────────────────────
    if (key === "x") {
      cmd.deleteCharForward(view, vim);
      resetPending();
      return true;
    }
    if (key === "X") {
      cmd.deleteCharBackward(view, vim);
      resetPending();
      return true;
    }
    if (key === "s") {
      // s = delete char + insert mode
      cmd.deleteCharForward(view, { ...vim, count: 1 });
      resetPending();
      setMode(view, "insert");
      return true;
    }
    if (key === "S") {
      cmd.changeLine(view);
      resetPending();
      setMode(view, "insert");
      return true;
    }
    if (key === "D") {
      cmd.deleteToLineEnd(view);
      resetPending();
      return true;
    }
    if (key === "C") {
      cmd.changeToLineEnd(view);
      resetPending();
      setMode(view, "insert");
      return true;
    }
    if (key === "J") {
      cmd.joinLines(bnEditor);
      resetPending();
      return true;
    }
    if (key === "p") {
      cmd.pasteBlock(bnEditor, vim, "after");
      resetPending();
      return true;
    }
    if (key === "P") {
      cmd.pasteBlock(bnEditor, vim, "before");
      resetPending();
      return true;
    }

    // ── Find repeat ─────────────────────────────────────────────────
    if (key === ";") {
      cmd.repeatFind(view, vim);
      resetPending();
      return true;
    }
    if (key === ",") {
      cmd.repeatFindReverse(view, vim);
      resetPending();
      return true;
    }

    // ── Undo/Redo ───────────────────────────────────────────────────
    if (key === "u") {
      cmd.undo(view);
      resetPending();
      return true;
    }

    // ── Visual mode (basic) ─────────────────────────────────────────
    if (key === "v") {
      resetPending();
      setMode(view, "visual");
      return true;
    }

    // Unknown key — consume it to prevent text insertion in normal mode
    resetPending();
    return true;
  }
}
