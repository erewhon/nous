import { useState, useEffect, useCallback } from "react";
import { getBlockHistory, revertBlock } from "../../utils/api";
import type { BlockHistoryEntry } from "../../types/page";

interface BlockHistoryPanelProps {
  notebookId: string;
  pageId: string;
  blockId: string;
  onClose: () => void;
  onRevert: () => void; // Called after successful revert to re-render editor
}

function formatRelativeTime(ts: string): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function opBadgeColor(op: string): string {
  switch (op) {
    case "modify":
      return "bg-blue-500/20 text-blue-400";
    case "insert":
      return "bg-green-500/20 text-green-400";
    case "delete":
      return "bg-red-500/20 text-red-400";
    case "move":
      return "bg-yellow-500/20 text-yellow-400";
    default:
      return "bg-zinc-500/20 text-zinc-400";
  }
}

function getBlockPreview(entry: BlockHistoryEntry): string | null {
  if (!entry.blockData) return null;
  const data = entry.blockData as Record<string, unknown>;
  // Try common block data fields
  if (typeof data.text === "string") return data.text;
  if (typeof data.data === "object" && data.data !== null) {
    const inner = data.data as Record<string, unknown>;
    if (typeof inner.text === "string") return inner.text;
  }
  // For lists/checklists, show first item
  if (Array.isArray(data.items)) {
    const first = data.items[0];
    if (typeof first === "string") return first;
    if (typeof first === "object" && first !== null) {
      const item = first as Record<string, unknown>;
      return (item.text as string) || (item.content as string) || null;
    }
  }
  return null;
}

export function BlockHistoryPanel({
  notebookId,
  pageId,
  blockId,
  onClose,
  onRevert,
}: BlockHistoryPanelProps) {
  const [history, setHistory] = useState<BlockHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reverting, setReverting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getBlockHistory(notebookId, pageId, blockId, 50)
      .then((entries) => {
        if (!cancelled) {
          setHistory(entries);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [notebookId, pageId, blockId]);

  const handleRevert = useCallback(
    async (snapshotName: string, ts: string) => {
      const confirmed = window.confirm(
        `Revert this block to its state from ${formatRelativeTime(ts)}?`
      );
      if (!confirmed) return;

      setReverting(snapshotName);
      try {
        await revertBlock(notebookId, pageId, blockId, snapshotName);
        onRevert();
        onClose();
      } catch (err) {
        setError(`Revert failed: ${String(err)}`);
      } finally {
        setReverting(null);
      }
    },
    [notebookId, pageId, blockId, onRevert, onClose]
  );

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed right-0 top-0 bottom-0 w-80 bg-zinc-900 border-l border-zinc-700 shadow-2xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-zinc-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="text-sm font-medium text-zinc-200">
            Block History
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Block ID */}
      <div className="px-4 py-2 border-b border-zinc-800">
        <span className="text-xs text-zinc-500 font-mono">
          {blockId.substring(0, 8)}...
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="p-4 text-sm text-zinc-500">Loading history...</div>
        )}

        {error && (
          <div className="p-4 text-sm text-red-400">{error}</div>
        )}

        {!loading && history.length === 0 && (
          <div className="p-4 text-sm text-zinc-500">
            No history recorded for this block.
          </div>
        )}

        {!loading &&
          history.map((entry, i) => {
            const preview = getBlockPreview(entry);
            const canRevert = entry.snapshotName && entry.op !== "delete";

            return (
              <div
                key={`${entry.ts}-${i}`}
                className="px-4 py-3 border-b border-zinc-800 hover:bg-zinc-800/50 transition-colors"
              >
                {/* Time and operation */}
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-zinc-400">
                    {formatRelativeTime(entry.ts)}
                  </span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${opBadgeColor(entry.op)}`}
                  >
                    {entry.op}
                  </span>
                </div>

                {/* Block type */}
                {entry.blockType && (
                  <div className="text-xs text-zinc-500 mb-1">
                    {entry.blockType}
                  </div>
                )}

                {/* Preview */}
                {preview && (
                  <div
                    className="text-xs text-zinc-400 line-clamp-2 mb-1"
                    dangerouslySetInnerHTML={{
                      __html: preview.replace(/<[^>]*>/g, "").substring(0, 120),
                    }}
                  />
                )}

                {/* Git commit link */}
                {entry.gitCommitId && (
                  <div className="text-xs text-zinc-500 font-mono mb-1">
                    commit {entry.gitCommitId.substring(0, 7)}
                  </div>
                )}

                {/* Revert button */}
                {canRevert && (
                  <button
                    onClick={() =>
                      handleRevert(entry.snapshotName!, entry.ts)
                    }
                    disabled={reverting !== null}
                    className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 disabled:cursor-not-allowed mt-1"
                  >
                    {reverting === entry.snapshotName
                      ? "Reverting..."
                      : "Revert to this version"}
                  </button>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
