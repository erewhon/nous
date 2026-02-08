import { useRef, useCallback, useEffect, useState } from "react";
import { useCanvasStore } from "../../stores/canvasStore";
import { InfiniteCanvas, type InfiniteCanvasRef } from "./InfiniteCanvas";
import { CanvasToolbar } from "./CanvasToolbar";
import { PagePickerDialog } from "./PagePickerDialog";
import type { CanvasPageContent } from "../../types/canvas";
import type { Page } from "../../types/page";
import * as api from "../../utils/api";

interface CanvasEditorProps {
  page: Page;
  notebookId: string;
  className?: string;
  onNavigateToPage?: (pageId: string) => void;
}

export function CanvasEditor({
  page,
  notebookId,
  className = "",
  onNavigateToPage,
}: CanvasEditorProps) {
  const canvasRef = useRef<InfiniteCanvasRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [initialContent, setInitialContent] =
    useState<CanvasPageContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPagePicker, setShowPagePicker] = useState(false);
  const pageCardCoordsRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { reset, setHistoryState } = useCanvasStore();

  // Load canvas content from file
  useEffect(() => {
    const loadContent = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await api.getFileContent(notebookId, page.id);
        if (response && response.content) {
          const parsed = JSON.parse(response.content) as CanvasPageContent;
          setInitialContent(parsed);
        } else {
          // New canvas - use default content
          setInitialContent({
            version: "1.0",
            fabricData: undefined,
            viewport: { panX: 0, panY: 0, zoom: 1 },
            elements: {},
            settings: {
              gridEnabled: true,
              gridSize: 20,
              snapToGrid: false,
              backgroundColor: "#1e1e2e",
            },
          });
        }
      } catch (err) {
        console.error("Failed to load canvas content:", err);
        // For new canvases, the file might not exist yet
        setInitialContent({
          version: "1.0",
          fabricData: undefined,
          viewport: { panX: 0, panY: 0, zoom: 1 },
          elements: {},
          settings: {
            gridEnabled: true,
            gridSize: 20,
            snapToGrid: false,
            backgroundColor: "#1e1e2e",
          },
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();

    // Reset store state when page changes
    return () => {
      reset();
    };
  }, [page.id, notebookId, reset]);

  // Update dimensions on container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateDimensions = () => {
      const rect = container.getBoundingClientRect();
      // Account for toolbar height (~60px)
      setDimensions({
        width: rect.width,
        height: rect.height - 60,
      });
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Save content with debounce
  const handleContentChange = useCallback(
    (content: CanvasPageContent) => {
      // Debounce save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await api.updateFileContent(
            notebookId,
            page.id,
            JSON.stringify(content, null, 2)
          );
        } catch (err) {
          console.error("Failed to save canvas content:", err);
        }
      }, 1000);
    },
    [notebookId, page.id]
  );

  // Cleanup save timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Handle history change
  const handleHistoryChange = useCallback(
    (canUndo: boolean, canRedo: boolean) => {
      setHistoryState(canUndo, canRedo);
    },
    [setHistoryState]
  );

  // Toolbar actions
  const handleZoomIn = useCallback(() => {
    canvasRef.current?.zoomIn();
  }, []);

  const handleZoomOut = useCallback(() => {
    canvasRef.current?.zoomOut();
  }, []);

  const handleResetView = useCallback(() => {
    canvasRef.current?.resetView();
  }, []);

  const handleFitToContent = useCallback(() => {
    canvasRef.current?.fitToContent();
  }, []);

  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    canvasRef.current?.redo();
  }, []);

  const handleClear = useCallback(() => {
    if (window.confirm("Clear all content from this canvas?")) {
      canvasRef.current?.clear();
    }
  }, []);

  const handleExport = useCallback(() => {
    const dataUrl = canvasRef.current?.exportPNG();
    if (dataUrl) {
      // Create download link
      const link = document.createElement("a");
      link.download = `${page.title || "canvas"}.png`;
      link.href = dataUrl;
      link.click();
    }
  }, [page.title]);

  // Page card creation via picker
  const handleRequestPageCard = useCallback((x: number, y: number) => {
    pageCardCoordsRef.current = { x, y };
    setShowPagePicker(true);
  }, []);

  const handlePageSelected = useCallback(
    (pageId: string, pageTitle: string, nbId: string) => {
      const { x, y } = pageCardCoordsRef.current;
      canvasRef.current?.addPageCard(pageId, pageTitle, nbId, x, y);
    },
    []
  );

  if (isLoading) {
    return (
      <div
        className={`flex h-full items-center justify-center ${className}`}
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        <div className="text-center">
          <div
            className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "var(--color-accent)" }}
          />
          <span style={{ color: "var(--color-text-muted)" }}>
            Loading canvas...
          </span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex h-full items-center justify-center ${className}`}
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">⚠️</div>
          <h3
            className="text-lg font-medium mb-2"
            style={{ color: "var(--color-text-primary)" }}
          >
            Failed to load canvas
          </h3>
          <p style={{ color: "var(--color-text-muted)" }}>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex h-full flex-col ${className}`}
      style={{ backgroundColor: "var(--color-bg-primary)" }}
    >
      {/* Floating toolbar */}
      <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2">
        <CanvasToolbar
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetView={handleResetView}
          onFitToContent={handleFitToContent}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClear={handleClear}
          onExport={handleExport}
        />
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative overflow-hidden">
        {initialContent && (
          <InfiniteCanvas
            ref={canvasRef}
            width={dimensions.width}
            height={dimensions.height}
            initialContent={initialContent}
            notebookId={notebookId}
            onContentChange={handleContentChange}
            onHistoryChange={handleHistoryChange}
            onNavigateToPage={onNavigateToPage}
            onRequestPageCard={handleRequestPageCard}
          />
        )}
      </div>

      {/* Status bar */}
      <div
        className="flex items-center justify-between px-4 py-2 text-xs border-t"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
          color: "var(--color-text-muted)",
        }}
      >
        <div className="flex items-center gap-4">
          <span>Canvas: {page.title}</span>
          <span>
            Size: {dimensions.width} x {dimensions.height}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span>Pan: Space+Drag or Middle-Click</span>
          <span>Zoom: Mouse Wheel</span>
        </div>
      </div>

      {/* Page picker dialog for PageCard creation */}
      <PagePickerDialog
        isOpen={showPagePicker}
        onClose={() => setShowPagePicker(false)}
        onSelect={handlePageSelected}
        notebookId={notebookId}
        excludePageId={page.id}
      />
    </div>
  );
}
