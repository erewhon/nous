/**
 * ProseMirror plugin implementing vim keybinding state machine.
 *
 * Manages mode transitions (normal/insert/visual), count prefix accumulation,
 * and key dispatch to command handlers. Always registered but checks an
 * `enabled` callback to allow runtime toggling without editor recreation.
 */
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import type { BlockNoteEditor } from "@blocknote/core";
import {
  DEFAULT_VIM_STATE,
  type EditRecord,
  type PartialBlockSnapshot,
  type VimMode,
  type VimState,
} from "./vimTypes";
import * as cmd from "./vimCommands";

interface RegisterContent {
  text: string;
  blocks: PartialBlockSnapshot[] | null;
  type: "charwise" | "linewise";
}

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
  "W",
  "B",
  "E",
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

  // Visual mode: the moving end (head) as an absolute doc position. The fixed
  // end (anchor) lives in vim.visualAnchor. -1 when not in visual mode.
  let visualHead = -1;

  // Sticky goal column for j/k (persists while consecutive vertical motions
  // start where the previous one ended; any other motion invalidates it).
  let verticalGoal: cmd.VerticalGoal = { column: null, pos: -1 };

  // Marks (m{a} / `{a} / '{a}) — stored as block id + offset so they survive
  // edits to other blocks. Per editor instance.
  const marks = new Map<string, { blockId: string; offset: number }>();

  function setMark(view: EditorView, char: string) {
    const cursor = bnEditor.getTextCursorPosition();
    if (!cursor) return;
    const { from } = view.state.selection;
    const offset = from - view.state.doc.resolve(from).start();
    marks.set(char, { blockId: cursor.block.id, offset });
  }

  function jumpToMark(view: EditorView, char: string, lineStart: boolean) {
    const mark = marks.get(char);
    if (!mark) return;
    try {
      bnEditor.setTextCursorPosition(mark.blockId, "start");
    } catch {
      marks.delete(char); // block was deleted
      return;
    }
    if (lineStart) {
      cmd.moveFirstNonWhitespace(view);
      return;
    }
    const start = view.state.doc.resolve(view.state.selection.from).start();
    const $s = view.state.doc.resolve(start);
    const target = Math.min(start + mark.offset, $s.end());
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(view.state.doc, target))
        .scrollIntoView()
    );
  }

  // Named registers ("a–"z, "0–"9). The unnamed register lives in vim.register
  // /registerBlocks/registerType. activeRegister is set by a `"{c}` prefix and
  // consumed by the next yank/delete/paste. "+" and "*" map to the OS clipboard.
  const registers = new Map<string, RegisterContent>();
  let activeRegister: string | null = null;

  // Insert-mode Ctrl-r waits for a register char to insert.
  let insertRegisterPending = false;

  function isNamedRegister(c: string | null): boolean {
    return c !== null && /^[a-zA-Z0-9]$/.test(c);
  }

  async function writeClipboard(text: string) {
    try {
      await navigator.clipboard?.writeText(text);
    } catch {
      // clipboard unavailable / denied — ignore
    }
  }

  async function readClipboard(): Promise<string> {
    try {
      return (await navigator.clipboard?.readText()) ?? "";
    } catch {
      return "";
    }
  }

  /**
   * Store a yank/delete into the unnamed register, plus the active named
   * register if one was given, and the OS clipboard (by default, or for "+/"*).
   * Consumes the active register.
   */
  function writeRegister(
    text: string,
    blocks: PartialBlockSnapshot[] | null,
    type: "charwise" | "linewise"
  ) {
    vim = {
      ...vim,
      register: text,
      registerBlocks: blocks,
      registerType: type,
    };
    if (isNamedRegister(activeRegister)) {
      registers.set((activeRegister as string).toLowerCase(), {
        text,
        blocks,
        type,
      });
    }
    if (
      activeRegister === null ||
      activeRegister === "+" ||
      activeRegister === "*"
    ) {
      void writeClipboard(text);
    }
    activeRegister = null;
  }

  /** Paste from the active register (named / clipboard) or the unnamed one. */
  function pasteFrom(view: EditorView, placement: "before" | "after") {
    // OS clipboard registers — read is async; paste charwise-inline when ready.
    if (activeRegister === "+" || activeRegister === "*") {
      activeRegister = null;
      void readClipboard().then((text) => {
        if (text) cmd.pasteInline(view, text, placement === "after");
      });
      return;
    }

    let content: RegisterContent = {
      text: vim.register,
      blocks: vim.registerBlocks,
      type: vim.registerType,
    };
    if (isNamedRegister(activeRegister)) {
      const r = registers.get((activeRegister as string).toLowerCase());
      if (r) content = r;
    }
    activeRegister = null;

    if (content.type === "charwise") {
      cmd.pasteInline(view, content.text, placement === "after");
      return;
    }
    // Linewise: pasteBlock reads from vim state — swap in the chosen register,
    // paste, then restore the unnamed register (pasting "a must not clobber it).
    const saved: RegisterContent = {
      text: vim.register,
      blocks: vim.registerBlocks,
      type: vim.registerType,
    };
    vim = {
      ...vim,
      register: content.text,
      registerBlocks: content.blocks,
      registerType: content.type,
    };
    cmd.pasteBlock(bnEditor, vim, placement);
    vim = {
      ...vim,
      register: saved.text,
      registerBlocks: saved.blocks,
      registerType: saved.type,
    };
  }

  /** Insert a register's text inline (insert-mode Ctrl-r). */
  function insertRegister(view: EditorView, char: string) {
    if (char === "+" || char === "*") {
      void readClipboard().then((text) => {
        if (text)
          view.dispatch(
            view.state.tr.insertText(text, view.state.selection.from)
          );
      });
      return;
    }
    let text = vim.register;
    if (isNamedRegister(char)) {
      const r = registers.get(char.toLowerCase());
      if (r) text = r.text;
    }
    if (text) view.dispatch(view.state.tr.insertText(text));
  }

  function isVisual(mode: VimMode): boolean {
    return mode === "visual" || mode === "visual-line";
  }

  function setMode(view: EditorView, mode: VimMode) {
    if (vim.mode === mode) return;
    const prev = vim.mode;
    vim = { ...vim, mode, pendingKeys: "", count: 0 };
    // Leaving visual mode for normal/insert clears the visual range.
    if (mode === "normal" || mode === "insert") {
      vim = { ...vim, visualAnchor: null };
      visualHead = -1;
    }
    onModeChange(mode);
    onPendingKeysChange("");

    // Toggle CSS class on the wrapper for caret hiding
    const wrapper = view.dom.closest(".bn-editor-wrapper");
    if (wrapper) {
      if (mode === "normal" || isVisual(mode)) {
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
    count?: number
  ): boolean {
    const effCount = Math.max(count ?? vim.count, 1);
    const result = cmd.executeMotion(
      view,
      bnEditor,
      { ...vim, count: effCount },
      motionKey,
      motionArg
    );
    if (!result) return false;

    if (result.linewise) {
      const { text, blocks } = cmd.applyOperatorLinewise(
        view,
        bnEditor,
        operator,
        result.from,
        result.to
      );
      writeRegister(text, blocks, "linewise");
    } else {
      // Check if charwise motion crossed block boundaries
      const $from = view.state.doc.resolve(Math.min(result.from, result.to));
      const $to = view.state.doc.resolve(Math.max(result.from, result.to));
      if ($from.parent !== $to.parent) {
        // Cross-block: fall back to linewise
        const { text, blocks } = cmd.applyOperatorLinewise(
          view,
          bnEditor,
          operator,
          result.from,
          result.to
        );
        writeRegister(text, blocks, "linewise");
      } else {
        const yanked = cmd.applyOperatorCharwise(
          view,
          operator,
          result.from,
          result.to
        );
        writeRegister(yanked, null, "charwise");
      }
    }

    recordEdit({
      type: "operator-motion",
      operator,
      motionKey,
      motionArg,
      count: effCount,
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
            record.motionArg
          );
        }
        break;
      case "operator-line":
        if (record.operator === "d") {
          const { text, blocks } = cmd.deleteBlock(bnEditor, vim);
          writeRegister(text, blocks, "linewise");
        } else if (record.operator === "c") {
          cmd.changeLine(view);
          setMode(view, "insert");
        } else if (record.operator === "y") {
          const { text, blocks } = cmd.yankBlock(bnEditor, vim);
          writeRegister(text, blocks, "linewise");
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
          case "~":
            cmd.toggleCase(view, vim);
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
        })
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
        if ((event.ctrlKey || event.metaKey) && vim.mode !== "insert") {
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
        if (isVisual(vim.mode)) {
          return handleVisualMode(view, event);
        }

        return false;
      },

      // In normal mode, prevent default text input behavior
      handleTextInput(
        _view: EditorView,
        _from: number,
        _to: number,
        _text: string
      ): boolean {
        if (!enabled()) return false;
        return vim.mode === "normal" || isVisual(vim.mode);
      },
    },
  });

  // ─── Insert mode handler ──────────────────────────────────────────────

  function handleInsertMode(view: EditorView, event: KeyboardEvent): boolean {
    // Ctrl+r{reg} → insert a register's contents (consumes the next key first,
    // so it must run before Escape/jj handling).
    if (insertRegisterPending) {
      event.preventDefault();
      insertRegisterPending = false;
      if (event.key.length === 1) insertRegister(view, event.key);
      return true;
    }

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

    if (event.ctrlKey && event.key === "r") {
      event.preventDefault();
      insertRegisterPending = true;
      return true;
    }

    // Ctrl+w → delete word backward
    if (event.ctrlKey && event.key === "w") {
      event.preventDefault();
      cmd.deleteWordBackwardInsert(view);
      return true;
    }

    // Ctrl+u → delete to line start
    if (event.ctrlKey && event.key === "u") {
      event.preventDefault();
      cmd.deleteToLineStartInsert(view);
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

  function handleNormalMode(view: EditorView, event: KeyboardEvent): boolean {
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

    // ── Pending: m{char} — set mark ──────────────────────────────────
    if (pending === "m") {
      if (key.length === 1) setMark(view, key);
      resetPending();
      return true;
    }

    // ── Pending: `{char} / '{char} — jump to mark ────────────────────
    if (pending === "`" || pending === "'") {
      if (key.length === 1) jumpToMark(view, key, pending === "'");
      resetPending();
      return true;
    }

    // ── Pending: "{char} — select register for the next op ───────────
    if (pending === '"') {
      if (key.length === 1) activeRegister = key;
      resetPending();
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

    // ── Pending: operator (d/c/y) [+ motion-count] + motion ─────────
    // `pending` is the operator optionally followed by a motion count,
    // e.g. "d", "d2", "c12". The effective count is (pre-operator count)
    // × (motion count) so vim sequences like 2d3w (= 6) work.
    const opMatch = /^([dcy])(\d*)$/.exec(pending);
    if (opMatch) {
      const op = opMatch[1] as "d" | "c" | "y";
      const motionCountStr = opMatch[2];
      const effCount =
        Math.max(vim.count, 1) *
        Math.max(parseInt(motionCountStr || "1", 10), 1);

      // Accumulate motion-count digits (0 only continues an existing count).
      if (
        (key >= "1" && key <= "9") ||
        (key === "0" && motionCountStr.length > 0)
      ) {
        setPendingKeys(pending + key);
        return true;
      }

      // Doubled operator: dd/cc/yy (linewise)
      if (key === op) {
        const opState = { ...vim, count: effCount };
        if (op === "d") {
          const { text, blocks } = cmd.deleteBlock(bnEditor, opState);
          writeRegister(text, blocks, "linewise");
          vim = { ...vim, lastCommand: op + op };
        } else if (op === "c") {
          cmd.changeLine(view);
          vim = { ...vim, registerType: "linewise", lastCommand: "cc" };
          recordEdit({ type: "operator-line", operator: op, count: effCount });
          resetPending();
          setMode(view, "insert");
          return true;
        } else {
          const { text, blocks } = cmd.yankBlock(bnEditor, opState);
          writeRegister(text, blocks, "linewise");
          vim = { ...vim, lastCommand: "yy" };
        }
        recordEdit({ type: "operator-line", operator: op, count: effCount });
        resetPending();
        return true;
      }

      // Operator + find motion key (df, dt, dF, dT, cf, ct, etc.)
      // (motion count before find is uncommon and dropped here.)
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

      // Operator + direct motion (honors the effective count, e.g. d2w)
      if (MOTION_KEYS.has(key)) {
        applyOperatorMotion(view, op, key, undefined, effCount);
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
            range.to
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
      cmd.clampCursorToContent(view, view.state);
      resetPending();
      return true;
    }
    if (key === "j") {
      verticalGoal = cmd.moveVertical(view, bnEditor, vim, 1, verticalGoal);
      resetPending();
      return true;
    }
    if (key === "k") {
      verticalGoal = cmd.moveVertical(view, bnEditor, vim, -1, verticalGoal);
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
    if (key === "W") {
      cmd.moveWordForward(view, bnEditor, vim, true);
      resetPending();
      return true;
    }
    if (key === "B") {
      cmd.moveWordBackward(view, bnEditor, vim, true);
      resetPending();
      return true;
    }
    if (key === "E") {
      cmd.moveWordEnd(view, bnEditor, vim, true);
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
      cmd.clampCursorToContent(view, view.state);
      resetPending();
      return true;
    }
    if (key === "}") {
      cmd.moveParagraphForward(view, bnEditor, vim);
      resetPending();
      return true;
    }
    if (key === "{") {
      cmd.moveParagraphBackward(view, bnEditor, vim);
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
    if (key === "m") {
      setPendingKeys("m");
      return true;
    }
    if (key === "`" || key === "'") {
      setPendingKeys(key);
      return true;
    }
    if (key === '"') {
      setPendingKeys('"');
      return true;
    }

    // ── Editing commands ────────────────────────────────────────────
    if (key === "x") {
      cmd.deleteCharForward(view, vim);
      cmd.clampCursorToContent(view, view.state);
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
      cmd.clampCursorToContent(view, view.state);
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
    if (key === "Y") {
      // Y — yank line (alias for yy)
      const { text, blocks } = cmd.yankBlock(bnEditor, vim);
      writeRegister(text, blocks, "linewise");
      vim = { ...vim, lastCommand: "Y" };
      resetPending();
      return true;
    }
    if (key === "~") {
      cmd.toggleCase(view, vim);
      recordEdit({
        type: "simple",
        command: "~",
        count: Math.max(vim.count, 1),
      });
      resetPending();
      return true;
    }

    // ── Paste (register-aware: named / clipboard / unnamed) ─────────
    if (key === "p") {
      pasteFrom(view, "after");
      resetPending();
      return true;
    }
    if (key === "P") {
      pasteFrom(view, "before");
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
        new CustomEvent("vim:open-search", { bubbles: true })
      );
      resetPending();
      return true;
    }
    if (key === "n") {
      view.dom.dispatchEvent(
        new CustomEvent("vim:search-next", { bubbles: true })
      );
      resetPending();
      return true;
    }
    if (key === "N") {
      view.dom.dispatchEvent(
        new CustomEvent("vim:search-prev", { bubbles: true })
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

    // ── Visual mode ─────────────────────────────────────────────────
    if (key === "v") {
      resetPending();
      enterVisual(view, false);
      return true;
    }
    if (key === "V") {
      resetPending();
      enterVisual(view, true);
      return true;
    }

    // Unknown key — consume it to prevent text insertion in normal mode
    resetPending();
    return true;
  }

  // ─── Visual mode handler ──────────────────────────────────────────────

  /** Enter (or switch) visual mode, anchoring at the current cursor. */
  function enterVisual(view: EditorView, linewise: boolean) {
    const target: VimMode = linewise ? "visual-line" : "visual";
    if (vim.mode === target) {
      // Toggling the same visual mode exits to normal.
      setMode(view, "normal");
      return;
    }
    if (!isVisual(vim.mode)) {
      // Fresh entry from normal: anchor at the cursor.
      const from = view.state.selection.from;
      vim = { ...vim, visualAnchor: from };
      visualHead = from;
    }
    setMode(view, target); // preserves visualAnchor (target is a visual mode)
    renderVisualSelection(view);
  }

  /** Clamp a position to the end of its block's text content. */
  function clampToBlockEnd(view: EditorView, pos: number): number {
    const size = view.state.doc.content.size;
    const safe = Math.max(0, Math.min(pos, size));
    return Math.min(safe, view.state.doc.resolve(safe).end());
  }

  /** Re-render the visual selection (inclusive of both ends) as a PM range. */
  function renderVisualSelection(view: EditorView) {
    const doc = view.state.doc;
    const anchor = vim.visualAnchor;
    if (anchor === null || visualHead < 0) return;

    if (vim.mode === "visual-line") {
      const $a = doc.resolve(Math.min(anchor, doc.content.size));
      const $h = doc.resolve(Math.min(visualHead, doc.content.size));
      const lo = Math.min($a.start(), $h.start());
      const hi = Math.max($a.end(), $h.end());
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(doc, lo, hi))
          .scrollIntoView()
      );
      return;
    }

    const lo = Math.min(anchor, visualHead);
    const hi = Math.max(anchor, visualHead);
    const end = clampToBlockEnd(view, hi + 1); // inclusive of the char at hi
    view.dispatch(
      view.state.tr
        .setSelection(TextSelection.create(doc, lo, Math.max(lo, end)))
        .scrollIntoView()
    );
  }

  /** Run a motion, then re-extend the visual selection to the new head. */
  function visualMotionExtend(view: EditorView, runMotion: () => void) {
    // Collapse to the head so the motion computes from the moving end.
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, clampToBlockEnd(view, visualHead))
      )
    );
    runMotion();
    visualHead = view.state.selection.head;
    renderVisualSelection(view);
  }

  /** Apply d/c/y to the current visual selection. */
  function applyVisualOperator(view: EditorView, op: "d" | "c" | "y") {
    const doc = view.state.doc;
    const anchor = vim.visualAnchor;
    if (anchor === null) return;
    const lo = Math.min(anchor, visualHead);
    const hi = Math.max(anchor, visualHead);
    const $lo = doc.resolve(lo);
    const $hi = doc.resolve(hi);

    if (vim.mode === "visual-line" || $lo.parent !== $hi.parent) {
      const { text, blocks } = cmd.applyOperatorLinewise(
        view,
        bnEditor,
        op,
        lo,
        hi
      );
      writeRegister(text, blocks, "linewise");
    } else {
      const end = Math.min(hi + 1, $hi.end());
      const yanked = cmd.applyOperatorCharwise(view, op, lo, end);
      writeRegister(yanked, null, "charwise");
    }
  }

  /** Apply ~ / u / U case change to the visual selection (single block). */
  function applyVisualCase(
    view: EditorView,
    kind: "toggle" | "lower" | "upper"
  ) {
    const doc = view.state.doc;
    const anchor = vim.visualAnchor;
    if (anchor === null) return;
    const lo = Math.min(anchor, visualHead);
    const hi = Math.max(anchor, visualHead);
    const $lo = doc.resolve(lo);
    const $hi = doc.resolve(hi);
    if ($lo.parent !== $hi.parent) return; // multi-block case ops not supported
    const end = Math.min(hi + 1, $hi.end());
    if (lo >= end) return;

    const text = doc.textBetween(lo, end);
    const transformed = text
      .split("")
      .map((c) =>
        kind === "upper"
          ? c.toUpperCase()
          : kind === "lower"
            ? c.toLowerCase()
            : c === c.toLowerCase()
              ? c.toUpperCase()
              : c.toLowerCase()
      )
      .join("");
    let tr = view.state.tr.insertText(transformed, lo, end);
    tr = tr.setSelection(TextSelection.create(tr.doc, lo));
    view.dispatch(tr);
  }

  function handleVisualMode(view: EditorView, event: KeyboardEvent): boolean {
    event.preventDefault();
    const key = event.key;
    const pending = vim.pendingKeys;

    // ── Pending: f/F/t/T{char} — find char (extends selection) ──────
    if (
      pending === "f" ||
      pending === "F" ||
      pending === "t" ||
      pending === "T"
    ) {
      if (key.length === 1) {
        const isForward = pending === "f" || pending === "t";
        const isTo = pending === "t" || pending === "T";
        visualMotionExtend(view, () => {
          if (isForward) cmd.findCharForward(view, key, vim, isTo);
          else cmd.findCharBackward(view, key, vim, isTo);
        });
      }
      setPendingKeys("");
      vim = { ...vim, count: 0 };
      return true;
    }

    // ── Pending: i/a{object} — text object selection (viw, vi(, …) ──
    if (pending === "i" || pending === "a") {
      if (key.length === 1) {
        const range = cmd.textObjectRange(view, pending, key);
        if (range) {
          vim = { ...vim, visualAnchor: range.from };
          visualHead = Math.max(range.from, range.to - 1);
          renderVisualSelection(view);
        }
      }
      setPendingKeys("");
      return true;
    }

    // ── Pending: g{motion} ──────────────────────────────────────────
    if (pending === "g") {
      if (key === "g")
        visualMotionExtend(view, () => cmd.moveDocStart(bnEditor));
      setPendingKeys("");
      vim = { ...vim, count: 0 };
      return true;
    }

    // ── Exit / switch mode ──────────────────────────────────────────
    if (key === "Escape") {
      setMode(view, "normal");
      return true;
    }
    if (key === "v") {
      enterVisual(view, false);
      return true;
    }
    if (key === "V") {
      enterVisual(view, true);
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
      return true;
    }

    // ── o — swap the active end ─────────────────────────────────────
    if (key === "o") {
      const anchor = vim.visualAnchor;
      if (anchor !== null) {
        vim = { ...vim, visualAnchor: visualHead };
        visualHead = anchor;
        renderVisualSelection(view);
      }
      return true;
    }

    // ── Motions (extend the selection) ──────────────────────────────
    const motions: Record<string, (() => void) | undefined> = {
      h: () => cmd.moveLeft(view, bnEditor, vim),
      l: () => cmd.moveRight(view, bnEditor, vim),
      j: () => cmd.moveDown(view, bnEditor, vim),
      k: () => cmd.moveUp(view, bnEditor, vim),
      w: () => cmd.moveWordForward(view, bnEditor, vim),
      b: () => cmd.moveWordBackward(view, bnEditor, vim),
      e: () => cmd.moveWordEnd(view, bnEditor, vim),
      W: () => cmd.moveWordForward(view, bnEditor, vim, true),
      B: () => cmd.moveWordBackward(view, bnEditor, vim, true),
      E: () => cmd.moveWordEnd(view, bnEditor, vim, true),
      "0": () => cmd.moveLineStart(view),
      "^": () => cmd.moveFirstNonWhitespace(view),
      $: () => cmd.moveLineEnd(view),
      G: () => cmd.moveDocEnd(bnEditor),
    };
    const motion = motions[key];
    if (motion) {
      visualMotionExtend(view, motion);
      vim = { ...vim, count: 0, pendingKeys: "" };
      return true;
    }
    if (key === "g") {
      setPendingKeys("g");
      return true;
    }
    if (FIND_MOTION_KEYS.has(key)) {
      setPendingKeys(key);
      return true;
    }
    if (key === "i" || key === "a") {
      setPendingKeys(key);
      return true;
    }

    // ── Operators on the selection ──────────────────────────────────
    if (key === "d" || key === "x") {
      applyVisualOperator(view, "d");
      setMode(view, "normal");
      return true;
    }
    if (key === "y") {
      applyVisualOperator(view, "y");
      setMode(view, "normal");
      return true;
    }
    if (key === "c" || key === "s") {
      applyVisualOperator(view, "c");
      setMode(view, "insert");
      return true;
    }
    if (key === "~") {
      applyVisualCase(view, "toggle");
      setMode(view, "normal");
      return true;
    }
    if (key === "u") {
      applyVisualCase(view, "lower");
      setMode(view, "normal");
      return true;
    }
    if (key === "U") {
      applyVisualCase(view, "upper");
      setMode(view, "normal");
      return true;
    }

    // Unknown key — consume it.
    return true;
  }
}
