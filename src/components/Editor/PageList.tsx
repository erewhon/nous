import { useState, useMemo, useEffect, memo, useCallback } from "react";
import type { Page, PageType } from "../../types/page";
import type { StudyPageContent } from "../../types/studyTools";
import { usePageStore } from "../../stores/pageStore";
import { useTagStore } from "../../stores/tagStore";
import { PageContextMenu } from "./PageContextMenu";

// Icon component for different page types
function PageTypeIcon({ pageType }: { pageType: PageType }) {
  switch (pageType) {
    case "chat":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
          <path d="M19 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
        </svg>
      );
    case "markdown":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
          <path d="M9 15v-3l2 2 2-2v3" />
        </svg>
      );
    case "pdf":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
          <path d="M10 12h4" />
          <path d="M10 16h4" />
        </svg>
      );
    case "jupyter":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "calendar":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "epub":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
      );
    case "canvas":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <circle cx="15" cy="15" r="2" />
        </svg>
      );
    case "database":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18" />
          <path d="M3 15h18" />
          <path d="M9 3v18" />
        </svg>
      );
    default:
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
        </svg>
      );
  }
}

// Memoized page list item for better performance
interface PageListItemProps {
  page: Page;
  isSelected: boolean;
  onSelect: (pageId: string) => void;
  onContextMenu: (page: Page, position: { x: number; y: number }) => void;
}

const PageListItem = memo(function PageListItem({
  page,
  isSelected,
  onSelect,
  onContextMenu,
}: PageListItemProps) {
  const handleClick = useCallback(() => {
    onSelect(page.id);
  }, [onSelect, page.id]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onContextMenu(page, { x: e.clientX, y: e.clientY });
    },
    [page, onContextMenu]
  );

  return (
    <li>
      <button
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        className="flex w-full items-center gap-3 rounded-lg text-left transition-all p-3"
        style={{
          backgroundColor: isSelected ? "var(--color-bg-tertiary)" : "transparent",
          color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
          borderLeft: `3px solid ${isSelected ? "var(--color-accent)" : "transparent"}`,
        }}
      >
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
          style={{
            backgroundColor: isSelected
              ? "rgba(139, 92, 246, 0.2)"
              : "var(--color-bg-tertiary)",
            color: isSelected ? "var(--color-accent)" : "var(--color-text-muted)",
          }}
        >
          <PageTypeIcon pageType={page.pageType} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {page.title}
          </span>
          {page.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {page.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full text-xs px-2 py-0.5"
                  style={{
                    backgroundColor: "rgba(139, 92, 246, 0.1)",
                    color: "var(--color-accent)",
                  }}
                >
                  {tag}
                </span>
              ))}
              {page.tags.length > 2 && (
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  +{page.tags.length - 2}
                </span>
              )}
            </div>
          )}
        </div>
      </button>
    </li>
  );
});

interface PageListProps {
  pages: Page[];
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  notebookId: string;
  onOpenStudyTools?: (pages: StudyPageContent[]) => void;
}

export function PageList({
  pages,
  selectedPageId,
  onSelectPage,
  notebookId,
  onOpenStudyTools,
}: PageListProps) {
  const { createPage } = usePageStore();
  const {
    buildTagsFromPages,
    getTagsByFrequency,
    selectedTags,
    toggleTagFilter,
    clearTagFilter,
    filterPagesByTags,
  } = useTagStore();
  const [showTagFilter, setShowTagFilter] = useState(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    page: Page;
    position: { x: number; y: number };
  } | null>(null);

  const handleContextMenu = useCallback(
    (page: Page, position: { x: number; y: number }) => {
      setContextMenu({ page, position });
    },
    []
  );

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleOpenStudyTools = useCallback(
    (studyPages: StudyPageContent[]) => {
      if (onOpenStudyTools) {
        onOpenStudyTools(studyPages);
      }
      setContextMenu(null);
    },
    [onOpenStudyTools]
  );

  // Build tags from pages when pages change
  useEffect(() => {
    buildTagsFromPages(pages);
  }, [pages, buildTagsFromPages]);

  // Get tags sorted by frequency
  const allTags = useMemo(() => getTagsByFrequency(), [getTagsByFrequency, pages]);

  // Filter pages by selected tags
  const filteredPages = useMemo(
    () => filterPagesByTags(pages),
    [filterPagesByTags, pages, selectedTags]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-5">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-text-muted)" }}
        >
          Pages
        </span>
        <div className="flex items-center gap-1">
          {/* Tag filter toggle */}
          <button
            onClick={() => setShowTagFilter(!showTagFilter)}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
            style={{
              color: selectedTags.length > 0 ? "var(--color-accent)" : "var(--color-text-muted)",
              backgroundColor: selectedTags.length > 0 ? "rgba(139, 92, 246, 0.1)" : "transparent",
            }}
            title="Filter by tags"
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
              <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
              <line x1="7" y1="7" x2="7.01" y2="7" />
            </svg>
          </button>
          {/* Create page button */}
          <button
            onClick={() => createPage(notebookId, "Untitled")}
            className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
            style={{ color: "var(--color-text-muted)" }}
            title="Create page"
          >
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
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tag filter section */}
      {showTagFilter && (
        <div
          className="mx-4 mb-3 rounded-lg p-3"
          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span
              className="text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Filter by tags
            </span>
            {selectedTags.length > 0 && (
              <button
                onClick={clearTagFilter}
                className="text-xs transition-colors hover:underline"
                style={{ color: "var(--color-accent)" }}
              >
                Clear
              </button>
            )}
          </div>
          {allTags.length === 0 ? (
            <span
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              No tags yet
            </span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {allTags.slice(0, 15).map((tag) => {
                const isSelected = selectedTags.includes(tag.name.toLowerCase());
                return (
                  <button
                    key={tag.name}
                    onClick={() => toggleTagFilter(tag.name)}
                    className="rounded-full px-2 py-0.5 text-xs transition-colors"
                    style={{
                      backgroundColor: isSelected
                        ? "rgba(139, 92, 246, 0.3)"
                        : "rgba(139, 92, 246, 0.1)",
                      color: "var(--color-accent)",
                      border: isSelected
                        ? "1px solid var(--color-accent)"
                        : "1px solid transparent",
                    }}
                  >
                    {tag.name}
                  </button>
                );
              })}
              {allTags.length > 15 && (
                <span
                  className="px-2 py-0.5 text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  +{allTags.length - 15} more
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Active filter indicator */}
      {selectedTags.length > 0 && !showTagFilter && (
        <div className="mx-4 mb-2 flex items-center gap-2">
          <span
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Filtered by:
          </span>
          {selectedTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full px-2 py-0.5 text-xs"
              style={{
                backgroundColor: "rgba(139, 92, 246, 0.15)",
                color: "var(--color-accent)",
              }}
            >
              {tag}
            </span>
          ))}
          <button
            onClick={clearTagFilter}
            className="text-xs transition-colors hover:underline"
            style={{ color: "var(--color-text-muted)" }}
          >
            Clear
          </button>
        </div>
      )}

      {/* Page list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {filteredPages.length === 0 ? (
          <div
            className="flex h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="text-xl opacity-50">📄</div>
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {selectedTags.length > 0 ? "No pages match selected tags" : "No pages yet"}
            </span>
          </div>
        ) : (
          <ul className="space-y-1">
            {filteredPages.map((page) => (
              <PageListItem
                key={page.id}
                page={page}
                isSelected={selectedPageId === page.id}
                onSelect={onSelectPage}
                onContextMenu={handleContextMenu}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && onOpenStudyTools && (
        <PageContextMenu
          page={contextMenu.page}
          position={contextMenu.position}
          onClose={handleCloseContextMenu}
          onOpenStudyTools={handleOpenStudyTools}
        />
      )}
    </div>
  );
}
