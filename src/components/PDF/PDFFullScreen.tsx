import { useEffect, useRef, useCallback, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { usePDFStore } from "../../stores/pdfStore";
import { PDFPageNav } from "./PDFPageNav";
import { PDFHighlightLayer } from "./PDFHighlightLayer";
import { PDFAnnotationSidebar } from "./PDFAnnotationSidebar";
import { HIGHLIGHT_COLORS } from "../../types/pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFFullScreenProps {
  onExtractHighlights: () => void;
}

export function PDFFullScreen({ onExtractHighlights }: PDFFullScreenProps) {
  const {
    viewerState,
    closeViewer,
    setCurrentPage,
    setZoom,
    startAnnotating,
    stopAnnotating,
    setSelectedColor,
    addHighlight,
    updateHighlight,
    deleteHighlight,
    selectHighlight,
  } = usePDFStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const [showSidebar, setShowSidebar] = useState(true);

  const {
    isOpen,
    pdfData,
    currentPage,
    zoom,
    isAnnotating,
    selectedHighlightId,
    selectedColor,
  } = viewerState;

  // Update container width
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        const sidebarWidth = showSidebar ? 300 : 0;
        setContainerWidth(containerRef.current.clientWidth - sidebarWidth - 48);
      }
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [showSidebar]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isAnnotating) {
          stopAnnotating();
        } else {
          closeViewer();
        }
      } else if (e.key === "ArrowLeft" && currentPage > 1) {
        setCurrentPage(currentPage - 1);
      } else if (
        e.key === "ArrowRight" &&
        pdfData?.totalPages &&
        currentPage < pdfData.totalPages
      ) {
        setCurrentPage(currentPage + 1);
      } else if (e.key === "+" || e.key === "=") {
        setZoom(zoom + 0.25);
      } else if (e.key === "-") {
        setZoom(zoom - 0.25);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isOpen,
    isAnnotating,
    currentPage,
    pdfData?.totalPages,
    zoom,
    closeViewer,
    stopAnnotating,
    setCurrentPage,
    setZoom,
  ]);

  const handleLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      if (pdfData && !pdfData.totalPages) {
        // Update totalPages in store
        usePDFStore.setState((state) => ({
          viewerState: {
            ...state.viewerState,
            pdfData: state.viewerState.pdfData
              ? { ...state.viewerState.pdfData, totalPages: numPages }
              : null,
          },
        }));
      }
    },
    [pdfData]
  );

  if (!isOpen || !pdfData) return null;

  const pageWidth = Math.min(containerWidth - 100, 900) * zoom;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between border-b px-4 py-3"
        style={{
          backgroundColor: "var(--color-bg-panel)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Left: Close and filename */}
        <div className="flex items-center gap-3">
          <button
            onClick={closeViewer}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Close (Escape)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
          <div>
            <h2
              className="text-sm font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              {pdfData.originalName || "PDF Document"}
            </h2>
            {pdfData.caption && (
              <p
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {pdfData.caption}
              </p>
            )}
          </div>
        </div>

        {/* Center: Page navigation */}
        <PDFPageNav
          currentPage={currentPage}
          totalPages={pdfData.totalPages || 1}
          onPageChange={setCurrentPage}
        />

        {/* Right: Tools */}
        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center gap-1 rounded-lg border px-2 py-1"
            style={{ borderColor: "var(--color-border)" }}
          >
            <button
              onClick={() => setZoom(zoom - 0.25)}
              disabled={zoom <= 0.5}
              className="flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-40"
              style={{ color: "var(--color-text-muted)" }}
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
              onClick={() => setZoom(zoom + 0.25)}
              disabled={zoom >= 3}
              className="flex h-6 w-6 items-center justify-center rounded transition-colors disabled:opacity-40"
              style={{ color: "var(--color-text-muted)" }}
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
            onClick={() => (isAnnotating ? stopAnnotating() : startAnnotating())}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isAnnotating ? "text-white" : ""
            }`}
            style={{
              backgroundColor: isAnnotating
                ? selectedColor
                : "var(--color-bg-tertiary)",
              color: isAnnotating ? "white" : "var(--color-text-secondary)",
            }}
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
                      ? "ring-2 ring-offset-2 scale-110"
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
              showSidebar ? "" : "bg-[--color-bg-tertiary]"
            }`}
            style={{ color: "var(--color-text-muted)" }}
            title={showSidebar ? "Hide sidebar" : "Show sidebar"}
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
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* PDF Viewer */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto"
          style={{ backgroundColor: "var(--color-bg-tertiary)" }}
        >
          <div className="flex min-h-full justify-center p-6">
            <Document
              file={pdfData.url}
              onLoadSuccess={handleLoadSuccess}
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
                  <span style={{ color: "var(--color-text-muted)" }}>
                    Loading PDF...
                  </span>
                </div>
              }
            >
              <div className="relative">
                <Page
                  pageNumber={currentPage}
                  width={pageWidth}
                  renderTextLayer={true}
                  renderAnnotationLayer={false}
                  className="shadow-xl"
                />

                {/* Highlight layer */}
                <PDFHighlightLayer
                  highlights={pdfData.highlights}
                  currentPage={currentPage}
                  containerRef={containerRef}
                  zoom={zoom}
                  isAnnotating={isAnnotating}
                  selectedColor={selectedColor}
                  selectedHighlightId={selectedHighlightId}
                  onHighlightCreate={addHighlight}
                  onHighlightClick={selectHighlight}
                />
              </div>
            </Document>
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
              highlights={pdfData.highlights}
              selectedHighlightId={selectedHighlightId}
              onSelectHighlight={selectHighlight}
              onUpdateHighlight={updateHighlight}
              onDeleteHighlight={deleteHighlight}
              onGoToPage={setCurrentPage}
            />
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className="flex items-center justify-between border-t px-4 py-2"
        style={{
          backgroundColor: "var(--color-bg-panel)",
          borderColor: "var(--color-border)",
        }}
      >
        <div className="flex items-center gap-2 text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          <span>{pdfData.highlights.length} highlight(s)</span>
          <span>|</span>
          <span>Arrow keys to navigate</span>
          <span>|</span>
          <span>+/- to zoom</span>
        </div>

        {/* Extract highlights button */}
        {pdfData.highlights.length > 0 && (
          <button
            onClick={onExtractHighlights}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors hover:opacity-90"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
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
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
            Extract to Page
          </button>
        )}
      </div>
    </div>
  );
}
