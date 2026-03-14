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
import {
  DEFAULT_VIM_STATE,
  type EditRecord,
  type VimMode,
  type VimState,
} from "./vimTypes";
import * as cmd from "./vimCommands";

export const VIM_PLUGIN_KEY = new PluginKey<VimState>("vim");

interface VimPluginOptions {
  bnEditor: BlockNoteEditor<any, any, any>;
  enabled: () => boolean;
  onModeChange: (mode: VimMode) => void;
  onPendingKeysChange: (keys: string) => void;
}

/** Keys that start a motion (used to detect operator+motion). */
const MOTION_KEYS = new Set([
  "w",
  "b",
  "e",
  "h",
  "l",
  "0",
  "^",
  "$",
  "j",
  "k",
  "G",
]);

/** Keys that require a second char argument for a motion. */
const FIND_MOTION_KEYS = new Set(["f", "F", "t", "T"]);

export function createVimPlugin(options: VimPluginOptions): Plugin<VimState> {
  const { bnEditor, enabled, onModeChange, onPendingKeysChange } = options;

  // Mutable state — ProseMirror plugin state is immutable by convention,
  // but for vim we need high-frequency mutation (pending keys, count) without
  // triggering full PM state updates. We keep a mutable copy and sync to
  // PM state only on mode changes (which affect decorations).
  let vim: VimState = { ...DEFAULT_VIM_STATE };

  // Track `jj` escape sequence timing
  let lastJTime = 0;

  // Ex command buffer for `:` mode
  let exBuffer = "";

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

  /** Record an edit for dot repeat. */
  function recordEdit(record: EditRecord) {
    vim = { ...vim, lastEditRecord: record };
  }

  /**
   * Handle an operator+motion combination.
   * Returns true if the operator was applied, false if motion failed.
   */
  function applyOperatorMotion(
    view: EditorView,
    operator: "d" | "c" | "y",
    motionKey: string,
    motionArg?: string,
  ): boolean {
    const result = cmd.executeMotion(
      view,
      bnEditor,
      { ...vim, count: Math.max(vim.count, 1) },
      motionKey,
      motionArg,
    );
    if (!result) return false;

    let yanked: string;
    if (result.linewise) {
      yanked = cmd.applyOperatorLinewise(
        view,
        bnEditor,
        operator,
        result.from,
        result.to,
      );
      vim = {
        ...vim,
        register: yanked,
        registerType: "linewise",
      };
    } else {
      // Check if charwise motion crossed block boundaries
      const $from = view.state.doc.resolve(Math.min(result.from, result.to));
      const $to = view.state.doc.resolve(Math.max(result.from, result.to));
      if ($from.parent !== $to.parent) {
        // Cross-block: fall back to linewise
        yanked = cmd.applyOperatorLinewise(
          view,
          bnEditor,
          operator,
          result.from,
          result.to,
        );
        vim = { ...vim, register: yanked, registerType: "linewise" };
      } else {
        yanked = cmd.applyOperatorCharwise(
          view,
          operator,
          result.from,
          result.to,
        );
        vim = { ...vim, register: yanked, registerType: "charwise" };
      }
    }

    recordEdit({
      type: "operator-motion",
      operator,
      motionKey,
      motionArg,
      count: Math.max(vim.count, 1),
    });

    return true;
  }

  /** Replay last edit record for dot repeat. */
  function replayEdit(view: EditorView, record: EditRecord, count?: number) {
    const savedCount = vim.count;
    vim = { ...vim, count: count ?? record.count };

    switch (record.type) {
      case "operator-motion":
        if (record.operator && record.motionKey) {
          applyOperatorMotion(
            view,
            record.operator,
            record.motionKey,
            record.motionArg,
          );
        }
        break;
      case "operator-line":
        if (record.operator === "d") {
          const yanked = cmd.deleteBlock(bnEditor, vim);
          vim = { ...vim, register: yanked, registerType: "linewise" };
        } else if (record.operator === "c") {
          cmd.changeLine(view);
          setMode(view, "insert");
        } else if (record.operator === "y") {
          const yanked = cmd.yankBlock(bnEditor, vim);
          vim = { ...vim, register: yanked, registerType: "linewise" };
        }
        break;
      case "simple":
        switch (record.command) {
          case "x":
            cmd.deleteCharForward(view, vim);
            break;
          case "X":
            cmd.deleteCharBackward(view, vim);
            break;
          case "D":
            cmd.deleteToLineEnd(view);
            break;
          case "J":
            cmd.joinLines(bnEditor);
            break;
          case "r":
            if (record.arg) cmd.replaceChar(view, record.arg);
            break;
          case "s":
            cmd.deleteCharForward(view, { ...vim, count: 1 });
            setMode(view, "insert");
            break;
          case "S":
            cmd.changeLine(view);
            setMode(view, "insert");
            break;
        }
        break;
    }

    vim = { ...vim, count: savedCount };
  }

  /** Execute an ex command (`:w`, `:wq`, etc.). */
  function executeExCommand(_view: EditorView, command: string) {
    const trimmed = command.trim();
    if (trimmed === "w" || trimmed === "wq") {
      // Dispatch Ctrl+S to save
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "s",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    }
    // Future: other ex commands can be added here
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
          if (event.key === "d") {
            // Ctrl+D = scroll half page down
            event.preventDefault();
            cmd.scrollHalfPageDown(view, bnEditor);
            resetPending();
            return true;
          }
          if (event.key === "u") {
            // Ctrl+U = scroll half page up
            event.preventDefault();
            cmd.scrollHalfPageUp(view, bnEditor);
            resetPending();
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

    // ── Ex command mode (:) ──────────────────────────────────────────
    if (pending.startsWith(":")) {
      if (key === "Escape") {
        exBuffer = "";
        resetPending();
        return true;
      }
      if (key === "Enter") {
        executeExCommand(view, exBuffer);
        exBuffer = "";
        resetPending();
        return true;
      }
      if (key === "Backspace") {
        if (exBuffer.length > 0) {
          exBuffer = exBuffer.slice(0, -1);
          setPendingKeys(":" + exBuffer);
        } else {
          exBuffer = "";
          resetPending();
        }
        return true;
      }
      if (key.length === 1) {
        exBuffer += key;
        setPendingKeys(":" + exBuffer);
        return true;
      }
      return true;
    }

    // ── Pending: r{char} — replace character ─────────────────────────
    if (pending === "r") {
      if (key.length === 1) {
        cmd.replaceChar(view, key);
        recordEdit({
          type: "simple",
          command: "r",
          arg: key,
          count: Math.max(vim.count, 1),
        });
        vim = { ...vim, lastCommand: `r${key}` };
      }
      resetPending();
      return true;
    }

    // ── Pending: f/F/t/T{char} — find character ─────────────────────
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

    // ── Pending: operator (d/c/y) + motion ──────────────────────────
    if (pending === "d" || pending === "c" || pending === "y") {
      const op = pending as "d" | "c" | "y";

      // Doubled operator: dd/cc/yy (linewise)
      if (key === op) {
        if (op === "d") {
          const yanked = cmd.deleteBlock(bnEditor, vim);
          vim = { ...vim, register: yanked, registerType: "linewise", lastCommand: op + op };
        } else if (op === "c") {
          cmd.changeLine(view);
          vim = { ...vim, registerType: "linewise", lastCommand: "cc" };
          recordEdit({
            type: "operator-line",
            operator: op,
            count: Math.max(vim.count, 1),
          });
          resetPending();
          setMode(view, "insert");
          return true;
        } else {
          const yanked = cmd.yankBlock(bnEditor, vim);
          vim = { ...vim, register: yanked, registerType: "linewise", lastCommand: "yy" };
        }
        recordEdit({
          type: "operator-line",
          operator: op,
          count: Math.max(vim.count, 1),
        });
        resetPending();
        return true;
      }

      // Operator + find motion key (df, dt, dF, dT, cf, ct, etc.)
      if (FIND_MOTION_KEYS.has(key)) {
        setPendingKeys(op + key);
        return true;
      }

      // Operator + text object prefix (di, da, ci, ca, yi, ya)
      if (key === "i" || key === "a") {
        setPendingKeys(op + key);
        return true;
      }

      // Operator + g prefix (dgg, cgg, ygg)
      if (key === "g") {
        setPendingKeys(op + "g");
        return true;
      }

      // Operator + direct motion
      if (MOTION_KEYS.has(key)) {
        applyOperatorMotion(view, op, key);
        if (op === "c") {
          resetPending();
          setMode(view, "insert");
          return true;
        }
        resetPending();
        return true;
      }

      // Unknown key after operator — cancel
      resetPending();
      return true;
    }

    // ── Pending: operator + find motion (e.g. "df", "ct") ───────────
    if (
      pending.length === 2 &&
      (pending[0] === "d" || pending[0] === "c" || pending[0] === "y") &&
      FIND_MOTION_KEYS.has(pending[1])
    ) {
      const op = pending[0] as "d" | "c" | "y";
      const findKey = pending[1];
      if (key.length === 1) {
        applyOperatorMotion(view, op, findKey, key);
        if (op === "c") {
          resetPending();
          setMode(view, "insert");
          return true;
        }
      }
      resetPending();
      return true;
    }

    // ── Pending: operator + text object (e.g. "di", "ca", "yi") ────
    if (
      pending.length === 2 &&
      (pending[0] === "d" || pending[0] === "c" || pending[0] === "y") &&
      (pending[1] === "i" || pending[1] === "a")
    ) {
      const op = pending[0] as "d" | "c" | "y";
      const objKind = pending[1] as "i" | "a";
      if (key.length === 1) {
        const range = cmd.textObjectRange(view, objKind, key);
        if (range) {
          const yanked = cmd.applyOperatorCharwise(
            view,
            op,
            range.from,
            range.to,
          );
          vim = { ...vim, register: yanked, registerType: "charwise" };
          recordEdit({
            type: "operator-motion",
            operator: op,
            motionKey: objKind + key,
            count: Math.max(vim.count, 1),
          });
          if (op === "c") {
            resetPending();
            setMode(view, "insert");
            return true;
          }
        }
      }
      resetPending();
      return true;
    }

    // ── Pending: operator + g (e.g. "dg", "cg", "yg") ──────────────
    if (
      pending.length === 2 &&
      (pending[0] === "d" || pending[0] === "c" || pending[0] === "y") &&
      pending[1] === "g"
    ) {
      const op = pending[0] as "d" | "c" | "y";
      if (key === "g") {
        // dgg, cgg, ygg
        applyOperatorMotion(view, op, "gg");
        if (op === "c") {
          resetPending();
          setMode(view, "insert");
          return true;
        }
      }
      resetPending();
      return true;
    }

    // ── Pending: g{motion} — g-prefix commands ──────────────────────
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

    // ── Bracket matching (%) ────────────────────────────────────────
    if (key === "%") {
      cmd.matchBracket(view);
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
      recordEdit({
        type: "simple",
        command: "x",
        count: Math.max(vim.count, 1),
      });
      resetPending();
      return true;
    }
    if (key === "X") {
      cmd.deleteCharBackward(view, vim);
      recordEdit({
        type: "simple",
        command: "X",
        count: Math.max(vim.count, 1),
      });
      resetPending();
      return true;
    }
    if (key === "s") {
      // s = delete char + insert mode
      cmd.deleteCharForward(view, { ...vim, count: 1 });
      recordEdit({
        type: "simple",
        command: "s",
        count: 1,
      });
      resetPending();
      setMode(view, "insert");
      return true;
    }
    if (key === "S") {
      cmd.changeLine(view);
      recordEdit({
        type: "simple",
        command: "S",
        count: Math.max(vim.count, 1),
      });
      resetPending();
      setMode(view, "insert");
      return true;
    }
    if (key === "D") {
      cmd.deleteToLineEnd(view);
      recordEdit({
        type: "simple",
        command: "D",
        count: Math.max(vim.count, 1),
      });
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
      recordEdit({
        type: "simple",
        command: "J",
        count: Math.max(vim.count, 1),
      });
      resetPending();
      return true;
    }

    // ── Paste (check registerType for inline vs block) ──────────────
    if (key === "p") {
      if (vim.registerType === "charwise") {
        cmd.pasteInline(view, vim.register, true);
      } else {
        cmd.pasteBlock(bnEditor, vim, "after");
      }
      resetPending();
      return true;
    }
    if (key === "P") {
      if (vim.registerType === "charwise") {
        cmd.pasteInline(view, vim.register, false);
      } else {
        cmd.pasteBlock(bnEditor, vim, "before");
      }
      resetPending();
      return true;
    }

    // ── Dot repeat (.) ──────────────────────────────────────────────
    if (key === ".") {
      if (vim.lastEditRecord) {
        const useCount = vim.count > 0 ? vim.count : undefined;
        replayEdit(view, vim.lastEditRecord, useCount);
      }
      resetPending();
      return true;
    }

    // ── Search (/nN) ────────────────────────────────────────────────
    if (key === "/") {
      view.dom.dispatchEvent(
        new CustomEvent("vim:open-search", { bubbles: true }),
      );
      resetPending();
      return true;
    }
    if (key === "n") {
      view.dom.dispatchEvent(
        new CustomEvent("vim:search-next", { bubbles: true }),
      );
      resetPending();
      return true;
    }
    if (key === "N") {
      view.dom.dispatchEvent(
        new CustomEvent("vim:search-prev", { bubbles: true }),
      );
      resetPending();
      return true;
    }

    // ── Ex command mode (:) ─────────────────────────────────────────
    if (key === ":") {
      exBuffer = "";
      setPendingKeys(":");
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
