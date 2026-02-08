import { useState, useCallback, useEffect, useRef } from "react";
import { usePageStore } from "../../stores/pageStore";

interface PagePickerDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (pageId: string, pageTitle: string, notebookId: string) => void;
  notebookId: string;
  excludePageId?: string;
}

export function PagePickerDialog({
  isOpen,
  onClose,
  onSelect,
  notebookId,
  excludePageId,
}: PagePickerDialogProps) {
  const { pages } = usePageStore();
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset search and focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      // Focus search input after render
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSelect = useCallback(
    (pageId: string, pageTitle: string) => {
      onSelect(pageId, pageTitle, notebookId);
      onClose();
    },
    [onSelect, onClose, notebookId]
  );

  if (!isOpen) return null;

  // Filter pages: same notebook, exclude current canvas page, match search
  const filteredPages = pages.filter((page) => {
    if (excludePageId && page.id === excludePageId) return false;
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      page.title.toLowerCase().includes(query) ||
      page.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[70vh] rounded-xl shadow-xl flex flex-col"
        style={{ backgroundColor: "var(--color-bg-secondary)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            className="text-base font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Select a Page
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
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
          className="px-5 py-3 border-b"
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
              ref={inputRef}
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
        </div>

        {/* Page list */}
        <div className="flex-1 overflow-y-auto p-3">
          {filteredPages.length === 0 ? (
            <div
              className="text-center py-8 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {searchQuery
                ? "No pages match your search"
                : "No pages available"}
            </div>
          ) : (
            <div className="space-y-0.5">
              {filteredPages.map((page) => (
                <button
                  key={page.id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors hover:bg-[--color-bg-tertiary]"
                  onClick={() => handleSelect(page.id, page.title)}
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
                    style={{ color: "var(--color-text-muted)", flexShrink: 0 }}
                  >
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-medium truncate"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {page.title || "Untitled"}
                    </div>
                    {page.pageType && page.pageType !== "standard" && (
                      <div
                        className="text-xs mt-0.5"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {page.pageType}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
