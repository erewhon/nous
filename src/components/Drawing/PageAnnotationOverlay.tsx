import { useEffect, useRef, useCallback, useState } from "react";
import { useDrawingStore } from "../../stores/drawingStore";
import { FabricCanvas, type FabricCanvasRef } from "./FabricCanvas";
import { DrawingToolbar } from "./DrawingToolbar";
import type { FabricCanvasData, PageAnnotation } from "../../types/drawing";
import { invoke } from "@tauri-apps/api/core";

interface PageAnnotationOverlayProps {
  pageId: string;
  notebookId: string;
}

export function PageAnnotationOverlay({
  pageId,
  notebookId,
}: PageAnnotationOverlayProps) {
  const {
    annotationState,
    closeAnnotationOverlay,
    updateAnnotationData,
    setAnnotationModified,
    setAnnotationTool,
    setAnnotationStrokeColor,
    setAnnotationFillColor,
    setAnnotationStrokeWidth,
  } = useDrawingStore();

  const canvasRef = useRef<FabricCanvasRef>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState({ x: 20, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const {
    isActive,
    selectedTool,
    strokeColor,
    fillColor,
    strokeWidth,
    isModified,
    annotationData,
  } = annotationState;

  // Load existing annotation on mount
  useEffect(() => {
    if (isActive && pageId && notebookId) {
      invoke<PageAnnotation | null>("get_page_annotation", {
        notebookId,
        pageId,
      })
        .then((annotation) => {
          if (annotation) {
            updateAnnotationData(annotation);
          }
        })
        .catch(() => {
          // No existing annotation
        });
    }
  }, [isActive, pageId, notebookId, updateAnnotationData]);

  // Handle canvas changes
  const handleCanvasChange = useCallback(
    (data: FabricCanvasData) => {
      updateAnnotationData({
        canvasData: data,
        updatedAt: new Date().toISOString(),
      });
      setAnnotationModified(true);
    },
    [updateAnnotationData, setAnnotationModified]
  );

  // Handle history changes
  const handleHistoryChange = useCallback(
    (canUndoNow: boolean, canRedoNow: boolean) => {
      setCanUndo(canUndoNow);
      setCanRedo(canRedoNow);
    },
    []
  );

  // Undo/redo handlers
  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    canvasRef.current?.redo();
  }, []);

  // Save annotation
  const handleSave = useCallback(async () => {
    const canvasData = canvasRef.current?.getCanvasData();
    if (!canvasData) return;

    const annotation: PageAnnotation = {
      id: annotationData?.id || crypto.randomUUID(),
      pageId,
      notebookId,
      canvasData,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      createdAt: annotationData?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await invoke("save_page_annotation", {
        notebookId,
        pageId,
        annotation,
      });
      setAnnotationModified(false);
    } catch (err) {
      console.error("Failed to save annotation:", err);
    }
  }, [annotationData, pageId, notebookId, setAnnotationModified]);

  // Handle close with save prompt
  const handleClose = useCallback(async () => {
    if (isModified) {
      if (confirm("Save changes before closing?")) {
        await handleSave();
      }
    }
    closeAnnotationOverlay();
  }, [isModified, handleSave, closeAnnotationOverlay]);

  // Clear annotation
  const handleClear = useCallback(() => {
    if (confirm("Clear all annotations on this page?")) {
      canvasRef.current?.clear();
    }
  }, []);

  // Export as PNG
  const handleExportPNG = useCallback(() => {
    const dataUrl = canvasRef.current?.exportPNG();
    if (dataUrl) {
      const link = document.createElement("a");
      link.download = `page-annotation-${pageId}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [pageId]);

  // Toolbar dragging
  const handleToolbarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      setIsDragging(true);
      dragOffset.current = {
        x: e.clientX - toolbarPosition.x,
        y: e.clientY - toolbarPosition.y,
      };
    },
    [toolbarPosition]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      setToolbarPosition({
        x: Math.max(0, Math.min(window.innerWidth - 400, e.clientX - dragOffset.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - 60, e.clientY - dragOffset.current.y)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, handleClose]);

  if (!isActive) return null;

  return (
    <div className="page-annotation-overlay">
      {/* Floating toolbar */}
      <div
        className="annotation-toolbar-container"
        style={{
          left: toolbarPosition.x,
          top: toolbarPosition.y,
        }}
        onMouseDown={handleToolbarMouseDown}
      >
        <div className="annotation-toolbar-header">
          <span className="annotation-toolbar-title">Page Annotation</span>
          <div className="annotation-toolbar-actions">
            <button
              type="button"
              className="annotation-toolbar-btn annotation-toolbar-btn--save"
              onClick={handleSave}
              disabled={!isModified}
              title="Save annotations"
            >
              Save
            </button>
            <button
              type="button"
              className="annotation-toolbar-btn"
              onClick={handleClose}
              title="Close (Escape)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <DrawingToolbar
          selectedTool={selectedTool}
          onSelectTool={setAnnotationTool}
          strokeColor={strokeColor}
          onStrokeColorChange={setAnnotationStrokeColor}
          fillColor={fillColor}
          onFillColorChange={setAnnotationFillColor}
          strokeWidth={strokeWidth}
          onStrokeWidthChange={setAnnotationStrokeWidth}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClear={handleClear}
          onExportPNG={handleExportPNG}
          compact
        />
      </div>

      {/* Canvas overlay */}
      <div className="annotation-canvas-container">
        <FabricCanvas
          ref={canvasRef}
          width={window.innerWidth}
          height={window.innerHeight}
          initialData={annotationData?.canvasData}
          selectedTool={selectedTool}
          strokeColor={strokeColor}
          fillColor={fillColor}
          strokeWidth={strokeWidth}
          backgroundColor="transparent"
          onCanvasChange={handleCanvasChange}
          onHistoryChange={handleHistoryChange}
        />
      </div>

      <style>{`
        .page-annotation-overlay {
          position: fixed;
          inset: 0;
          z-index: 999;
          pointer-events: none;
        }

        .annotation-toolbar-container {
          position: fixed;
          z-index: 1001;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
          pointer-events: auto;
          cursor: move;
        }

        .annotation-toolbar-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-bg-tertiary);
          border-radius: 8px 8px 0 0;
        }

        .annotation-toolbar-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--color-text-secondary);
        }

        .annotation-toolbar-actions {
          display: flex;
          gap: 8px;
        }

        .annotation-toolbar-btn {
          padding: 4px 8px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--color-text-secondary);
          cursor: pointer;
          font-size: 12px;
          display: flex;
          align-items: center;
        }

        .annotation-toolbar-btn:hover:not(:disabled) {
          background: var(--color-bg-primary);
          color: var(--color-text-primary);
        }

        .annotation-toolbar-btn--save {
          background: var(--color-accent);
          color: white;
        }

        .annotation-toolbar-btn--save:hover:not(:disabled) {
          opacity: 0.9;
          background: var(--color-accent);
          color: white;
        }

        .annotation-toolbar-btn--save:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .annotation-canvas-container {
          position: absolute;
          inset: 0;
          pointer-events: auto;
        }

        .annotation-canvas-container .fabric-canvas-container {
          width: 100%;
          height: 100%;
        }

        .annotation-canvas-container canvas {
          width: 100% !important;
          height: 100% !important;
        }
      `}</style>
    </div>
  );
}
