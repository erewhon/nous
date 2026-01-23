import { useState, useEffect, useRef } from "react";
import type { Notebook } from "../../types/notebook";
import type { Folder } from "../../types/page";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import * as api from "../../utils/api";

interface MovePageDialogProps {
  isOpen: boolean;
  onClose: () => void;
  pageId: string;
  pageTitle: string;
  currentNotebookId: string;
  onMoved?: () => void;
}

export function MovePageDialog({
  isOpen,
  onClose,
  pageId,
  pageTitle,
  currentNotebookId,
  onMoved,
}: MovePageDialogProps) {
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const focusTrapRef = useFocusTrap(isOpen);
  const selectRef = useRef<HTMLSelectElement>(null);

  // Load notebooks when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadNotebooks();
      // Focus the select when dialog opens
      setTimeout(() => selectRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Load folders when notebook is selected
  useEffect(() => {
    if (selectedNotebookId) {
      loadFolders(selectedNotebookId);
    } else {
      setFolders([]);
      setSelectedFolderId(null);
    }
  }, [selectedNotebookId]);

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
      setNotebooks(allNotebooks.filter((nb) => nb.id !== currentNotebookId));
    } catch (e) {
      setError("Failed to load notebooks");
      console.error("Failed to load notebooks:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadFolders = async (notebookId: string) => {
    try {
      const notebookFolders = await api.listFolders(notebookId);
      // Filter out archive folders
      setFolders(notebookFolders.filter((f) => f.folderType !== "archive"));
    } catch (e) {
      console.error("Failed to load folders:", e);
      setFolders([]);
    }
  };

  const handleMove = async () => {
    if (!selectedNotebookId) return;

    setIsMoving(true);
    setError(null);
    try {
      await api.movePageToNotebook(
        currentNotebookId,
        pageId,
        selectedNotebookId,
        selectedFolderId || undefined
      );
      onMoved?.();
      handleClose();
    } catch (e) {
      setError("Failed to move page");
      console.error("Failed to move page:", e);
    } finally {
      setIsMoving(false);
    }
  };

  const handleClose = () => {
    setSelectedNotebookId(null);
    setSelectedFolderId(null);
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
        aria-labelledby="move-page-title"
        className="w-full max-w-md rounded-xl border p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            id="move-page-title"
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Move Page to Notebook
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
          Move "{pageTitle}" to another notebook.
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
            No other notebooks available
          </div>
        ) : (
          <div className="space-y-4">
            {/* Notebook selection */}
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

            {/* Folder selection (optional) */}
            {selectedNotebookId && folders.length > 0 && (
              <div>
                <label
                  htmlFor="target-folder"
                  className="mb-2 block text-sm font-medium"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  Target Folder (optional)
                </label>
                <select
                  id="target-folder"
                  value={selectedFolderId || ""}
                  onChange={(e) => setSelectedFolderId(e.target.value || null)}
                  className="w-full rounded-lg px-3 py-2 text-sm"
                  style={{
                    backgroundColor: "var(--color-bg-primary)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-primary)",
                  }}
                >
                  <option value="">Root level (no folder)</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
            disabled={!selectedNotebookId || isMoving}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            {isMoving ? "Moving..." : "Move Page"}
          </button>
        </div>
      </div>
    </div>
  );
}
