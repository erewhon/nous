import { useEffect, useRef, useId, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import type { FileStorageMode } from "../../types/page";

interface FileImportDialogProps {
  isOpen: boolean;
  filePath: string;
  onConfirm: (storageMode: FileStorageMode) => void;
  onCancel: () => void;
}

export function FileImportDialog({
  isOpen,
  filePath,
  onConfirm,
  onCancel,
}: FileImportDialogProps) {
  const [storageMode, setStorageMode] = useState<FileStorageMode>("embedded");
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const focusTrapRef = useFocusTrap(isOpen);
  const titleId = useId();
  const descriptionId = useId();

  // Extract filename from path
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  // Determine file type for display
  const getFileType = (path: string): string => {
    const ext = path.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "md":
        return "Markdown";
      case "pdf":
        return "PDF";
      case "ipynb":
        return "Jupyter Notebook";
      case "epub":
        return "EPUB";
      case "ics":
        return "Calendar";
      default:
        return "File";
    }
  };

  const fileType = getFileType(filePath);

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
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter" && document.activeElement === confirmButtonRef.current) {
        onConfirm(storageMode);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onConfirm, onCancel, storageMode]);

  // Close when clicking backdrop
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onCancel();
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
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-xl border p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <h2
          id={titleId}
          className="mb-2 text-lg font-semibold"
          style={{ color: "var(--color-text-primary)" }}
        >
          Import {fileType}
        </h2>

        {/* File info */}
        <div
          className="mb-4 rounded-lg p-3"
          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
        >
          <div className="flex items-center gap-2">
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
              style={{ color: "var(--color-accent)" }}
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span
              className="text-sm font-medium truncate"
              style={{ color: "var(--color-text-primary)" }}
              title={fileName}
            >
              {fileName}
            </span>
          </div>
          <p
            className="mt-1 text-xs truncate"
            style={{ color: "var(--color-text-muted)" }}
            title={filePath}
          >
            {filePath}
          </p>
        </div>

        {/* Storage mode selection */}
        <div className="mb-6">
          <p
            id={descriptionId}
            className="mb-3 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            How would you like to store this file?
          </p>

          <div className="space-y-2">
            {/* Embedded option */}
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
                  Copy the file into the notebook. The file will be portable and included in exports.
                </p>
              </div>
            </label>

            {/* Linked option */}
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
                  Reference the original file location. Changes to the file will be reflected in the notebook.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-3" role="group" aria-label="Dialog actions">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Cancel
          </button>
          <button
            ref={confirmButtonRef}
            onClick={() => onConfirm(storageMode)}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
