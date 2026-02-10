import { useEffect, useRef, type RefObject } from "react";
import type EditorJS from "@editorjs/editorjs";

interface UseHeaderCollapseOptions {
  containerRef: RefObject<HTMLElement | null>;
  editorRef: RefObject<EditorJS | null>;
  holderId: string;
  enabled?: boolean;
}

// Chevron SVG encoded for use in CSS mask-image (theme-aware via currentColor)
const CHEVRON_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">` +
    `<path d="M7 10l5 5 5-5z" fill="black"/>` +
    `</svg>`
);

/**
 * Adds collapsible section toggles to Editor.js header blocks (H1-H4).
 * Clicking a toggle hides all blocks until the next header of equal or higher level.
 * Collapse state is view-only (not persisted), resets on page switch.
 *
 * IMPORTANT: This hook makes ZERO DOM mutations inside the editor container.
 * All visual changes are applied via a <style> tag in <head>, and clicks are
 * handled via event delegation on the container. This avoids triggering
 * Editor.js's internal MutationObserver and prevents WebKitGTK rendering freezes.
 */
export function useHeaderCollapse({
  containerRef,
  editorRef: _editorRef,
  holderId,
  enabled = true,
}: UseHeaderCollapseOptions) {
  const collapsedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;

    // Create <style> element in <head> — OUTSIDE the editor container,
    // so updates never trigger Editor.js's MutationObserver.
    const styleEl = document.createElement("style");
    styleEl.id = `header-collapse-${holderId}`;
    document.head.appendChild(styleEl);

    const getHeaderLevel = (block: HTMLElement): number => {
      for (let level = 1; level <= 4; level++) {
        if (block.querySelector(`h${level}.ce-header`)) return level;
      }
      return 0;
    };

    const getBlocks = (): HTMLElement[] => {
      return Array.from(
        container.querySelectorAll(
          ".ce-block:not(.columns-editor-holder .ce-block)"
        )
      ) as HTMLElement[];
    };

    // Regenerate CSS based on current block layout and collapse state.
    // This reads the DOM (block IDs, header levels) but never writes to it.
    const updateCSS = () => {
      const blocks = getBlocks();
      const lines: string[] = [];

      // Base styles: toggle chevron via ::before on all headers.
      // Uses mask-image so the chevron inherits the header's text color.
      lines.push(
        `#${holderId} .ce-block .ce-header {` +
          `position: relative;` +
          `padding-left: 24px;` +
          `}`,
        `#${holderId} .ce-block .ce-header::before {` +
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
        `#${holderId} .ce-block:hover .ce-header::before {` +
          `opacity: 0.5;` +
          `}`
      );

      // Per-collapsed-header: rotated chevron + hide subsequent blocks
      for (const collapsedId of collapsedIds.current) {
        const blockIdx = blocks.findIndex(
          (b) => b.getAttribute("data-block-id") === collapsedId
        );
        if (blockIdx === -1) continue;
        const headerLevel = getHeaderLevel(blocks[blockIdx]);
        if (headerLevel === 0) continue;

        // Rotated chevron, always visible
        lines.push(
          `#${holderId} .ce-block[data-block-id="${collapsedId}"] .ce-header::before {` +
            `transform: translateY(-50%) rotate(-90deg);` +
            `opacity: 0.7;` +
            `}`
        );

        // Hide subsequent blocks until next header of equal/higher level
        for (let i = blockIdx + 1; i < blocks.length; i++) {
          const siblingLevel = getHeaderLevel(blocks[i]);
          if (siblingLevel > 0 && siblingLevel <= headerLevel) break;
          const siblingId = blocks[i].getAttribute("data-block-id");
          if (siblingId) {
            lines.push(
              `#${holderId} .ce-block[data-block-id="${siblingId}"] { display: none; }`
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
      const header = target.closest(".ce-header") as HTMLElement | null;
      if (!header) return;

      // Only toggle when clicking the left 28px (the ::before toggle area)
      const headerRect = header.getBoundingClientRect();
      const clickX = e.clientX - headerRect.left;
      if (clickX > 28) return;

      const block = header.closest(".ce-block") as HTMLElement | null;
      if (!block) return;
      const blockId = block.getAttribute("data-block-id");
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

    // Use capture phase so we intercept before Editor.js handles the click
    container.addEventListener("click", handleClick, true);

    // Initial CSS generation — wait for assignBlockIdAttributes (runs at ~100ms
    // after onReady, plus the 500ms rendering guard in useEditor).
    const timeoutId = setTimeout(updateCSS, 700);

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
            (node.classList.contains("ce-block") ||
              node.querySelector?.(".ce-block"))
          ) {
            shouldUpdate = true;
            break;
          }
        }
        if (!shouldUpdate) {
          for (const node of mutation.removedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.classList.contains("ce-block") ||
                node.querySelector?.(".ce-block"))
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
  }, [containerRef, holderId, enabled]);
}
