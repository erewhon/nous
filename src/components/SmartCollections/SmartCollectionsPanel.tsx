import { useState, useEffect } from "react";
import { useCollectionStore, type SmartCollection } from "../../stores/collectionStore";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface SmartCollectionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SmartCollectionsPanel({ isOpen, onClose }: SmartCollectionsPanelProps) {
  const { collections, isGenerating, error, generateCollections, removeCollection, clearCollections } =
    useCollectionStore();
  const selectedNotebookId = useNotebookStore((s) => s.selectedNotebookId);
  const pages = usePageStore((s) => s.pages);
  const selectPage = usePageStore((s) => s.selectPage);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const focusTrapRef = useFocusTrap(isOpen);

  const notebookCollections = collections.filter(
    (c) => c.notebookId === selectedNotebookId
  );

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleGenerate = () => {
    if (selectedNotebookId) {
      generateCollections(selectedNotebookId);
    }
  };

  const handleClear = () => {
    if (selectedNotebookId) {
      clearCollections(selectedNotebookId);
    }
  };

  const handlePageClick = (pageId: string) => {
    selectPage(pageId);
    onClose();
  };

  const getPageTitle = (pageId: string) => {
    const page = pages.find((p) => p.id === pageId);
    return page?.title || "Untitled";
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Panel */}
      <div
        ref={focusTrapRef}
        className="relative w-full max-w-lg overflow-hidden rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-5 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: "var(--color-accent)" }}>
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
            <span className="font-medium" style={{ color: "var(--color-text-primary)" }}>
              Smart Collections
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Actions */}
        <div
          className="flex items-center gap-2 border-b px-5 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !selectedNotebookId}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            {isGenerating ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Generating...
              </span>
            ) : (
              "Generate"
            )}
          </button>
          {notebookCollections.length > 0 && (
            <button
              onClick={handleClear}
              className="rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-muted)" }}
            >
              Clear
            </button>
          )}
          {error && (
            <span className="ml-2 text-xs" style={{ color: "var(--color-danger, #e53e3e)" }}>
              {error}
            </span>
          )}
        </div>

        {/* Collections list */}
        <div className="max-h-[50vh] overflow-y-auto p-3">
          {notebookCollections.length === 0 ? (
            <div
              className="py-8 text-center text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {isGenerating
                ? "AI is analyzing your pages..."
                : "Click \"Generate\" to create topic-based collections from your pages"}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {notebookCollections.map((collection) => (
                <CollectionCard
                  key={collection.id}
                  collection={collection}
                  isExpanded={expandedId === collection.id}
                  onToggle={() =>
                    setExpandedId(expandedId === collection.id ? null : collection.id)
                  }
                  onRemove={() => removeCollection(collection.id)}
                  onPageClick={handlePageClick}
                  getPageTitle={getPageTitle}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="border-t px-5 py-3 text-xs"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          {notebookCollections.length > 0
            ? `${notebookCollections.length} collection${notebookCollections.length !== 1 ? "s" : ""}`
            : "AI-powered page grouping"}
        </div>
      </div>
    </div>
  );
}

function CollectionCard({
  collection,
  isExpanded,
  onToggle,
  onRemove,
  onPageClick,
  getPageTitle,
}: {
  collection: SmartCollection;
  isExpanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onPageClick: (pageId: string) => void;
  getPageTitle: (pageId: string) => string;
}) {
  return (
    <div
      className="rounded-lg border"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: "var(--color-bg-secondary)",
      }}
    >
      {/* Card header */}
      <div
        className="flex items-center gap-2 px-4 py-3 cursor-pointer"
        onClick={onToggle}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          style={{
            color: "var(--color-text-muted)",
            transform: isExpanded ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span
          className="flex-1 text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          {collection.name}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-xs"
          style={{
            backgroundColor: "var(--color-bg-tertiary)",
            color: "var(--color-text-muted)",
          }}
        >
          {collection.pageIds.length}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="rounded p-0.5 transition-colors hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-muted)" }}
          aria-label="Remove collection"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Description */}
      <div
        className="px-4 pb-2 text-xs"
        style={{ color: "var(--color-text-muted)" }}
      >
        {collection.description}
      </div>

      {/* Expanded: page list */}
      {isExpanded && (
        <div
          className="border-t px-2 py-2"
          style={{ borderColor: "var(--color-border)" }}
        >
          {collection.pageIds.map((pageId) => (
            <button
              key={pageId}
              onClick={() => onPageClick(pageId)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14,2 14,8 20,8" />
              </svg>
              <span className="truncate">{getPageTitle(pageId)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
