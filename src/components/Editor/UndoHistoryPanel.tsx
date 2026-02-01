import { useEffect, useRef } from "react";
import { useUndoHistoryStore, type HistoryEntry } from "../../stores/undoHistoryStore";

interface UndoHistoryPanelProps {
  pageId: string;
  isOpen: boolean;
  onClose: () => void;
  onJumpToState: (entryId: string) => void;
}

export function UndoHistoryPanel({
  pageId,
  isOpen,
  onClose,
  onJumpToState,
}: UndoHistoryPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const history = useUndoHistoryStore((state) => state.getHistory(pageId));
  const currentIndex = useUndoHistoryStore((state) => state.getCurrentIndex(pageId));
  const clearHistory = useUndoHistoryStore((state) => state.clearHistory);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const entries = history?.entries || [];

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }

    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getEntryDescription = (entry: HistoryEntry, index: number) => {
    if (entry.description) return entry.description;

    const blockCount = entry.data.blocks?.length || 0;
    if (index === 0) return `Initial state (${blockCount} blocks)`;
    return `Edit (${blockCount} blocks)`;
  };

  return (
    <div
      ref={panelRef}
      className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border shadow-xl"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
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
            style={{ color: "var(--color-text-muted)" }}
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l4 2" />
          </svg>
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            Edit History
          </span>
          <span
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            ({entries.length} states)
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 transition-colors hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-muted)" }}
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
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* History list */}
      <div className="max-h-80 overflow-y-auto">
        {entries.length === 0 ? (
          <div
            className="px-4 py-8 text-center text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            No history yet. Start editing to build history.
          </div>
        ) : (
          <div className="py-2">
            {[...entries].reverse().map((entry, reversedIndex) => {
              const index = entries.length - 1 - reversedIndex;
              const isCurrent = index === currentIndex;

              return (
                <button
                  key={entry.id}
                  onClick={() => onJumpToState(entry.id)}
                  className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-[--color-bg-tertiary] ${
                    isCurrent ? "bg-[--color-bg-tertiary]" : ""
                  }`}
                >
                  {/* Timeline indicator */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`h-3 w-3 rounded-full border-2 ${
                        isCurrent
                          ? "border-[--color-accent] bg-[--color-accent]"
                          : "border-[--color-text-muted] bg-transparent"
                      }`}
                    />
                    {reversedIndex < entries.length - 1 && (
                      <div
                        className="mt-1 h-6 w-0.5"
                        style={{ backgroundColor: "var(--color-border)" }}
                      />
                    )}
                  </div>

                  {/* Entry info */}
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm truncate"
                      style={{
                        color: isCurrent
                          ? "var(--color-accent)"
                          : "var(--color-text-primary)",
                        fontWeight: isCurrent ? 500 : 400,
                      }}
                    >
                      {getEntryDescription(entry, index)}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {formatTime(entry.timestamp)}
                    </div>
                  </div>

                  {/* Current indicator */}
                  {isCurrent && (
                    <span
                      className="rounded-full px-2 py-0.5 text-xs"
                      style={{
                        backgroundColor: "rgba(139, 92, 246, 0.15)",
                        color: "var(--color-accent)",
                      }}
                    >
                      Current
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      {entries.length > 0 && (
        <div
          className="border-t px-4 py-2"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={() => {
              clearHistory(pageId);
              onClose();
            }}
            className="w-full rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            Clear History
          </button>
        </div>
      )}
    </div>
  );
}
