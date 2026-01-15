import type { JSX } from "react";
import type { DrawingToolType } from "../../types/drawing";
import { DrawingColorPicker } from "./DrawingColorPicker";
import { StrokeWidthPicker } from "./StrokeWidthPicker";

interface DrawingToolbarProps {
  selectedTool: DrawingToolType;
  onSelectTool: (tool: DrawingToolType) => void;
  strokeColor: string;
  onStrokeColorChange: (color: string) => void;
  fillColor: string | null;
  onFillColorChange: (color: string | null) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear?: () => void;
  onExportPNG?: () => void;
  compact?: boolean;
}

interface ToolDef {
  id: DrawingToolType;
  icon: JSX.Element;
  label: string;
}

const TOOLS: ToolDef[] = [
  {
    id: "select",
    label: "Select",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
        <path d="M13 13l6 6" />
      </svg>
    ),
  },
  {
    id: "pen",
    label: "Pen",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
  },
  {
    id: "eraser",
    label: "Eraser",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 20H7L3 16c-.6-.6-.6-1.5 0-2.1l10-10c.6-.6 1.5-.6 2.1 0l7 7c.6.6.6 1.5 0 2.1L15 20" />
        <path d="M6 11l4 4" />
      </svg>
    ),
  },
  {
    id: "rectangle",
    label: "Rectangle",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      </svg>
    ),
  },
  {
    id: "circle",
    label: "Circle",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
  },
  {
    id: "ellipse",
    label: "Ellipse",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="12" rx="10" ry="6" />
      </svg>
    ),
  },
  {
    id: "line",
    label: "Line",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="5" y1="19" x2="19" y2="5" />
      </svg>
    ),
  },
  {
    id: "arrow",
    label: "Arrow",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    ),
  },
  {
    id: "text",
    label: "Text",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    ),
  },
];

export function DrawingToolbar({
  selectedTool,
  onSelectTool,
  strokeColor,
  onStrokeColorChange,
  fillColor,
  onFillColorChange,
  strokeWidth,
  onStrokeWidthChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onExportPNG,
  compact = false,
}: DrawingToolbarProps) {
  return (
    <div className={`drawing-toolbar ${compact ? "drawing-toolbar--compact" : ""}`}>
      {/* Tool buttons */}
      <div className="drawing-toolbar-tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`drawing-tool-btn ${selectedTool === tool.id ? "drawing-tool-btn--active" : ""}`}
            onClick={() => onSelectTool(tool.id)}
            title={tool.label}
          >
            {tool.icon}
          </button>
        ))}
      </div>

      <div className="drawing-toolbar-separator" />

      {/* Color pickers */}
      <DrawingColorPicker
        strokeColor={strokeColor}
        fillColor={fillColor}
        onStrokeColorChange={onStrokeColorChange}
        onFillColorChange={onFillColorChange}
        compact={compact}
      />

      <div className="drawing-toolbar-separator" />

      {/* Stroke width */}
      <StrokeWidthPicker
        value={strokeWidth}
        onChange={onStrokeWidthChange}
        compact={compact}
      />

      <div className="drawing-toolbar-separator" />

      {/* Undo/Redo */}
      <div className="drawing-toolbar-history">
        <button
          type="button"
          className="drawing-tool-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
        </button>
        <button
          type="button"
          className="drawing-tool-btn"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
          </svg>
        </button>
      </div>

      {/* Clear and Export */}
      {(onClear || onExportPNG) && (
        <>
          <div className="drawing-toolbar-separator" />
          <div className="drawing-toolbar-actions">
            {onClear && (
              <button
                type="button"
                className="drawing-tool-btn"
                onClick={onClear}
                title="Clear canvas"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            )}
            {onExportPNG && (
              <button
                type="button"
                className="drawing-tool-btn"
                onClick={onExportPNG}
                title="Export as PNG"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
