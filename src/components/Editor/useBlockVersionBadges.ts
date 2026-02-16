import { useEffect, useRef, useCallback, type RefObject } from "react";
import { getBlockVersionCounts } from "../../utils/api";

interface UseBlockVersionBadgesOptions {
  containerRef: RefObject<HTMLElement | null>;
  holderId: string;
  notebookId?: string;
  pageId?: string;
  pageDataVersion: number;
  enabled?: boolean;
  onBlockHistoryOpen?: (blockId: string) => void;
}

/**
 * Adds CSS-only version count badges to editor blocks.
 * Shows how many times each block has been modified, as a subtle pill badge
 * in the right gutter area.
 *
 * IMPORTANT: This hook makes ZERO DOM mutations inside the editor container.
 * All visual changes are applied via a <style> tag in <head>. This avoids
 * triggering Editor.js's internal MutationObserver and prevents WebKitGTK
 * rendering freezes.
 */
export function useBlockVersionBadges({
  containerRef,
  holderId,
  notebookId,
  pageId,
  pageDataVersion,
  enabled = true,
  onBlockHistoryOpen,
}: UseBlockVersionBadgesOptions) {
  const styleElRef = useRef<HTMLStyleElement | null>(null);
  const countsRef = useRef<Record<string, number>>({});
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch version counts and update CSS
  const updateBadges = useCallback(async () => {
    if (!notebookId || !pageId || !enabled) return;

    try {
      const counts = await getBlockVersionCounts(notebookId, pageId);
      countsRef.current = counts;

      if (!styleElRef.current) return;

      const lines: string[] = [];

      // Base style for the badge (applied via ::after pseudo-element)
      lines.push(
        `#${holderId} .ce-block[data-version-count]::after {` +
          `content: attr(data-version-count);` +
          `position: absolute;` +
          `right: -36px;` +
          `top: 4px;` +
          `font-size: 10px;` +
          `line-height: 16px;` +
          `padding: 0 5px;` +
          `border-radius: 8px;` +
          `background: var(--color-bg-tertiary, rgba(255,255,255,0.06));` +
          `color: var(--color-text-tertiary, rgba(255,255,255,0.35));` +
          `cursor: pointer;` +
          `opacity: 0;` +
          `transition: opacity 0.15s ease;` +
          `pointer-events: auto;` +
          `z-index: 1;` +
          `}`
      );

      // Show on hover
      lines.push(
        `#${holderId} .ce-block[data-version-count]:hover::after {` +
          `opacity: 1;` +
          `}`
      );

      // Per-block rules using CSS attribute selectors (no DOM mutation)
      for (const [blockId, count] of Object.entries(counts)) {
        if (count > 0) {
          lines.push(
            `#${holderId} .ce-block[data-block-id="${CSS.escape(blockId)}"] {` +
              `position: relative;` +
              `}`
          );
        }
      }

      styleElRef.current.textContent = lines.join("\n");

      // Set data-version-count attributes on blocks.
      // We do this via the container (outside the Editor.js contenteditable),
      // targeting .ce-block wrappers which are not contenteditable themselves.
      // This is safe — .ce-block is the outer wrapper managed by Editor.js.
      const container = containerRef.current;
      if (container) {
        const blocks = container.querySelectorAll(
          ".ce-block:not(.columns-editor-holder .ce-block)"
        );
        for (const block of blocks) {
          const blockId = block.getAttribute("data-block-id");
          if (blockId && counts[blockId] && counts[blockId] > 0) {
            block.setAttribute("data-version-count", String(counts[blockId]));
          } else {
            block.removeAttribute("data-version-count");
          }
        }
      }
    } catch {
      // Best-effort — don't fail the editor for badge issues
    }
  }, [notebookId, pageId, enabled, holderId, containerRef]);

  useEffect(() => {
    if (!enabled || !containerRef.current || !notebookId || !pageId) return;

    // Create <style> element in <head>
    const styleEl = document.createElement("style");
    styleEl.id = `block-version-badges-${holderId}`;
    document.head.appendChild(styleEl);
    styleElRef.current = styleEl;

    // Debounced fetch — don't fetch on every pageDataVersion change
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(updateBadges, 1500);

    return () => {
      if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
      styleEl.remove();
      styleElRef.current = null;
      // Clean up data-version-count attributes
      const container = containerRef.current;
      if (container) {
        const blocks = container.querySelectorAll("[data-version-count]");
        for (const block of blocks) {
          block.removeAttribute("data-version-count");
        }
      }
    };
  }, [containerRef, holderId, enabled, notebookId, pageId]);

  // Re-fetch when pageDataVersion changes (debounced)
  useEffect(() => {
    if (!enabled || !notebookId || !pageId) return;
    if (fetchTimeoutRef.current) clearTimeout(fetchTimeoutRef.current);
    fetchTimeoutRef.current = setTimeout(updateBadges, 2000);
  }, [pageDataVersion, updateBadges, enabled, notebookId, pageId]);

  // Click handler for badge area (event delegation)
  useEffect(() => {
    if (!enabled || !containerRef.current || !onBlockHistoryOpen) return;

    const container = containerRef.current;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const block = target.closest(".ce-block") as HTMLElement | null;
      if (!block) return;

      const versionCount = block.getAttribute("data-version-count");
      if (!versionCount) return;

      // Check if the click is in the badge area (right side beyond content)
      const blockRect = block.getBoundingClientRect();
      const clickX = e.clientX - blockRect.left;
      if (clickX < blockRect.width - 10) return; // Must click near the right edge

      const blockId = block.getAttribute("data-block-id");
      if (!blockId) return;

      e.preventDefault();
      e.stopPropagation();
      onBlockHistoryOpen(blockId);
    };

    container.addEventListener("click", handleClick, true);

    return () => {
      container.removeEventListener("click", handleClick, true);
    };
  }, [containerRef, enabled, onBlockHistoryOpen]);
}
