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
  _view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
): boolean {
  const count = Math.max(state.count, 1);
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
  }
  return true;
}

export function moveUp(
  _view: EditorView,
  bnEditor: BlockNoteEditor<any, any, any>,
  state: VimState,
): boolean {
  const count = Math.max(state.count, 1);
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
