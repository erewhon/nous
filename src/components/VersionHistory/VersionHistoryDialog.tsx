import { useState, useEffect, useCallback, useMemo } from "react";
import type { Page, EditorBlock } from "../../types/page";
import {
  getPageVersions,
  getPageVersion,
  restorePageVersion,
  type PageVersion,
} from "../../utils/api";
import { usePageStore } from "../../stores/pageStore";
import { HistoryBlockRenderer } from "../PageHistory/HistoryBlockRenderer";
import { BlockDiffRenderer } from "../PageHistory/BlockDiffRenderer";
import { computeBlockDiff, type BlockDiff } from "../../utils/diff";

type ViewMode = "preview" | "changes";

interface VersionHistoryDialogProps {
  isOpen: boolean;
  page: Page | null;
  onClose: () => void;
}

/** Human-friendly relative time (e.g. "2 hours ago"). Pure — exported for tests. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown time";
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min !== 1 ? "s" : ""} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr !== 1 ? "s" : ""} ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} day${day !== 1 ? "s" : ""} ago`;
  const mon = Math.round(day / 30);
  if (mon < 12) return `${mon} month${mon !== 1 ? "s" : ""} ago`;
  const yr = Math.round(mon / 12);
  return `${yr} year${yr !== 1 ? "s" : ""} ago`;
}

/**
 * Version History panel sourced from a page's always-on local snapshots + oplog
 * (distinct from the Git-based PageHistoryDialog). Lists restorable snapshots,
 * previews each (or diffs it against the current page), and restores on demand.
 */
export function VersionHistoryDialog({
  isOpen,
  page,
  onClose,
}: VersionHistoryDialogProps) {
  const refreshPages = usePageStore((s) => s.refreshPages);

  const [isLoading, setIsLoading] = useState(true);
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [selected, setSelected] = useState<PageVersion | null>(null);
  const [snapshotBlocks, setSnapshotBlocks] = useState<EditorBlock[] | null>(null);
  const [snapshotTitle, setSnapshotTitle] = useState<string>("");
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [isRestoring, setIsRestoring] = useState(false);
  const [confirmingRestore, setConfirmingRestore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the version list when the dialog opens.
  useEffect(() => {
    if (!isOpen || !page) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      setSelected(null);
      setSnapshotBlocks(null);
      setViewMode("preview");
      setConfirmingRestore(false);
      try {
        const list = await getPageVersions(page.notebookId, page.id);
        if (!cancelled) setVersions(list);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load versions");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, page]);

  // Load a selected snapshot's full content for preview / diff.
  const selectVersion = useCallback(
    async (version: PageVersion) => {
      if (!page) return;
      setSelected(version);
      setConfirmingRestore(false);
      setIsLoadingPreview(true);
      setError(null);
      try {
        const snap = await getPageVersion(page.notebookId, page.id, version.name);
        setSnapshotBlocks(snap.content?.blocks ?? []);
        setSnapshotTitle(snap.title || "Untitled");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load snapshot");
        setSnapshotBlocks(null);
      } finally {
        setIsLoadingPreview(false);
      }
    },
    [page]
  );

  const currentBlocks = page?.content?.blocks ?? [];
  const blockDiffs: BlockDiff[] | null = useMemo(() => {
    if (!snapshotBlocks) return null;
    // Diff FROM the snapshot TO the current page: "added" = present now but not
    // in the snapshot, "removed" = was in the snapshot but is gone now.
    return computeBlockDiff(snapshotBlocks, currentBlocks);
  }, [snapshotBlocks, currentBlocks]);

  const handleRestore = useCallback(async () => {
    if (!page || !selected) return;
    if (!confirmingRestore) {
      setConfirmingRestore(true);
      return;
    }
    setIsRestoring(true);
    setError(null);
    try {
      await restorePageVersion(page.notebookId, page.id, selected.name);
      // Refresh so every open pane re-renders with the restored content.
      await refreshPages([page.id]);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore version");
    } finally {
      setIsRestoring(false);
      setConfirmingRestore(false);
    }
  }, [page, selected, confirmingRestore, refreshPages, onClose]);

  // Escape closes; arrows / j-k navigate the list.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (versions.length === 0) return;
      const down = e.key === "ArrowDown" || e.key === "j";
      const up = e.key === "ArrowUp" || e.key === "k";
      if (!down && !up) return;
      e.preventDefault();
      const idx = selected
        ? versions.findIndex((v) => v.name === selected.name)
        : -1;
      const next = Math.min(versions.length - 1, Math.max(0, idx + (down ? 1 : -1)));
      void selectVersion(versions[next]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, versions, selected, onClose, selectVersion]);

  if (!isOpen || !page) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
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
              Version History
            </h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
              {page.title || "Untitled"} · local snapshots
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-base transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1">
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                Loading versions…
              </div>
            </div>
          ) : versions.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6">
              <p
                className="text-center text-sm"
                style={{ color: "var(--color-text-muted)" }}
              >
                No saved versions yet.
                <br />
                Snapshots are captured automatically as you edit.
              </p>
            </div>
          ) : (
            <>
              {/* Version list */}
              <div
                className="w-80 shrink-0 overflow-y-auto border-r"
                style={{ borderColor: "var(--color-border)" }}
              >
                {versions.map((v) => {
                  const isSelected = selected?.name === v.name;
                  return (
                    <button
                      key={v.name}
                      onClick={() => void selectVersion(v)}
                      className="w-full border-b px-4 py-3 text-left transition-colors hover:bg-[--color-bg-tertiary]"
                      style={{
                        borderColor: "var(--color-border)",
                        backgroundColor: isSelected
                          ? "var(--color-bg-tertiary)"
                          : undefined,
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className="text-sm font-medium"
                          style={{ color: "var(--color-text-secondary)" }}
                          title={new Date(v.ts).toLocaleString()}
                        >
                          {formatRelativeTime(v.ts)}
                        </span>
                        <span
                          className="shrink-0 text-[10px]"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {v.blockCount} block{v.blockCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                      {v.preview && (
                        <p
                          className="mt-1 line-clamp-2 text-xs"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {v.preview}
                        </p>
                      )}
                      {v.changesSince > 0 && (
                        <p
                          className="mt-1 text-[10px]"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {v.changesSince} edit{v.changesSince !== 1 ? "s" : ""} after
                          this
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Preview / diff */}
              <div className="flex min-w-0 flex-1 flex-col">
                {!selected ? (
                  <div className="flex flex-1 items-center justify-center">
                    <div
                      className="text-sm"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Select a version to preview
                    </div>
                  </div>
                ) : (
                  <>
                    <div
                      className="flex shrink-0 items-center justify-between border-b px-4 py-3"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      <span
                        className="text-sm"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {formatRelativeTime(selected.ts)}
                      </span>
                      <div
                        className="flex shrink-0 gap-1 rounded-lg p-0.5"
                        style={{ backgroundColor: "var(--color-bg-tertiary)" }}
                      >
                        {(["preview", "changes"] as ViewMode[]).map((m) => (
                          <button
                            key={m}
                            onClick={() => setViewMode(m)}
                            className="rounded-md px-3 py-1 text-xs font-medium transition-colors"
                            style={{
                              backgroundColor:
                                viewMode === m
                                  ? "rgba(139, 92, 246, 0.15)"
                                  : "transparent",
                              color:
                                viewMode === m
                                  ? "var(--color-accent)"
                                  : "var(--color-text-muted)",
                            }}
                          >
                            {m === "preview" ? "Preview" : "Changes vs current"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex-1 overflow-auto p-4">
                      {isLoadingPreview ? (
                        <div
                          className="text-sm"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          Loading…
                        </div>
                      ) : viewMode === "preview" ? (
                        snapshotBlocks ? (
                          <div>
                            <h3
                              className="mb-3 text-lg font-semibold"
                              style={{ color: "var(--color-text-primary)" }}
                            >
                              {snapshotTitle}
                            </h3>
                            <HistoryBlockRenderer blocks={snapshotBlocks} />
                          </div>
                        ) : (
                          <div
                            className="text-sm"
                            style={{ color: "var(--color-text-muted)" }}
                          >
                            No content
                          </div>
                        )
                      ) : blockDiffs && blockDiffs.length > 0 ? (
                        <BlockDiffRenderer diffs={blockDiffs} />
                      ) : (
                        <div
                          className="text-sm"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          No differences from the current version.
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Error */}
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
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {versions.length > 0 &&
              `${versions.length} version${versions.length !== 1 ? "s" : ""}`}
          </p>
          <div className="flex items-center gap-2">
            {confirmingRestore && (
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Replace current content with this version?
              </span>
            )}
            <button
              onClick={() => void handleRestore()}
              disabled={!selected || isRestoring}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
              style={{ backgroundColor: "var(--color-accent)", color: "white" }}
            >
              {isRestoring
                ? "Restoring…"
                : confirmingRestore
                  ? "Confirm restore"
                  : "Restore this version"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
