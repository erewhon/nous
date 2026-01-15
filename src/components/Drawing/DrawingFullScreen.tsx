import { useEffect, useRef, useCallback, useState } from "react";
import { useDrawingStore } from "../../stores/drawingStore";
import { FabricCanvas, type FabricCanvasRef } from "./FabricCanvas";
import { DrawingToolbar } from "./DrawingToolbar";
import type { FabricCanvasData } from "../../types/drawing";

export function DrawingFullScreen() {
  const {
    viewerState,
    closeViewer,
    updateViewerDrawingData,
    setSelectedTool,
    setStrokeColor,
    setFillColor,
    setStrokeWidth,
    setHistoryState,
  } = useDrawingStore();

  const canvasRef = useRef<FabricCanvasRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  const {
    isOpen,
    drawingData,
    selectedTool,
    strokeColor,
    fillColor,
    strokeWidth,
    canUndo,
    canRedo,
  } = viewerState;

  // Calculate canvas size based on container
  useEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setCanvasSize({
          width: rect.width - 32, // Padding
          height: rect.height - 32,
        });
      }
    };

    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, [isOpen]);

  // Handle canvas changes
  const handleCanvasChange = useCallback(
    (data: FabricCanvasData) => {
      updateViewerDrawingData({ canvasData: data });
    },
    [updateViewerDrawingData]
  );

  // Handle history changes
  const handleHistoryChange = useCallback(
    (canUndoNow: boolean, canRedoNow: boolean) => {
      setHistoryState(canUndoNow, canRedoNow);
    },
    [setHistoryState]
  );

  // Undo/redo handlers
  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);

  const handleRedo = useCallback(() => {
    canvasRef.current?.redo();
  }, []);

  // Clear handler
  const handleClear = useCallback(() => {
    if (confirm("Clear the entire canvas?")) {
      canvasRef.current?.clear();
    }
  }, []);

  // Export PNG handler
  const handleExportPNG = useCallback(() => {
    const dataUrl = canvasRef.current?.exportPNG();
    if (dataUrl) {
      const link = document.createElement("a");
      link.download = "drawing.png";
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, []);

  // Save and close
  const handleSave = useCallback(() => {
    const canvasData = canvasRef.current?.getCanvasData();
    if (canvasData) {
      updateViewerDrawingData({ canvasData, lastModified: Date.now() });
    }
    closeViewer();
  }, [updateViewerDrawingData, closeViewer]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === "Escape") {
        handleSave();
      }

      // Tool shortcuts
      if (e.key === "v" || e.key === "V") {
        setSelectedTool("select");
      }
      if (e.key === "p" || e.key === "P") {
        setSelectedTool("pen");
      }
      if (e.key === "e" || e.key === "E") {
        setSelectedTool("eraser");
      }
      if (e.key === "r" || e.key === "R") {
        setSelectedTool("rectangle");
      }
      if (e.key === "c" || e.key === "C") {
        setSelectedTool("circle");
      }
      if (e.key === "l" || e.key === "L") {
        setSelectedTool("line");
      }
      if (e.key === "a" || e.key === "A") {
        setSelectedTool("arrow");
      }
      if (e.key === "t" || e.key === "T") {
        setSelectedTool("text");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleSave, setSelectedTool]);

  if (!isOpen || !drawingData) return null;

  return (
    <div className="drawing-fullscreen-overlay">
      <div className="drawing-fullscreen-container">
        {/* Header */}
        <div className="drawing-fullscreen-header">
          <div className="drawing-fullscreen-title">
            <h2>Drawing Editor</h2>
          </div>
          <div className="drawing-fullscreen-actions">
            <button
              type="button"
              onClick={handleSave}
              className="drawing-fullscreen-save-btn"
            >
              Save & Close
            </button>
            <button
              type="button"
              onClick={closeViewer}
              className="drawing-fullscreen-btn drawing-fullscreen-close"
              title="Close (Escape)"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <DrawingToolbar
          selectedTool={selectedTool}
          onSelectTool={setSelectedTool}
          strokeColor={strokeColor}
          onStrokeColorChange={setStrokeColor}
          fillColor={fillColor}
          onFillColorChange={setFillColor}
          strokeWidth={strokeWidth}
          onStrokeWidthChange={setStrokeWidth}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClear={handleClear}
          onExportPNG={handleExportPNG}
        />

        {/* Canvas */}
        <div className="drawing-fullscreen-content" ref={containerRef}>
          <div className="drawing-fullscreen-canvas">
            <FabricCanvas
              ref={canvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              initialData={drawingData.canvasData}
              selectedTool={selectedTool}
              strokeColor={strokeColor}
              fillColor={fillColor}
              strokeWidth={strokeWidth}
              onCanvasChange={handleCanvasChange}
              onHistoryChange={handleHistoryChange}
            />
          </div>
        </div>

        {/* Footer with shortcuts hint */}
        <div className="drawing-fullscreen-footer">
          <span>
            <kbd>V</kbd> Select
          </span>
          <span>
            <kbd>P</kbd> Pen
          </span>
          <span>
            <kbd>E</kbd> Eraser
          </span>
          <span>
            <kbd>R</kbd> Rectangle
          </span>
          <span>
            <kbd>C</kbd> Circle
          </span>
          <span>
            <kbd>L</kbd> Line
          </span>
          <span>
            <kbd>A</kbd> Arrow
          </span>
          <span>
            <kbd>T</kbd> Text
          </span>
          <span>
            <kbd>Ctrl+Z</kbd> Undo
          </span>
          <span>
            <kbd>Esc</kbd> Save & Close
          </span>
        </div>
      </div>

      <style>{`
        .drawing-fullscreen-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.9);
          z-index: 1000;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .drawing-fullscreen-container {
          width: 95%;
          height: 95%;
          background: var(--color-bg-primary);
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .drawing-fullscreen-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border);
          background: var(--color-bg-secondary);
        }

        .drawing-fullscreen-title h2 {
          margin: 0;
          font-size: 16px;
          font-weight: 500;
          color: var(--color-text-primary);
        }

        .drawing-fullscreen-actions {
          display: flex;
          gap: 8px;
        }

        .drawing-fullscreen-save-btn {
          padding: 6px 12px;
          border: none;
          border-radius: 4px;
          background: var(--color-accent);
          color: white;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        }

        .drawing-fullscreen-save-btn:hover {
          opacity: 0.9;
        }

        .drawing-fullscreen-btn {
          padding: 6px 8px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--color-text-secondary);
          cursor: pointer;
          display: flex;
          align-items: center;
        }

        .drawing-fullscreen-btn:hover {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
        }

        .drawing-fullscreen-close:hover {
          background: var(--color-error-bg);
          color: var(--color-error);
        }

        .drawing-fullscreen-content {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-bg-tertiary);
          padding: 16px;
          overflow: hidden;
        }

        .drawing-fullscreen-canvas {
          background: #ffffff;
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        }

        .drawing-fullscreen-footer {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 16px;
          padding: 8px 16px;
          background: var(--color-bg-secondary);
          border-top: 1px solid var(--color-border);
          font-size: 11px;
          color: var(--color-text-muted);
        }

        .drawing-fullscreen-footer kbd {
          display: inline-block;
          padding: 2px 5px;
          font-family: monospace;
          font-size: 10px;
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: 3px;
          margin-right: 4px;
        }
      `}</style>
    </div>
  );
}
