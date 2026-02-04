import { useState, useCallback, useEffect } from "react";
import { usePageStore } from "../../stores/pageStore";
import type { Page } from "../../types/page";
import type { StudyPageContent } from "../../types/studyTools";

interface PageSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (pages: StudyPageContent[]) => void;
  title?: string;
  description?: string;
  minPages?: number;
  maxPages?: number;
}

export function PageSelector({
  isOpen,
  onClose,
  onSelect,
  title = "Select Pages",
  description = "Choose pages to include",
  minPages = 1,
  maxPages,
}: PageSelectorProps) {
  const { pages } = usePageStore();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  // Reset selection when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedIds(new Set());
      setSearchQuery("");
    }
  }, [isOpen]);

  const togglePage = useCallback((pageId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        if (maxPages && next.size >= maxPages) {
          return prev;
        }
        next.add(pageId);
      }
      return next;
    });
  }, [maxPages]);

  const selectAll = useCallback(() => {
    const filtered = pages.filter((page) => {
      if (!searchQuery) return true;
      const query = searchQuery.toLowerCase();
      return (
        page.title.toLowerCase().includes(query) ||
        page.tags?.some((tag) => tag.toLowerCase().includes(query))
      );
    });
    const allIds = filtered.map((p) => p.id);
    if (maxPages) {
      setSelectedIds(new Set(allIds.slice(0, maxPages)));
    } else {
      setSelectedIds(new Set(allIds));
    }
  }, [pages, searchQuery, maxPages]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleConfirm = useCallback(() => {
    const selectedPages = pages.filter((p) => selectedIds.has(p.id));
    const pageContents: StudyPageContent[] = selectedPages.map((page) => ({
      pageId: page.id,
      title: page.title,
      content: extractPageContent(page),
      tags: page.tags || [],
    }));
    onSelect(pageContents);
    onClose();
  }, [pages, selectedIds, onSelect, onClose]);

  if (!isOpen) return null;

  // Filter pages
  const filteredPages = pages.filter((page) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      page.title.toLowerCase().includes(query) ||
      page.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  const canConfirm = selectedIds.size >= minPages;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[80vh] rounded-xl shadow-xl flex flex-col"
        style={{ backgroundColor: "var(--color-bg-secondary)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              {title}
            </h2>
            <p
              className="text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {description}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div
          className="px-6 py-3 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="relative">
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
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--color-text-muted)" }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search pages..."
              className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <span
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {selectedIds.size} of {filteredPages.length} selected
              {maxPages && ` (max ${maxPages})`}
            </span>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-xs hover:underline"
                style={{ color: "var(--color-accent)" }}
              >
                Select all
              </button>
              <button
                onClick={deselectAll}
                className="text-xs hover:underline"
                style={{ color: "var(--color-text-muted)" }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>

        {/* Page list */}
        <div className="flex-1 overflow-y-auto p-4">
          {filteredPages.length === 0 ? (
            <div
              className="text-center py-8 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {searchQuery
                ? "No pages match your search"
                : "No pages in this notebook"}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredPages.map((page) => (
                <PageItem
                  key={page.id}
                  page={page}
                  isSelected={selectedIds.has(page.id)}
                  onToggle={() => togglePage(page.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-4 border-t"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            Confirm ({selectedIds.size} page{selectedIds.size !== 1 ? "s" : ""})
          </button>
        </div>
      </div>
    </div>
  );
}

interface PageItemProps {
  page: Page;
  isSelected: boolean;
  onToggle: () => void;
}

function PageItem({ page, isSelected, onToggle }: PageItemProps) {
  return (
    <div
      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors hover:bg-[--color-bg-tertiary] ${
        isSelected ? "bg-[--color-accent]/5" : ""
      }`}
      onClick={onToggle}
    >
      <div
        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
          isSelected
            ? "border-[--color-accent] bg-[--color-accent]"
            : "border-[--color-border]"
        }`}
      >
        {isSelected && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className="font-medium truncate"
          style={{ color: "var(--color-text-primary)" }}
        >
          {page.title || "Untitled"}
        </div>
        {page.tags && page.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {page.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-muted)",
                }}
              >
                {tag}
              </span>
            ))}
            {page.tags.length > 3 && (
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                +{page.tags.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Helper to extract plain text from Editor.js content
function extractPageContent(page: Page): string {
  if (!page.content?.blocks) return "";

  return page.content.blocks
    .map((block: { type?: string; data?: { text?: string; items?: string[] } }) => {
      if (block.data?.text) {
        // Strip HTML tags for plain text
        return block.data.text.replace(/<[^>]*>/g, "");
      }
      if (block.data?.items) {
        return block.data.items.join("\n");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}
