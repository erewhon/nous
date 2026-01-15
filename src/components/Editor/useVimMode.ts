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
}

/**
 * Custom hook that adds VI keybindings to Editor.js
 *
 * Supported commands:
 *
 * Normal Mode:
 * - h, j, k, l: Navigation (left, down, up, right)
 * - w, b, e: Word movement (next word, prev word, end of word)
 * - 0, $: Line start/end
 * - gg, G: Document start/end
 * - i, a, A, I: Enter insert mode (at cursor, after cursor, end of line, start of line)
 * - o, O: Open line below/above
 * - dd: Delete current block
 * - yy: Yank (copy) current block
 * - p, P: Paste after/before
 * - u: Undo
 * - Ctrl+r: Redo
 * - /: Focus search (opens command palette)
 * - Escape: Exit insert mode
 *
 * Insert Mode:
 * - Escape, Ctrl+[, jj: Exit to normal mode
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
    setVimState((s) => ({ ...s, mode: "normal", pendingKeys: "" }));
    onModeChange?.("normal");

    // Move cursor back one position (vim behavior)
    moveCursor("left");
  }, [onModeChange, moveCursor]);

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

      // dd - delete line/block
      if (fullKey === "dd") {
        deleteBlock();
        setVimState((s) => ({ ...s, pendingKeys: "" }));
        return true;
      }

      // yy - yank line/block
      if (fullKey === "yy") {
        yankBlock();
        setVimState((s) => ({ ...s, pendingKeys: "" }));
        return true;
      }

      // If we have a pending 'g' or 'd' or 'y', wait for next key
      if (key === "g" || key === "d" || key === "y") {
        setVimState((s) => ({ ...s, pendingKeys: s.pendingKeys + key }));
        return true;
      }

      // Clear pending if it doesn't form a valid command
      if (pending && !["g", "d", "y"].includes(pending)) {
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
          const currentIndex = getCurrentBlockIndex();
          const blocks = containerRef.current?.querySelectorAll(".ce-block");
          if (blocks && currentIndex < blocks.length - 1) {
            focusBlock(currentIndex + 1);
          }
          return true;
        }
        case "k": {
          const currentIndex = getCurrentBlockIndex();
          if (currentIndex > 0) {
            focusBlock(currentIndex - 1);
          }
          return true;
        }

        // Word movement
        case "w":
          moveByWord("forward");
          return true;
        case "b":
          moveByWord("backward");
          return true;
        case "e":
          moveByWord("forward");
          return true;

        // Line movement
        case "0":
          moveCursor("start");
          return true;
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

        // Undo/Redo
        case "u":
          document.execCommand("undo");
          return true;
        case "r":
          if (e.ctrlKey) {
            document.execCommand("redo");
            return true;
          }
          break;

        // Search (opens command palette via existing shortcut)
        case "/":
          // Let the default Cmd+K handler work
          return false;

        // Escape
        case "Escape":
          // Already in normal mode, clear pending
          setVimState((s) => ({ ...s, pendingKeys: "" }));
          return true;
      }

      return false;
    },
    [
      containerRef,
      focusBlock,
      getCurrentBlockIndex,
      moveCursor,
      moveByWord,
      enterInsertMode,
      deleteBlock,
      yankBlock,
      pasteBlock,
    ]
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
  }, [enabled, containerRef, handleNormalModeKey, handleInsertModeKey]);

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
  };
}
