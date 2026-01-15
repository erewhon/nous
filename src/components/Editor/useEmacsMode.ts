import { useEffect, useRef, useCallback, useState } from "react";
import type EditorJS from "@editorjs/editorjs";

interface UseEmacsModeOptions {
  enabled: boolean;
  editorRef: React.MutableRefObject<EditorJS | null>;
  containerRef: React.RefObject<HTMLElement>;
}

interface EmacsState {
  markActive: boolean;
  markPosition: number | null;
  killRing: string[];
  killRingIndex: number;
}

/**
 * Custom hook that adds Emacs keybindings to Editor.js
 *
 * Supported commands:
 *
 * Navigation:
 * - Ctrl+f: Forward one character
 * - Ctrl+b: Backward one character
 * - Ctrl+n: Next line (next block)
 * - Ctrl+p: Previous line (previous block)
 * - Ctrl+a: Beginning of line
 * - Ctrl+e: End of line
 * - Alt+f: Forward one word
 * - Alt+b: Backward one word
 * - Alt+<: Beginning of document
 * - Alt+>: End of document
 *
 * Editing:
 * - Ctrl+d: Delete character forward
 * - Ctrl+h: Delete character backward (backspace)
 * - Ctrl+k: Kill to end of line
 * - Ctrl+w: Kill region (cut)
 * - Alt+w: Copy region
 * - Ctrl+y: Yank (paste)
 * - Alt+y: Yank pop (cycle kill ring)
 * - Ctrl+/: Undo
 * - Ctrl+Shift+/: Redo
 *
 * Mark:
 * - Ctrl+Space: Set mark
 * - Ctrl+g: Cancel / deactivate mark
 *
 * Other:
 * - Ctrl+x Ctrl+s: Save (triggers existing save)
 */
export function useEmacsMode({
  enabled,
  editorRef,
  containerRef,
}: UseEmacsModeOptions) {
  const [emacsState, setEmacsState] = useState<EmacsState>({
    markActive: false,
    markPosition: null,
    killRing: [],
    killRingIndex: 0,
  });

  const stateRef = useRef(emacsState);
  stateRef.current = emacsState;

  const pendingKeysRef = useRef<string>("");

  // Get current block index
  const getCurrentBlockIndex = useCallback((): number => {
    const editor = editorRef.current;
    if (!editor) return -1;

    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return -1;

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
    (index: number, atStart: boolean = false) => {
      const blocks = containerRef.current?.querySelectorAll(".ce-block");
      if (!blocks || index < 0 || index >= blocks.length) return;

      const block = blocks[index] as HTMLElement;
      const editable = block.querySelector(
        '[contenteditable="true"]'
      ) as HTMLElement;
      if (editable) {
        editable.focus();
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(editable);
        range.collapse(atStart);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    },
    [containerRef]
  );

  // Move cursor within text
  const moveCursor = useCallback(
    (direction: "left" | "right" | "start" | "end") => {
      const selection = window.getSelection();
      if (!selection || !selection.anchorNode) return;

      // Deactivate mark if moving without shift
      if (stateRef.current.markActive) {
        selection.collapseToEnd();
      }

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
    },
    []
  );

  // Move by word
  const moveByWord = useCallback((direction: "forward" | "backward") => {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return;

    const text = selection.anchorNode.textContent || "";
    const range = selection.getRangeAt(0);
    let pos = range.startOffset;

    if (direction === "forward") {
      const remaining = text.slice(pos);
      const match = remaining.match(/^\s*\S+/);
      if (match) {
        pos += match[0].length;
      } else {
        pos = text.length;
      }
    } else {
      const before = text.slice(0, pos);
      const match = before.match(/\S+\s*$/);
      if (match) {
        pos -= match[0].length;
      } else {
        pos = 0;
      }
    }

    range.setStart(
      range.startContainer,
      Math.max(0, Math.min(pos, text.length))
    );
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  // Set mark at current position
  const setMark = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return;

    const range = selection.getRangeAt(0);
    setEmacsState((s) => ({
      ...s,
      markActive: true,
      markPosition: range.startOffset,
    }));
  }, []);

  // Kill (cut) to end of line
  const killLine = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return;

    const text = selection.anchorNode.textContent || "";
    const range = selection.getRangeAt(0);
    const pos = range.startOffset;

    // Get text from cursor to end of line
    const killedText = text.slice(pos);

    if (killedText) {
      // Add to kill ring
      setEmacsState((s) => ({
        ...s,
        killRing: [killedText, ...s.killRing.slice(0, 9)],
        killRingIndex: 0,
      }));

      // Delete the text
      range.setEnd(range.startContainer, text.length);
      range.deleteContents();
    }
  }, []);

  // Kill region (cut selection)
  const killRegion = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const killedText = selection.toString();
    if (killedText) {
      setEmacsState((s) => ({
        ...s,
        killRing: [killedText, ...s.killRing.slice(0, 9)],
        killRingIndex: 0,
        markActive: false,
      }));

      // Delete selection
      const range = selection.getRangeAt(0);
      range.deleteContents();
    }
  }, []);

  // Copy region
  const copyRegion = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const copiedText = selection.toString();
    if (copiedText) {
      setEmacsState((s) => ({
        ...s,
        killRing: [copiedText, ...s.killRing.slice(0, 9)],
        killRingIndex: 0,
        markActive: false,
      }));

      // Collapse selection
      selection.collapseToEnd();
    }
  }, []);

  // Yank (paste from kill ring)
  const yank = useCallback(() => {
    const state = stateRef.current;
    if (state.killRing.length === 0) return;

    const textToYank = state.killRing[state.killRingIndex];
    if (!textToYank) return;

    const selection = window.getSelection();
    if (!selection || !selection.anchorNode) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();

    const textNode = document.createTextNode(textToYank);
    range.insertNode(textNode);

    // Move cursor after inserted text
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  // Yank pop (cycle through kill ring)
  const yankPop = useCallback(() => {
    const state = stateRef.current;
    if (state.killRing.length <= 1) return;

    // TODO: Implement proper yank-pop by replacing last yank
    const newIndex = (state.killRingIndex + 1) % state.killRing.length;
    setEmacsState((s) => ({ ...s, killRingIndex: newIndex }));
  }, []);

  // Cancel / keyboard quit
  const cancel = useCallback(() => {
    setEmacsState((s) => ({
      ...s,
      markActive: false,
      markPosition: null,
    }));
    pendingKeysRef.current = "";

    // Collapse selection
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      selection.collapseToEnd();
    }
  }, []);

  // Main keydown handler
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle when focus is in the editor
      if (!containerRef.current?.contains(document.activeElement)) {
        return;
      }

      const pending = pendingKeysRef.current;

      // Handle Ctrl+x prefix commands
      if (pending === "C-x") {
        if (e.ctrlKey && e.key === "s") {
          // Ctrl+x Ctrl+s: Save - let it propagate to existing handler
          pendingKeysRef.current = "";
          return;
        }
        // Unknown Ctrl+x command, cancel
        pendingKeysRef.current = "";
        return;
      }

      // Set Ctrl+x prefix
      if (e.ctrlKey && e.key === "x" && !e.metaKey && !e.altKey) {
        e.preventDefault();
        pendingKeysRef.current = "C-x";
        return;
      }

      // Don't interfere with Cmd shortcuts (macOS)
      if (e.metaKey) {
        return;
      }

      let handled = false;

      // Ctrl key combinations
      if (e.ctrlKey && !e.altKey) {
        switch (e.key) {
          case "f": // Forward char
            moveCursor("right");
            handled = true;
            break;
          case "b": // Backward char
            moveCursor("left");
            handled = true;
            break;
          case "n": // Next line
            {
              const currentIndex = getCurrentBlockIndex();
              const blocks =
                containerRef.current?.querySelectorAll(".ce-block");
              if (blocks && currentIndex < blocks.length - 1) {
                focusBlock(currentIndex + 1, true);
              }
            }
            handled = true;
            break;
          case "p": // Previous line
            {
              const currentIndex = getCurrentBlockIndex();
              if (currentIndex > 0) {
                focusBlock(currentIndex - 1, false);
              }
            }
            handled = true;
            break;
          case "a": // Beginning of line
            moveCursor("start");
            handled = true;
            break;
          case "e": // End of line
            moveCursor("end");
            handled = true;
            break;
          case "d": // Delete forward
            document.execCommand("forwardDelete");
            handled = true;
            break;
          case "h": // Delete backward (backspace)
            document.execCommand("delete");
            handled = true;
            break;
          case "k": // Kill line
            killLine();
            handled = true;
            break;
          case "w": // Kill region
            killRegion();
            handled = true;
            break;
          case "y": // Yank
            yank();
            handled = true;
            break;
          case " ": // Set mark
            setMark();
            handled = true;
            break;
          case "g": // Cancel
            cancel();
            handled = true;
            break;
          case "/": // Undo
            document.execCommand("undo");
            handled = true;
            break;
        }
      }

      // Alt key combinations
      if (e.altKey && !e.ctrlKey) {
        switch (e.key) {
          case "f": // Forward word
            moveByWord("forward");
            handled = true;
            break;
          case "b": // Backward word
            moveByWord("backward");
            handled = true;
            break;
          case "w": // Copy region
            copyRegion();
            handled = true;
            break;
          case "y": // Yank pop
            yankPop();
            handled = true;
            break;
          case "<": // Beginning of document
            focusBlock(0, true);
            handled = true;
            break;
          case ">": // End of document
            {
              const blocks =
                containerRef.current?.querySelectorAll(".ce-block");
              if (blocks && blocks.length > 0) {
                focusBlock(blocks.length - 1, false);
              }
            }
            handled = true;
            break;
        }
      }

      // Ctrl+Shift combinations
      if (e.ctrlKey && e.shiftKey) {
        if (e.key === "/") {
          // Redo
          document.execCommand("redo");
          handled = true;
        }
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
  }, [
    enabled,
    containerRef,
    getCurrentBlockIndex,
    focusBlock,
    moveCursor,
    moveByWord,
    killLine,
    killRegion,
    copyRegion,
    yank,
    yankPop,
    setMark,
    cancel,
  ]);

  // Reset state when disabled
  useEffect(() => {
    if (!enabled) {
      setEmacsState({
        markActive: false,
        markPosition: null,
        killRing: [],
        killRingIndex: 0,
      });
      pendingKeysRef.current = "";
    }
  }, [enabled]);

  return {
    markActive: emacsState.markActive,
    killRingLength: emacsState.killRing.length,
  };
}
