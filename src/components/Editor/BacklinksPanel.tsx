import { useMemo } from "react";
import { useLinkStore, type BlockRefInfo } from "../../stores/linkStore";
import { usePageStore } from "../../stores/pageStore";

interface BacklinksPanelProps {
  pageTitle: string;
  pageId: string;
  notebookId: string;
  onBlockRefClick?: (blockId: string, pageId: string) => void;
}

export function BacklinksPanel({
  pageTitle,
  pageId,
  notebookId,
  onBlockRefClick,
}: BacklinksPanelProps) {
  const getBacklinks = useLinkStore((s) => s.getBacklinks);
  const getBlockBacklinks = useLinkStore((s) => s.getBlockBacklinks);
  const selectPage = usePageStore((s) => s.selectPage);
  const pages = usePageStore((s) => s.pages);

  const backlinks = getBacklinks(pageTitle);

  // Collect block-level references for all blocks on this page
  const blockBacklinks = useMemo(() => {
    const currentPage = pages.find((p) => p.id === pageId);
    if (!currentPage?.content?.blocks) return [];

    const results: Array<{
      blockId: string;
      blockPreview: string;
      refs: BlockRefInfo[];
    }> = [];

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

  const handleBacklinkClick = (sourcePageId: string) => {
    // Verify the page exists and is in the same notebook
    const page = pages.find(
      (p) => p.id === sourcePageId && p.notebookId === notebookId
    );
    if (page) {
      selectPage(sourcePageId);
    }
  };

  if (backlinks.length === 0 && blockBacklinks.length === 0) {
    return null;
  }

  return (
    <div className="mt-8 border-t border-[--color-border] pt-6">
      {/* Page-level backlinks */}
      {backlinks.length > 0 && (
        <>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-[--color-text-secondary]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 17H7A5 5 0 0 1 7 7h2" />
              <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
            Backlinks ({backlinks.length})
          </h3>
          <ul className="space-y-2">
            {backlinks.map((backlink) => (
              <li key={backlink.sourcePageId}>
                <button
                  onClick={() => handleBacklinkClick(backlink.sourcePageId)}
                  className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-[--color-text-secondary] transition-colors hover:bg-[--color-bg-secondary] hover:text-[--color-text-primary]"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14,2 14,8 20,8" />
                  </svg>
                  <span className="truncate">{backlink.sourcePageTitle}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Block-level references */}
      {blockBacklinks.length > 0 && (
        <div className={backlinks.length > 0 ? "mt-6" : ""}>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-[--color-text-secondary]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 8h6" />
              <path d="M9 12h6" />
              <path d="M9 16h4" />
            </svg>
            Block References (
            {blockBacklinks.reduce((sum, b) => sum + b.refs.length, 0)})
          </h3>
          <ul className="space-y-3">
            {blockBacklinks.map((entry) => (
              <li key={entry.blockId}>
                <div
                  className="text-xs text-[--color-text-muted] px-3 py-1 truncate"
                  title={entry.blockPreview}
                >
                  {entry.blockPreview}
                </div>
                <ul className="space-y-1">
                  {entry.refs.map((ref) => (
                    <li key={`${ref.sourcePageId}-${ref.targetBlockId}`}>
                      <button
                        onClick={() => {
                          if (onBlockRefClick) {
                            // Navigate to the source page that contains the reference
                            onBlockRefClick(ref.targetBlockId, ref.sourcePageId);
                          } else {
                            handleBacklinkClick(ref.sourcePageId);
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm text-[--color-text-secondary] transition-colors hover:bg-[--color-bg-secondary] hover:text-[--color-text-primary]"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                          <polyline points="14,2 14,8 20,8" />
                        </svg>
                        <span className="truncate">
                          {ref.sourcePageTitle}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
