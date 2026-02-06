import { useState, useEffect, useRef, useCallback } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useToastStore } from "../../stores/toastStore";
import type { Page } from "../../types/page";
import { generatePrintHtml } from "./api";

interface PrintDialogProps {
  isOpen: boolean;
  onClose: () => void;
  page: Page;
}

export function PrintDialog({ isOpen, onClose, page }: PrintDialogProps) {
  const [includeToc, setIncludeToc] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const toast = useToastStore();

  const generate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const html = await generatePrintHtml(page.notebookId, page.id, {
        includeToc,
        includeMetadata,
      });
      setPrintHtml(html);
    } catch (err) {
      toast.error("Failed to generate print preview: " + String(err));
    } finally {
      setIsGenerating(false);
    }
  }, [page.notebookId, page.id, includeToc, includeMetadata, toast]);

  useEffect(() => {
    if (isOpen) {
      generate();
    } else {
      setPrintHtml(null);
    }
  }, [isOpen, generate]);

  const handlePrint = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
  };

  const handleExport = async () => {
    if (!printHtml) return;

    const path = await save({
      defaultPath: `${page.title || "page"}.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (path) {
      try {
        await writeTextFile(path, printHtml);
        toast.success("HTML exported successfully");
      } catch (err) {
        toast.error("Failed to export: " + String(err));
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg rounded-xl border p-6 shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-panel)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Print / PDF
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors hover:opacity-80"
            style={{ color: "var(--color-text-muted)" }}
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
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Options */}
        <div className="flex flex-col gap-3 mb-4">
          <label
            className="flex items-center gap-3 text-sm cursor-pointer"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <input
              type="checkbox"
              checked={includeToc}
              onChange={(e) => setIncludeToc(e.target.checked)}
              className="rounded"
              style={{ accentColor: "var(--color-accent)" }}
            />
            Include Table of Contents
          </label>
          <label
            className="flex items-center gap-3 text-sm cursor-pointer"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={(e) => setIncludeMetadata(e.target.checked)}
              className="rounded"
              style={{ accentColor: "var(--color-accent)" }}
            />
            Include Metadata (tags, dates)
          </label>
        </div>

        {/* Preview */}
        <div
          className="rounded-lg border overflow-hidden mb-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          {isGenerating ? (
            <div
              className="flex items-center justify-center"
              style={{ height: 400, color: "var(--color-text-muted)" }}
            >
              <svg
                className="h-5 w-5 animate-spin mr-2"
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
              <span className="text-sm">Generating preview...</span>
            </div>
          ) : printHtml ? (
            <iframe
              ref={iframeRef}
              srcDoc={printHtml}
              style={{
                width: "100%",
                height: 400,
                border: "none",
                background: "#fff",
              }}
              title="Print Preview"
            />
          ) : (
            <div
              className="flex items-center justify-center text-sm"
              style={{ height: 400, color: "var(--color-text-muted)" }}
            >
              No preview available
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex justify-end gap-2">
          <button
            onClick={handleExport}
            disabled={!printHtml || isGenerating}
            className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:opacity-80 disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            Export HTML
          </button>
          <button
            onClick={handlePrint}
            disabled={!printHtml || isGenerating}
            className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            Print
          </button>
        </div>
      </div>
    </div>
  );
}
