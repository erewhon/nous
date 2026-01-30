import { useEffect, useRef, type RefObject } from "react";
import type EditorJS from "@editorjs/editorjs";

interface UseHeaderCollapseOptions {
  containerRef: RefObject<HTMLElement | null>;
  editorRef: RefObject<EditorJS | null>;
  enabled?: boolean;
}

/**
 * Adds collapsible section toggles to Editor.js header blocks (H1-H4).
 * Clicking a toggle hides all blocks until the next header of equal or higher level.
 * Collapse state is view-only (not persisted), resets on page switch.
 */
export function useHeaderCollapse({
  containerRef,
  editorRef,
  enabled = true,
}: UseHeaderCollapseOptions) {
  const collapsedHeaders = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const container = containerRef.current;
    let observer: MutationObserver | null = null;

    // Get the header level (1-4) from a .ce-block element, or 0 if not a header
    const getHeaderLevel = (block: HTMLElement): number => {
      for (let level = 1; level <= 4; level++) {
        if (block.querySelector(`h${level}.ce-header`)) {
          return level;
        }
      }
      return 0;
    };

    // Get the actual header element (h1-h4) from a block
    const getHeaderElement = (block: HTMLElement): HTMLElement | null => {
      for (let level = 1; level <= 4; level++) {
        const el = block.querySelector(`h${level}.ce-header`);
        if (el) return el as HTMLElement;
      }
      return null;
    };

    // Get all top-level editor blocks (not inside columns)
    const getBlocks = (): HTMLElement[] => {
      return Array.from(
        container.querySelectorAll(
          ".ce-block:not(.columns-editor-holder .ce-block)"
        )
      ) as HTMLElement[];
    };

    // Create toggle chevron element
    const createToggle = (isCollapsed: boolean): HTMLElement => {
      const toggle = document.createElement("span");
      toggle.className = "ce-header-collapse-toggle";
      if (isCollapsed) {
        toggle.classList.add("ce-header-collapse-toggle--collapsed");
      }
      toggle.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
      toggle.title = isCollapsed ? "Expand section" : "Collapse section";
      return toggle;
    };

    // Apply collapse/expand for a given header block index
    const applyCollapseState = (blocks: HTMLElement[]) => {
      // First, remove all section-collapsed classes
      for (const block of blocks) {
        block.classList.remove("ce-block--section-collapsed");
      }

      // For each collapsed header, hide subsequent blocks
      for (const headerIdx of collapsedHeaders.current) {
        if (headerIdx >= blocks.length) continue;
        const headerBlock = blocks[headerIdx];
        const headerLevel = getHeaderLevel(headerBlock);
        if (headerLevel === 0) continue;

        // Walk subsequent siblings and hide until next header of equal/higher level
        for (let i = headerIdx + 1; i < blocks.length; i++) {
          const siblingLevel = getHeaderLevel(blocks[i]);
          if (siblingLevel > 0 && siblingLevel <= headerLevel) {
            break; // Stop at equal or higher level header
          }
          blocks[i].classList.add("ce-block--section-collapsed");
        }
      }
    };

    // Inject toggle buttons on all header blocks
    const processHeaders = () => {
      const blocks = getBlocks();

      // Remove existing toggles
      container
        .querySelectorAll(".ce-header-collapse-toggle")
        .forEach((el) => el.remove());

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const level = getHeaderLevel(block);
        if (level === 0) continue;

        const isCollapsed = collapsedHeaders.current.has(i);
        const toggle = createToggle(isCollapsed);

        // Insert toggle inline as the first child of the header element
        const headerEl = getHeaderElement(block);
        if (headerEl) {
          headerEl.insertBefore(toggle, headerEl.firstChild);
        }

        // Handle click
        toggle.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          if (collapsedHeaders.current.has(i)) {
            collapsedHeaders.current.delete(i);
          } else {
            collapsedHeaders.current.add(i);
          }

          // Re-process to update toggles and visibility
          processHeaders();
        });
      }

      applyCollapseState(blocks);
    };

    // Initial processing (with delay for Editor.js to render)
    const timeoutId = setTimeout(processHeaders, 200);

    // Watch for DOM changes
    let debounceId: ReturnType<typeof setTimeout> | null = null;
    observer = new MutationObserver((mutations) => {
      let shouldProcess = false;
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          for (const node of mutation.addedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.classList.contains("ce-block") ||
                node.querySelector?.(".ce-block"))
            ) {
              shouldProcess = true;
              break;
            }
          }
          for (const node of mutation.removedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.classList.contains("ce-block") ||
                node.querySelector?.(".ce-block"))
            ) {
              shouldProcess = true;
              break;
            }
          }
        }
        if (shouldProcess) break;
      }
      if (shouldProcess) {
        // On structural changes, clear collapse state and re-inject
        collapsedHeaders.current.clear();
        if (debounceId) clearTimeout(debounceId);
        debounceId = setTimeout(processHeaders, 50);
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      clearTimeout(timeoutId);
      if (debounceId) clearTimeout(debounceId);
      observer?.disconnect();
      collapsedHeaders.current.clear();

      // Clean up toggles and collapsed classes
      container
        .querySelectorAll(".ce-header-collapse-toggle")
        .forEach((el) => el.remove());
      container
        .querySelectorAll(".ce-block--section-collapsed")
        .forEach((el) => el.classList.remove("ce-block--section-collapsed"));
    };
  }, [containerRef, editorRef, enabled]);
}
