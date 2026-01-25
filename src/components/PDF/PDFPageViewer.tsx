import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Page as PageType } from "../../types/page";
import type { PDFHighlight } from "../../types/pdf";
import { HIGHLIGHT_COLORS } from "../../types/pdf";
import { useLinkedFileSync } from "../../hooks/useLinkedFileSync";
import { LinkedFileChangedBanner } from "../LinkedFile";
import { PDFHighlightLayer } from "./PDFHighlightLayer";
import { PDFAnnotationSidebar } from "./PDFAnnotationSidebar";
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
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [isReloading, setIsReloading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Annotation state
  const [highlights, setHighlights] = useState<PDFHighlight[]>([]);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string>(HIGHLIGHT_COLORS[0].value);
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Linked file sync detection
  const { isModified, dismiss, markSynced } = useLinkedFileSync(page, notebookId);

  // Load annotations on mount
  useEffect(() => {
    const loadAnnotations = async () => {
      try {
        const annotations = await api.getPdfAnnotations(notebookId, page.id);
        setHighlights(annotations.highlights);
      } catch (err) {
        console.error("Failed to load PDF annotations:", err);
      }
    };

    loadAnnotations();
  }, [notebookId, page.id]);

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
        const sidebarWidth = showSidebar ? 300 : 0;
        setContainerWidth(containerRef.current.clientWidth - sidebarWidth);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [showSidebar]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === "Escape" && isAnnotating) {
        setIsAnnotating(false);
      } else if (e.key === "ArrowLeft" && currentPage > 1) {
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
  }, [currentPage, totalPages, isAnnotating]);

  const handleLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setTotalPages(numPages);
  }, []);

  const handleLoadError = useCallback((err: Error) => {
    setError(err.message || "Failed to load PDF");
    console.error("PDF load error:", err);
  }, []);

  // Highlight operations
  const handleHighlightCreate = useCallback(
    async (highlight: Omit<PDFHighlight, "id" | "createdAt" | "updatedAt">) => {
      const now = new Date().toISOString();
      const newHighlight: PDFHighlight = {
        ...highlight,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };

      // Optimistic update
      setHighlights((prev) => [...prev, newHighlight]);
      setIsSaving(true);

      try {
        const result = await api.addPdfHighlight(notebookId, page.id, newHighlight);
        setHighlights(result.highlights);
      } catch (err) {
        console.error("Failed to save highlight:", err);
        // Revert on error
        setHighlights((prev) => prev.filter((h) => h.id !== newHighlight.id));
      } finally {
        setIsSaving(false);
      }
    },
    [notebookId, page.id]
  );

  const handleHighlightUpdate = useCallback(
    async (highlightId: string, updates: Partial<PDFHighlight>) => {
      // Optimistic update
      setHighlights((prev) =>
        prev.map((h) =>
          h.id === highlightId
            ? { ...h, ...updates, updatedAt: new Date().toISOString() }
            : h
        )
      );
      setIsSaving(true);

      try {
        const result = await api.updatePdfHighlight(
          notebookId,
          page.id,
          highlightId,
          updates.note,
          updates.color
        );
        setHighlights(result.highlights);
      } catch (err) {
        console.error("Failed to update highlight:", err);
        // Reload to get correct state
        const annotations = await api.getPdfAnnotations(notebookId, page.id);
        setHighlights(annotations.highlights);
      } finally {
        setIsSaving(false);
      }
    },
    [notebookId, page.id]
  );

  const handleHighlightDelete = useCallback(
    async (highlightId: string) => {
      const originalHighlights = highlights;
      // Optimistic update
      setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
      setSelectedHighlightId(null);
      setIsSaving(true);

      try {
        const result = await api.deletePdfHighlight(notebookId, page.id, highlightId);
        setHighlights(result.highlights);
      } catch (err) {
        console.error("Failed to delete highlight:", err);
        // Revert on error
        setHighlights(originalHighlights);
      } finally {
        setIsSaving(false);
      }
    },
    [notebookId, page.id, highlights]
  );

  const handleHighlightClick = useCallback((id: string) => {
    setSelectedHighlightId((prev) => (prev === id ? null : id));
    if (!showSidebar) {
      setShowSidebar(true);
    }
  }, [showSidebar]);

  const handleGoToPage = useCallback((pageNum: number) => {
    setCurrentPage(pageNum);
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
    <div ref={containerRef} className={`flex flex-col h-full ${className}`}>
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
                const p = parseInt(e.target.value);
                if (p >= 1 && p <= totalPages) {
                  setCurrentPage(p);
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

        {/* Right: Tools */}
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
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

          {/* Annotation toggle */}
          <button
            onClick={() => setIsAnnotating(!isAnnotating)}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              isAnnotating ? "text-white" : ""
            }`}
            style={{
              backgroundColor: isAnnotating
                ? selectedColor
                : "var(--color-bg-tertiary)",
              color: isAnnotating ? "white" : "var(--color-text-secondary)",
            }}
            title={isAnnotating ? "Stop annotating (Esc)" : "Start annotating"}
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
              <path d="m9 11-6 6v3h9l3-3" />
              <path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4" />
            </svg>
            {isAnnotating ? "Stop" : "Annotate"}
          </button>

          {/* Color picker (when annotating) */}
          {isAnnotating && (
            <div className="flex gap-1">
              {HIGHLIGHT_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setSelectedColor(color.value)}
                  className={`h-6 w-6 rounded-full transition-transform ${
                    selectedColor === color.value
                      ? "ring-2 ring-offset-1 scale-110"
                      : "hover:scale-110"
                  }`}
                  style={{
                    backgroundColor: color.value,
                  }}
                  title={color.name}
                />
              ))}
            </div>
          )}

          {/* Sidebar toggle */}
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
              showSidebar ? "bg-[--color-bg-tertiary]" : ""
            }`}
            style={{ color: "var(--color-text-muted)" }}
            title={showSidebar ? "Hide annotations" : "Show annotations"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M15 3v18" />
            </svg>
            {highlights.length > 0 && !showSidebar && (
              <span
                className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium text-white"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                {highlights.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* PDF Content */}
        <div
          ref={pdfContainerRef}
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
                <div className="relative">
                  <Page
                    pageNumber={currentPage}
                    width={pageWidth}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                    className="shadow-xl"
                  />

                  {/* Highlight layer */}
                  <PDFHighlightLayer
                    highlights={highlights}
                    currentPage={currentPage}
                    containerRef={pdfContainerRef}
                    zoom={zoom}
                    isAnnotating={isAnnotating}
                    selectedColor={selectedColor}
                    selectedHighlightId={selectedHighlightId}
                    onHighlightCreate={handleHighlightCreate}
                    onHighlightClick={handleHighlightClick}
                  />
                </div>
              </Document>
            )}
          </div>
        </div>

        {/* Sidebar */}
        {showSidebar && (
          <div
            className="w-[300px] flex-shrink-0 border-l"
            style={{
              backgroundColor: "var(--color-bg-panel)",
              borderColor: "var(--color-border)",
            }}
          >
            <PDFAnnotationSidebar
              highlights={highlights}
              selectedHighlightId={selectedHighlightId}
              onSelectHighlight={setSelectedHighlightId}
              onUpdateHighlight={handleHighlightUpdate}
              onDeleteHighlight={handleHighlightDelete}
              onGoToPage={handleGoToPage}
            />
          </div>
        )}
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
        <div className="flex items-center gap-2">
          <span>{highlights.length} highlight(s)</span>
          {isSaving && (
            <>
              <span>|</span>
              <span className="animate-pulse">Saving...</span>
            </>
          )}
          <span>|</span>
          <span>Arrow keys to navigate | +/- to zoom</span>
        </div>
        {page.sourceFile && (
          <span className="truncate max-w-[300px]" title={page.sourceFile}>
            {page.sourceFile}
          </span>
        )}
      </div>
    </div>
  );
}
