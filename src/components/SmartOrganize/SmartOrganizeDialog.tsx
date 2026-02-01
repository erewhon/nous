import { useState, useEffect, useMemo } from "react";
import type { Notebook } from "../../types/notebook";
import type { OrganizeSuggestion, OrganizeMove } from "../../types/organize";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import * as api from "../../utils/api";

type Step = "configure" | "analyzing" | "review";

interface SmartOrganizeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  currentNotebookId: string;
  currentPageId?: string;
  currentPageTitle?: string;
  currentSectionId?: string | null;
  currentSectionName?: string;
  sectionsEnabled?: boolean;
  allPageIds?: string[];
  sectionPageIds?: string[];
  onCompleted?: () => void;
}

type SourceType = "current-page" | "section" | "notebook";

export function SmartOrganizeDialog({
  isOpen,
  onClose,
  currentNotebookId,
  currentPageId,
  currentPageTitle,
  currentSectionId,
  currentSectionName,
  sectionsEnabled,
  allPageIds,
  sectionPageIds,
  onCompleted,
}: SmartOrganizeDialogProps) {
  const [step, setStep] = useState<Step>("configure");
  const [sourceType, setSourceType] = useState<SourceType>(
    currentPageId ? "current-page" : "notebook"
  );
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedDestinations, setSelectedDestinations] = useState<Set<string>>(
    new Set()
  );
  const [isLoadingNotebooks, setIsLoadingNotebooks] = useState(false);
  const [suggestions, setSuggestions] = useState<OrganizeSuggestion[]>([]);
  const [checkedPages, setCheckedPages] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  const focusTrapRef = useFocusTrap(isOpen);

  // Load notebooks when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStep("configure");
      setError(null);
      setSuggestions([]);
      setCheckedPages(new Set());
      setOverrides({});
      setSourceType(currentPageId ? "current-page" : "notebook");
      loadNotebooks();
    }
  }, [isOpen, currentPageId]);

  // Keyboard handling
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const loadNotebooks = async () => {
    setIsLoadingNotebooks(true);
    try {
      const allNotebooks = await api.listNotebooks();
      const otherNotebooks = allNotebooks.filter(
        (nb) => nb.id !== currentNotebookId
      );
      setNotebooks(otherNotebooks);
      // Pre-select all destinations
      setSelectedDestinations(new Set(otherNotebooks.map((nb) => nb.id)));
    } catch {
      setError("Failed to load notebooks");
    } finally {
      setIsLoadingNotebooks(false);
    }
  };

  const handleClose = () => {
    setStep("configure");
    setError(null);
    setSuggestions([]);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  const toggleDestination = (notebookId: string) => {
    setSelectedDestinations((prev) => {
      const next = new Set(prev);
      if (next.has(notebookId)) {
        next.delete(notebookId);
      } else {
        next.add(notebookId);
      }
      return next;
    });
  };

  const selectAllDestinations = () => {
    setSelectedDestinations(new Set(notebooks.map((nb) => nb.id)));
  };

  const deselectAllDestinations = () => {
    setSelectedDestinations(new Set());
  };

  // Resolve which page IDs to send based on source type
  const resolvePageIds = (): string[] => {
    switch (sourceType) {
      case "current-page":
        return currentPageId ? [currentPageId] : [];
      case "section":
        return sectionPageIds ?? [];
      case "notebook":
        return allPageIds ?? [];
    }
  };

  const handleAnalyze = async () => {
    const pageIds = resolvePageIds();
    if (pageIds.length === 0) {
      setError("No pages to analyze");
      return;
    }
    if (selectedDestinations.size === 0) {
      setError("Select at least one destination notebook");
      return;
    }

    setStep("analyzing");
    setError(null);

    try {
      const results = await api.smartOrganizeSuggest(
        currentNotebookId,
        pageIds,
        Array.from(selectedDestinations)
      );
      setSuggestions(results);

      // Pre-check pages that have a suggested move
      const checked = new Set<string>();
      for (const s of results) {
        if (s.suggestedNotebookId) {
          checked.add(s.pageId);
        }
      }
      setCheckedPages(checked);
      setOverrides({});
      setStep("review");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to analyze pages"
      );
      setStep("configure");
    }
  };

  const togglePageCheck = (pageId: string) => {
    setCheckedPages((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  };

  const handleOverride = (pageId: string, notebookId: string | null) => {
    setOverrides((prev) => ({ ...prev, [pageId]: notebookId }));
    // If overriding to a notebook, check the page; if "keep", uncheck
    setCheckedPages((prev) => {
      const next = new Set(prev);
      if (notebookId) {
        next.add(pageId);
      } else {
        next.delete(pageId);
      }
      return next;
    });
  };

  // Build moves from checked pages
  const movesToApply = useMemo((): OrganizeMove[] => {
    const moves: OrganizeMove[] = [];
    for (const s of suggestions) {
      if (!checkedPages.has(s.pageId)) continue;
      const targetId =
        overrides[s.pageId] !== undefined
          ? overrides[s.pageId]
          : s.suggestedNotebookId;
      if (targetId) {
        moves.push({ pageId: s.pageId, targetNotebookId: targetId });
      }
    }
    return moves;
  }, [suggestions, checkedPages, overrides]);

  const moveCount = movesToApply.length;
  const keepCount = suggestions.length - moveCount;

  const handleApply = async () => {
    if (movesToApply.length === 0) return;

    setIsApplying(true);
    setError(null);

    try {
      const result = await api.smartOrganizeApply(
        currentNotebookId,
        movesToApply
      );
      if (result.errors.length > 0) {
        setError(
          `Moved ${result.movedCount} pages. Errors: ${result.errors.join(", ")}`
        );
      }
      onCompleted?.();
      handleClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to apply moves"
      );
    } finally {
      setIsApplying(false);
    }
  };

  const confidenceColor = (c: number): string => {
    if (c > 0.8) return "#22c55e";
    if (c > 0.5) return "#eab308";
    return "#ef4444";
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="smart-organize-title"
        className="w-full max-w-2xl rounded-xl border p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2
            id="smart-organize-title"
            className="text-lg font-semibold flex items-center gap-2"
            style={{ color: "var(--color-text-primary)" }}
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
              style={{ color: "var(--color-accent)" }}
            >
              <path d="M15 4V2" />
              <path d="M15 16v-2" />
              <path d="M8 9h2" />
              <path d="M20 9h2" />
              <path d="M17.8 11.8 19 13" />
              <path d="M15 9h.01" />
              <path d="M17.8 6.2 19 5" />
              <path d="m3 21 9-9" />
              <path d="M12.2 6.2 11 5" />
            </svg>
            Smart Organize
          </h2>
          <button
            onClick={handleClose}
            className="rounded-full p-1 transition-colors hover:bg-[var(--color-bg-tertiary)]"
            aria-label="Close"
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
              style={{ color: "var(--color-text-muted)" }}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {error && (
          <div
            className="mb-4 rounded-lg p-3 text-sm"
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              color: "#ef4444",
            }}
          >
            {error}
          </div>
        )}

        {/* Step: Configure */}
        {step === "configure" && (
          <div className="space-y-4 overflow-y-auto flex-1">
            <p
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              AI will analyze your pages and suggest which notebook each should
              be moved to.
            </p>

            {/* Source selection */}
            <div>
              <label
                className="mb-2 block text-sm font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Source
              </label>
              <div className="space-y-2">
                {currentPageId && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="source"
                      checked={sourceType === "current-page"}
                      onChange={() => setSourceType("current-page")}
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <span style={{ color: "var(--color-text-primary)" }}>
                      Current Page
                      {currentPageTitle && (
                        <span
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          {" "}
                          — {currentPageTitle}
                        </span>
                      )}
                    </span>
                  </label>
                )}

                {sectionsEnabled && currentSectionId && currentSectionName && (
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="source"
                      checked={sourceType === "section"}
                      onChange={() => setSourceType("section")}
                      style={{ accentColor: "var(--color-accent)" }}
                    />
                    <span style={{ color: "var(--color-text-primary)" }}>
                      Pages in section "{currentSectionName}"
                      {sectionPageIds && (
                        <span style={{ color: "var(--color-text-muted)" }}>
                          {" "}
                          ({sectionPageIds.length} pages)
                        </span>
                      )}
                    </span>
                  </label>
                )}

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="source"
                    checked={sourceType === "notebook"}
                    onChange={() => setSourceType("notebook")}
                    style={{ accentColor: "var(--color-accent)" }}
                  />
                  <span style={{ color: "var(--color-text-primary)" }}>
                    All pages in notebook
                    {allPageIds && (
                      <span style={{ color: "var(--color-text-muted)" }}>
                        {" "}
                        ({allPageIds.length} pages)
                      </span>
                    )}
                  </span>
                </label>
              </div>
            </div>

            {/* Destination notebooks */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label
                  className="block text-sm font-medium"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Destination Notebooks
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={selectAllDestinations}
                    className="text-xs transition-colors hover:underline"
                    style={{ color: "var(--color-accent)" }}
                  >
                    Select all
                  </button>
                  <button
                    onClick={deselectAllDestinations}
                    className="text-xs transition-colors hover:underline"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Deselect all
                  </button>
                </div>
              </div>

              {isLoadingNotebooks ? (
                <div
                  className="py-4 text-center text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Loading notebooks...
                </div>
              ) : notebooks.length === 0 ? (
                <div
                  className="py-4 text-center text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  No other notebooks available
                </div>
              ) : (
                <div
                  className="max-h-48 overflow-y-auto rounded-lg border p-2 space-y-1"
                  style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: "var(--color-bg-primary)",
                  }}
                >
                  {notebooks.map((nb) => (
                    <label
                      key={nb.id}
                      className="flex items-center gap-2 rounded px-2 py-1.5 text-sm cursor-pointer transition-colors hover:bg-[var(--color-bg-tertiary)]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDestinations.has(nb.id)}
                        onChange={() => toggleDestination(nb.id)}
                        style={{ accentColor: "var(--color-accent)" }}
                      />
                      <span style={{ color: "var(--color-text-primary)" }}>
                        {nb.icon ? `${nb.icon} ` : ""}
                        {nb.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleClose}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Cancel
              </button>
              <button
                onClick={handleAnalyze}
                disabled={
                  selectedDestinations.size === 0 ||
                  resolvePageIds().length === 0
                }
                className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
              >
                Analyze
              </button>
            </div>
          </div>
        )}

        {/* Step: Analyzing */}
        {step === "analyzing" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }}
            />
            <p
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Analyzing {resolvePageIds().length} page
              {resolvePageIds().length !== 1 ? "s" : ""}...
            </p>
          </div>
        )}

        {/* Step: Review */}
        {step === "review" && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Stats bar */}
            <div
              className="mb-3 flex items-center gap-4 text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <span>
                Suggestions for {suggestions.length} page
                {suggestions.length !== 1 ? "s" : ""}
              </span>
              <span style={{ color: "var(--color-text-muted)" }}>|</span>
              <span style={{ color: "#22c55e" }}>
                Move: {moveCount}
              </span>
              <span style={{ color: "var(--color-text-muted)" }}>
                Keep in place: {keepCount}
              </span>
            </div>

            {/* Table */}
            <div
              className="flex-1 overflow-y-auto rounded-lg border"
              style={{ borderColor: "var(--color-border)" }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="border-b text-left"
                    style={{
                      borderColor: "var(--color-border)",
                      backgroundColor: "var(--color-bg-primary)",
                    }}
                  >
                    <th className="px-3 py-2 w-8"></th>
                    <th
                      className="px-3 py-2 font-medium"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      Page
                    </th>
                    <th
                      className="px-3 py-2 font-medium"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      Suggested Notebook
                    </th>
                    <th
                      className="px-3 py-2 font-medium w-16 text-center"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      Conf.
                    </th>
                    <th
                      className="px-3 py-2 font-medium"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      Reasoning
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {suggestions.map((s) => {
                    const effectiveTarget =
                      overrides[s.pageId] !== undefined
                        ? overrides[s.pageId]
                        : s.suggestedNotebookId;

                    return (
                      <tr
                        key={s.pageId}
                        className="border-b transition-colors hover:bg-[var(--color-bg-tertiary)]"
                        style={{ borderColor: "var(--color-border)" }}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checkedPages.has(s.pageId)}
                            onChange={() => togglePageCheck(s.pageId)}
                            style={{ accentColor: "var(--color-accent)" }}
                          />
                        </td>
                        <td
                          className="px-3 py-2"
                          style={{ color: "var(--color-text-primary)" }}
                        >
                          {s.pageTitle}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={effectiveTarget ?? ""}
                            onChange={(e) =>
                              handleOverride(
                                s.pageId,
                                e.target.value || null
                              )
                            }
                            className="w-full rounded px-2 py-1 text-sm"
                            style={{
                              backgroundColor: "var(--color-bg-primary)",
                              border: "1px solid var(--color-border)",
                              color: "var(--color-text-primary)",
                            }}
                          >
                            <option value="">Keep in place</option>
                            {notebooks
                              .filter((nb) =>
                                selectedDestinations.has(nb.id)
                              )
                              .map((nb) => (
                                <option key={nb.id} value={nb.id}>
                                  {nb.icon ? `${nb.icon} ` : ""}
                                  {nb.name}
                                </option>
                              ))}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className="inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: `${confidenceColor(s.confidence)}20`,
                              color: confidenceColor(s.confidence),
                            }}
                          >
                            {Math.round(s.confidence * 100)}%
                          </span>
                        </td>
                        <td
                          className="px-3 py-2 max-w-[200px] truncate"
                          style={{ color: "var(--color-text-muted)" }}
                          title={s.reasoning}
                        >
                          {s.reasoning}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center gap-3 pt-4">
              <button
                onClick={() => setStep("configure")}
                className="rounded-lg px-3 py-2 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: "var(--color-text-muted)" }}
              >
                Back
              </button>
              <div className="flex gap-3">
                <button
                  onClick={handleClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-bg-tertiary)]"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleApply}
                  disabled={moveCount === 0 || isApplying}
                  className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "white",
                  }}
                >
                  {isApplying
                    ? "Moving..."
                    : `Move Selected (${moveCount})`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
