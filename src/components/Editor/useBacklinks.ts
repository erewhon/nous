import { useMemo } from "react";
import { useLinkStore, type BlockRefInfo, type LinkInfo } from "../../stores/linkStore";
import { usePageStore } from "../../stores/pageStore";
import { extractBacklinkExcerpt, type BacklinkExcerpt } from "./backlinkExcerpt";

export interface BlockBacklinkEntry {
  blockId: string;
  blockPreview: string;
  refs: BlockRefInfo[];
}

export interface BacklinkWithExcerpt extends LinkInfo {
  /** Sentence around the wiki-link in the source page, split for highlighting;
      null when the source content isn't loaded or the link isn't in a text block. */
  excerpt: BacklinkExcerpt | null;
}

export interface UseBacklinksResult {
  /** Page-level backlinks (pages that [[wiki-link]] to this page's title). */
  backlinks: BacklinkWithExcerpt[];
  /** Block-level references grouped by the block on this page they point at. */
  blockBacklinks: BlockBacklinkEntry[];
  /** Always false today — backlinks come from synchronous store selectors, not
      an async fetch — but exposed so callers can treat this like a data hook. */
  loading: boolean;
  /** Navigate to a backlink's source page (same-notebook guard, as the inline panel). */
  navigateToBacklink: (sourcePageId: string) => void;
}

/**
 * Backlink data for a page, extracted verbatim from BacklinksPanel so the
 * inline panel and the Study right rail can render the same data without
 * duplicating the store reads and block-preview computation.
 */
export function useBacklinks(
  notebookId: string,
  pageId: string,
  pageTitle: string
): UseBacklinksResult {
  const getBacklinks = useLinkStore((s) => s.getBacklinks);
  const getBlockBacklinks = useLinkStore((s) => s.getBlockBacklinks);
  const selectPage = usePageStore((s) => s.selectPage);
  const pages = usePageStore((s) => s.pages);

  const rawBacklinks = getBacklinks(pageTitle);

  // Attach the source-sentence excerpt to each backlink (the rail's card body).
  const backlinks = useMemo(
    () =>
      rawBacklinks.map((bl): BacklinkWithExcerpt => {
        const source = pages.find((p) => p.id === bl.sourcePageId);
        return {
          ...bl,
          excerpt: extractBacklinkExcerpt(
            source?.content?.blocks,
            bl.targetTitle
          ),
        };
      }),
    [rawBacklinks, pages]
  );

  // Collect block-level references for all blocks on this page.
  const blockBacklinks = useMemo(() => {
    const currentPage = pages.find((p) => p.id === pageId);
    if (!currentPage?.content?.blocks) return [];

    const results: BlockBacklinkEntry[] = [];

    for (const block of currentPage.content.blocks) {
      const refs = getBlockBacklinks(block.id);
      if (refs.length > 0) {
        // Get a text preview of the block
        let preview = "";
        if (typeof block.data.text === "string") {
          const tmp = document.createElement("div");
          tmp.innerHTML = block.data.text;
          preview = tmp.textContent || tmp.innerText || "";
        }
        if (preview.length > 80) preview = preview.slice(0, 80) + "...";

        results.push({
          blockId: block.id,
          blockPreview: preview || "(block)",
          refs,
        });
      }
    }

    return results;
  }, [pageId, pages, getBlockBacklinks]);

  const navigateToBacklink = (sourcePageId: string) => {
    // Verify the page exists and is in the same notebook
    const page = pages.find(
      (p) => p.id === sourcePageId && p.notebookId === notebookId
    );
    if (page) {
      selectPage(sourcePageId);
    }
  };

  return { backlinks, blockBacklinks, loading: false, navigateToBacklink };
}
