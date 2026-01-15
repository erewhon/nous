import { useCallback, useRef, useEffect } from "react";
import type { PDFHighlight, PDFRect } from "../../types/pdf";

interface PDFHighlightLayerProps {
  highlights: PDFHighlight[];
  currentPage: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  isAnnotating: boolean;
  selectedColor: string;
  selectedHighlightId: string | null;
  onHighlightCreate: (
    highlight: Omit<PDFHighlight, "id" | "createdAt" | "updatedAt">
  ) => void;
  onHighlightClick: (id: string) => void;
}

export function PDFHighlightLayer({
  highlights,
  currentPage,
  containerRef,
  zoom,
  isAnnotating,
  selectedColor,
  selectedHighlightId,
  onHighlightCreate,
  onHighlightClick,
}: PDFHighlightLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);

  // Filter highlights for current page
  const currentPageHighlights = highlights.filter(
    (h) => h.pageNumber === currentPage
  );

  // Handle text selection
  const handleMouseUp = useCallback(() => {
    if (!isAnnotating || !containerRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString().trim()) {
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    // Get the selection range
    const range = selection.getRangeAt(0);

    // Get the PDF page container
    const pageContainer = containerRef.current.querySelector(".react-pdf__Page");
    if (!pageContainer) return;

    const pageRect = pageContainer.getBoundingClientRect();

    // Get all client rects from the range
    const clientRects = range.getClientRects();
    const rects: PDFRect[] = [];

    for (let i = 0; i < clientRects.length; i++) {
      const rect = clientRects[i];

      // Convert to PDF coordinate space (relative to page, accounting for zoom)
      const pdfRect: PDFRect = {
        x: (rect.left - pageRect.left) / zoom,
        y: (rect.top - pageRect.top) / zoom,
        width: rect.width / zoom,
        height: rect.height / zoom,
      };

      // Filter out very small rects (likely whitespace)
      if (pdfRect.width > 2 && pdfRect.height > 2) {
        rects.push(pdfRect);
      }
    }

    if (rects.length === 0) return;

    // Create the highlight
    onHighlightCreate({
      pageNumber: currentPage,
      rects,
      selectedText,
      color: selectedColor,
    });

    // Clear selection
    selection.removeAllRanges();
  }, [
    isAnnotating,
    containerRef,
    currentPage,
    zoom,
    selectedColor,
    onHighlightCreate,
  ]);

  // Add mouseup listener when annotating
  useEffect(() => {
    if (!isAnnotating) return;

    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isAnnotating, handleMouseUp]);

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10 }}
    >
      {currentPageHighlights.map((highlight) => (
        <div key={highlight.id} className="highlight-group">
          {highlight.rects.map((rect, i) => (
            <div
              key={`${highlight.id}-${i}`}
              className="absolute pointer-events-auto cursor-pointer transition-all"
              style={{
                left: `${rect.x * zoom}px`,
                top: `${rect.y * zoom}px`,
                width: `${rect.width * zoom}px`,
                height: `${rect.height * zoom}px`,
                backgroundColor: highlight.color,
                opacity: selectedHighlightId === highlight.id ? 0.5 : 0.3,
                mixBlendMode: "multiply",
                borderRadius: "2px",
                boxShadow:
                  selectedHighlightId === highlight.id
                    ? `0 0 0 2px ${highlight.color}`
                    : "none",
              }}
              onClick={() => onHighlightClick(highlight.id)}
              title={highlight.note || highlight.selectedText.slice(0, 100)}
            />
          ))}

          {/* Note indicator */}
          {highlight.note && highlight.rects.length > 0 && (
            <div
              className="absolute pointer-events-auto cursor-pointer"
              style={{
                left: `${(highlight.rects[0].x + highlight.rects[0].width) * zoom + 4}px`,
                top: `${highlight.rects[0].y * zoom}px`,
                backgroundColor: highlight.color,
                borderRadius: "50%",
                width: "16px",
                height: "16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onClick={() => onHighlightClick(highlight.id)}
              title={highlight.note}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="white"
                stroke="white"
                strokeWidth="2"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
          )}
        </div>
      ))}

      {/* Annotation mode indicator */}
      {isAnnotating && (
        <div
          className="absolute top-2 right-2 rounded-full px-3 py-1 text-xs font-medium pointer-events-none"
          style={{
            backgroundColor: selectedColor,
            color: "white",
            boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}
        >
          Select text to highlight
        </div>
      )}
    </div>
  );
}
