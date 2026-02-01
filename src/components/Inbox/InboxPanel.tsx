import { useEffect, useState } from "react";
import { useInboxStore } from "../../stores/inboxStore";
import type { InboxItem, ClassificationAction } from "../../types/inbox";

interface InboxItemRowProps {
  item: InboxItem;
  isSelected: boolean;
  onToggle: () => void;
  onDelete: () => void;
}

function ClassificationBadge({ action }: { action: ClassificationAction }) {
  const getActionInfo = () => {
    switch (action.type) {
      case "CreatePage":
        return {
          label: `Create in ${action.notebook_name}`,
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          ),
          color: "var(--color-success)",
        };
      case "AppendToPage":
        return {
          label: `Append to "${action.page_title}"`,
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </svg>
          ),
          color: "var(--color-info)",
        };
      case "CreateNotebook":
        return {
          label: `New notebook: ${action.suggested_name}`,
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              <line x1="12" y1="6" x2="12" y2="12" />
              <line x1="9" y1="9" x2="15" y2="9" />
            </svg>
          ),
          color: "var(--color-warning)",
        };
      case "KeepInInbox":
        return {
          label: "Keep in inbox",
          icon: (
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
          ),
          color: "var(--color-text-muted)",
        };
    }
  };

  const info = getActionInfo();

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs"
      style={{ backgroundColor: `${info.color}20`, color: info.color }}
    >
      {info.icon}
      <span>{info.label}</span>
    </div>
  );
}

function InboxItemRow({ item, isSelected, onToggle, onDelete }: InboxItemRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="border-b transition-colors"
      style={{
        borderColor: "var(--color-border)",
        backgroundColor: isSelected ? "rgba(139, 92, 246, 0.1)" : "transparent",
      }}
    >
      <div className="flex items-start gap-3 p-3">
        {/* Checkbox */}
        <label className="flex cursor-pointer items-center pt-0.5">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggle}
            className="h-4 w-4 rounded border-2 accent-violet-500"
            style={{ borderColor: "var(--color-border)" }}
          />
        </label>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h4
                className="font-medium text-sm truncate"
                style={{ color: "var(--color-text-primary)" }}
              >
                {item.title}
              </h4>
              {item.content && (
                <p
                  className={`text-xs mt-0.5 ${isExpanded ? "" : "line-clamp-2"}`}
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {item.content}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              {item.content && item.content.length > 100 && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="rounded p-1 transition-colors hover:bg-white/10"
                  style={{ color: "var(--color-text-muted)" }}
                  title={isExpanded ? "Collapse" : "Expand"}
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
                    style={{ transform: isExpanded ? "rotate(180deg)" : "" }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
              )}
              <button
                onClick={onDelete}
                className="rounded p-1 transition-colors hover:bg-red-500/20"
                style={{ color: "var(--color-text-muted)" }}
                title="Delete"
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
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          </div>

          {/* Tags */}
          {item.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {item.tags.map((tag) => (
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
            </div>
          )}

          {/* Classification */}
          {item.classification && (
            <div className="mt-2 flex items-center gap-2">
              <ClassificationBadge action={item.classification.action} />
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {Math.round(item.classification.confidence * 100)}% confidence
              </span>
            </div>
          )}

          {/* Timestamp */}
          <div
            className="mt-1 text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {new Date(item.captured_at).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  );
}

export function InboxPanel() {
  const {
    items,
    summary,
    isLoading,
    isClassifying,
    isApplying,
    error,
    selectedItemIds,
    showInboxPanel,
    closeInboxPanel,
    loadUnprocessed,
    loadSummary,
    classifyAll,
    applySelected,
    toggleItem,
    selectAll,
    deselectAll,
    deleteItem,
  } = useInboxStore();

  // Load items when panel opens
  useEffect(() => {
    if (showInboxPanel) {
      loadUnprocessed();
      loadSummary();
    }
  }, [showInboxPanel, loadUnprocessed, loadSummary]);

  // Handle keyboard events
  useEffect(() => {
    if (!showInboxPanel) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeInboxPanel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showInboxPanel, closeInboxPanel]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeInboxPanel();
    }
  };

  const classifiedCount = items.filter((i) => i.classification).length;
  const unclassifiedCount = items.length - classifiedCount;

  if (!showInboxPanel) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="flex h-[80vh] w-full max-w-2xl flex-col rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3 shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-3">
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
              style={{ color: "var(--color-accent)" }}
            >
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
            <div>
              <h2
                className="font-semibold"
                style={{ color: "var(--color-text-primary)" }}
              >
                Inbox
              </h2>
              {summary && (
                <p
                  className="text-xs"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {summary.unprocessed_count} items to process
                </p>
              )}
            </div>
          </div>
          <button
            onClick={closeInboxPanel}
            className="rounded p-1.5 transition-colors hover:bg-white/10"
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
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div
          className="flex items-center justify-between gap-2 border-b px-4 py-2 shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => (selectedItemIds.size === items.length ? deselectAll() : selectAll())}
              className="rounded px-2 py-1 text-xs transition-colors hover:bg-white/10"
              style={{ color: "var(--color-text-secondary)" }}
            >
              {selectedItemIds.size === items.length ? "Deselect All" : "Select All"}
            </button>
            <span
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {selectedItemIds.size} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => classifyAll()}
              disabled={isClassifying || unclassifiedCount === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
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
                <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.5 2-1 3l6 6-3 3-6-6c-1 .5-1.9 1-3 1a4 4 0 1 1 0-8" />
                <circle cx="8" cy="8" r="2" />
              </svg>
              {isClassifying ? "Classifying..." : `Classify (${unclassifiedCount})`}
            </button>
            <button
              onClick={() => applySelected()}
              disabled={isApplying || selectedItemIds.size === 0}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
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
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {isApplying ? "Applying..." : `Apply (${selectedItemIds.size})`}
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div
            className="mx-4 mt-2 rounded-lg px-3 py-2 text-sm"
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              color: "var(--color-error)",
            }}
          >
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && items.length === 0 ? (
            <div
              className="flex items-center justify-center py-12"
              style={{ color: "var(--color-text-muted)" }}
            >
              Loading...
            </div>
          ) : items.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-12 text-center"
              style={{ color: "var(--color-text-muted)" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="mb-4 opacity-50"
              >
                <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              </svg>
              <p className="text-sm font-medium">Inbox is empty</p>
              <p className="text-xs mt-1">
                Press <kbd className="rounded border px-1" style={{ borderColor: "var(--color-border)" }}>Cmd+Shift+N</kbd> to capture a note
              </p>
            </div>
          ) : (
            <div>
              {items.map((item) => (
                <InboxItemRow
                  key={item.id}
                  item={item}
                  isSelected={selectedItemIds.has(item.id)}
                  onToggle={() => toggleItem(item.id)}
                  onDelete={() => deleteItem(item.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-4 py-3 shrink-0"
          style={{ borderColor: "var(--color-border)" }}
        >
          <p
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {classifiedCount} of {items.length} classified
          </p>
          <button
            onClick={closeInboxPanel}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
