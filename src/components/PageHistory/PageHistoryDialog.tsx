import { useState, useEffect, useCallback } from "react";
import type { Page } from "../../types/page";
import type { EditorBlock } from "../../types/page";
import {
  gitHistory,
  gitGetPageAtCommit,
  gitRestorePage,
  gitIsEnabled,
  type CommitInfo,
} from "../../utils/api";
import { usePageStore } from "../../stores/pageStore";
import { HistoryBlockRenderer } from "./HistoryBlockRenderer";
import { blocksToLines, computeLineDiff, type DiffLine } from "../../utils/diff";

type ViewMode = "preview" | "changes";

interface ParsedPage {
  title: string;
  blocks: EditorBlock[];
}

interface PageHistoryDialogProps {
  isOpen: boolean;
  page: Page | null;
  onClose: () => void;
}

function parsePage(json: string): ParsedPage | null {
  try {
    const page = JSON.parse(json);
    return {
      title: page.title || "Untitled",
      blocks: page.content?.blocks || [],
    };
  } catch {
    return null;
  }
}

export function PageHistoryDialog({
  isOpen,
  page,
  onClose,
}: PageHistoryDialogProps) {
  const { loadPages } = usePageStore();
  const [isLoading, setIsLoading] = useState(true);
  const [gitEnabled, setGitEnabled] = useState(false);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [parsedPage, setParsedPage] = useState<ParsedPage | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [diffLines, setDiffLines] = useState<DiffLine[] | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);

  // Load git status and history when dialog opens
  useEffect(() => {
    if (!isOpen || !page) return;

    const loadHistory = async () => {
      setIsLoading(true);
      setError(null);
      setSelectedCommit(null);
      setPreviewContent(null);
      setParsedPage(null);
      setDiffLines(null);
      setViewMode("preview");

      try {
        const enabled = await gitIsEnabled(page.notebookId);
        setGitEnabled(enabled);

        if (enabled) {
          const history = await gitHistory(page.notebookId, page.id, 50);
          setCommits(history);
        } else {
          setCommits([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load history");
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [isOpen, page]);

  // Load preview when a commit is selected
  const loadPreview = useCallback(
    async (commit: CommitInfo) => {
      if (!page) return;

      setIsLoadingPreview(true);
      setError(null);

      try {
        const content = await gitGetPageAtCommit(
          page.notebookId,
          page.id,
          commit.id
        );
        setPreviewContent(content);
        setParsedPage(parsePage(content));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load version"
        );
        setPreviewContent(null);
        setParsedPage(null);
      } finally {
        setIsLoadingPreview(false);
      }
    },
    [page]
  );

  const handleSelectCommit = (commit: CommitInfo) => {
    setSelectedCommit(commit);
    setViewMode("preview");
    setDiffLines(null);
    loadPreview(commit);
  };

  // Lazily compute diff when user switches to Changes tab
  const loadDiff = useCallback(async () => {
    if (!page || !selectedCommit || !previewContent) return;

    const selectedIndex = commits.findIndex((c) => c.id === selectedCommit.id);
    // Newest-first: predecessor is next index
    if (selectedIndex < 0 || selectedIndex >= commits.length - 1) {
      // This is the oldest commit
      setDiffLines([]);
      return;
    }

    const predecessorCommit = commits[selectedIndex + 1];
    const currentCommitId = selectedCommit.id;
    setIsLoadingDiff(true);

    try {
      const predecessorContent = await gitGetPageAtCommit(
        page.notebookId,
        page.id,
        predecessorCommit.id
      );

      // Race condition guard
      if (currentCommitId !== selectedCommit.id) return;

      const oldParsed = parsePage(predecessorContent);
      const newParsed = parsePage(previewContent);

      const oldLines = oldParsed ? blocksToLines(oldParsed.blocks) : [];
      const newLines = newParsed ? blocksToLines(newParsed.blocks) : [];

      setDiffLines(computeLineDiff(oldLines, newLines));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to compute diff"
      );
    } finally {
      setIsLoadingDiff(false);
    }
  }, [page, selectedCommit, previewContent, commits]);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    if (mode === "changes" && diffLines === null && !isLoadingDiff) {
      loadDiff();
    }
  };

  const handleRestore = async () => {
    if (!page || !selectedCommit) return;

    setIsRestoring(true);
    setError(null);

    try {
      await gitRestorePage(page.notebookId, page.id, selectedCommit.id);
      await loadPages(page.notebookId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore version");
    } finally {
      setIsRestoring(false);
    }
  };

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Close when clicking backdrop
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen || !page) return null;

  // Find predecessor for diff header
  const selectedIndex = selectedCommit
    ? commits.findIndex((c) => c.id === selectedCommit.id)
    : -1;
  const isOldestCommit = selectedIndex >= 0 && selectedIndex >= commits.length - 1;
  const predecessorCommit =
    selectedIndex >= 0 && selectedIndex < commits.length - 1
      ? commits[selectedIndex + 1]
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="flex h-[600px] w-full max-w-4xl flex-col rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex shrink-0 items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div>
            <h2
              className="text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Page History
            </h2>
            <p
              className="mt-0.5 text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              {page.title || "Untitled"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <IconClose />
          </button>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1">
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <div
                className="text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Loading history...
              </div>
            </div>
          ) : !gitEnabled ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
              <IconGitOff />
              <p
                className="text-center text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                Version control is not enabled for this notebook.
                <br />
                Enable Git in Notebook Settings to track page history.
              </p>
            </div>
          ) : commits.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
              <IconHistory />
              <p
                className="text-center text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                No history found for this page.
                <br />
                Changes will be tracked after the next save.
              </p>
            </div>
          ) : (
            <>
              {/* Commit List */}
              <div
                className="w-64 shrink-0 overflow-y-auto border-r"
                style={{ borderColor: "var(--color-border)" }}
              >
                {commits.map((commit) => (
                  <button
                    key={commit.id}
                    onClick={() => handleSelectCommit(commit)}
                    className="w-full border-b px-4 py-3 text-left transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{
                      borderColor: "var(--color-border)",
                      backgroundColor:
                        selectedCommit?.id === commit.id
                          ? "var(--color-bg-tertiary)"
                          : undefined,
                    }}
                  >
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {commit.message}
                    </p>
                    <p
                      className="mt-1 text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {formatTimestamp(commit.timestamp)}
                    </p>
                    <p
                      className="mt-0.5 truncate text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {commit.short_id} by {commit.author}
                    </p>
                  </button>
                ))}
              </div>

              {/* Preview Panel */}
              <div className="flex min-w-0 flex-1 flex-col">
                {!selectedCommit ? (
                  <div className="flex flex-1 items-center justify-center">
                    <p
                      className="text-sm"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Select a version to preview
                    </p>
                  </div>
                ) : isLoadingPreview ? (
                  <div className="flex flex-1 items-center justify-center">
                    <p
                      className="text-sm"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Loading version...
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col overflow-hidden">
                    {/* Sub-header with commit info and tab toggle */}
                    <div
                      className="shrink-0 border-b px-4 py-2"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p
                            className="text-xs font-medium"
                            style={{ color: "var(--color-text-secondary)" }}
                          >
                            {selectedCommit.message}
                          </p>
                          <p
                            className="text-xs"
                            style={{ color: "var(--color-text-muted)" }}
                          >
                            {formatTimestamp(selectedCommit.timestamp)} by{" "}
                            {selectedCommit.author}
                          </p>
                        </div>
                        {/* Tab Toggle */}
                        <div
                          className="flex gap-1 rounded-lg p-0.5"
                          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                        >
                          <button
                            onClick={() => handleViewModeChange("preview")}
                            className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                            style={{
                              backgroundColor:
                                viewMode === "preview"
                                  ? "rgba(139, 92, 246, 0.15)"
                                  : "transparent",
                              color:
                                viewMode === "preview"
                                  ? "var(--color-accent)"
                                  : "var(--color-text-muted)",
                            }}
                          >
                            Preview
                          </button>
                          <button
                            onClick={() => handleViewModeChange("changes")}
                            className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                            style={{
                              backgroundColor:
                                viewMode === "changes"
                                  ? "rgba(139, 92, 246, 0.15)"
                                  : "transparent",
                              color:
                                viewMode === "changes"
                                  ? "var(--color-accent)"
                                  : "var(--color-text-muted)",
                            }}
                          >
                            Changes
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Content area */}
                    <div className="flex-1 overflow-auto p-4">
                      {viewMode === "preview" ? (
                        parsedPage ? (
                          <div>
                            <h3
                              className="mb-3 text-lg font-semibold"
                              style={{ color: "var(--color-text-primary)" }}
                            >
                              {parsedPage.title}
                            </h3>
                            <HistoryBlockRenderer blocks={parsedPage.blocks} />
                          </div>
                        ) : (
                          <pre
                            className="whitespace-pre-wrap break-words font-mono text-xs"
                            style={{ color: "var(--color-text-primary)" }}
                          >
                            {previewContent || "No content"}
                          </pre>
                        )
                      ) : (
                        <DiffView
                          diffLines={diffLines}
                          isLoading={isLoadingDiff}
                          isOldestCommit={isOldestCommit}
                          predecessorCommit={predecessorCommit}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div
            className="shrink-0 border-t px-6 py-3"
            style={{
              borderColor: "var(--color-border)",
              backgroundColor: "rgba(239, 68, 68, 0.1)",
            }}
          >
            <p className="text-sm text-red-500">{error}</p>
          </div>
        )}

        {/* Footer */}
        <div
          className="flex shrink-0 items-center justify-between border-t px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <p
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            {commits.length > 0 && `${commits.length} versions`}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
            >
              Close
            </button>
            {selectedCommit && (
              <button
                onClick={handleRestore}
                disabled={isRestoring}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
                style={{
                  background:
                    "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
                }}
              >
                {isRestoring ? "Restoring..." : "Restore This Version"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Diff View Component ---

function DiffView({
  diffLines,
  isLoading,
  isOldestCommit,
  predecessorCommit,
}: {
  diffLines: DiffLine[] | null;
  isLoading: boolean;
  isOldestCommit: boolean;
  predecessorCommit: CommitInfo | null;
}) {
  if (isOldestCommit) {
    return (
      <p
        className="text-sm italic"
        style={{ color: "var(--color-text-muted)" }}
      >
        This is the earliest recorded version.
      </p>
    );
  }

  if (isLoading) {
    return (
      <p
        className="text-sm"
        style={{ color: "var(--color-text-muted)" }}
      >
        Computing changes...
      </p>
    );
  }

  if (!diffLines) return null;

  if (diffLines.length === 0) {
    return (
      <p
        className="text-sm italic"
        style={{ color: "var(--color-text-muted)" }}
      >
        No text changes detected.
      </p>
    );
  }

  const hasChanges = diffLines.some((l) => l.type !== "unchanged");

  return (
    <div>
      {predecessorCommit && (
        <p
          className="mb-3 text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          Comparing with previous version ({predecessorCommit.short_id})
        </p>
      )}
      {!hasChanges ? (
        <p
          className="text-sm italic"
          style={{ color: "var(--color-text-muted)" }}
        >
          No text changes detected.
        </p>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border"
          style={{ borderColor: "var(--color-border)" }}
        >
          {diffLines.map((line, i) => (
            <div
              key={i}
              className="px-3 py-0.5 font-mono text-xs"
              style={{
                backgroundColor:
                  line.type === "added"
                    ? "rgba(34, 197, 94, 0.1)"
                    : line.type === "removed"
                      ? "rgba(239, 68, 68, 0.1)"
                      : undefined,
                color:
                  line.type === "added"
                    ? "rgb(34, 197, 94)"
                    : line.type === "removed"
                      ? "rgb(239, 68, 68)"
                      : "var(--color-text-secondary)",
              }}
            >
              {line.type === "added"
                ? "+"
                : line.type === "removed"
                  ? "-"
                  : " "}{" "}
              {line.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Helper Functions ---

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Today at ${date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  } else if (diffDays === 1) {
    return `Yesterday at ${date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
}

// --- Icons ---

function IconClose() {
  return (
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
  );
}

function IconGitOff() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-text-muted)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity: 0.5 }}
    >
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-text-muted)"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ opacity: 0.5 }}
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}
