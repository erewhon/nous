import { useState, useEffect, useRef } from "react";
import type { Notebook } from "../../types/notebook";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import * as api from "../../utils/api";

interface MergeNotebookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string;
  notebookName: string;
  onMerged?: () => void;
}

export function MergeNotebookDialog({
  isOpen,
  onClose,
  notebookId,
  notebookName,
  onMerged,
}: MergeNotebookDialogProps) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const focusTrapRef = useFocusTrap(isOpen);
  const selectRef = useRef<HTMLSelectElement>(null);

  // Load notebooks when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadNotebooks();
      setTimeout(() => selectRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const loadNotebooks = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const allNotebooks = await api.listNotebooks();
      // Filter out the current notebook
      setNotebooks(allNotebooks.filter((nb) => nb.id !== notebookId));
    } catch (e) {
      setError("Failed to load notebooks");
      console.error("Failed to load notebooks:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMerge = async () => {
    if (!selectedNotebookId) return;

    setIsMerging(true);
    setError(null);
    try {
      await api.mergeNotebook(notebookId, selectedNotebookId);
      onMerged?.();
      handleClose();
    } catch (e) {
      setError("Failed to merge notebook");
      console.error("Failed to merge notebook:", e);
    } finally {
      setIsMerging(false);
    }
  };

  const handleClose = () => {
    setSelectedNotebookId(null);
    setError(null);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-notebook-title"
        className="w-full max-w-md rounded-xl border p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            id="merge-notebook-title"
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Merge Into Another Notebook
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

        <p
          className="mb-4 text-sm"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Merge all contents of &ldquo;{notebookName}&rdquo; into the selected
          notebook. The source notebook will be deleted.
        </p>

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

        {isLoading ? (
          <div
            className="py-8 text-center"
            style={{ color: "var(--color-text-muted)" }}
          >
            Loading notebooks...
          </div>
        ) : notebooks.length === 0 ? (
          <div
            className="py-8 text-center"
            style={{ color: "var(--color-text-muted)" }}
          >
            No other notebooks available.
          </div>
        ) : (
          <div>
            <label
              htmlFor="target-notebook"
              className="mb-2 block text-sm font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Target Notebook
            </label>
            <select
              id="target-notebook"
              ref={selectRef}
              value={selectedNotebookId || ""}
              onChange={(e) => setSelectedNotebookId(e.target.value || null)}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              <option value="">Select a notebook...</option>
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.icon ? `${nb.icon} ` : ""}{nb.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--color-bg-tertiary)]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={!selectedNotebookId || isMerging}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            {isMerging ? "Merging..." : "Merge"}
          </button>
        </div>
      </div>
    </div>
  );
}
