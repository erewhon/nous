import { useEffect, useRef, type RefObject } from "react";

interface UseBlockNoteHeaderCollapseOptions {
  containerRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
}

// Chevron SVG encoded for use in CSS mask-image (theme-aware via currentColor)
const CHEVRON_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">` +
    `<path d="M7 10l5 5 5-5z" fill="black"/>` +
    `</svg>`
);

/**
 * Adds collapsible section toggles to BlockNote heading blocks (H1-H4).
 * Clicking a toggle hides all blocks until the next heading of equal or higher level.
 * Collapse state is view-only (not persisted), resets on page switch.
 *
 * Adapted from useHeaderCollapse.ts (Editor.js version) for BlockNote's DOM:
 * - `.ce-block` → `[data-node-type="blockContainer"]`
 * - `data-block-id` → `data-id`
 * - `.ce-header` / `h1.ce-header` → `[data-content-type="heading"]`
 * - Header level: `[data-level]` attribute on `[data-content-type="heading"]`
 *
 * IMPORTANT: This hook makes ZERO DOM mutations inside the editor container.
 * All visual changes are applied via a <style> tag in <head>, and clicks are
 * handled via event delegation on the container.
 */
export function useBlockNoteHeaderCollapse({
  containerRef,
  enabled = true,
}: UseBlockNoteHeaderCollapseOptions) {
  const collapsedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;

    // Create <style> element in <head> — OUTSIDE the editor container,
    // so updates never trigger ProseMirror's internal observers.
    const styleEl = document.createElement("style");
    styleEl.id = `bn-header-collapse-${Date.now()}`;
    document.head.appendChild(styleEl);

    // Unique selector scoped to this container via data-page-id
    const pageId = container.getAttribute("data-page-id") || "";
    const scopeSelector = pageId
      ? `.bn-editor-wrapper[data-page-id="${pageId}"]`
      : ".bn-editor-wrapper";

    const getHeaderLevel = (block: HTMLElement): number => {
      const heading = block.querySelector(
        '[data-content-type="heading"]'
      ) as HTMLElement | null;
      if (!heading) return 0;
      const level = parseInt(heading.getAttribute("data-level") || "0", 10);
      return level >= 1 && level <= 4 ? level : 0;
    };

    const getBlocks = (): HTMLElement[] => {
      return Array.from(
        container.querySelectorAll(
          '[data-node-type="blockContainer"]'
        )
      ) as HTMLElement[];
    };

    const getBlockId = (block: HTMLElement): string | null => {
      return block.getAttribute("data-id");
    };

    // Regenerate CSS based on current block layout and collapse state.
    // This reads the DOM (block IDs, header levels) but never writes to it.
    const updateCSS = () => {
      const blocks = getBlocks();
      const lines: string[] = [];

      // Base styles: toggle chevron via ::before on all headings.
      // Uses mask-image so the chevron inherits the heading's text color.
      lines.push(
        `${scopeSelector} [data-node-type="blockContainer"] [data-content-type="heading"] {` +
          `position: relative;` +
          `padding-left: 24px;` +
          `}`,
        `${scopeSelector} [data-node-type="blockContainer"] [data-content-type="heading"]::before {` +
          `content: "";` +
          `position: absolute;` +
          `left: 2px;` +
          `top: 50%;` +
          `transform: translateY(-50%);` +
          `width: 16px;` +
          `height: 16px;` +
          `-webkit-mask-image: url("data:image/svg+xml,${CHEVRON_SVG}");` +
          `mask-image: url("data:image/svg+xml,${CHEVRON_SVG}");` +
          `-webkit-mask-size: contain;` +
          `mask-size: contain;` +
          `-webkit-mask-repeat: no-repeat;` +
          `mask-repeat: no-repeat;` +
          `background-color: currentColor;` +
          `cursor: pointer;` +
          `opacity: 0;` +
          `transition: transform 0.15s ease, opacity 0.15s ease;` +
          `}`,
        `${scopeSelector} [data-node-type="blockContainer"]:hover [data-content-type="heading"]::before {` +
          `opacity: 0.5;` +
          `}`
      );

      // Per-collapsed-header: rotated chevron + hide subsequent blocks
      for (const collapsedId of collapsedIds.current) {
        const blockIdx = blocks.findIndex(
          (b) => getBlockId(b) === collapsedId
        );
        if (blockIdx === -1) continue;
        const headerLevel = getHeaderLevel(blocks[blockIdx]);
        if (headerLevel === 0) continue;

        // Rotated chevron, always visible
        lines.push(
          `${scopeSelector} [data-node-type="blockContainer"][data-id="${collapsedId}"] [data-content-type="heading"]::before {` +
            `transform: translateY(-50%) rotate(-90deg);` +
            `opacity: 0.7;` +
            `}`
        );

        // Hide subsequent blocks until next heading of equal/higher level
        for (let i = blockIdx + 1; i < blocks.length; i++) {
          const siblingLevel = getHeaderLevel(blocks[i]);
          if (siblingLevel > 0 && siblingLevel <= headerLevel) break;
          const siblingId = getBlockId(blocks[i]);
          if (siblingId) {
            lines.push(
              `${scopeSelector} [data-node-type="blockContainer"][data-id="${siblingId}"] { display: none; }`
            );
          }
        }
      }

      styleEl.textContent = lines.join("\n");
    };

    // Toggle click handler via event delegation — no elements inserted,
    // no event listeners on editor internals.
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const heading = target.closest(
        '[data-content-type="heading"]'
      ) as HTMLElement | null;
      if (!heading) return;

      // Only toggle when clicking the left 28px (the ::before toggle area)
      const headingRect = heading.getBoundingClientRect();
      const clickX = e.clientX - headingRect.left;
      if (clickX > 28) return;

      const block = heading.closest(
        '[data-node-type="blockContainer"]'
      ) as HTMLElement | null;
      if (!block) return;
      const blockId = getBlockId(block);
      if (!blockId) return;

      e.preventDefault();
      e.stopPropagation();

      if (collapsedIds.current.has(blockId)) {
        collapsedIds.current.delete(blockId);
      } else {
        collapsedIds.current.add(blockId);
      }

      updateCSS();
    };

    // Use capture phase so we intercept before ProseMirror handles the click
    container.addEventListener("click", handleClick, true);

    // Initial CSS generation — BlockNote renders quickly, but give a small delay
    const timeoutId = setTimeout(updateCSS, 200);

    // Watch for block additions/removals to regenerate CSS.
    // This observer only READS block IDs — it never modifies the DOM.
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;
        for (const node of mutation.addedNodes) {
          if (
            node instanceof HTMLElement &&
            (node.getAttribute("data-node-type") === "blockContainer" ||
              node.querySelector?.('[data-node-type="blockContainer"]'))
          ) {
            shouldUpdate = true;
            break;
          }
        }
        if (!shouldUpdate) {
          for (const node of mutation.removedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.getAttribute("data-node-type") === "blockContainer" ||
                node.querySelector?.('[data-node-type="blockContainer"]'))
            ) {
              shouldUpdate = true;
              break;
            }
          }
        }
        if (shouldUpdate) break;
      }
      if (shouldUpdate) {
        // Block structure changed — clear collapse state and regenerate
        collapsedIds.current.clear();
        if (debounceId) clearTimeout(debounceId);
        debounceId = setTimeout(updateCSS, 200);
      }
    });

    observer.observe(container, { childList: true, subtree: true });

    return () => {
      clearTimeout(timeoutId);
      if (debounceId) clearTimeout(debounceId);
      observer.disconnect();
      container.removeEventListener("click", handleClick, true);
      collapsedIds.current.clear();
      styleEl.remove();
    };
  }, [containerRef, enabled]);
}
