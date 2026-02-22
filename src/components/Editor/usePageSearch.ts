import { useState, useRef, useCallback, useEffect } from "react";

interface PageSearchMatch {
  blockElement: HTMLElement;
  textNode: Text;
  rangeStart: number;
  length: number;
}

interface UsePageSearchOptions {
  holderId: string;
  scrollContainerRef: React.RefObject<HTMLElement | null>;
  active: boolean;
}

const HIGHLIGHT_SUPPORTED = typeof Highlight !== "undefined";

/**
 * In-page text search for the Editor.js content area.
 *
 * Uses the CSS Custom Highlight API (zero DOM mutations) when available,
 * with a block-level CSS fallback (injected <style> in <head>, same pattern
 * as useHeaderCollapse) for browsers without support.
 *
 * IMPORTANT: This hook NEVER mutates DOM inside the editor container.
 * All highlighting is done via CSS.highlights or a <style> tag in <head>.
 */
export function usePageSearch({
  holderId,
  scrollContainerRef: _scrollContainerRef,
  active,
}: UsePageSearchOptions) {
  const [query, setQuery] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  const matchesRef = useRef<PageSearchMatch[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackStyleRef = useRef<HTMLStyleElement | null>(null);

  // Run search: walk text nodes, find matches, set highlights
  const runSearch = useCallback(
    (q: string) => {
      // Clear previous highlights
      if (HIGHLIGHT_SUPPORTED) {
        CSS.highlights.delete("page-search");
        CSS.highlights.delete("page-search-current");
      }
      if (fallbackStyleRef.current) {
        fallbackStyleRef.current.textContent = "";
      }

      if (!q || !holderId) {
        matchesRef.current = [];
        setTotalCount(0);
        setCurrentIndex(0);
        return;
      }

      const container = document.getElementById(holderId);
      if (!container) {
        matchesRef.current = [];
        setTotalCount(0);
        setCurrentIndex(0);
        return;
      }

      const lowerQuery = q.toLowerCase();
      const matches: PageSearchMatch[] = [];

      // Walk all text nodes inside the editor container
      const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        {
          acceptNode(node) {
            // Skip text nodes in hidden blocks (collapsed headers)
            const block = (node.parentElement as HTMLElement | null)?.closest(
              ".ce-block"
            ) as HTMLElement | null;
            if (block && block.offsetParent === null) {
              return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
          },
        }
      );

      let textNode: Text | null;
      while ((textNode = walker.nextNode() as Text | null)) {
        const text = textNode.textContent;
        if (!text) continue;
        const lowerText = text.toLowerCase();
        let startIdx = 0;
        while (true) {
          const idx = lowerText.indexOf(lowerQuery, startIdx);
          if (idx === -1) break;

          const blockEl = (
            textNode.parentElement as HTMLElement | null
          )?.closest(".ce-block") as HTMLElement | null;

          if (blockEl) {
            matches.push({
              blockElement: blockEl,
              textNode,
              rangeStart: idx,
              length: q.length,
            });
          }
          startIdx = idx + 1;
        }
      }

      matchesRef.current = matches;
      setTotalCount(matches.length);

      const newIndex = matches.length > 0 ? 0 : 0;
      setCurrentIndex(newIndex);

      // Apply highlights
      if (HIGHLIGHT_SUPPORTED && matches.length > 0) {
        const allRanges = matches.map((m) => {
          const range = new Range();
          range.setStart(m.textNode, m.rangeStart);
          range.setEnd(m.textNode, m.rangeStart + m.length);
          return range;
        });
        CSS.highlights.set("page-search", new Highlight(...allRanges));

        // Highlight current match
        const currentRange = new Range();
        currentRange.setStart(matches[0].textNode, matches[0].rangeStart);
        currentRange.setEnd(
          matches[0].textNode,
          matches[0].rangeStart + matches[0].length
        );
        CSS.highlights.set("page-search-current", new Highlight(currentRange));

        // Scroll to first match
        matches[0].blockElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      } else if (!HIGHLIGHT_SUPPORTED && matches.length > 0) {
        // Fallback: block-level CSS highlighting
        applyFallbackCSS(matches, 0);
        matches[0].blockElement.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    },
    [holderId]
  );

  // Fallback CSS highlighting (block-level, same pattern as useHeaderCollapse)
  const applyFallbackCSS = useCallback(
    (matches: PageSearchMatch[], currentIdx: number) => {
      if (!holderId) return;
      if (!fallbackStyleRef.current) {
        fallbackStyleRef.current = document.createElement("style");
        fallbackStyleRef.current.id = `page-search-fallback-${holderId}`;
        document.head.appendChild(fallbackStyleRef.current);
      }

      const escapedId = CSS.escape(holderId);
      const matchBlockIds = new Set<string>();
      let currentBlockId: string | null = null;

      matches.forEach((m, i) => {
        const blockId = m.blockElement.getAttribute("data-block-id");
        if (blockId) {
          matchBlockIds.add(blockId);
          if (i === currentIdx) currentBlockId = blockId;
        }
      });

      const rules: string[] = [];
      for (const blockId of matchBlockIds) {
        const isCurrent = blockId === currentBlockId;
        rules.push(
          `#${escapedId} .ce-block[data-block-id="${CSS.escape(blockId)}"] .ce-block__content {` +
            `background-color: ${isCurrent ? "rgba(250, 204, 21, 0.25)" : "rgba(250, 204, 21, 0.1)"};` +
            (isCurrent ? `outline: 2px solid rgba(250, 204, 21, 0.5);` : "") +
            `border-radius: 2px;` +
            `}`
        );
      }

      fallbackStyleRef.current.textContent = rules.join("\n");
    },
    [holderId]
  );

  // Update current match highlight (for navigation)
  const updateCurrentHighlight = useCallback(
    (idx: number) => {
      const matches = matchesRef.current;
      if (matches.length === 0) return;

      if (HIGHLIGHT_SUPPORTED) {
        const m = matches[idx];
        const range = new Range();
        range.setStart(m.textNode, m.rangeStart);
        range.setEnd(m.textNode, m.rangeStart + m.length);
        CSS.highlights.set("page-search-current", new Highlight(range));
      } else {
        applyFallbackCSS(matches, idx);
      }

      matches[idx].blockElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    },
    [applyFallbackCSS]
  );

  // Debounced search on query change
  useEffect(() => {
    if (!active) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(query);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, active, runSearch]);

  // Re-search on holderId change (page switch while search is open)
  useEffect(() => {
    if (!active || !query) return;
    runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holderId]);

  // Cleanup on deactivation or unmount
  useEffect(() => {
    if (!active) {
      if (HIGHLIGHT_SUPPORTED) {
        CSS.highlights.delete("page-search");
        CSS.highlights.delete("page-search-current");
      }
      if (fallbackStyleRef.current) {
        fallbackStyleRef.current.remove();
        fallbackStyleRef.current = null;
      }
      matchesRef.current = [];
      setTotalCount(0);
      setCurrentIndex(0);
    }
    return () => {
      if (HIGHLIGHT_SUPPORTED) {
        CSS.highlights.delete("page-search");
        CSS.highlights.delete("page-search-current");
      }
      if (fallbackStyleRef.current) {
        fallbackStyleRef.current.remove();
        fallbackStyleRef.current = null;
      }
    };
  }, [active]);

  const goToNext = useCallback(() => {
    if (matchesRef.current.length === 0) return;
    const next = (currentIndex + 1) % matchesRef.current.length;
    setCurrentIndex(next);
    updateCurrentHighlight(next);
  }, [currentIndex, updateCurrentHighlight]);

  const goToPrevious = useCallback(() => {
    if (matchesRef.current.length === 0) return;
    const prev =
      (currentIndex - 1 + matchesRef.current.length) %
      matchesRef.current.length;
    setCurrentIndex(prev);
    updateCurrentHighlight(prev);
  }, [currentIndex, updateCurrentHighlight]);

  const clear = useCallback(() => {
    setQuery("");
    if (HIGHLIGHT_SUPPORTED) {
      CSS.highlights.delete("page-search");
      CSS.highlights.delete("page-search-current");
    }
    if (fallbackStyleRef.current) {
      fallbackStyleRef.current.remove();
      fallbackStyleRef.current = null;
    }
    matchesRef.current = [];
    setTotalCount(0);
    setCurrentIndex(0);
  }, []);

  return {
    query,
    setQuery,
    currentIndex,
    totalCount,
    goToNext,
    goToPrevious,
    clear,
  };
}
