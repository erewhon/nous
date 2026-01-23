import { useState, useEffect, useRef } from "react";
import type { Library } from "../../types/library";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import * as api from "../../utils/api";

interface MoveNotebookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string;
  notebookName: string;
  currentLibraryId: string;
  onMoved?: () => void;
}

export function MoveNotebookDialog({
  isOpen,
  onClose,
  notebookId,
  notebookName,
  currentLibraryId,
  onMoved,
}: MoveNotebookDialogProps) {
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const focusTrapRef = useFocusTrap(isOpen);
  const selectRef = useRef<HTMLSelectElement>(null);

  // Load libraries when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadLibraries();
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

  const loadLibraries = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const allLibraries = await api.listLibraries();
      // Filter out the current library
      setLibraries(allLibraries.filter((lib) => lib.id !== currentLibraryId));
    } catch (e) {
      setError("Failed to load libraries");
      console.error("Failed to load libraries:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMove = async () => {
    if (!selectedLibraryId) return;

    setIsMoving(true);
    setError(null);
    try {
      await api.moveNotebookToLibrary(notebookId, currentLibraryId, selectedLibraryId);
      onMoved?.();
      handleClose();
    } catch (e) {
      setError("Failed to move notebook");
      console.error("Failed to move notebook:", e);
    } finally {
      setIsMoving(false);
    }
  };

  const handleClose = () => {
    setSelectedLibraryId(null);
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-notebook-title"
        className="w-full max-w-md rounded-xl border p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            id="move-notebook-title"
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Move Notebook to Library
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
          Move "{notebookName}" to another library.
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
            Loading libraries...
          </div>
        ) : libraries.length === 0 ? (
          <div
            className="py-8 text-center"
            style={{ color: "var(--color-text-muted)" }}
          >
            No other libraries available. Create a new library first.
          </div>
        ) : (
          <div>
            <label
              htmlFor="target-library"
              className="mb-2 block text-sm font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Target Library
            </label>
            <select
              id="target-library"
              ref={selectRef}
              value={selectedLibraryId || ""}
              onChange={(e) => setSelectedLibraryId(e.target.value || null)}
              className="w-full rounded-lg px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                border: "1px solid var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              <option value="">Select a library...</option>
              {libraries.map((lib) => (
                <option key={lib.id} value={lib.id}>
                  {lib.icon ? `${lib.icon} ` : ""}{lib.name}
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
            onClick={handleMove}
            disabled={!selectedLibraryId || isMoving}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            {isMoving ? "Moving..." : "Move Notebook"}
          </button>
        </div>
      </div>
    </div>
  );
}
