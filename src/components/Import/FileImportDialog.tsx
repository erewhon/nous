import { useEffect, useRef, useId, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { FileStorageMode, Folder, Section } from "../../types/page";
import type { Notebook } from "../../types/notebook";
import { classifyFile, getFileTypeLabel } from "../../utils/fileImport";
import * as api from "../../utils/api";

export interface ImportConfig {
  storageMode: FileStorageMode;
  notebookId: string;
  sectionId?: string;
  folderId?: string;
}

export interface ImportProgress {
  total: number;
  completed: number;
  currentFile: string;
}

interface FileImportDialogProps {
  isOpen: boolean;
  filePaths: string[];
  currentNotebookId: string | null;
  currentSectionId?: string | null;
  onConfirm: (config: ImportConfig) => void;
  onCancel: () => void;
  importProgress?: ImportProgress | null;
}

export function FileImportDialog({
  isOpen,
  filePaths,
  currentNotebookId,
  currentSectionId,
  onConfirm,
  onCancel,
  importProgress,
}: FileImportDialogProps) {
  const [storageMode, setStorageMode] = useState<FileStorageMode>("embedded");
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const focusTrapRef = useFocusTrap(isOpen);
  const titleId = useId();

  const isImporting = importProgress != null;

  // Classify all files
  const classifiedFiles = filePaths.map((path) => {
    const fileName = path.split(/[/\\]/).pop() || path;
    const classification = classifyFile(path);
    return { path, fileName, ...classification };
  });

  // Check if any native files exist (need storage mode)
  const hasNativeFiles = classifiedFiles.some((f) => f.action === "native" && f.supported);

  // Load notebooks when dialog opens
  useEffect(() => {
    if (!isOpen) return;
    api.listNotebooks().then((nbs) => {
      setNotebooks(nbs);
      // Default to current notebook
      if (currentNotebookId) {
        setSelectedNotebookId(currentNotebookId);
      } else if (nbs.length > 0) {
        setSelectedNotebookId(nbs[0].id);
      }
    });
    // Reset section/folder to current
    setSelectedSectionId(currentSectionId ?? null);
    setSelectedFolderId(null);
    setStorageMode("embedded");
  }, [isOpen, currentNotebookId, currentSectionId]);

  // Load sections and folders when notebook changes
  useEffect(() => {
    if (!selectedNotebookId) {
      setSections([]);
      setFolders([]);
      return;
    }
    // Load sections
    const nb = notebooks.find((n) => n.id === selectedNotebookId);
    if (nb?.sectionsEnabled) {
      api.listSections(selectedNotebookId).then(setSections);
    } else {
      setSections([]);
      setSelectedSectionId(null);
    }
    // Load folders
    api.listFolders(selectedNotebookId).then((allFolders) => {
      setFolders(allFolders.filter((f) => f.folderType !== "archive"));
    });
  }, [selectedNotebookId, notebooks]);

  // Focus confirm button when dialog opens
  useEffect(() => {
    if (isOpen && confirmButtonRef.current) {
      confirmButtonRef.current.focus();
    }
  }, [isOpen]);

  // Handle keyboard events
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImporting) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel, isImporting]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isImporting) {
      onCancel();
    }
  };

  const handleConfirm = () => {
    if (!selectedNotebookId) return;
    onConfirm({
      storageMode,
      notebookId: selectedNotebookId,
      sectionId: selectedSectionId || undefined,
      folderId: selectedFolderId || undefined,
    });
  };

  if (!isOpen || filePaths.length === 0) return null;

  const progressPercent = importProgress
    ? Math.round((importProgress.completed / importProgress.total) * 100)
    : 0;

  const selectedNb = notebooks.find((n) => n.id === selectedNotebookId);

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
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-xl border p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <h2
          id={titleId}
          className="mb-4 text-lg font-semibold"
          style={{ color: "var(--color-text-primary)" }}
        >
          Import {filePaths.length === 1 ? "File" : `${filePaths.length} Files`}
        </h2>

        {/* File list */}
        <div
          className="mb-4 rounded-lg p-3 max-h-40 overflow-y-auto"
          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
        >
          {classifiedFiles.map((file) => (
            <div key={file.path} className="flex items-center gap-2 py-1">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: file.supported ? "var(--color-accent)" : "var(--color-text-muted)", flexShrink: 0 }}
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span
                className="text-sm truncate flex-1"
                style={{ color: "var(--color-text-primary)" }}
                title={file.path}
              >
                {file.fileName}
              </span>
              <span
                className="text-xs flex-shrink-0 rounded px-1.5 py-0.5"
                style={{
                  color: file.supported ? "var(--color-text-secondary)" : "var(--color-text-muted)",
                  backgroundColor: file.supported ? "var(--color-bg-secondary)" : "transparent",
                }}
              >
                {file.supported ? getFileTypeLabel(file.extension) : "Unsupported"}
              </span>
            </div>
          ))}
        </div>

        {/* Location pickers */}
        <div className="mb-4 space-y-3">
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Import to
          </p>

          {/* Notebook select */}
          <div>
            <label
              className="block text-xs mb-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              Notebook
            </label>
            <select
              value={selectedNotebookId || ""}
              onChange={(e) => {
                setSelectedNotebookId(e.target.value || null);
                setSelectedSectionId(null);
                setSelectedFolderId(null);
              }}
              disabled={isImporting}
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.name}
                </option>
              ))}
            </select>
          </div>

          {/* Section select (only if notebook has sections) */}
          {selectedNb?.sectionsEnabled && sections.length > 0 && (
            <div>
              <label
                className="block text-xs mb-1"
                style={{ color: "var(--color-text-muted)" }}
              >
                Section
              </label>
              <select
                value={selectedSectionId || ""}
                onChange={(e) => setSelectedSectionId(e.target.value || null)}
                disabled={isImporting}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              >
                <option value="">No section</option>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Folder select */}
          {folders.length > 0 && (
            <div>
              <label
                className="block text-xs mb-1"
                style={{ color: "var(--color-text-muted)" }}
              >
                Folder
              </label>
              <select
                value={selectedFolderId || ""}
                onChange={(e) => setSelectedFolderId(e.target.value || null)}
                disabled={isImporting}
                className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              >
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Storage mode selection — only for native file types */}
        {hasNativeFiles && (
          <div className="mb-4">
            <p
              className="mb-2 text-sm font-medium"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Storage mode
            </p>
            <div className="space-y-2">
              <label
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
                style={{
                  borderColor:
                    storageMode === "embedded"
                      ? "var(--color-accent)"
                      : "var(--color-border)",
                  backgroundColor:
                    storageMode === "embedded"
                      ? "var(--color-accent-subtle)"
                      : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="storageMode"
                  value="embedded"
                  checked={storageMode === "embedded"}
                  onChange={() => setStorageMode("embedded")}
                  disabled={isImporting}
                  className="mt-0.5"
                />
                <div>
                  <span
                    className="text-sm font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Embedded (Recommended)
                  </span>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Copy files into the notebook. Portable and included in exports.
                  </p>
                </div>
              </label>
              <label
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors"
                style={{
                  borderColor:
                    storageMode === "linked"
                      ? "var(--color-accent)"
                      : "var(--color-border)",
                  backgroundColor:
                    storageMode === "linked"
                      ? "var(--color-accent-subtle)"
                      : "transparent",
                }}
              >
                <input
                  type="radio"
                  name="storageMode"
                  value="linked"
                  checked={storageMode === "linked"}
                  onChange={() => setStorageMode("linked")}
                  disabled={isImporting}
                  className="mt-0.5"
                />
                <div>
                  <span
                    className="text-sm font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Linked
                  </span>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Reference the original file location. Changes reflected automatically.
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Progress bar during import */}
        {importProgress && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <span
                className="text-xs"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Importing {importProgress.completed + 1}/{importProgress.total}...
              </span>
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {progressPercent}%
              </span>
            </div>
            <div
              className="h-2 w-full rounded-full overflow-hidden"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${progressPercent}%`,
                  backgroundColor: "var(--color-accent)",
                }}
              />
            </div>
            <p
              className="mt-1 text-xs truncate"
              style={{ color: "var(--color-text-muted)" }}
              title={importProgress.currentFile}
            >
              {importProgress.currentFile}
            </p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex justify-end gap-3" role="group" aria-label="Dialog actions">
          <button
            onClick={onCancel}
            disabled={isImporting}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            onClick={handleConfirm}
            disabled={isImporting || !selectedNotebookId}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            {isImporting ? (
              <>
                <svg
                  className="animate-spin h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Importing...
              </>
            ) : (
              `Import ${filePaths.length === 1 ? "" : `${filePaths.length} files`}`.trim()
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
