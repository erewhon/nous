import { useState, useEffect, useRef } from "react";
import type { Notebook } from "../../types/notebook";
import { useNotebookStore } from "../../stores/notebookStore";

interface NotebookSettingsDialogProps {
  isOpen: boolean;
  notebook: Notebook | null;
  onClose: () => void;
}

export function NotebookSettingsDialog({
  isOpen,
  notebook,
  onClose,
}: NotebookSettingsDialogProps) {
  const { updateNotebook, deleteNotebook } = useNotebookStore();
  const [name, setName] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Reset form when notebook changes
  useEffect(() => {
    if (notebook) {
      setName(notebook.name);
      setSystemPrompt(notebook.systemPrompt || "");
    }
  }, [notebook]);

  // Focus name input when dialog opens
  useEffect(() => {
    if (isOpen && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isOpen]);

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

  const handleSave = async () => {
    if (!notebook || !name.trim()) return;

    setIsSaving(true);
    try {
      await updateNotebook(notebook.id, {
        name: name.trim(),
        systemPrompt: systemPrompt.trim() || undefined,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!notebook) return;

    await deleteNotebook(notebook.id);
    setShowDeleteConfirm(false);
    onClose();
  };

  // Close when clicking backdrop
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen || !notebook) return null;

  const hasChanges =
    name !== notebook.name ||
    (systemPrompt || "") !== (notebook.systemPrompt || "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-lg rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Notebook Settings
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <IconClose />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-5 p-6">
          {/* Notebook Name */}
          <div>
            <label
              className="mb-2 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Name
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Notebook name"
              className="w-full rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* System Prompt */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                AI System Prompt
              </label>
              {systemPrompt && (
                <button
                  onClick={() => setSystemPrompt("")}
                  className="text-xs transition-colors hover:underline"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Clear
                </button>
              )}
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Custom AI system prompt for this notebook (optional). Leave empty to use the app default."
              rows={5}
              className="w-full resize-none rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:border-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            <p
              className="mt-1.5 text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              This prompt overrides the app default for all pages in this notebook,
              unless a page has its own custom prompt.
            </p>
          </div>

          {/* Info */}
          <div
            className="flex items-start gap-2 rounded-lg border p-3"
            style={{
              backgroundColor: "rgba(139, 92, 246, 0.05)",
              borderColor: "rgba(139, 92, 246, 0.2)",
            }}
          >
            <IconInfo />
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              <strong>Prompt inheritance:</strong> Page prompt → Notebook prompt → App default.
              When you chat with AI, the most specific prompt is used.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t px-6 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-red-500/10"
            style={{ color: "var(--color-error)" }}
          >
            Delete Notebook
          </button>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-secondary)",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || isSaving || !hasChanges}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{
                background: "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
              }}
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowDeleteConfirm(false);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border p-6 shadow-2xl"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
            }}
          >
            <h3
              className="mb-2 text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Delete Notebook
            </h3>
            <p
              className="mb-6 text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Are you sure you want to delete "{notebook.name}"? This will permanently
              delete all pages in this notebook. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: "var(--color-error)" }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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

function IconInfo() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--color-accent)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, marginTop: 1 }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}
