import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
import { BlockDiffRenderer } from "./BlockDiffRenderer";
import { computeBlockDiff, type BlockDiff } from "../../utils/diff";

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

const COMMITS_PER_PAGE = 100;

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
  const loadPages = usePageStore((s) => s.loadPages);
  const [isLoading, setIsLoading] = useState(true);
  const [gitEnabled, setGitEnabled] = useState(false);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [hasMoreCommits, setHasMoreCommits] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  const [compareCommit, setCompareCommit] = useState<CommitInfo | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [parsedPage, setParsedPage] = useState<ParsedPage | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [blockDiffs, setBlockDiffs] = useState<BlockDiff[] | null>(null);
  const [isLoadingDiff, setIsLoadingDiff] = useState(false);
  const commitListRef = useRef<HTMLDivElement>(null);

  // Load git status and history when dialog opens
  useEffect(() => {
    if (!isOpen || !page) return;

    const loadHistory = async () => {
      setIsLoading(true);
      setError(null);
      setSelectedCommit(null);
      setCompareCommit(null);
      setPreviewContent(null);
      setParsedPage(null);
      setBlockDiffs(null);
      setViewMode("preview");

      try {
        const enabled = await gitIsEnabled(page.notebookId);
        setGitEnabled(enabled);

        if (enabled) {
          const history = await gitHistory(
            page.notebookId,
            page.id,
            COMMITS_PER_PAGE
          );
          setCommits(history);
          setHasMoreCommits(history.length === COMMITS_PER_PAGE);
        } else {
          setCommits([]);
          setHasMoreCommits(false);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load history");
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [isOpen, page]);

  // Load more commits (pagination)
  const loadMore = useCallback(async () => {
    if (!page || isLoadingMore || !hasMoreCommits) return;

    setIsLoadingMore(true);
    try {
      const moreCommits = await gitHistory(
        page.notebookId,
        page.id,
        COMMITS_PER_PAGE,
        commits.length
      );
      setCommits((prev) => [...prev, ...moreCommits]);
      setHasMoreCommits(moreCommits.length === COMMITS_PER_PAGE);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load more history"
      );
    } finally {
      setIsLoadingMore(false);
    }
  }, [page, isLoadingMore, hasMoreCommits, commits.length]);

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

  const handleSelectCommit = (commit: CommitInfo, shiftKey: boolean) => {
    if (shiftKey && selectedCommit && selectedCommit.id !== commit.id) {
      // Shift+click: enter compare mode
      setCompareCommit(commit);
      setViewMode("changes");
      setBlockDiffs(null);
    } else {
      // Normal click: select commit, exit compare mode
      setSelectedCommit(commit);
      setCompareCommit(null);
      setViewMode("preview");
      setBlockDiffs(null);
      loadPreview(commit);
    }
  };

  const clearCompare = () => {
    setCompareCommit(null);
    setBlockDiffs(null);
  };

  // Determine the two commits being compared
  const compareInfo = useMemo(() => {
    if (compareCommit && selectedCommit) {
      // Compare mode: determine older/newer
      const selIdx = commits.findIndex((c) => c.id === selectedCommit.id);
      const cmpIdx = commits.findIndex((c) => c.id === compareCommit.id);
      if (selIdx < 0 || cmpIdx < 0) return null;
      // commits are newest-first, so higher index = older
      const olderCommit = selIdx > cmpIdx ? selectedCommit : compareCommit;
      const newerCommit = selIdx > cmpIdx ? compareCommit : selectedCommit;
      return { olderCommit, newerCommit };
    }
    if (selectedCommit) {
      const selIdx = commits.findIndex((c) => c.id === selectedCommit.id);
      if (selIdx < 0 || selIdx >= commits.length - 1) return null; // oldest commit
      return {
        olderCommit: commits[selIdx + 1],
        newerCommit: selectedCommit,
      };
    }
    return null;
  }, [selectedCommit, compareCommit, commits]);

  const isOldestCommit = useMemo(() => {
    if (compareCommit) return false;
    if (!selectedCommit) return false;
    const idx = commits.findIndex((c) => c.id === selectedCommit.id);
    return idx >= 0 && idx >= commits.length - 1;
  }, [selectedCommit, compareCommit, commits]);

  // Lazily compute block diff when user switches to Changes tab
  const loadBlockDiff = useCallback(async () => {
    if (!page || !compareInfo) return;

    const { olderCommit, newerCommit } = compareInfo;
    const capturedNewerId = newerCommit.id;
    setIsLoadingDiff(true);

    try {
      const [olderContent, newerContent] = await Promise.all([
        gitGetPageAtCommit(page.notebookId, page.id, olderCommit.id),
        gitGetPageAtCommit(page.notebookId, page.id, newerCommit.id),
      ]);

      // Race condition guard
      if (capturedNewerId !== newerCommit.id) return;

      const oldParsed = parsePage(olderContent);
      const newParsed = parsePage(newerContent);

      const oldBlocks = oldParsed?.blocks || [];
      const newBlocks = newParsed?.blocks || [];

      setBlockDiffs(computeBlockDiff(oldBlocks, newBlocks));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to compute diff"
      );
    } finally {
      setIsLoadingDiff(false);
    }
  }, [page, compareInfo]);

  // Auto-load block diff when Changes tab is active but diffs not yet loaded
  useEffect(() => {
    if (viewMode === "changes" && blockDiffs === null && !isLoadingDiff && compareInfo) {
      loadBlockDiff();
    }
  }, [viewMode, blockDiffs, isLoadingDiff, compareInfo, loadBlockDiff]);

  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
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
      setError(
        err instanceof Error ? err.message : "Failed to restore version"
      );
    } finally {
      setIsRestoring(false);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }

      // Don't intercept keys when typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }

      // j/k or Arrow keys to navigate commits
      if (
        (e.key === "j" || e.key === "ArrowDown" ||
         e.key === "k" || e.key === "ArrowUp") &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        const isDown = e.key === "j" || e.key === "ArrowDown";
        const currentIdx = selectedCommit
          ? commits.findIndex((c) => c.id === selectedCommit.id)
          : isDown ? -1 : commits.length;
        const nextIdx = isDown
          ? Math.min(currentIdx + 1, commits.length - 1)
          : Math.max(currentIdx - 1, 0);
        if (nextIdx >= 0 && commits[nextIdx]) {
          setSelectedCommit(commits[nextIdx]);
          setCompareCommit(null);
          setViewMode("preview");
          setBlockDiffs(null);
          loadPreview(commits[nextIdx]);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, selectedCommit, commits, loadPreview]);

  // Close when clicking backdrop
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Diff stats (must be before conditional return to satisfy rules of hooks)
  const diffStats = useMemo(() => {
    if (!blockDiffs) return null;
    const added = blockDiffs.filter((d) => d.type === "added").length;
    const removed = blockDiffs.filter((d) => d.type === "removed").length;
    const modified = blockDiffs.filter((d) => d.type === "modified").length;
    return { added, removed, modified };
  }, [blockDiffs]);

  if (!isOpen || !page) return null;

  // Group commits by date
  const dateGroups = groupCommitsByDate(commits);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="flex h-[650px] w-full max-w-5xl flex-col rounded-xl border shadow-2xl"
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
              {/* Commit List (sidebar) */}
              <div
                ref={commitListRef}
                className="w-72 shrink-0 overflow-y-auto border-r"
                style={{ borderColor: "var(--color-border)" }}
              >
                {dateGroups.map((group) => (
                  <div key={group.label}>
                    {/* Date group header */}
                    <div
                      className="sticky top-0 z-10 border-b px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider"
                      style={{
                        backgroundColor: "var(--color-bg-secondary)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text-muted)",
                      }}
                    >
                      {group.label}
                    </div>
                    {group.commits.map((commit) => {
                      const isSelected = selectedCommit?.id === commit.id;
                      const isCompare = compareCommit?.id === commit.id;

                      return (
                        <button
                          key={commit.id}
                          onClick={(e) =>
                            handleSelectCommit(commit, e.shiftKey)
                          }
                          className="w-full border-b px-4 py-2.5 text-left transition-colors hover:bg-[--color-bg-tertiary]"
                          style={{
                            borderColor: "var(--color-border)",
                            backgroundColor: isSelected
                              ? "var(--color-bg-tertiary)"
                              : isCompare
                                ? "rgba(59, 130, 246, 0.08)"
                                : undefined,
                          }}
                        >
                          <div className="flex items-start gap-2">
                            {/* Selection indicator */}
                            {(isSelected || isCompare) && (
                              <div
                                className="mt-1 h-2 w-2 shrink-0 rounded-full"
                                style={{
                                  backgroundColor: isSelected
                                    ? "var(--color-accent)"
                                    : "rgb(59, 130, 246)",
                                }}
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <p
                                className="truncate text-sm font-medium"
                                style={{
                                  color: "var(--color-text-primary)",
                                }}
                              >
                                {commit.message}
                              </p>
                              <p
                                className="mt-0.5 text-xs"
                                style={{ color: "var(--color-text-muted)" }}
                              >
                                {formatTime(commit.timestamp)}{" "}
                                <span className="opacity-60">
                                  {commit.short_id}
                                </span>
                              </p>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}

                {/* Load More */}
                {hasMoreCommits && (
                  <button
                    onClick={loadMore}
                    disabled={isLoadingMore}
                    className="w-full px-4 py-3 text-center text-xs font-medium transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{ color: "var(--color-accent)" }}
                  >
                    {isLoadingMore ? "Loading..." : "Load more"}
                  </button>
                )}
              </div>

              {/* Preview / Changes Panel */}
              <div className="flex min-w-0 flex-1 flex-col">
                {!selectedCommit ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2">
                    <p
                      className="text-sm"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Select a version to preview
                    </p>
                    <p
                      className="text-xs"
                      style={{ color: "var(--color-text-muted)", opacity: 0.6 }}
                    >
                      Shift+click two versions to compare
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
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {compareCommit ? (
                            <div className="flex items-center gap-2">
                              <span
                                className="text-xs font-medium"
                                style={{ color: "var(--color-text-secondary)" }}
                              >
                                Comparing {compareInfo?.olderCommit.short_id}{" "}
                                &rarr; {compareInfo?.newerCommit.short_id}
                              </span>
                              <button
                                onClick={clearCompare}
                                className="rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-[--color-bg-tertiary]"
                                style={{ color: "var(--color-text-muted)" }}
                              >
                                Clear
                              </button>
                            </div>
                          ) : (
                            <>
                              <p
                                className="truncate text-xs font-medium"
                                style={{
                                  color: "var(--color-text-secondary)",
                                }}
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
                            </>
                          )}
                        </div>
                        {/* Tab Toggle */}
                        <div
                          className="flex shrink-0 gap-1 rounded-lg p-0.5"
                          style={{
                            backgroundColor: "var(--color-bg-tertiary)",
                          }}
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
                        <BlockDiffView
                          blockDiffs={blockDiffs}
                          isLoading={isLoadingDiff}
                          isOldestCommit={isOldestCommit}
                          compareInfo={compareInfo}
                          diffStats={diffStats}
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
            {commits.length > 0 &&
              `${commits.length} version${commits.length !== 1 ? "s" : ""}${hasMoreCommits ? "+" : ""}`}
            {commits.length > 0 && (
              <span className="ml-2 opacity-50">
                j/k to navigate, Tab to switch tabs, Shift+click to compare
              </span>
            )}
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
            {selectedCommit && !compareCommit && (
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

// --- Block Diff View Component ---

function BlockDiffView({
  blockDiffs,
  isLoading,
  isOldestCommit,
  compareInfo,
  diffStats,
}: {
  blockDiffs: BlockDiff[] | null;
  isLoading: boolean;
  isOldestCommit: boolean;
  compareInfo: { olderCommit: CommitInfo; newerCommit: CommitInfo } | null;
  diffStats: { added: number; removed: number; modified: number } | null;
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

  if (!compareInfo) {
    return (
      <p
        className="text-sm italic"
        style={{ color: "var(--color-text-muted)" }}
      >
        No previous version to compare with.
      </p>
    );
  }

  if (isLoading) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        Computing changes...
      </p>
    );
  }

  if (!blockDiffs) return null;

  const hasChanges = blockDiffs.some((d) => d.type !== "unchanged");

  return (
    <div>
      {/* Diff header */}
      <div className="mb-3 flex items-center gap-3">
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {compareInfo.olderCommit.short_id} &rarr;{" "}
          {compareInfo.newerCommit.short_id}
        </p>
        {diffStats && hasChanges && (
          <div className="flex gap-2 text-[10px] font-medium">
            {diffStats.added > 0 && (
              <span style={{ color: "rgb(34, 197, 94)" }}>
                +{diffStats.added} added
              </span>
            )}
            {diffStats.modified > 0 && (
              <span style={{ color: "rgb(59, 130, 246)" }}>
                ~{diffStats.modified} modified
              </span>
            )}
            {diffStats.removed > 0 && (
              <span style={{ color: "rgb(239, 68, 68)" }}>
                -{diffStats.removed} removed
              </span>
            )}
          </div>
        )}
      </div>

      {!hasChanges ? (
        <p
          className="text-sm italic"
          style={{ color: "var(--color-text-muted)" }}
        >
          No block changes detected.
        </p>
      ) : (
        <BlockDiffRenderer diffs={blockDiffs} />
      )}
    </div>
  );
}

// --- Date grouping ---

interface CommitDateGroup {
  label: string;
  commits: CommitInfo[];
}

function groupCommitsByDate(commits: CommitInfo[]): CommitDateGroup[] {
  const groups: CommitDateGroup[] = [];
  const now = new Date();
  const todayStr = formatDateKey(now);

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = formatDateKey(yesterday);

  let currentLabel = "";
  let currentGroup: CommitInfo[] = [];

  for (const commit of commits) {
    const date = new Date(commit.timestamp);
    const dateKey = formatDateKey(date);

    let label: string;
    if (dateKey === todayStr) {
      label = "Today";
    } else if (dateKey === yesterdayStr) {
      label = "Yesterday";
    } else {
      label = date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
    }

    if (label !== currentLabel) {
      if (currentGroup.length > 0) {
        groups.push({ label: currentLabel, commits: currentGroup });
      }
      currentLabel = label;
      currentGroup = [commit];
    } else {
      currentGroup.push(commit);
    }
  }

  if (currentGroup.length > 0) {
    groups.push({ label: currentLabel, commits: currentGroup });
  }

  return groups;
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

// --- Helper Functions ---

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
