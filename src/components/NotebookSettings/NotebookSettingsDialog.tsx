import { useState, useEffect, useRef, useCallback } from "react";
import type { Notebook } from "../../types/notebook";
import { useNotebookStore } from "../../stores/notebookStore";
import {
  gitIsEnabled,
  gitInit,
  gitStatus,
  gitSetRemote,
  gitRemoveRemote,
  gitPush,
  gitPull,
  getCoverPage,
  createCoverPage,
  type GitStatus,
} from "../../utils/api";
import { InlineColorPicker } from "../ColorPicker/ColorPicker";

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
  const [color, setColor] = useState<string | undefined>(undefined);
  const [sectionsEnabled, setSectionsEnabled] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Git state
  const [gitEnabled, setGitEnabled] = useState(false);
  const [gitStatusData, setGitStatusData] = useState<GitStatus | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [isGitLoading, setIsGitLoading] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);

  // Cover page state
  const [hasCoverPage, setHasCoverPage] = useState(false);
  const [isCoverLoading, setIsCoverLoading] = useState(false);

  // Load git status
  const loadGitStatus = useCallback(async () => {
    if (!notebook) return;
    try {
      const enabled = await gitIsEnabled(notebook.id);
      setGitEnabled(enabled);
      if (enabled) {
        const status = await gitStatus(notebook.id);
        setGitStatusData(status);
        setRemoteUrl(status.remote_url || "");
      }
    } catch (e) {
      console.error("Failed to load git status:", e);
    }
  }, [notebook]);

  // Load cover page status
  const loadCoverStatus = useCallback(async () => {
    if (!notebook) return;
    try {
      const cover = await getCoverPage(notebook.id);
      setHasCoverPage(cover !== null);
    } catch (e) {
      console.error("Failed to load cover page status:", e);
    }
  }, [notebook]);

  // Reset form when notebook changes
  useEffect(() => {
    if (notebook) {
      setName(notebook.name);
      setColor(notebook.color);
      setSectionsEnabled(notebook.sectionsEnabled ?? false);
      setSystemPrompt(notebook.systemPrompt || "");
      loadGitStatus();
      loadCoverStatus();
    }
  }, [notebook, loadGitStatus, loadCoverStatus]);

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
        color: color || undefined,
        sectionsEnabled,
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
    (color || null) !== (notebook.color || null) ||
    sectionsEnabled !== (notebook.sectionsEnabled ?? false) ||
    (systemPrompt || "") !== (notebook.systemPrompt || "");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleBackdropClick}
    >
      <div
        className="flex w-full max-w-lg flex-col rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
          maxHeight: "calc(100vh - 4rem)",
        }}
      >
        {/* Header */}
        <div
          className="flex flex-shrink-0 items-center justify-between border-b px-6 py-4"
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

        {/* Content - scrollable */}
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
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

          {/* Color */}
          <div>
            <label
              className="mb-2 block text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Color
            </label>
            <InlineColorPicker
              value={color}
              onChange={(c) => setColor(c)}
              showClear={true}
            />
          </div>

          {/* Sections Toggle */}
          <div
            className="flex items-center justify-between rounded-lg border p-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div>
              <span
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Enable Sections
              </span>
              <p
                className="mt-0.5 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Organize pages with tabs (like OneNote sections)
              </p>
            </div>
            <button
              onClick={() => setSectionsEnabled(!sectionsEnabled)}
              className="relative h-6 w-11 rounded-full transition-colors"
              style={{
                backgroundColor: sectionsEnabled
                  ? "var(--color-accent)"
                  : "var(--color-bg-tertiary)",
              }}
            >
              <span
                className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform"
                style={{
                  left: sectionsEnabled ? "calc(100% - 1.375rem)" : "0.125rem",
                }}
              />
            </button>
          </div>

          {/* Cover Page */}
          <div
            className="flex items-center justify-between rounded-lg border p-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div>
              <span
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Cover Page
              </span>
              <p
                className="mt-0.5 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {hasCoverPage
                  ? "Customize your notebook's cover page"
                  : "Add a styled entry page for this notebook"}
              </p>
            </div>
            {hasCoverPage ? (
              <span
                className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: "rgba(34, 197, 94, 0.15)",
                  color: "rgb(34, 197, 94)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Created
              </span>
            ) : (
              <button
                onClick={async () => {
                  if (!notebook) return;
                  setIsCoverLoading(true);
                  try {
                    await createCoverPage(notebook.id);
                    setHasCoverPage(true);
                  } catch (e) {
                    console.error("Failed to create cover page:", e);
                  } finally {
                    setIsCoverLoading(false);
                  }
                }}
                disabled={isCoverLoading}
                className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                style={{
                  backgroundColor: "var(--color-accent)",
                  color: "white",
                }}
              >
                {isCoverLoading ? "Creating..." : "Create Cover"}
              </button>
            )}
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

          {/* Git Version Control */}
          <div
            className="rounded-lg border p-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <IconGit />
                <span
                  className="text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  Version Control
                </span>
              </div>
              {!gitEnabled ? (
                <button
                  onClick={async () => {
                    if (!notebook) return;
                    setIsGitLoading(true);
                    setGitError(null);
                    try {
                      await gitInit(notebook.id);
                      await loadGitStatus();
                    } catch (e) {
                      setGitError(e instanceof Error ? e.message : "Failed to enable Git");
                    } finally {
                      setIsGitLoading(false);
                    }
                  }}
                  disabled={isGitLoading}
                  className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors hover:opacity-90"
                  style={{
                    backgroundColor: "var(--color-accent)",
                    color: "white",
                  }}
                >
                  {isGitLoading ? "Enabling..." : "Enable Git"}
                </button>
              ) : (
                <span
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{
                    backgroundColor: "rgba(34, 197, 94, 0.15)",
                    color: "rgb(34, 197, 94)",
                  }}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Enabled
                </span>
              )}
            </div>

            {gitEnabled && gitStatusData && (
              <div className="space-y-3">
                {/* Status */}
                <div className="flex items-center gap-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
                  <span>
                    Branch: <strong style={{ color: "var(--color-text-primary)" }}>{gitStatusData.branch || "main"}</strong>
                  </span>
                  {gitStatusData.is_dirty ? (
                    <span className="text-yellow-500">Uncommitted changes</span>
                  ) : (
                    <span className="text-green-500">Clean</span>
                  )}
                  {gitStatusData.ahead > 0 && (
                    <span>↑ {gitStatusData.ahead} ahead</span>
                  )}
                  {gitStatusData.behind > 0 && (
                    <span>↓ {gitStatusData.behind} behind</span>
                  )}
                </div>

                {/* Last commit */}
                {gitStatusData.last_commit && (
                  <div className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                    Last commit: <span style={{ color: "var(--color-text-secondary)" }}>{gitStatusData.last_commit.message}</span>
                    <span className="ml-2 opacity-60">({gitStatusData.last_commit.short_id})</span>
                  </div>
                )}

                {/* Remote URL */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium" style={{ color: "var(--color-text-secondary)" }}>
                    Remote URL (optional)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={remoteUrl}
                      onChange={(e) => setRemoteUrl(e.target.value)}
                      placeholder="https://github.com/user/repo.git"
                      className="flex-1 rounded-md border px-2.5 py-1.5 text-xs outline-none transition-colors focus:border-[--color-accent]"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        borderColor: "var(--color-border)",
                        color: "var(--color-text-primary)",
                      }}
                    />
                    <button
                      onClick={async () => {
                        if (!notebook) return;
                        setIsGitLoading(true);
                        setGitError(null);
                        try {
                          if (remoteUrl.trim()) {
                            await gitSetRemote(notebook.id, remoteUrl.trim());
                          } else {
                            await gitRemoveRemote(notebook.id);
                          }
                          await loadGitStatus();
                        } catch (e) {
                          setGitError(e instanceof Error ? e.message : "Failed to set remote");
                        } finally {
                          setIsGitLoading(false);
                        }
                      }}
                      disabled={isGitLoading}
                      className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      Save
                    </button>
                  </div>
                </div>

                {/* Push/Pull buttons */}
                {gitStatusData.has_remote && (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        if (!notebook) return;
                        setIsGitLoading(true);
                        setGitError(null);
                        try {
                          await gitPull(notebook.id);
                          await loadGitStatus();
                        } catch (e) {
                          setGitError(e instanceof Error ? e.message : "Pull failed");
                        } finally {
                          setIsGitLoading(false);
                        }
                      }}
                      disabled={isGitLoading}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      <IconDownload /> Pull
                    </button>
                    <button
                      onClick={async () => {
                        if (!notebook) return;
                        setIsGitLoading(true);
                        setGitError(null);
                        try {
                          await gitPush(notebook.id);
                          await loadGitStatus();
                        } catch (e) {
                          setGitError(e instanceof Error ? e.message : "Push failed");
                        } finally {
                          setIsGitLoading(false);
                        }
                      }}
                      disabled={isGitLoading}
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
                      style={{
                        backgroundColor: "var(--color-bg-tertiary)",
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      <IconUpload /> Push
                    </button>
                  </div>
                )}

                {/* Error message */}
                {gitError && (
                  <p className="text-xs" style={{ color: "var(--color-error)" }}>
                    {gitError}
                  </p>
                )}
              </div>
            )}

            {!gitEnabled && (
              <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                Enable Git to track page history, sync to remote repositories, and restore previous versions.
              </p>
            )}
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
          className="flex flex-shrink-0 items-center justify-between border-t px-6 py-4"
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

function IconGit() {
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
      style={{ color: "var(--color-text-muted)" }}
    >
      <circle cx="12" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="6" r="3" />
      <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
      <path d="M12 12v3" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
