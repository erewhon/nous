import { useEffect, useRef, useCallback, useState } from "react";
import type EditorJS from "@editorjs/editorjs";

export type VimMode = "normal" | "insert" | "visual";

interface UseVimModeOptions {
  enabled: boolean;
  editorRef: React.MutableRefObject<EditorJS | null>;
  containerRef: React.RefObject<HTMLElement>;
  onModeChange?: (mode: VimMode) => void;
}

interface VimState {
  mode: VimMode;
  pendingKeys: string;
  count: number;
  lastCommand: string;
  register: string; // For yank/paste
  lastFindChar: string; // For f/F/t/T repeat with ; and ,
  lastFindDirection: "forward" | "backward";
  lastFindType: "to" | "find"; // t/T vs f/F
  visualAnchor: number | null; // Start position for visual mode
}

/**
 * Custom hook that adds VI keybindings to Editor.js
 *
 * Supported commands:
 *
 * Normal Mode Navigation:
 * - h, j, k, l: Basic movement (left, down, up, right)
 * - w, W: Word/WORD forward
 * - b, B: Word/WORD backward
 * - e, E: End of word/WORD
 * - 0, ^: Line start / first non-blank
 * - $: Line end
 * - gg, G: Document start/end
 * - H, M, L: High/Middle/Low of visible blocks
 * - f{char}, F{char}: Find character forward/backward
 * - t{char}, T{char}: To character forward/backward (before char)
 * - ;, ,: Repeat last f/F/t/T forward/backward
 * - n, N: Repeat last search forward/backward (placeholder)
 *
 * Normal Mode Editing:
 * - i, a: Insert at cursor / after cursor
 * - I, A: Insert at line start / line end
 * - o, O: Open line below/above
 * - r{char}: Replace single character
 * - R: Replace mode (continuous replace)
 * - x, X: Delete char under/before cursor
 * - s, S: Substitute char/line
 * - D, C: Delete/Change to end of line
 * - dd: Delete current block
 * - cc: Change current block
 * - yy, Y: Yank current block
 * - p, P: Paste after/before
 * - J: Join lines
 * - u: Undo
 * - Ctrl+r: Redo
 * - ~: Toggle case of character
 * - .: Repeat last command (placeholder)
 *
 * Visual Mode:
 * - v: Enter visual mode
 * - V: Enter visual line mode
 * - Escape: Exit visual mode
 * - d, x: Delete selection
 * - y: Yank selection
 * - c, s: Change selection
 *
 * Insert Mode:
 * - Escape, Ctrl+[, jj: Exit to normal mode
 * - Ctrl+w: Delete word backward
 * - Ctrl+u: Delete to line start
 *
 * Other:
 * - /: Focus search
 * - ZZ: Save and close (placeholder)
 * - ZQ: Close without saving (placeholder)
 */
export function useVimMode({
  enabled,
  editorRef,
  containerRef,
  onModeChange,
}: UseVimModeOptions) {
  const [vimState, setVimState] = useState<VimState>({
    mode: "normal",
    pendingKeys: "",
    count: 0,
    lastCommand: "",
    register: "",
    lastFindChar: "",
    lastFindDirection: "forward",
    lastFindType: "find",
    visualAnchor: null,
  });

  const stateRef = useRef(vimState);
  stateRef.current = vimState;

  // Get current block index
  const getCurrentBlockIndex = useCallback((): number => {
    const editor = editorRef.current;
    if (!editor) return -1;

    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return -1;

    // Find the block element containing the selection
    let node: Node | null = selection.anchorNode;
    while (node && node !== containerRef.current) {
      if (node instanceof HTMLElement && node.classList.contains("ce-block")) {
        const blocks = containerRef.current?.querySelectorAll(".ce-block");
        if (blocks) {
          return Array.from(blocks).indexOf(node);
        }
      }
      node = node.parentNode;
    }
    return 0;
  }, [editorRef, containerRef]);

  // Check if cursor is inside a checklist/list block and get list info
  // Supports both custom ChecklistTool (.cdx-checklist__item) and
  // built-in List tool (.cdx-list__item, .cdx-nested-list__item)
  const getChecklistInfo = useCallback((): {
    isInChecklist: boolean;
    checklistContainer: HTMLElement | null;
    currentItemIndex: number;
    items: HTMLElement[];
    itemSelector: string;
    textSelector: string;
  } => {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) {
      return { isInChecklist: false, checklistContainer: null, currentItemIndex: -1, items: [], itemSelector: "", textSelector: "" };
    }

    // Find if we're in a list/checklist item by looking for known item classes
    // Use closest() for more reliable detection from text nodes
    let element: HTMLElement | null = null;
    if (selection.anchorNode instanceof HTMLElement) {
      element = selection.anchorNode;
    } else if (selection.anchorNode.parentElement) {
      element = selection.anchorNode.parentElement;
    }

    if (!element) {
      return { isInChecklist: false, checklistContainer: null, currentItemIndex: -1, items: [], itemSelector: "", textSelector: "" };
    }

    // Try to find list item using closest() - more reliable than walking
    let listItem: HTMLElement | null = null;
    let itemSelector = "";
    let textSelector = "";

    // Custom ChecklistTool
    listItem = element.closest(".cdx-checklist__item");
    if (listItem) {
      itemSelector = ".cdx-checklist__item";
      textSelector = ".cdx-checklist__item-text";
    }

    // Built-in List tool
    if (!listItem) {
      listItem = element.closest(".cdx-list__item");
      if (listItem) {
        itemSelector = ".cdx-list__item";
        textSelector = ".cdx-list__item-content";
      }
    }

    // Nested list tool
    if (!listItem) {
      listItem = element.closest(".cdx-nested-list__item");
      if (listItem) {
        itemSelector = ".cdx-nested-list__item";
        textSelector = ".cdx-nested-list__item-content";
      }
    }

    if (!listItem || !itemSelector) {
      return { isInChecklist: false, checklistContainer: null, currentItemIndex: -1, items: [], itemSelector: "", textSelector: "" };
    }

    // Get sibling items (items at the same level)
    const parentContainer = listItem.parentElement;
    if (!parentContainer) {
      return { isInChecklist: false, checklistContainer: null, currentItemIndex: -1, items: [], itemSelector: "", textSelector: "" };
    }

    // Get all sibling items of the same type - use children filtering which is more reliable
    const items = Array.from(parentContainer.children).filter(
      (el) => el.classList.contains(itemSelector.slice(1)) // Remove leading "."
    ) as HTMLElement[];

    if (items.length === 0) {
      return { isInChecklist: false, checklistContainer: null, currentItemIndex: -1, items: [], itemSelector: "", textSelector: "" };
    }

    const currentItemIndex = items.indexOf(listItem);

    return { isInChecklist: true, checklistContainer: parentContainer, currentItemIndex, items, itemSelector, textSelector };
  }, []);

  // Focus a specific checklist/list item
  const focusChecklistItem = useCallback((items: HTMLElement[], index: number, textSelector?: string) => {
    if (index < 0 || index >= items.length) return;

    const item = items[index];
    // Try multiple possible text element selectors
    const selectors = textSelector
      ? [textSelector, "[contenteditable='true']"]
      : [".cdx-checklist__item-text", ".cdx-list__item-content", ".cdx-nested-list__item-content", "[contenteditable='true']"];

    let textEl: HTMLElement | null = null;
    for (const sel of selectors) {
      textEl = item.querySelector(sel) as HTMLElement;
      if (textEl) break;
    }

    if (textEl) {
      textEl.focus();
      // Place cursor at end
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(textEl);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, []);

  // Delete a specific checklist/list item (returns true if item was deleted)
  // Uses Editor.js block API instead of direct DOM removal to avoid
  // WebKitGTK rendering freezes from DOM mutations inside contenteditable.
  const deleteChecklistItem = useCallback(async (
    _checklistContainer: HTMLElement,
    items: HTMLElement[],
    itemIndex: number,
    _itemSelector: string,
    textSelector: string
  ): Promise<boolean> => {
    if (items.length <= 1) {
      // Don't delete the last item - delete the whole block instead
      return false;
    }

    const editor = editorRef.current;
    if (!editor) return false;

    // Save item text to register before deleting
    const itemToDelete = items[itemIndex];
    const textEl = itemToDelete.querySelector(textSelector) || itemToDelete.querySelector("[contenteditable='true']");
    const itemText = textEl?.textContent || "";
    setVimState((s) => ({
      ...s,
      register: itemText,
    }));

    // Get the block index and save editor data
    const blockIndex = getCurrentBlockIndex();
    if (blockIndex < 0) return false;

    const data = await editor.save();
    const block = data.blocks[blockIndex];
    if (!block) return false;

    // Remove the item from the block data based on block type
    let updated = false;
    if (block.type === "checklist" && Array.isArray(block.data.items)) {
      // Custom ChecklistTool: { items: [{ text, checked }] }
      if (itemIndex < block.data.items.length) {
        block.data.items.splice(itemIndex, 1);
        updated = true;
      }
    } else if (block.type === "list" && Array.isArray(block.data.items)) {
      // @editorjs/list: { items: [{ content, meta, items }] }
      if (itemIndex < block.data.items.length) {
        block.data.items.splice(itemIndex, 1);
        updated = true;
      }
    }

    if (!updated) return false;

    // Update the block through Editor.js API (safe re-render, no direct DOM mutation)
    editor.blocks.update(block.id!, block.data);

    // Focus the appropriate item after re-render
    const focusIndex = itemIndex > 0 ? itemIndex - 1 : 0;
    setTimeout(() => {
      const holder = containerRef.current;
      if (!holder) return;
      const blockEl = holder.querySelectorAll(".ce-block")[blockIndex] as HTMLElement;
      if (!blockEl) return;
      const newItems = Array.from(blockEl.querySelectorAll(
        ".cdx-checklist__item, .cdx-list__item, .cdx-nested-list__item"
      )) as HTMLElement[];
      if (newItems.length > 0) {
        focusChecklistItem(newItems, Math.min(focusIndex, newItems.length - 1), textSelector);
      }
    }, 50);

    return true;
  }, [editorRef, containerRef, getCurrentBlockIndex, focusChecklistItem]);

  // Focus a block by index
  const focusBlock = useCallback(
    (index: number) => {
      const blocks = containerRef.current?.querySelectorAll(".ce-block");
      if (!blocks || index < 0 || index >= blocks.length) return;

      const block = blocks[index] as HTMLElement;
      const editable = block.querySelector(
        '[contenteditable="true"]'
      ) as HTMLElement;
      if (editable) {
        editable.focus();
        // Place cursor at end
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(editable);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    },
    [containerRef]
  );

  // Move cursor within text
  const moveCursor = useCallback((direction: "left" | "right" | "start" | "end") => {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return;

    const range = selection.getRangeAt(0);

    if (direction === "left") {
      if (range.startOffset > 0) {
        range.setStart(range.startContainer, range.startOffset - 1);
        range.collapse(true);
      }
    } else if (direction === "right") {
      const textLength = range.startContainer.textContent?.length || 0;
      if (range.startOffset < textLength) {
        range.setStart(range.startContainer, range.startOffset + 1);
        range.collapse(true);
      }
    } else if (direction === "start") {
      range.setStart(range.startContainer, 0);
      range.collapse(true);
    } else if (direction === "end") {
      const textLength = range.startContainer.textContent?.length || 0;
      range.setStart(range.startContainer, textLength);
      range.collapse(true);
    }

    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  // Move by WORD (whitespace delimited)
  const moveByWORD = useCallback((direction: "forward" | "backward" | "end") => {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return;

    const text = selection.anchorNode.textContent || "";
    const range = selection.getRangeAt(0);
    let pos = range.startOffset;

    if (direction === "forward") {
      // Find next WORD boundary (whitespace separated)
      const remaining = text.slice(pos);
      const match = remaining.match(/^\s*\S+/);
      if (match) {
        pos += match[0].length;
        // Position at start of next WORD
        const afterMatch = text.slice(pos).match(/^\s*/);
        if (afterMatch && afterMatch[0].length > 0) {
          pos += afterMatch[0].length;
        }
      } else {
        pos = text.length;
      }
    } else if (direction === "backward") {
      // Find previous WORD boundary
      const before = text.slice(0, pos);
      const match = before.match(/\S+\s*$/);
      if (match) {
        pos -= match[0].length;
      } else {
        pos = 0;
      }
    } else if (direction === "end") {
      // Move to end of current/next WORD
      const remaining = text.slice(pos);
      // Skip current word if at start, then find end of next word
      const match = remaining.match(/^\s*\S+/);
      if (match) {
        pos += match[0].length - 1; // -1 to be on last char
        if (pos < range.startOffset) pos = range.startOffset; // Don't go backward
      }
    }

    range.setStart(range.startContainer, Math.max(0, Math.min(pos, text.length)));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  // Find character in line (f/F/t/T commands)
  const findChar = useCallback((
    char: string,
    direction: "forward" | "backward",
    type: "find" | "to"
  ): boolean => {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return false;

    const text = selection.anchorNode.textContent || "";
    const range = selection.getRangeAt(0);
    const pos = range.startOffset;
    let targetPos = -1;

    if (direction === "forward") {
      const searchStart = pos + 1;
      const idx = text.indexOf(char, searchStart);
      if (idx !== -1) {
        targetPos = type === "to" ? idx - 1 : idx;
      }
    } else {
      const searchText = text.slice(0, pos);
      const idx = searchText.lastIndexOf(char);
      if (idx !== -1) {
        targetPos = type === "to" ? idx + 1 : idx;
      }
    }

    if (targetPos >= 0 && targetPos <= text.length) {
      range.setStart(range.startContainer, targetPos);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    return false;
  }, []);

  // Move by word
  const moveByWord = useCallback((direction: "forward" | "backward") => {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return;

    const text = selection.anchorNode.textContent || "";
    const range = selection.getRangeAt(0);
    let pos = range.startOffset;

    if (direction === "forward") {
      // Find next word boundary
      const remaining = text.slice(pos);
      const match = remaining.match(/^\s*\S+/);
      if (match) {
        pos += match[0].length;
      } else {
        pos = text.length;
      }
    } else {
      // Find previous word boundary
      const before = text.slice(0, pos);
      const match = before.match(/\S+\s*$/);
      if (match) {
        pos -= match[0].length;
      } else {
        pos = 0;
      }
    }

    range.setStart(range.startContainer, Math.max(0, Math.min(pos, text.length)));
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  // Enter insert mode
  const enterInsertMode = useCallback(
    (position: "cursor" | "after" | "lineStart" | "lineEnd" | "newLineBelow" | "newLineAbove" = "cursor") => {
      setVimState((s) => ({ ...s, mode: "insert", pendingKeys: "" }));
      onModeChange?.("insert");

      const editor = editorRef.current;
      if (!editor) return;

      if (position === "after") {
        moveCursor("right");
      } else if (position === "lineStart") {
        moveCursor("start");
      } else if (position === "lineEnd") {
        moveCursor("end");
      } else if (position === "newLineBelow" || position === "newLineAbove") {
        const currentIndex = getCurrentBlockIndex();
        const targetIndex = position === "newLineBelow" ? currentIndex + 1 : currentIndex;

        // Insert new block using Editor.js API
        editor.blocks.insert("paragraph", { text: "" }, undefined, targetIndex, true);

        // Focus the new block after a short delay
        setTimeout(() => focusBlock(targetIndex), 50);
      }
    },
    [editorRef, onModeChange, moveCursor, getCurrentBlockIndex, focusBlock]
  );

  // Exit to normal mode
  const enterNormalMode = useCallback(() => {
    setVimState((s) => ({ ...s, mode: "normal", pendingKeys: "", visualAnchor: null }));
    onModeChange?.("normal");

    // Clear any selection
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      selection.collapseToEnd();
    }

    // Move cursor back one position (vim behavior)
    moveCursor("left");
  }, [onModeChange, moveCursor]);

  // Enter visual mode
  const enterVisualMode = useCallback((lineMode: boolean = false) => {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return;

    const range = selection.getRangeAt(0);
    const anchor = range.startOffset;

    if (lineMode) {
      // Select entire line/block content
      const editableEl = selection.anchorNode.parentElement?.closest('[contenteditable="true"]');
      if (editableEl) {
        const textNode = editableEl.firstChild;
        if (textNode) {
          range.selectNodeContents(textNode);
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }
    }

    setVimState((s) => ({ ...s, mode: "visual", pendingKeys: "", visualAnchor: anchor }));
    onModeChange?.("visual");
  }, [onModeChange]);

  // Toggle case of character under cursor
  const toggleCase = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return;

    const text = selection.anchorNode.textContent || "";
    const range = selection.getRangeAt(0);
    const pos = range.startOffset;

    if (pos < text.length) {
      const char = text[pos];
      const newChar = char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
      if (char !== newChar) {
        // Replace the character
        const newText = text.slice(0, pos) + newChar + text.slice(pos + 1);
        selection.anchorNode.textContent = newText;
        // Move cursor right
        range.setStart(selection.anchorNode, pos + 1);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        // Still move cursor right
        range.setStart(selection.anchorNode, pos + 1);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  }, []);

  // Delete current block
  const deleteBlock = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentIndex = getCurrentBlockIndex();
    if (currentIndex >= 0) {
      // Save to register for paste
      const data = await editor.save();
      if (data.blocks[currentIndex]) {
        setVimState((s) => ({
          ...s,
          register: JSON.stringify(data.blocks[currentIndex]),
        }));
      }

      editor.blocks.delete(currentIndex);

      // Focus previous block or first block
      setTimeout(() => {
        const newIndex = Math.max(0, currentIndex - 1);
        focusBlock(newIndex);
      }, 50);
    }
  }, [editorRef, getCurrentBlockIndex, focusBlock]);

  // Yank (copy) current block
  const yankBlock = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;

    const currentIndex = getCurrentBlockIndex();
    const data = await editor.save();
    if (data.blocks[currentIndex]) {
      setVimState((s) => ({
        ...s,
        register: JSON.stringify(data.blocks[currentIndex]),
      }));
    }
  }, [editorRef, getCurrentBlockIndex]);

  // Paste block
  const pasteBlock = useCallback(
    (before: boolean = false) => {
      const editor = editorRef.current;
      if (!editor || !stateRef.current.register) return;

      try {
        const block = JSON.parse(stateRef.current.register);
        const currentIndex = getCurrentBlockIndex();
        const targetIndex = before ? currentIndex : currentIndex + 1;

        editor.blocks.insert(block.type, block.data, undefined, targetIndex, true);

        setTimeout(() => focusBlock(targetIndex), 50);
      } catch {
        // Invalid register content
      }
    },
    [editorRef, getCurrentBlockIndex, focusBlock]
  );

  // Handle normal mode key
  const handleNormalModeKey = useCallback(
    (e: KeyboardEvent): boolean => {
      const key = e.key;
      const pending = stateRef.current.pendingKeys;

      // Build count prefix
      if (/^[1-9]$/.test(key) || (pending && /^\d+$/.test(pending) && /^\d$/.test(key))) {
        setVimState((s) => ({ ...s, pendingKeys: s.pendingKeys + key }));
        return true;
      }

      // Check for two-key commands
      const fullKey = pending + key;

      // gg - go to start
      if (fullKey === "gg") {
        focusBlock(0);
        setVimState((s) => ({ ...s, pendingKeys: "" }));
        return true;
      }

      // dd - delete line/block (or checklist/list item if in one)
      if (fullKey === "dd") {
        const checklistInfoDD = getChecklistInfo();
        if (checklistInfoDD.isInChecklist && checklistInfoDD.checklistContainer) {
          // Delete just the current checklist/list item (async — uses Editor.js API)
          deleteChecklistItem(
            checklistInfoDD.checklistContainer,
            checklistInfoDD.items,
            checklistInfoDD.currentItemIndex,
            checklistInfoDD.itemSelector,
            checklistInfoDD.textSelector
          ).then((deleted) => {
            if (!deleted) {
              // Only one item left, delete the whole block
              deleteBlock();
            }
          });
        } else {
          deleteBlock();
        }
        setVimState((s) => ({ ...s, pendingKeys: "" }));
        return true;
      }

      // yy - yank line/block
      if (fullKey === "yy") {
        yankBlock();
        setVimState((s) => ({ ...s, pendingKeys: "" }));
        return true;
      }

      // cc - change line/block (delete and enter insert mode)
      if (fullKey === "cc") {
        deleteBlock();
        enterInsertMode("cursor");
        setVimState((s) => ({ ...s, pendingKeys: "" }));
        return true;
      }

      // ZZ - save and close (placeholder - just clear pending)
      if (fullKey === "ZZ") {
        // Could trigger save here if we had access to save function
        setVimState((s) => ({ ...s, pendingKeys: "" }));
        return true;
      }

      // ZQ - close without saving (placeholder)
      if (fullKey === "ZQ") {
        setVimState((s) => ({ ...s, pendingKeys: "" }));
        return true;
      }

      // f{char} - find character forward
      if (pending === "f" && key.length === 1) {
        const found = findChar(key, "forward", "find");
        if (found) {
          setVimState((s) => ({
            ...s,
            pendingKeys: "",
            lastFindChar: key,
            lastFindDirection: "forward",
            lastFindType: "find",
          }));
        } else {
          setVimState((s) => ({ ...s, pendingKeys: "" }));
        }
        return true;
      }

      // F{char} - find character backward
      if (pending === "F" && key.length === 1) {
        const found = findChar(key, "backward", "find");
        if (found) {
          setVimState((s) => ({
            ...s,
            pendingKeys: "",
            lastFindChar: key,
            lastFindDirection: "backward",
            lastFindType: "find",
          }));
        } else {
          setVimState((s) => ({ ...s, pendingKeys: "" }));
        }
        return true;
      }

      // t{char} - to character forward (before char)
      if (pending === "t" && key.length === 1) {
        const found = findChar(key, "forward", "to");
        if (found) {
          setVimState((s) => ({
            ...s,
            pendingKeys: "",
            lastFindChar: key,
            lastFindDirection: "forward",
            lastFindType: "to",
          }));
        } else {
          setVimState((s) => ({ ...s, pendingKeys: "" }));
        }
        return true;
      }

      // T{char} - to character backward (after char)
      if (pending === "T" && key.length === 1) {
        const found = findChar(key, "backward", "to");
        if (found) {
          setVimState((s) => ({
            ...s,
            pendingKeys: "",
            lastFindChar: key,
            lastFindDirection: "backward",
            lastFindType: "to",
          }));
        } else {
          setVimState((s) => ({ ...s, pendingKeys: "" }));
        }
        return true;
      }

      // r{char} - replace single character
      if (pending === "r" && key.length === 1 && key !== "Escape") {
        const selection = window.getSelection();
        if (selection && selection.anchorNode) {
          const text = selection.anchorNode.textContent || "";
          const range = selection.getRangeAt(0);
          const pos = range.startOffset;
          if (pos < text.length) {
            const newText = text.slice(0, pos) + key + text.slice(pos + 1);
            selection.anchorNode.textContent = newText;
            // Keep cursor at same position
            range.setStart(selection.anchorNode, pos);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
        setVimState((s) => ({ ...s, pendingKeys: "" }));
        return true;
      }

      // If we have a pending 'g', 'd', 'y', 'c', 'f', 'F', 't', 'T', 'r', or 'Z', wait for next key
      if (["g", "d", "y", "c", "f", "F", "t", "T", "r", "Z"].includes(key)) {
        setVimState((s) => ({ ...s, pendingKeys: s.pendingKeys + key }));
        return true;
      }

      // Clear pending if it doesn't form a valid command start
      if (pending && !["g", "d", "y", "c", "f", "F", "t", "T", "r", "Z"].includes(pending)) {
        setVimState((s) => ({ ...s, pendingKeys: "" }));
      }

      // Single key commands
      switch (key) {
        // Navigation
        case "h":
          moveCursor("left");
          return true;
        case "l":
          moveCursor("right");
          return true;
        case "j": {
          // Check if we're in a checklist/list first
          const checklistInfoJ = getChecklistInfo();
          if (checklistInfoJ.isInChecklist) {
            // Move to next checklist item within the block
            if (checklistInfoJ.currentItemIndex < checklistInfoJ.items.length - 1) {
              focusChecklistItem(checklistInfoJ.items, checklistInfoJ.currentItemIndex + 1, checklistInfoJ.textSelector);
            } else {
              // At last checklist item, move to next block
              const currentIndex = getCurrentBlockIndex();
              const blocks = containerRef.current?.querySelectorAll(".ce-block");
              if (blocks && currentIndex < blocks.length - 1) {
                focusBlock(currentIndex + 1);
              }
            }
          } else {
            const currentIndex = getCurrentBlockIndex();
            const blocks = containerRef.current?.querySelectorAll(".ce-block");
            if (blocks && currentIndex < blocks.length - 1) {
              focusBlock(currentIndex + 1);
            }
          }
          return true;
        }
        case "k": {
          // Check if we're in a checklist/list first
          const checklistInfoK = getChecklistInfo();
          if (checklistInfoK.isInChecklist) {
            // Move to previous checklist item within the block
            if (checklistInfoK.currentItemIndex > 0) {
              focusChecklistItem(checklistInfoK.items, checklistInfoK.currentItemIndex - 1, checklistInfoK.textSelector);
            } else {
              // At first checklist item, move to previous block
              const currentIndex = getCurrentBlockIndex();
              if (currentIndex > 0) {
                focusBlock(currentIndex - 1);
              }
            }
          } else {
            const currentIndex = getCurrentBlockIndex();
            if (currentIndex > 0) {
              focusBlock(currentIndex - 1);
            }
          }
          return true;
        }

        // Word movement (lowercase - word boundaries)
        case "w":
          moveByWord("forward");
          return true;
        case "b":
          moveByWord("backward");
          return true;
        case "e":
          moveByWord("forward");
          return true;

        // WORD movement (uppercase - whitespace boundaries)
        case "W":
          moveByWORD("forward");
          return true;
        case "B":
          moveByWORD("backward");
          return true;
        case "E":
          moveByWORD("end");
          return true;

        // Line movement
        case "0":
          moveCursor("start");
          return true;
        case "^": {
          // Move to first non-blank character
          const selection = window.getSelection();
          if (selection && selection.anchorNode) {
            const text = selection.anchorNode.textContent || "";
            const range = selection.getRangeAt(0);
            const match = text.match(/^\s*/);
            const firstNonBlank = match ? match[0].length : 0;
            range.setStart(range.startContainer, firstNonBlank);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          }
          return true;
        }
        case "$":
          moveCursor("end");
          return true;

        // Document movement
        case "G": {
          const blocks = containerRef.current?.querySelectorAll(".ce-block");
          if (blocks && blocks.length > 0) {
            focusBlock(blocks.length - 1);
          }
          return true;
        }

        // Screen position movement (H/M/L - adapted for block editor)
        case "H": {
          // High - go to first visible block (or just first block)
          focusBlock(0);
          return true;
        }
        case "M": {
          // Middle - go to middle block
          const blocks = containerRef.current?.querySelectorAll(".ce-block");
          if (blocks && blocks.length > 0) {
            const middleIndex = Math.floor(blocks.length / 2);
            focusBlock(middleIndex);
          }
          return true;
        }
        case "L": {
          // Low - go to last block
          const blocks = containerRef.current?.querySelectorAll(".ce-block");
          if (blocks && blocks.length > 0) {
            focusBlock(blocks.length - 1);
          }
          return true;
        }

        // Insert mode
        case "i":
          enterInsertMode("cursor");
          return true;
        case "a":
          enterInsertMode("after");
          return true;
        case "A":
          enterInsertMode("lineEnd");
          return true;
        case "I":
          enterInsertMode("lineStart");
          return true;
        case "o":
          enterInsertMode("newLineBelow");
          return true;
        case "O":
          enterInsertMode("newLineAbove");
          return true;

        // Paste
        case "p":
          pasteBlock(false);
          return true;
        case "P":
          pasteBlock(true);
          return true;

        // Delete character under cursor (x)
        case "x": {
          const selection = window.getSelection();
          if (selection && selection.anchorNode) {
            const range = selection.getRangeAt(0);
            const text = selection.anchorNode.textContent || "";
            if (range.startOffset < text.length) {
              range.setEnd(range.startContainer, range.startOffset + 1);
              range.deleteContents();
            }
          }
          return true;
        }

        // Delete to end of line (D)
        case "D": {
          const selection = window.getSelection();
          if (selection && selection.anchorNode) {
            const range = selection.getRangeAt(0);
            const text = selection.anchorNode.textContent || "";
            range.setEnd(range.startContainer, text.length);
            range.deleteContents();
          }
          return true;
        }

        // Change to end of line (C) - delete to end and enter insert mode
        case "C": {
          const selection = window.getSelection();
          if (selection && selection.anchorNode) {
            const range = selection.getRangeAt(0);
            const text = selection.anchorNode.textContent || "";
            range.setEnd(range.startContainer, text.length);
            range.deleteContents();
          }
          enterInsertMode("cursor");
          return true;
        }

        // Substitute character (s) - delete char and enter insert mode
        case "s": {
          const selection = window.getSelection();
          if (selection && selection.anchorNode) {
            const range = selection.getRangeAt(0);
            const text = selection.anchorNode.textContent || "";
            if (range.startOffset < text.length) {
              range.setEnd(range.startContainer, range.startOffset + 1);
              range.deleteContents();
            }
          }
          enterInsertMode("cursor");
          return true;
        }

        // Substitute line (S) - delete line content and enter insert mode
        case "S": {
          const selection = window.getSelection();
          if (selection && selection.anchorNode) {
            const range = document.createRange();
            range.selectNodeContents(selection.anchorNode);
            range.deleteContents();
          }
          enterInsertMode("cursor");
          return true;
        }

        // Delete character before cursor (X)
        case "X": {
          const selection = window.getSelection();
          if (selection && selection.anchorNode) {
            const range = selection.getRangeAt(0);
            if (range.startOffset > 0) {
              range.setStart(range.startContainer, range.startOffset - 1);
              range.deleteContents();
            }
          }
          return true;
        }

        // Yank line (Y - same as yy)
        case "Y":
          yankBlock();
          return true;

        // Replace mode (R) - continuous replace
        case "R":
          // Enter a replace-like mode - for simplicity, just enter insert mode
          // True replace mode would need special handling
          enterInsertMode("cursor");
          return true;

        // Visual mode
        case "v":
          enterVisualMode(false);
          return true;

        case "V":
          enterVisualMode(true);
          return true;

        // Toggle case (~)
        case "~":
          toggleCase();
          return true;

        // Repeat last f/F/t/T forward (;)
        case ";": {
          const state = stateRef.current;
          if (state.lastFindChar) {
            findChar(state.lastFindChar, state.lastFindDirection, state.lastFindType);
          }
          return true;
        }

        // Repeat last f/F/t/T backward (,)
        case ",": {
          const state = stateRef.current;
          if (state.lastFindChar) {
            const reverseDir = state.lastFindDirection === "forward" ? "backward" : "forward";
            findChar(state.lastFindChar, reverseDir, state.lastFindType);
          }
          return true;
        }

        // Repeat last search forward (n) - placeholder
        case "n":
          // Would need search state to implement properly
          return true;

        // Repeat last search backward (N) - placeholder
        case "N":
          // Would need search state to implement properly
          return true;

        // Undo/Redo
        case "u":
          document.execCommand("undo");
          return true;
        case "r":
          if (e.ctrlKey) {
            document.execCommand("redo");
            return true;
          }
          // Single 'r' for replace character - not implemented yet, prevent insertion
          return true;

        // Search (opens command palette via existing shortcut)
        case "/":
          // Let the default Cmd+K handler work
          return false;

        // Escape
        case "Escape":
          // Already in normal mode, clear pending
          setVimState((s) => ({ ...s, pendingKeys: "" }));
          return true;

        // Join lines (J)
        case "J": {
          // Join current line with next - simplified: just remove newline
          const currentIndex = getCurrentBlockIndex();
          const editor = editorRef.current;
          if (editor && currentIndex >= 0) {
            editor.save().then((data) => {
              if (data.blocks[currentIndex + 1]) {
                const currentBlock = data.blocks[currentIndex];
                const nextBlock = data.blocks[currentIndex + 1];
                if (currentBlock.type === "paragraph" && nextBlock.type === "paragraph") {
                  const currentText = (currentBlock.data as { text?: string }).text || "";
                  const nextText = (nextBlock.data as { text?: string }).text || "";
                  editor.blocks.update(currentBlock.id!, { text: currentText + " " + nextText });
                  editor.blocks.delete(currentIndex + 1);
                }
              }
            });
          }
          return true;
        }

        default:
          // In normal mode, prevent any other printable characters from inserting
          // Allow special keys like arrows, function keys, etc.
          if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            // Single character key that's not handled - block it in normal mode
            return true;
          }
          break;
      }

      return false;
    },
    [
      containerRef,
      editorRef,
      focusBlock,
      getCurrentBlockIndex,
      getChecklistInfo,
      focusChecklistItem,
      deleteChecklistItem,
      moveCursor,
      moveByWord,
      moveByWORD,
      findChar,
      enterInsertMode,
      enterVisualMode,
      toggleCase,
      deleteBlock,
      yankBlock,
      pasteBlock,
    ]
  );

  // Handle visual mode key
  const handleVisualModeKey = useCallback(
    (e: KeyboardEvent): boolean => {
      const key = e.key;
      const selection = window.getSelection();

      switch (key) {
        case "Escape":
          enterNormalMode();
          return true;

        // Navigation keys extend selection in visual mode
        case "h":
        case "l":
        case "j":
        case "k":
        case "w":
        case "b":
        case "e":
        case "0":
        case "$":
        case "G":
        case "gg": {
          // In visual mode, navigation should extend selection
          // For simplicity, we'll just modify the selection
          const sel = window.getSelection();
          if (sel && sel.anchorNode && sel.focusNode) {
            const text = sel.focusNode.textContent || "";
            let newPos = sel.focusOffset;

            if (key === "h" && newPos > 0) newPos--;
            else if (key === "l" && newPos < text.length) newPos++;
            else if (key === "w") {
              const remaining = text.slice(newPos);
              const match = remaining.match(/^\s*\S+/);
              if (match) newPos += match[0].length;
            } else if (key === "b") {
              const before = text.slice(0, newPos);
              const match = before.match(/\S+\s*$/);
              if (match) newPos -= match[0].length;
            } else if (key === "e") {
              const remaining = text.slice(newPos);
              const match = remaining.match(/^\s*\S+/);
              if (match) newPos += match[0].length;
            } else if (key === "0") {
              newPos = 0;
            } else if (key === "$") {
              newPos = text.length;
            }

            // Extend selection to new position
            sel.extend(sel.focusNode, Math.max(0, Math.min(newPos, text.length)));
          }
          return true;
        }

        // Delete selection
        case "d":
        case "x": {
          if (selection && !selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            // Save deleted text to register
            setVimState((s) => ({
              ...s,
              register: range.toString(),
            }));
            range.deleteContents();
          }
          enterNormalMode();
          return true;
        }

        // Yank selection
        case "y": {
          if (selection && !selection.isCollapsed) {
            const text = selection.toString();
            setVimState((s) => ({
              ...s,
              register: text,
            }));
            // Also copy to clipboard
            navigator.clipboard.writeText(text).catch(() => {});
          }
          enterNormalMode();
          return true;
        }

        // Change selection (delete and enter insert mode)
        case "c":
        case "s": {
          if (selection && !selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            setVimState((s) => ({
              ...s,
              register: range.toString(),
            }));
            range.deleteContents();
          }
          enterInsertMode("cursor");
          return true;
        }

        // Toggle case of selection
        case "~": {
          if (selection && !selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            const text = range.toString();
            const toggled = text.split("").map((char) =>
              char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase()
            ).join("");
            range.deleteContents();
            range.insertNode(document.createTextNode(toggled));
          }
          enterNormalMode();
          return true;
        }

        // Enter insert mode at start of selection
        case "I": {
          if (selection && !selection.isCollapsed) {
            selection.collapseToStart();
          }
          enterInsertMode("cursor");
          return true;
        }

        // Enter insert mode at end of selection
        case "A": {
          if (selection && !selection.isCollapsed) {
            selection.collapseToEnd();
          }
          enterInsertMode("cursor");
          return true;
        }

        default:
          // Block other single characters in visual mode
          if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            return true;
          }
          break;
      }

      return false;
    },
    [enterNormalMode, enterInsertMode]
  );

  // Handle insert mode key
  const handleInsertModeKey = useCallback(
    (e: KeyboardEvent): boolean => {
      const key = e.key;

      // Exit to normal mode
      if (key === "Escape" || (e.ctrlKey && key === "[")) {
        enterNormalMode();
        return true;
      }

      // jj to exit (common vim mapping)
      if (key === "j" && stateRef.current.pendingKeys === "j") {
        enterNormalMode();
        // Remove the first 'j' that was typed
        document.execCommand("delete");
        setVimState((s) => ({ ...s, pendingKeys: "" }));
        return true;
      }

      if (key === "j") {
        setVimState((s) => ({ ...s, pendingKeys: "j" }));
        // Let the j be typed, will be removed if followed by another j
        return false;
      }

      // Ctrl+w - delete word backward
      if (e.ctrlKey && key === "w") {
        const selection = window.getSelection();
        if (selection && selection.anchorNode) {
          const text = selection.anchorNode.textContent || "";
          const range = selection.getRangeAt(0);
          const pos = range.startOffset;
          const before = text.slice(0, pos);
          const match = before.match(/\S+\s*$/) || before.match(/\s+$/);
          if (match) {
            range.setStart(range.startContainer, pos - match[0].length);
            range.deleteContents();
          }
        }
        return true;
      }

      // Ctrl+u - delete to line start
      if (e.ctrlKey && key === "u") {
        const selection = window.getSelection();
        if (selection && selection.anchorNode) {
          const range = selection.getRangeAt(0);
          range.setStart(range.startContainer, 0);
          range.deleteContents();
        }
        return true;
      }

      // Clear pending on any other key
      setVimState((s) => ({ ...s, pendingKeys: "" }));

      // Let all other keys pass through to the editor
      return false;
    },
    [enterNormalMode]
  );

  // Main keydown handler
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't interfere with global shortcuts
      if (e.metaKey || (e.ctrlKey && !["[", "r"].includes(e.key))) {
        return;
      }

      // Don't interfere when Editor.js popover is open (slash commands, block tunes, etc.)
      // This allows typing in the popover's search field for filtering
      const popoverOpen = document.querySelector('.ce-popover--opened');
      if (popoverOpen) {
        return;
      }

      // Only handle when focus is in the editor
      if (!containerRef.current?.contains(document.activeElement)) {
        return;
      }

      const state = stateRef.current;
      let handled = false;

      if (state.mode === "normal") {
        handled = handleNormalModeKey(e);
      } else if (state.mode === "insert") {
        handled = handleInsertModeKey(e);
      } else if (state.mode === "visual") {
        handled = handleVisualModeKey(e);
      }

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Use capture phase to intercept before Editor.js
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [enabled, containerRef, handleNormalModeKey, handleInsertModeKey, handleVisualModeKey]);

  // Reset to normal mode when editor loses focus
  useEffect(() => {
    if (!enabled) return;

    const handleFocusOut = (e: FocusEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.relatedTarget as Node)
      ) {
        setVimState((s) => ({ ...s, mode: "normal", pendingKeys: "" }));
        onModeChange?.("normal");
      }
    };

    containerRef.current?.addEventListener("focusout", handleFocusOut);
    return () => {
      containerRef.current?.removeEventListener("focusout", handleFocusOut);
    };
  }, [enabled, containerRef, onModeChange]);

  // Start in normal mode when vim mode is enabled
  useEffect(() => {
    if (enabled) {
      setVimState((s) => ({ ...s, mode: "normal" }));
      onModeChange?.("normal");
    }
  }, [enabled, onModeChange]);

  return {
    mode: vimState.mode,
    pendingKeys: vimState.pendingKeys,
    enterNormalMode,
    enterInsertMode,
    enterVisualMode,
  };
}
