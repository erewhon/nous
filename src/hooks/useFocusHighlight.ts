import { useEffect, useRef, type RefObject } from "react";

export type FocusHighlightMode = "sentence" | "paragraph" | "none";

interface UseFocusHighlightOptions {
  enabled: boolean;
  mode: FocusHighlightMode;
  containerRef: RefObject<HTMLElement | null>;
}

/**
 * BlockNote DOM selector for block wrappers.
 * Uses bn-block-outer (the visual wrapper) so dimming covers the entire block.
 * Falls back to data-node-type selectors if class names change.
 */
const BLOCK_SELECTOR = '.bn-block-outer, [data-node-type="blockOuter"]';
/** Selector for the inner block (used to find the active block from cursor). */
const BLOCK_INNER_SELECTOR = '.bn-block, [data-node-type="blockContainer"]';

/**
 * Hook that dims non-active content in zen mode.
 * - Paragraph mode: highlights the active block, dims siblings.
 * - Sentence mode: highlights the active sentence via Range API.
 */
export function useFocusHighlight({
  enabled,
  mode,
  containerRef,
}: UseFocusHighlightOptions) {
  const activeBlockRef = useRef<Element | null>(null);
  const sentenceHighlightRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!enabled || mode === "none") {
      // Clean up any existing highlights
      cleanup();
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    function cleanup() {
      // Remove focus classes from all block wrappers
      document.querySelectorAll(BLOCK_SELECTOR).forEach((block) => {
        block.classList.remove("focus-dimmed", "focus-active");
      });
      activeBlockRef.current = null;

      // Remove sentence highlight
      if (sentenceHighlightRef.current) {
        sentenceHighlightRef.current.remove();
        sentenceHighlightRef.current = null;
      }
    }

    function handleSelectionChange() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const cursorNode = range.startContainer;

      // Make sure the selection is inside our editor container
      const nodeEl = cursorNode.nodeType === Node.TEXT_NODE
        ? cursorNode.parentElement
        : (cursorNode as Element);
      if (!nodeEl || !container!.contains(nodeEl)) return;

      if (mode === "paragraph") {
        handleParagraphMode(nodeEl);
      } else if (mode === "sentence") {
        handleSentenceMode(cursorNode, range, nodeEl);
      }
    }

    function handleParagraphMode(element: Element) {
      // Find the containing block — try inner block first, then get its outer wrapper
      const innerBlock = element.closest(BLOCK_INNER_SELECTOR);
      if (!innerBlock) return;

      // The outer wrapper is the parent with bn-block-outer class
      const activeOuter = innerBlock.closest(BLOCK_SELECTOR);
      if (!activeOuter) return;

      // Skip if same element
      if (activeOuter === activeBlockRef.current) return;
      activeBlockRef.current = activeOuter;

      // Get only direct-child block wrappers in the editor's top-level block group
      // to avoid dimming nested blocks (children of the active block)
      const allOuters = container!.querySelectorAll(BLOCK_SELECTOR);
      allOuters.forEach((outer) => {
        if (outer === activeOuter || activeOuter.contains(outer)) {
          // Active block or a child of the active block — keep visible
          outer.classList.add("focus-active");
          outer.classList.remove("focus-dimmed");
        } else if (outer.contains(activeOuter)) {
          // Ancestor of the active block — keep visible (don't dim parents)
          outer.classList.remove("focus-dimmed", "focus-active");
        } else {
          outer.classList.add("focus-dimmed");
          outer.classList.remove("focus-active");
        }
      });
    }

    function handleSentenceMode(cursorNode: Node, range: Range, element: Element) {
      // Remove previous sentence highlight
      if (sentenceHighlightRef.current) {
        sentenceHighlightRef.current.remove();
        sentenceHighlightRef.current = null;
      }

      // Also apply paragraph-level dimming for context
      handleParagraphMode(element);

      // Find the text node content
      const textNode =
        cursorNode.nodeType === Node.TEXT_NODE
          ? cursorNode
          : cursorNode.firstChild;
      if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

      const text = textNode.textContent || "";
      const offset = range.startOffset;

      // Find sentence boundaries around cursor
      const sentenceBreaks = /[.!?]+\s/g;
      let sentenceStart = 0;
      let sentenceEnd = text.length;
      let match;

      while ((match = sentenceBreaks.exec(text)) !== null) {
        const breakEnd = match.index + match[0].length;
        if (breakEnd <= offset) {
          sentenceStart = breakEnd;
        } else if (match.index >= offset) {
          sentenceEnd = match.index + match[0].length - 1; // include punctuation
          break;
        }
      }

      if (sentenceStart === 0 && sentenceEnd === text.length && text.length === 0) {
        return;
      }

      // Create a highlight range for the sentence
      try {
        const sentenceRange = document.createRange();
        sentenceRange.setStart(textNode, sentenceStart);
        sentenceRange.setEnd(textNode, Math.min(sentenceEnd, text.length));

        const rects = sentenceRange.getClientRects();
        if (rects.length === 0) return;

        // Create overlay highlight
        const highlight = document.createElement("div");
        highlight.className = "focus-sentence-highlight";
        highlight.style.position = "absolute";
        highlight.style.pointerEvents = "none";
        highlight.style.zIndex = "0";

        const containerRect = container!.getBoundingClientRect();
        const scrollTop = container!.scrollTop;
        const scrollLeft = container!.scrollLeft;

        // Cover all rects (handles line wrapping)
        for (let i = 0; i < rects.length; i++) {
          const rect = rects[i];
          const span = document.createElement("div");
          span.style.position = "absolute";
          span.style.left = `${rect.left - containerRect.left + scrollLeft}px`;
          span.style.top = `${rect.top - containerRect.top + scrollTop}px`;
          span.style.width = `${rect.width}px`;
          span.style.height = `${rect.height}px`;
          span.style.backgroundColor = "var(--color-accent)";
          span.style.opacity = "0.08";
          span.style.borderRadius = "2px";
          highlight.appendChild(span);
        }

        container!.style.position = "relative";
        container!.appendChild(highlight);
        sentenceHighlightRef.current = highlight;
      } catch {
        // Range operations can fail on edge cases — ignore
      }
    }

    // Debounce to 50ms
    let timeoutId: number;
    const debouncedHandler = () => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(handleSelectionChange, 50);
    };

    document.addEventListener("selectionchange", debouncedHandler);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("selectionchange", debouncedHandler);
      cleanup();
    };
  }, [enabled, mode, containerRef]);
}
