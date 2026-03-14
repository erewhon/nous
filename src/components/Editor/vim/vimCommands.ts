/**
 * Vim command implementations operating on ProseMirror EditorView.
 *
 * Block-level operations (dd, yy, p, o/O) use BlockNote's editor API
 * while character/word motions use ProseMirror transactions directly.
 */
import type { EditorView } from "@tiptap/pm/view";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { undo as pmUndo, redo as pmRedo } from "@tiptap/pm/history";
import type { BlockNoteEditor } from "@blocknote/core";
import type { VimState } from "./vimTypes";

// ─── Character / word motions (ProseMirror level) ───────────────────────────

export function moveLeft(
  view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
): boolean {
  let remaining = Math.max(state.count, 1);

  for (let step = 0; step < remaining; step++) {
    const { from } = view.state.selection;
    const $pos = view.state.doc.resolve(from);
    if (from > $pos.start()) {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, from - 1),
        ),
      );
    } else {
      // At start of block — wrap to end of previous block
      const cursor = bnEditor.getTextCursorPosition();
      if (!cursor) break;
      const prev = bnEditor.getPrevBlock(cursor.block);
      if (!prev) break;
      bnEditor.setTextCursorPosition(prev.id, "end");
    }
  }
  return true;
}

export function moveRight(
  view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
): boolean {
  let remaining = Math.max(state.count, 1);

  for (let step = 0; step < remaining; step++) {
    const { from } = view.state.selection;
    const $pos = view.state.doc.resolve(from);
    if (from < $pos.end()) {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, from + 1),
        ),
      );
    } else {
      // At end of block — wrap to start of next block
      const cursor = bnEditor.getTextCursorPosition();
      if (!cursor) break;
      const next = bnEditor.getNextBlock(cursor.block);
      if (!next) break;
      bnEditor.setTextCursorPosition(next.id, "start");
    }
  }
  return true;
}

export function moveDown(
  view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
): boolean {
  const count = Math.max(state.count, 1);

  for (let i = 0; i < count; i++) {
    const { from } = view.state.selection;
    const coords = view.coordsAtPos(from);
    if (!coords) break;

    // Offset by half a line height to land solidly on the next visual line
    // (using just +1 lands at the boundary and snaps to end of current line)
    const lineHeight = coords.bottom - coords.top;
    const targetCoords = { left: coords.left, top: coords.bottom + Math.max(lineHeight * 0.5, 4) };
    const pos = view.posAtCoords(targetCoords);

    if (pos && pos.pos !== from) {
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, pos.pos))
          .scrollIntoView(),
      );
    } else {
      // At the bottom of the visible document — fall back to block-level
      const cursor = bnEditor.getTextCursorPosition();
      if (!cursor) break;
      const next = bnEditor.getNextBlock(cursor.block);
      if (!next) break;
      bnEditor.setTextCursorPosition(next.id, "start");
      // Scroll the newly focused block into view
      view.dispatch(view.state.tr.scrollIntoView());
    }
  }
  return true;
}

export function moveUp(
  view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
): boolean {
  const count = Math.max(state.count, 1);

  for (let i = 0; i < count; i++) {
    const { from } = view.state.selection;
    const coords = view.coordsAtPos(from);
    if (!coords) break;

    const lineHeight = coords.bottom - coords.top;
    const targetCoords = { left: coords.left, top: coords.top - Math.max(lineHeight * 0.5, 4) };
    const pos = view.posAtCoords(targetCoords);

    if (pos && pos.pos !== from) {
      view.dispatch(
        view.state.tr
          .setSelection(TextSelection.create(view.state.doc, pos.pos))
          .scrollIntoView(),
      );
    } else {
      // At the top of the visible document — fall back to block-level
      const cursor = bnEditor.getTextCursorPosition();
      if (!cursor) break;
      const prev = bnEditor.getPrevBlock(cursor.block);
      if (!prev) break;
      bnEditor.setTextCursorPosition(prev.id, "start");
      view.dispatch(view.state.tr.scrollIntoView());
    }
  }
  return true;
}

export function moveWordForward(
  view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
): boolean {
  let remaining = Math.max(state.count, 1);

  for (let step = 0; step < remaining; step++) {
    const { from } = view.state.selection;
    const $pos = view.state.doc.resolve(from);
    const textAfter = view.state.doc.textBetween(from, $pos.end());

    // Try to find a word boundary in the current block
    const match = textAfter.match(/^(\S*\s+|\S+)/);
    if (match && match[0].length < textAfter.length) {
      // Found a word boundary within this block
      const target = from + match[0].length;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, target),
        ),
      );
    } else {
      // At end of block text — jump to start of next block
      const cursor = bnEditor.getTextCursorPosition();
      if (!cursor) break;
      const next = bnEditor.getNextBlock(cursor.block);
      if (!next) break;
      bnEditor.setTextCursorPosition(next.id, "start");
    }
  }
  return true;
}

export function moveWordBackward(
  view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
): boolean {
  let remaining = Math.max(state.count, 1);

  for (let step = 0; step < remaining; step++) {
    const { from } = view.state.selection;
    const $pos = view.state.doc.resolve(from);
    const textBefore = view.state.doc.textBetween($pos.start(), from);

    if (textBefore.length > 0) {
      // Find previous word start within this block
      const match = textBefore.match(/(\s+\S*|\S+)$/);
      if (match) {
        const target = $pos.start() + textBefore.length - match[0].length;
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, target),
          ),
        );
      } else {
        // Move to block start
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, $pos.start()),
          ),
        );
      }
    } else {
      // Already at start of block — jump to end of previous block
      const cursor = bnEditor.getTextCursorPosition();
      if (!cursor) break;
      const prev = bnEditor.getPrevBlock(cursor.block);
      if (!prev) break;
      bnEditor.setTextCursorPosition(prev.id, "end");
      // After landing at end of prev block, continue the loop to find
      // the actual word start (b should land on word start, not end)
    }
  }
  return true;
}

export function moveWordEnd(
  view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
): boolean {
  let remaining = Math.max(state.count, 1);

  for (let step = 0; step < remaining; step++) {
    const { from } = view.state.selection;
    const $pos = view.state.doc.resolve(from);
    const textAfter = view.state.doc.textBetween(from, $pos.end());

    if (textAfter.length > 1) {
      // Skip current char, then find end of word
      const remaining2 = textAfter.slice(1);
      const match = remaining2.match(/^\s*\S*/);
      if (match && match[0].length > 0) {
        const target = from + 1 + match[0].length;
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, Math.min(target, $pos.end())),
          ),
        );
        continue;
      }
    }

    // At or near end of block — jump to next block and find first word end
    const cursor = bnEditor.getTextCursorPosition();
    if (!cursor) break;
    const next = bnEditor.getNextBlock(cursor.block);
    if (!next) break;
    bnEditor.setTextCursorPosition(next.id, "start");

    // Now find the end of the first word in the new block
    const newFrom = view.state.selection.from;
    const new$pos = view.state.doc.resolve(newFrom);
    const newText = view.state.doc.textBetween(newFrom, new$pos.end());
    const wordMatch = newText.match(/^\s*\S*/);
    if (wordMatch && wordMatch[0].length > 0) {
      const target = newFrom + wordMatch[0].length;
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(
            view.state.doc,
            Math.min(target, new$pos.end()),
          ),
        ),
      );
    }
  }
  return true;
}

export function moveLineStart(view: EditorView): boolean {
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const target = $pos.start();
  if (target !== from) {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, target)),
    );
  }
  return true;
}

export function moveFirstNonWhitespace(view: EditorView): boolean {
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const lineStart = $pos.start();
  const lineEnd = $pos.end();
  const text = view.state.doc.textBetween(lineStart, lineEnd);
  const match = text.match(/^\s*/);
  const offset = match ? match[0].length : 0;
  const target = lineStart + offset;
  if (target !== from) {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, target)),
    );
  }
  return true;
}

export function moveLineEnd(view: EditorView): boolean {
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const target = $pos.end();
  if (target !== from) {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, target)),
    );
  }
  return true;
}

export function moveDocStart(
  bnEditor: BlockNoteEditor<any, any, any>,
): boolean {
  const doc = bnEditor.document;
  if (doc.length > 0) {
    bnEditor.setTextCursorPosition(doc[0].id, "start");
  }
  return true;
}

export function moveDocEnd(
  bnEditor: BlockNoteEditor<any, any, any>,
): boolean {
  const doc = bnEditor.document;
  if (doc.length > 0) {
    bnEditor.setTextCursorPosition(doc[doc.length - 1].id, "start");
  }
  return true;
}

// ─── Block-level operations (BlockNote API) ─────────────────────────────────

export function deleteBlock(
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
): string {
  const cursor = bnEditor.getTextCursorPosition();
  if (!cursor) return state.register;

  const count = Math.max(state.count, 1);
  const blocks = [cursor.block];
  let block = cursor.block;
  for (let i = 1; i < count; i++) {
    const next = bnEditor.getNextBlock(block);
    if (!next) break;
    blocks.push(next);
    block = next;
  }

  const yanked = blocks
    .map((b) => {
      const content = b.content;
      if (Array.isArray(content)) {
        return content.map((c: any) => c.text ?? "").join("");
      }
      return "";
    })
    .join("\n");

  const nextBlock = bnEditor.getNextBlock(blocks[blocks.length - 1]);
  const prevBlock = bnEditor.getPrevBlock(blocks[0]);

  bnEditor.removeBlocks(blocks.map((b) => b.id));

  if (nextBlock) {
    bnEditor.setTextCursorPosition(nextBlock.id, "start");
  } else if (prevBlock) {
    bnEditor.setTextCursorPosition(prevBlock.id, "start");
  }

  return yanked;
}

export function yankBlock(
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
): string {
  const cursor = bnEditor.getTextCursorPosition();
  if (!cursor) return state.register;

  const count = Math.max(state.count, 1);
  const blocks = [cursor.block];
  let block = cursor.block;
  for (let i = 1; i < count; i++) {
    const next = bnEditor.getNextBlock(block);
    if (!next) break;
    blocks.push(next);
    block = next;
  }

  return blocks
    .map((b) => {
      const content = b.content;
      if (Array.isArray(content)) {
        return content.map((c: any) => c.text ?? "").join("");
      }
      return "";
    })
    .join("\n");
}

export function pasteBlock(
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
  placement: "before" | "after",
): boolean {
  if (!state.register) return true;

  const cursor = bnEditor.getTextCursorPosition();
  if (!cursor) return true;

  const lines = state.register.split("\n");
  const newBlocks = lines.map((line) => ({
    type: "paragraph" as const,
    content: line,
  }));

  bnEditor.insertBlocks(newBlocks, cursor.block.id, placement);

  const doc = bnEditor.document;
  const curIdx = doc.findIndex((b) => b.id === cursor.block.id);
  if (curIdx >= 0) {
    const targetIdx = placement === "after" ? curIdx + 1 : curIdx;
    if (targetIdx < doc.length) {
      bnEditor.setTextCursorPosition(doc[targetIdx].id, "start");
    }
  }

  return true;
}

export function openLine(
  bnEditor: BlockNoteEditor<any, any, any>,
  placement: "before" | "after",
): boolean {
  const cursor = bnEditor.getTextCursorPosition();
  if (!cursor) return false;

  const newBlock = { type: "paragraph" as const, content: "" };
  bnEditor.insertBlocks([newBlock], cursor.block.id, placement);

  const doc = bnEditor.document;
  const curIdx = doc.findIndex((b) => b.id === cursor.block.id);
  if (curIdx >= 0) {
    const targetIdx = placement === "after" ? curIdx + 1 : curIdx;
    if (targetIdx >= 0 && targetIdx < doc.length) {
      bnEditor.setTextCursorPosition(doc[targetIdx].id, "start");
    }
  }

  return true;
}

// ─── Editing commands ───────────────────────────────────────────────────────

export function deleteCharForward(
  view: EditorView,
  state: VimState,
): boolean {
  const count = Math.max(state.count, 1);
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const end = Math.min(from + count, $pos.end());
  if (from < end) {
    view.dispatch(view.state.tr.delete(from, end));
  }
  return true;
}

export function deleteCharBackward(
  view: EditorView,
  state: VimState,
): boolean {
  const count = Math.max(state.count, 1);
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const start = Math.max(from - count, $pos.start());
  if (start < from) {
    view.dispatch(view.state.tr.delete(start, from));
  }
  return true;
}

export function replaceChar(view: EditorView, char: string): boolean {
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const end = Math.min(from + 1, $pos.end());
  if (from < end) {
    view.dispatch(view.state.tr.delete(from, end).insertText(char, from));
  }
  return true;
}

export function deleteToLineEnd(view: EditorView): boolean {
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const end = $pos.end();
  if (from < end) {
    view.dispatch(view.state.tr.delete(from, end));
  }
  return true;
}

export function changeToLineEnd(view: EditorView): boolean {
  deleteToLineEnd(view);
  return true;
}

export function changeLine(view: EditorView): boolean {
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const start = $pos.start();
  const end = $pos.end();
  if (start < end) {
    view.dispatch(view.state.tr.delete(start, end));
  } else {
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, start)),
    );
  }
  return true;
}

export function joinLines(
  bnEditor: BlockNoteEditor<any, any, any>,
): boolean {
  const cursor = bnEditor.getTextCursorPosition();
  if (!cursor) return false;

  const nextBlock = bnEditor.getNextBlock(cursor.block);
  if (!nextBlock) return true;

  // Get text content of the next block
  const nextContent = nextBlock.content;
  let nextText = "";
  if (Array.isArray(nextContent)) {
    nextText = nextContent.map((c: any) => c.text ?? "").join("");
  }

  // Get current block text content
  const curContent = cursor.block.content;
  let curText = "";
  if (Array.isArray(curContent)) {
    curText = curContent.map((c: any) => c.text ?? "").join("");
  }

  // Update current block with joined content and remove next block
  const joined = curText + (nextText ? " " + nextText : "");
  bnEditor.updateBlock(cursor.block.id, {
    content: joined,
  });
  bnEditor.removeBlocks([nextBlock.id]);

  return true;
}

// ─── Find character motions (f/F/t/T) ───────────────────────────────────────

export function findCharForward(
  view: EditorView,
  char: string,
  state: VimState,
  toMode: boolean,
): boolean {
  const count = Math.max(state.count, 1);
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const end = $pos.end();
  if (from + 1 >= end) return true;
  const text = view.state.doc.textBetween(from + 1, end);

  let offset = 0;
  let found = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === char) {
      found++;
      if (found === count) {
        offset = i + 1;
        break;
      }
    }
  }

  if (found >= count) {
    let target = from + offset;
    if (toMode) target--;
    if (target !== from) {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, target),
        ),
      );
    }
  }
  return true;
}

export function findCharBackward(
  view: EditorView,
  char: string,
  state: VimState,
  toMode: boolean,
): boolean {
  const count = Math.max(state.count, 1);
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const start = $pos.start();
  if (start >= from) return true;
  const text = view.state.doc.textBetween(start, from);

  let found = 0;
  let offset = text.length;
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === char) {
      found++;
      if (found === count) {
        offset = i;
        break;
      }
    }
  }

  if (found >= count) {
    let target = start + offset;
    if (toMode) target++;
    if (target !== from) {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.create(view.state.doc, target),
        ),
      );
    }
  }
  return true;
}

export function repeatFind(view: EditorView, state: VimState): boolean {
  if (!state.lastFindChar) return true;
  const toMode = state.lastFindType === "to";
  if (state.lastFindDirection === "forward") {
    return findCharForward(view, state.lastFindChar, state, toMode);
  }
  return findCharBackward(view, state.lastFindChar, state, toMode);
}

export function repeatFindReverse(view: EditorView, state: VimState): boolean {
  if (!state.lastFindChar) return true;
  const toMode = state.lastFindType === "to";
  if (state.lastFindDirection === "forward") {
    return findCharBackward(view, state.lastFindChar, state, toMode);
  }
  return findCharForward(view, state.lastFindChar, state, toMode);
}

// ─── Undo/Redo ──────────────────────────────────────────────────────────────

export function undo(view: EditorView): boolean {
  return pmUndo(view.state, view.dispatch);
}

export function redo(view: EditorView): boolean {
  return pmRedo(view.state, view.dispatch);
}

// ─── Helper: clamp cursor to end of text node in normal mode ────────────────

export function clampCursorToContent(
  view: EditorView,
  _state: EditorState,
): void {
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const end = $pos.end();
  // In normal mode the cursor should not sit past the last character
  if (from > $pos.start() && from >= end && end > $pos.start()) {
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, end - 1),
      ),
    );
  }
}

// ─── Motion result system for operator+motion combos ─────────────────────────

export interface MotionResult {
  from: number;
  to: number;
  linewise: boolean;
}

/** Set of motions that are characterwise (not linewise). */
const CHARWISE_MOTIONS = new Set([
  "w",
  "b",
  "e",
  "h",
  "l",
  "0",
  "^",
  "$",
  "f",
  "F",
  "t",
  "T",
]);

/**
 * Execute a motion and return the range it covers.
 * The cursor is moved as a side effect, then we compute from/to.
 */
export function executeMotion(
  view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
  motionKey: string,
  motionArg?: string,
): MotionResult | null {
  const before = view.state.selection.from;

  // Execute the motion
  switch (motionKey) {
    case "w":
      moveWordForward(view, bnEditor, state);
      break;
    case "b":
      moveWordBackward(view, bnEditor, state);
      break;
    case "e":
      moveWordEnd(view, bnEditor, state);
      break;
    case "h":
      moveLeft(view, bnEditor, state);
      break;
    case "l":
      moveRight(view, bnEditor, state);
      break;
    case "0":
      moveLineStart(view);
      break;
    case "^":
      moveFirstNonWhitespace(view);
      break;
    case "$":
      moveLineEnd(view);
      break;
    case "j":
      moveDown(view, bnEditor, state);
      break;
    case "k":
      moveUp(view, bnEditor, state);
      break;
    case "G":
      if (state.count > 0) {
        const doc = bnEditor.document;
        const idx = Math.min(state.count - 1, doc.length - 1);
        if (idx >= 0 && doc[idx]) {
          bnEditor.setTextCursorPosition(doc[idx].id, "start");
        }
      } else {
        moveDocEnd(bnEditor);
      }
      break;
    case "gg":
      moveDocStart(bnEditor);
      break;
    case "f":
      if (motionArg) findCharForward(view, motionArg, state, false);
      break;
    case "F":
      if (motionArg) findCharBackward(view, motionArg, state, false);
      break;
    case "t":
      if (motionArg) findCharForward(view, motionArg, state, true);
      break;
    case "T":
      if (motionArg) findCharBackward(view, motionArg, state, true);
      break;
    default:
      return null;
  }

  const after = view.state.selection.from;
  if (after === before && motionKey !== "0" && motionKey !== "^") return null;

  const linewise = !CHARWISE_MOTIONS.has(motionKey);

  // For 'e' motion (inclusive): extend to include the character at cursor
  let to = after;
  if (motionKey === "e" && after > before) {
    to = after + 1;
    // Clamp to block end
    const $pos = view.state.doc.resolve(after);
    to = Math.min(to, $pos.end());
  }

  return { from: before, to, linewise };
}

// ─── Operator application ────────────────────────────────────────────────────

/**
 * Apply an operator to a charwise range within the current block's text node.
 * Returns the yanked text.
 */
export function applyOperatorCharwise(
  view: EditorView,
  operator: "d" | "c" | "y",
  from: number,
  to: number,
): string {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);

  // Clamp to the same text node (block)
  const $lo = view.state.doc.resolve(lo);
  const blockStart = $lo.start();
  const blockEnd = $lo.end();
  const clampedLo = Math.max(lo, blockStart);
  const clampedHi = Math.min(hi, blockEnd);

  if (clampedLo >= clampedHi) return "";

  const yanked = view.state.doc.textBetween(clampedLo, clampedHi);

  if (operator === "d" || operator === "c") {
    view.dispatch(view.state.tr.delete(clampedLo, clampedHi));
  } else {
    // yank — restore cursor to original position
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, from),
      ),
    );
  }

  return yanked;
}

/**
 * Apply a linewise operator using BlockNote API.
 * Operates on blocks between the cursor's original block and the motion target.
 * Returns the yanked text.
 */
export function applyOperatorLinewise(
  view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  operator: "d" | "c" | "y",
  fromPos: number,
  toPos: number,
): string {
  // Find the blocks that span from fromPos to toPos
  const doc = bnEditor.document;

  // Find block containing fromPos and block containing toPos
  const fromBlock = bnEditor.getTextCursorPosition()?.block;
  if (!fromBlock) return "";

  // For linewise, we need to figure out which blocks are in range
  // Move cursor back to fromPos to find the original block
  try {
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, fromPos),
      ),
    );
  } catch {
    // Position may be invalid after motion
  }

  const startCursor = bnEditor.getTextCursorPosition();
  if (!startCursor) return "";
  const startBlock = startCursor.block;

  // Move to toPos to find end block
  try {
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, toPos),
      ),
    );
  } catch {
    // Position may be invalid
  }

  const endCursor = bnEditor.getTextCursorPosition();
  if (!endCursor) return "";
  const endBlock = endCursor.block;

  // Collect blocks from start to end
  const startIdx = doc.findIndex((b) => b.id === startBlock.id);
  const endIdx = doc.findIndex((b) => b.id === endBlock.id);
  if (startIdx < 0 || endIdx < 0) return "";

  const lo = Math.min(startIdx, endIdx);
  const hi = Math.max(startIdx, endIdx);
  const blocks = doc.slice(lo, hi + 1);

  const yanked = blocks
    .map((b) => {
      const content = b.content;
      if (Array.isArray(content)) {
        return content.map((c: any) => c.text ?? "").join("");
      }
      return "";
    })
    .join("\n");

  if (operator === "d") {
    const nextBlock = hi + 1 < doc.length ? doc[hi + 1] : null;
    const prevBlock = lo > 0 ? doc[lo - 1] : null;
    bnEditor.removeBlocks(blocks.map((b) => b.id));
    if (nextBlock) {
      bnEditor.setTextCursorPosition(nextBlock.id, "start");
    } else if (prevBlock) {
      bnEditor.setTextCursorPosition(prevBlock.id, "start");
    }
  } else if (operator === "c") {
    // Clear first block, remove rest
    if (blocks.length > 1) {
      bnEditor.removeBlocks(blocks.slice(1).map((b) => b.id));
    }
    bnEditor.updateBlock(blocks[0].id, { content: "" });
    bnEditor.setTextCursorPosition(blocks[0].id, "start");
  } else {
    // yank — restore cursor
    bnEditor.setTextCursorPosition(startBlock.id, "start");
  }

  return yanked;
}

// ─── Inline paste (charwise) ─────────────────────────────────────────────────

export function pasteInline(
  view: EditorView,
  register: string,
  after: boolean,
): boolean {
  if (!register) return true;

  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const insertPos = after ? Math.min(from + 1, $pos.end()) : from;

  view.dispatch(view.state.tr.insertText(register, insertPos));
  // Place cursor at end of pasted text minus 1 (vim convention)
  const endPos = insertPos + register.length - 1;
  view.dispatch(
    view.state.tr.setSelection(
      TextSelection.create(view.state.doc, Math.max(insertPos, endPos)),
    ),
  );

  return true;
}

// ─── Bracket matching (%) ────────────────────────────────────────────────────

const BRACKET_PAIRS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  ")": "(",
  "]": "[",
  "}": "{",
};
const OPEN_BRACKETS = new Set(["(", "[", "{"]);

export function matchBracket(view: EditorView): boolean {
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const blockStart = $pos.start();
  const blockEnd = $pos.end();
  const text = view.state.doc.textBetween(blockStart, blockEnd);
  const cursorOffset = from - blockStart;

  if (cursorOffset >= text.length) return true;

  const ch = text[cursorOffset];
  const match = BRACKET_PAIRS[ch];
  if (!match) return true;

  if (OPEN_BRACKETS.has(ch)) {
    // Scan forward
    let depth = 1;
    for (let i = cursorOffset + 1; i < text.length; i++) {
      if (text[i] === ch) depth++;
      if (text[i] === match) depth--;
      if (depth === 0) {
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, blockStart + i),
          ),
        );
        return true;
      }
    }
  } else {
    // Scan backward
    let depth = 1;
    for (let i = cursorOffset - 1; i >= 0; i--) {
      if (text[i] === ch) depth++;
      if (text[i] === match) depth--;
      if (depth === 0) {
        view.dispatch(
          view.state.tr.setSelection(
            TextSelection.create(view.state.doc, blockStart + i),
          ),
        );
        return true;
      }
    }
  }

  return true;
}

// ─── Half-page scroll (Ctrl+D / Ctrl+U) ─────────────────────────────────────

export function scrollHalfPageDown(
  view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  count: number = 15,
): boolean {
  const cursor = bnEditor.getTextCursorPosition();
  if (!cursor) return false;

  let block = cursor.block;
  for (let i = 0; i < count; i++) {
    const next = bnEditor.getNextBlock(block);
    if (!next) break;
    block = next;
  }

  if (block.id !== cursor.block.id) {
    bnEditor.setTextCursorPosition(block.id, "start");
    view.dispatch(view.state.tr.scrollIntoView());
  }
  return true;
}

export function scrollHalfPageUp(
  view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  count: number = 15,
): boolean {
  const cursor = bnEditor.getTextCursorPosition();
  if (!cursor) return false;

  let block = cursor.block;
  for (let i = 0; i < count; i++) {
    const prev = bnEditor.getPrevBlock(block);
    if (!prev) break;
    block = prev;
  }

  if (block.id !== cursor.block.id) {
    bnEditor.setTextCursorPosition(block.id, "start");
    view.dispatch(view.state.tr.scrollIntoView());
  }
  return true;
}

// ─── Text objects (iw, aw, i", a", i(, a(, etc.) ─────────────────────────────

/** Characters that count as "word" characters (same as \w). */
function isWordChar(ch: string): boolean {
  return /\w/.test(ch);
}

/**
 * Find the range of a text object.
 * Returns { from, to } in document positions, or null if not found.
 */
export function textObjectRange(
  view: EditorView,
  kind: "i" | "a",
  object: string,
): MotionResult | null {
  const { from } = view.state.selection;
  const $pos = view.state.doc.resolve(from);
  const blockStart = $pos.start();
  const blockEnd = $pos.end();
  const text = view.state.doc.textBetween(blockStart, blockEnd);
  const offset = from - blockStart;

  // Word text objects: iw, aw
  if (object === "w" || object === "W") {
    return wordTextObject(text, offset, blockStart, kind);
  }

  // Bracket/paren text objects
  const bracketPairs: Record<string, [string, string]> = {
    "(": ["(", ")"],
    ")": ["(", ")"],
    "b": ["(", ")"],
    "{": ["{", "}"],
    "}": ["{", "}"],
    "B": ["{", "}"],
    "[": ["[", "]"],
    "]": ["[", "]"],
    "<": ["<", ">"],
    ">": ["<", ">"],
  };
  if (bracketPairs[object]) {
    const [open, close] = bracketPairs[object];
    return bracketTextObject(text, offset, blockStart, kind, open, close);
  }

  // Quote text objects: i", a", i', a', i`, a`
  if (object === '"' || object === "'" || object === "`") {
    return quoteTextObject(text, offset, blockStart, kind, object);
  }

  return null;
}

function wordTextObject(
  text: string,
  offset: number,
  blockStart: number,
  kind: "i" | "a",
): MotionResult | null {
  if (text.length === 0) return null;
  const clamped = Math.min(offset, text.length - 1);

  // Find word boundaries around cursor
  let wordStart = clamped;
  let wordEnd = clamped;

  const cursorOnWord = isWordChar(text[clamped]);

  if (cursorOnWord) {
    while (wordStart > 0 && isWordChar(text[wordStart - 1])) wordStart--;
    while (wordEnd < text.length - 1 && isWordChar(text[wordEnd + 1])) wordEnd++;
    wordEnd++; // exclusive end
  } else {
    // Cursor on whitespace/punctuation — select the whitespace run
    const cursorIsSpace = /\s/.test(text[clamped]);
    if (cursorIsSpace) {
      while (wordStart > 0 && /\s/.test(text[wordStart - 1])) wordStart--;
      while (wordEnd < text.length - 1 && /\s/.test(text[wordEnd + 1])) wordEnd++;
      wordEnd++;
    } else {
      // Non-word, non-space (punctuation)
      while (wordStart > 0 && !isWordChar(text[wordStart - 1]) && !/\s/.test(text[wordStart - 1])) wordStart--;
      while (wordEnd < text.length - 1 && !isWordChar(text[wordEnd + 1]) && !/\s/.test(text[wordEnd + 1])) wordEnd++;
      wordEnd++;
    }
  }

  if (kind === "a") {
    // Include trailing whitespace, or leading if no trailing
    if (wordEnd < text.length && /\s/.test(text[wordEnd])) {
      while (wordEnd < text.length && /\s/.test(text[wordEnd])) wordEnd++;
    } else if (wordStart > 0 && /\s/.test(text[wordStart - 1])) {
      while (wordStart > 0 && /\s/.test(text[wordStart - 1])) wordStart--;
    }
  }

  return {
    from: blockStart + wordStart,
    to: blockStart + wordEnd,
    linewise: false,
  };
}

function bracketTextObject(
  text: string,
  offset: number,
  blockStart: number,
  kind: "i" | "a",
  open: string,
  close: string,
): MotionResult | null {
  // Find matching brackets around cursor
  let openPos = -1;
  let closePos = -1;

  // Search backward for opening bracket
  let depth = 0;
  for (let i = offset; i >= 0; i--) {
    if (text[i] === close && i !== offset) depth++;
    if (text[i] === open) {
      if (depth === 0) {
        openPos = i;
        break;
      }
      depth--;
    }
  }

  if (openPos < 0) return null;

  // Search forward for closing bracket from the opening bracket
  depth = 0;
  for (let i = openPos; i < text.length; i++) {
    if (text[i] === open && i !== openPos) depth++;
    if (text[i] === close) {
      if (depth === 0) {
        closePos = i;
        break;
      }
      depth--;
    }
  }

  if (closePos < 0) return null;

  if (kind === "i") {
    return {
      from: blockStart + openPos + 1,
      to: blockStart + closePos,
      linewise: false,
    };
  }
  return {
    from: blockStart + openPos,
    to: blockStart + closePos + 1,
    linewise: false,
  };
}

function quoteTextObject(
  text: string,
  offset: number,
  blockStart: number,
  kind: "i" | "a",
  quote: string,
): MotionResult | null {
  // Find quote boundaries — collect all quote positions and find the pair around cursor
  const positions: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === quote && (i === 0 || text[i - 1] !== "\\")) {
      positions.push(i);
    }
  }

  // Find the pair of quotes that contain the cursor
  for (let i = 0; i < positions.length - 1; i += 2) {
    const start = positions[i];
    const end = positions[i + 1];
    if (offset >= start && offset <= end) {
      if (kind === "i") {
        return {
          from: blockStart + start + 1,
          to: blockStart + end,
          linewise: false,
        };
      }
      return {
        from: blockStart + start,
        to: blockStart + end + 1,
        linewise: false,
      };
    }
  }

  return null;
}
