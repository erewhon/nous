import { useState, useEffect, useCallback } from "react";
import {
  ConflictInfo,
  ConflictContent,
  ResolutionStrategy,
  gitListConflicts,
  gitGetConflictContent,
  gitResolveConflict,
  gitResolveAllConflicts,
  gitCommitMerge,
  gitAbortMerge,
} from "../../utils/api";

interface GitConflictDialogProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string;
  onResolved: () => void;
}

// Icons
const IconClose = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconWarning = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const IconCheck = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export function GitConflictDialog({
  isOpen,
  onClose,
  notebookId,
  onResolved,
}: GitConflictDialogProps) {
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [selectedConflict, setSelectedConflict] = useState<ConflictInfo | null>(
    null
  );
  const [conflictContent, setConflictContent] = useState<ConflictContent | null>(
    null
  );
  const [resolvedPaths, setResolvedPaths] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load conflicts
  const loadConflicts = useCallback(async () => {
    if (!notebookId) return;
    setIsLoading(true);
    setError(null);
    try {
      const conflictList = await gitListConflicts(notebookId);
      setConflicts(conflictList);
      if (conflictList.length > 0 && !selectedConflict) {
        setSelectedConflict(conflictList[0]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load conflicts");
    } finally {
      setIsLoading(false);
    }
  }, [notebookId, selectedConflict]);

  // Load conflict content when selection changes
  useEffect(() => {
    if (!selectedConflict || !notebookId) return;

    const loadContent = async () => {
      try {
        const content = await gitGetConflictContent(
          notebookId,
          selectedConflict.path
        );
        setConflictContent(content);
      } catch (e) {
        console.error("Failed to load conflict content:", e);
        setConflictContent(null);
      }
    };

    loadContent();
  }, [selectedConflict, notebookId]);

  // Initial load
  useEffect(() => {
    if (isOpen) {
      loadConflicts();
      setResolvedPaths(new Set());
    }
  }, [isOpen, loadConflicts]);

  // Resolve single conflict
  const handleResolve = async (strategy: ResolutionStrategy) => {
    if (!selectedConflict || !notebookId) return;

    setIsLoading(true);
    setError(null);
    try {
      await gitResolveConflict(notebookId, selectedConflict.path, strategy);
      setResolvedPaths((prev) => new Set([...prev, selectedConflict.path]));

      // Move to next unresolved conflict
      const nextConflict = conflicts.find(
        (c) => c.path !== selectedConflict.path && !resolvedPaths.has(c.path)
      );
      setSelectedConflict(nextConflict || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve conflict");
    } finally {
      setIsLoading(false);
    }
  };

  // Resolve all with strategy
  const handleResolveAll = async (strategy: ResolutionStrategy) => {
    if (!notebookId) return;

    setIsLoading(true);
    setError(null);
    try {
      await gitResolveAllConflicts(notebookId, strategy);
      setResolvedPaths(new Set(conflicts.map((c) => c.path)));
      setSelectedConflict(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to resolve all conflicts"
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Commit the merge
  const handleCommitMerge = async () => {
    if (!notebookId) return;

    setIsLoading(true);
    setError(null);
    try {
      await gitCommitMerge(notebookId);
      onResolved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to commit merge");
    } finally {
      setIsLoading(false);
    }
  };

  // Abort the merge
  const handleAbort = async () => {
    if (!notebookId) return;

    setIsLoading(true);
    setError(null);
    try {
      await gitAbortMerge(notebookId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to abort merge");
    } finally {
      setIsLoading(false);
    }
  };

  const allResolved = conflicts.length > 0 && resolvedPaths.size === conflicts.length;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="relative flex h-[80vh] w-[90vw] max-w-5xl flex-col rounded-lg border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-4 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
            <span className="text-yellow-500">
              <IconWarning />
            </span>
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Merge Conflicts
            </h2>
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-muted)",
              }}
            >
              {conflicts.length - resolvedPaths.size} remaining
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 transition-colors hover:bg-white/10"
            style={{ color: "var(--color-text-muted)" }}
          >
            <IconClose />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Conflict list sidebar */}
          <div
            className="w-64 flex-shrink-0 overflow-y-auto border-r"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="p-2">
              {conflicts.map((conflict) => (
                <button
                  key={conflict.path}
                  onClick={() => setSelectedConflict(conflict)}
                  className={`mb-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors ${
                    selectedConflict?.path === conflict.path
                      ? "bg-[--color-accent]/20"
                      : "hover:bg-white/5"
                  }`}
                  style={{
                    color: resolvedPaths.has(conflict.path)
                      ? "var(--color-text-muted)"
                      : "var(--color-text-primary)",
                  }}
                >
                  {resolvedPaths.has(conflict.path) ? (
                    <span className="text-green-500">
                      <IconCheck />
                    </span>
                  ) : (
                    <span className="h-4 w-4 rounded-full border border-yellow-500" />
                  )}
                  <span className="truncate">{conflict.path.split("/").pop()}</span>
                </button>
              ))}

              {conflicts.length === 0 && !isLoading && (
                <p
                  className="px-3 py-4 text-center text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  No conflicts found
                </p>
              )}
            </div>
          </div>

          {/* Content viewer */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {selectedConflict && conflictContent && !resolvedPaths.has(selectedConflict.path) ? (
              <>
                {/* Conflict path header */}
                <div
                  className="border-b px-4 py-2"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <p
                    className="text-sm font-mono"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {selectedConflict.path}
                  </p>
                </div>

                {/* Version comparison */}
                <div className="flex flex-1 overflow-hidden">
                  {/* Ours (current branch) */}
                  <div className="flex flex-1 flex-col overflow-hidden border-r" style={{ borderColor: "var(--color-border)" }}>
                    <div
                      className="flex items-center justify-between border-b px-3 py-2"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <span
                        className="text-xs font-medium"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        Current Branch (Ours)
                      </span>
                      <button
                        onClick={() => handleResolve("ours")}
                        disabled={isLoading}
                        className="rounded px-2 py-1 text-xs font-medium transition-colors hover:opacity-90"
                        style={{
                          backgroundColor: "var(--color-accent)",
                          color: "white",
                        }}
                      >
                        Use This
                      </button>
                    </div>
                    <pre
                      className="flex-1 overflow-auto p-3 font-mono text-xs"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {conflictContent.ours || "(No content)"}
                    </pre>
                  </div>

                  {/* Theirs (incoming branch) */}
                  <div className="flex flex-1 flex-col overflow-hidden">
                    <div
                      className="flex items-center justify-between border-b px-3 py-2"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <span
                        className="text-xs font-medium"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        Incoming Branch (Theirs)
                      </span>
                      <button
                        onClick={() => handleResolve("theirs")}
                        disabled={isLoading}
                        className="rounded px-2 py-1 text-xs font-medium transition-colors hover:opacity-90"
                        style={{
                          backgroundColor: "var(--color-accent)",
                          color: "white",
                        }}
                      >
                        Use This
                      </button>
                    </div>
                    <pre
                      className="flex-1 overflow-auto p-3 font-mono text-xs"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {conflictContent.theirs || "(No content)"}
                    </pre>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p
                  className="text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {allResolved
                    ? "All conflicts resolved! Click 'Commit Merge' to complete."
                    : "Select a conflict to view and resolve"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer with actions */}
        <div
          className="flex items-center justify-between border-t px-4 py-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={handleAbort}
              disabled={isLoading}
              className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                color: "rgb(239, 68, 68)",
              }}
            >
              Abort Merge
            </button>
            {conflicts.length > 1 && !allResolved && (
              <>
                <button
                  onClick={() => handleResolveAll("ours")}
                  disabled={isLoading}
                  className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  Accept All Ours
                </button>
                <button
                  onClick={() => handleResolveAll("theirs")}
                  disabled={isLoading}
                  className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                  style={{
                    backgroundColor: "var(--color-bg-tertiary)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  Accept All Theirs
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {error && (
              <p className="mr-2 text-xs" style={{ color: "var(--color-error)" }}>
                {error}
              </p>
            )}
            <button
              onClick={handleCommitMerge}
              disabled={isLoading || !allResolved}
              className="rounded-md px-4 py-1.5 text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
              style={{
                backgroundColor: allResolved
                  ? "rgb(34, 197, 94)"
                  : "var(--color-bg-tertiary)",
                color: allResolved ? "white" : "var(--color-text-muted)",
              }}
            >
              {isLoading ? "Working..." : "Commit Merge"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
