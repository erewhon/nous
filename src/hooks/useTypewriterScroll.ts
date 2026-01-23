import { useEffect, useRef, type RefObject } from "react";

interface UseTypewriterScrollOptions {
  enabled: boolean;
  containerRef: RefObject<HTMLElement | null>;
  offset?: number; // 0-1, where 0.5 is center. Default: 0.4 (slightly above center)
}

/**
 * Hook that implements typewriter scrolling for distraction-free writing.
 * When enabled, it keeps the cursor vertically centered in the viewport
 * as the user types.
 */
export function useTypewriterScroll({
  enabled,
  containerRef,
  offset = 0.4,
}: UseTypewriterScrollOptions) {
  const lastScrollTop = useRef(0);
  const isScrolling = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    const handleSelectionChange = () => {
      // Prevent scroll during programmatic scrolling
      if (isScrolling.current) return;

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      // Get the cursor position
      const range = selection.getRangeAt(0);
      if (!range.collapsed) return; // Only for cursor, not selection

      // Get the bounding rect of the cursor position
      const rects = range.getClientRects();
      if (rects.length === 0) {
        // For empty lines, get the rect from the container
        const cursorNode = range.startContainer;
        const element = cursorNode.nodeType === Node.TEXT_NODE
          ? cursorNode.parentElement
          : cursorNode as Element;

        if (!element) return;

        const elementRect = element.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        // Check if element is within the container
        if (
          elementRect.top < containerRect.top ||
          elementRect.bottom > containerRect.bottom
        ) {
          return;
        }

        // Calculate target position
        const targetY = containerRect.top + containerRect.height * offset;
        const currentY = elementRect.top + elementRect.height / 2;
        const scrollDelta = currentY - targetY;

        // Only scroll if there's a significant difference
        if (Math.abs(scrollDelta) > 20) {
          isScrolling.current = true;
          container.scrollBy({
            top: scrollDelta,
            behavior: "smooth",
          });

          // Reset scrolling flag after animation
          setTimeout(() => {
            isScrolling.current = false;
          }, 300);
        }
        return;
      }

      const rect = rects[0];
      const containerRect = container.getBoundingClientRect();

      // Check if cursor is within the container
      if (
        rect.top < containerRect.top ||
        rect.bottom > containerRect.bottom
      ) {
        return;
      }

      // Calculate target position (offset from top)
      const targetY = containerRect.top + containerRect.height * offset;
      const currentY = rect.top + rect.height / 2;
      const scrollDelta = currentY - targetY;

      // Only scroll if there's a significant difference (avoid jittering)
      if (Math.abs(scrollDelta) > 20) {
        isScrolling.current = true;
        container.scrollBy({
          top: scrollDelta,
          behavior: "smooth",
        });

        // Reset scrolling flag after animation
        setTimeout(() => {
          isScrolling.current = false;
        }, 300);
      }
    };

    // Debounce to avoid too frequent updates
    let timeoutId: number;
    const debouncedHandler = () => {
      clearTimeout(timeoutId);
      timeoutId = window.setTimeout(handleSelectionChange, 50);
    };

    // Listen to selection changes (covers typing, clicking, arrow keys)
    document.addEventListener("selectionchange", debouncedHandler);

    // Also listen to keyup for Enter key (new lines)
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        // Small delay to allow DOM to update
        setTimeout(handleSelectionChange, 10);
      }
    };
    container.addEventListener("keyup", handleKeyUp);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("selectionchange", debouncedHandler);
      container.removeEventListener("keyup", handleKeyUp);
    };
  }, [enabled, containerRef, offset]);

  // Store last scroll position when scrolling manually
  useEffect(() => {
    if (!enabled) return;

    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (!isScrolling.current) {
        lastScrollTop.current = container.scrollTop;
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [enabled, containerRef]);
}
