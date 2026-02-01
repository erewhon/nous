import { useState, useCallback, useRef, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFHighlight, PDFDisplayMode } from "../../types/pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PDFViewerProps {
  url: string;
  currentPage: number;
  onPageChange: (page: number) => void;
  totalPages?: number;
  onLoadSuccess: (numPages: number) => void;
  highlights?: PDFHighlight[];
  onHighlightClick?: (id: string) => void;
  displayMode?: PDFDisplayMode;
  zoom?: number;
  className?: string;
  showTextLayer?: boolean;
}

export function PDFViewer({
  url,
  currentPage,
  onPageChange: _onPageChange,
  totalPages,
  onLoadSuccess,
  highlights = [],
  onHighlightClick,
  displayMode = "preview",
  zoom = 1,
  className = "",
  showTextLayer = true,
}: PDFViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // Get height based on display mode
  const getHeight = () => {
    switch (displayMode) {
      case "thumbnail":
        return 200;
      case "preview":
        return 400;
      case "full":
        return undefined; // Full height
      default:
        return 400;
    }
  };

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

  const handleLoadSuccess = useCallback(
    ({ numPages }: { numPages: number }) => {
      setIsLoading(false);
      setError(null);
      onLoadSuccess(numPages);
    },
    [onLoadSuccess]
  );

  const handleLoadError = useCallback((err: Error) => {
    setIsLoading(false);
    setError(err.message || "Failed to load PDF");
    console.error("PDF load error:", err);
  }, []);

  // Calculate page width based on zoom and container
  const pageWidth = Math.min(containerWidth - 20, 800) * zoom;

  // Filter highlights for current page
  const currentPageHighlights = highlights.filter(
    (h) => h.pageNumber === currentPage
  );

  return (
    <div
      ref={containerRef}
      className={`pdf-viewer relative ${className}`}
      style={{
        height: getHeight(),
        overflow: "auto",
        backgroundColor: "var(--color-bg-tertiary)",
        borderRadius: "8px",
      }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
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
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
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
      )}

      <Document
        file={url}
        onLoadSuccess={handleLoadSuccess}
        onLoadError={handleLoadError}
        loading={null}
        className="flex justify-center"
      >
        <div className="relative">
          <Page
            pageNumber={currentPage}
            width={pageWidth}
            renderTextLayer={showTextLayer}
            renderAnnotationLayer={false}
            loading={null}
          />

          {/* Highlight overlay */}
          {currentPageHighlights.length > 0 && (
            <div className="absolute inset-0 pointer-events-none">
              {currentPageHighlights.map((highlight) => (
                <div key={highlight.id}>
                  {highlight.rects.map((rect, i) => (
                    <div
                      key={`${highlight.id}-${i}`}
                      className="absolute pointer-events-auto cursor-pointer transition-opacity hover:opacity-80"
                      style={{
                        left: `${rect.x * zoom}px`,
                        top: `${rect.y * zoom}px`,
                        width: `${rect.width * zoom}px`,
                        height: `${rect.height * zoom}px`,
                        backgroundColor: highlight.color,
                        opacity: 0.3,
                        mixBlendMode: "multiply",
                      }}
                      onClick={() => onHighlightClick?.(highlight.id)}
                      title={highlight.note || highlight.selectedText}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </Document>

      {/* Page indicator */}
      {totalPages && totalPages > 1 && (
        <div
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-xs"
          style={{
            backgroundColor: "var(--color-bg-panel)",
            color: "var(--color-text-secondary)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          {currentPage} / {totalPages}
        </div>
      )}
    </div>
  );
}
