import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Page as PageType } from "../../types/page";
import { useLinkedFileSync } from "../../hooks/useLinkedFileSync";
import { LinkedFileChangedBanner } from "../LinkedFile";
import * as api from "../../utils/api";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFPageViewerProps {
  page: PageType;
  notebookId: string;
  className?: string;
}

export function PDFPageViewer({ page, notebookId, className = "" }: PDFPageViewerProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [isReloading, setIsReloading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Linked file sync detection
  const { isModified, dismiss, markSynced } = useLinkedFileSync(page, notebookId);

  // Reload the PDF file
  const handleReload = useCallback(async () => {
    setIsReloading(true);
    try {
      // Mark the file as synced
      await api.markLinkedFileSynced(notebookId, page.id);
      markSynced();
      // Force reload by incrementing key and clearing cache
      setReloadKey((k) => k + 1);
      // Re-fetch file URL to bust cache
      const filePath = await api.getFilePath(notebookId, page.id);
      const url = convertFileSrc(filePath) + `?t=${Date.now()}`;
      setFileUrl(url);
    } catch (err) {
      console.error("Failed to reload PDF:", err);
    } finally {
      setIsReloading(false);
    }
  }, [notebookId, page.id, markSynced]);

  // Load file path and convert to URL
  useEffect(() => {
    const loadFile = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const filePath = await api.getFilePath(notebookId, page.id);
        const url = convertFileSrc(filePath);
        setFileUrl(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load PDF");
        console.error("Failed to load PDF:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadFile();
  }, [notebookId, page.id, reloadKey]);

  // Update container width on resize
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.clientWidth);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === "ArrowLeft" && currentPage > 1) {
        setCurrentPage((p) => p - 1);
      } else if (e.key === "ArrowRight" && currentPage < totalPages) {
        setCurrentPage((p) => p + 1);
      } else if (e.key === "+" || e.key === "=") {
        setZoom((z) => Math.min(z + 0.25, 3));
      } else if (e.key === "-") {
        setZoom((z) => Math.max(z - 0.25, 0.5));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentPage, totalPages]);

  const handleLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setTotalPages(numPages);
  }, []);

  const handleLoadError = useCallback((err: Error) => {
    setError(err.message || "Failed to load PDF");
    console.error("PDF load error:", err);
  }, []);

  const pageWidth = Math.min(containerWidth - 80, 900) * zoom;

  if (isLoading) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="flex items-center gap-2">
          <svg
            className="h-5 w-5 animate-spin"
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
          <span style={{ color: "var(--color-text-muted)" }}>Loading PDF...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center h-full ${className}`}>
        <div className="text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-error)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-2"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p style={{ color: "var(--color-error)" }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Linked file changed banner */}
      {isModified && (
        <LinkedFileChangedBanner
          onReload={handleReload}
          onDismiss={dismiss}
          isReloading={isReloading}
          fileName={page.title}
        />
      )}

      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Left: File info */}
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
            style={{ color: "var(--color-error)" }}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-text-primary)" }}
          >
            {page.title}
          </span>
          {page.storageMode === "linked" && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-muted)",
              }}
            >
              Linked
            </span>
          )}
        </div>

        {/* Center: Page navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40"
            style={{ color: "var(--color-text-muted)" }}
            title="Previous page"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={totalPages}
              value={currentPage}
              onChange={(e) => {
                const page = parseInt(e.target.value);
                if (page >= 1 && page <= totalPages) {
                  setCurrentPage(page);
                }
              }}
              className="w-12 rounded border px-2 py-1 text-center text-sm"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            <span style={{ color: "var(--color-text-muted)" }}>/</span>
            <span style={{ color: "var(--color-text-secondary)" }}>{totalPages}</span>
          </div>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-40"
            style={{ color: "var(--color-text-muted)" }}
            title="Next page"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>

        {/* Right: Zoom controls */}
        <div
          className="flex items-center gap-1 rounded-lg border px-2 py-1"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={() => setZoom((z) => Math.max(z - 0.25, 0.5))}
            disabled={zoom <= 0.5}
            className="flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-40"
            style={{ color: "var(--color-text-muted)" }}
            title="Zoom out"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <span
            className="min-w-[48px] text-center text-xs"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(z + 0.25, 3))}
            disabled={zoom >= 3}
            className="flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-40"
            style={{ color: "var(--color-text-muted)" }}
            title="Zoom in"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* PDF Content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
        style={{ backgroundColor: "var(--color-bg-tertiary)" }}
      >
        <div className="flex min-h-full justify-center p-6">
          {fileUrl && (
            <Document
              file={fileUrl}
              onLoadSuccess={handleLoadSuccess}
              onLoadError={handleLoadError}
              loading={
                <div className="flex items-center gap-2">
                  <svg
                    className="h-5 w-5 animate-spin"
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
                  <span style={{ color: "var(--color-text-muted)" }}>Loading PDF...</span>
                </div>
              }
            >
              <Page
                pageNumber={currentPage}
                width={pageWidth}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                className="shadow-xl"
              />
            </Document>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between px-4 py-2 border-t text-xs"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-muted)",
        }}
      >
        <span>Arrow keys to navigate | +/- to zoom</span>
        {page.sourceFile && (
          <span className="truncate max-w-[300px]" title={page.sourceFile}>
            {page.sourceFile}
          </span>
        )}
      </div>
    </div>
  );
}
