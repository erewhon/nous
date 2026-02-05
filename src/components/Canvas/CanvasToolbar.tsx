import { useCanvasStore } from "../../stores/canvasStore";
import type { CanvasToolType } from "../../types/canvas";
import { STROKE_WIDTHS } from "../../types/drawing";

interface CanvasToolbarProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onFitToContent: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onClear?: () => void;
  onExport?: () => void;
}

interface ToolButtonProps {
  tool: CanvasToolType;
  icon: React.ReactNode;
  title: string;
}

export function CanvasToolbar({
  onZoomIn,
  onZoomOut,
  onResetView,
  onFitToContent,
  onUndo,
  onRedo,
  onClear,
  onExport,
}: CanvasToolbarProps) {
  const {
    selectedTool,
    setSelectedTool,
    strokeColor,
    setStrokeColor,
    fillColor,
    setFillColor,
    strokeWidth,
    setStrokeWidth,
    viewport,
    settings,
    toggleGrid,
    toggleSnapToGrid,
    canUndo,
    canRedo,
  } = useCanvasStore();

  const ToolButton = ({ tool, icon, title }: ToolButtonProps) => (
    <button
      onClick={() => setSelectedTool(tool)}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
        selectedTool === tool
          ? "bg-[--color-accent] text-white"
          : "hover:bg-[--color-bg-tertiary]"
      }`}
      style={{
        color: selectedTool === tool ? "white" : "var(--color-text-primary)",
      }}
      title={title}
    >
      {icon}
    </button>
  );

  return (
    <div
      className="flex items-center gap-1 rounded-xl border p-1.5 shadow-lg"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Navigation tools */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          tool="select"
          title="Select (V)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
            </svg>
          }
        />
        <ToolButton
          tool="pan"
          title="Pan (H)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
              <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
              <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
              <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
            </svg>
          }
        />
      </div>

      <div className="mx-1 h-6 w-px bg-[--color-border]" />

      {/* Drawing tools */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          tool="pen"
          title="Pen (P)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 19l7-7 3 3-7 7-3-3z" />
              <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              <path d="M2 2l7.586 7.586" />
              <circle cx="11" cy="11" r="2" />
            </svg>
          }
        />
        <ToolButton
          tool="eraser"
          title="Eraser (E)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M7 21h10" />
              <path d="M5.5 11.5l8-8a3.54 3.54 0 0 1 5 5l-8 8a3.54 3.54 0 0 1-5-5z" />
              <path d="M2 2l20 20" strokeDasharray="2 2" />
            </svg>
          }
        />
        <ToolButton
          tool="rectangle"
          title="Rectangle (R)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
            </svg>
          }
        />
        <ToolButton
          tool="ellipse"
          title="Ellipse (O)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <ellipse cx="12" cy="12" rx="9" ry="6" />
            </svg>
          }
        />
        <ToolButton
          tool="line"
          title="Line (L)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="5" y1="19" x2="19" y2="5" />
            </svg>
          }
        />
        <ToolButton
          tool="arrow"
          title="Arrow (A)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="5" y1="19" x2="19" y2="5" />
              <polyline points="10 5 19 5 19 14" />
            </svg>
          }
        />
        <ToolButton
          tool="text"
          title="Text (T)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="4 7 4 4 20 4 20 7" />
              <line x1="9" y1="20" x2="15" y2="20" />
              <line x1="12" y1="4" x2="12" y2="20" />
            </svg>
          }
        />
      </div>

      <div className="mx-1 h-6 w-px bg-[--color-border]" />

      {/* Canvas-specific tools */}
      <div className="flex items-center gap-0.5">
        <ToolButton
          tool="textCard"
          title="Text Card (C)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="7" y1="8" x2="17" y2="8" />
              <line x1="7" y1="12" x2="15" y2="12" />
              <line x1="7" y1="16" x2="12" y2="16" />
            </svg>
          }
        />
        <ToolButton
          tool="pageCard"
          title="Page Card (G)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          }
        />
        <ToolButton
          tool="connection"
          title="Connection (K)"
          icon={
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="5" cy="12" r="3" />
              <circle cx="19" cy="12" r="3" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          }
        />
      </div>

      <div className="mx-1 h-6 w-px bg-[--color-border]" />

      {/* Color picker */}
      <div className="flex items-center gap-1">
        <div className="relative">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg border-2"
            style={{
              backgroundColor: strokeColor,
              borderColor: "var(--color-border)",
            }}
            title="Stroke color"
          >
            <input
              type="color"
              value={strokeColor}
              onChange={(e) => setStrokeColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </button>
        </div>
        <div className="relative">
          <button
            className="flex h-8 w-8 items-center justify-center rounded-lg border-2"
            style={{
              backgroundColor: fillColor || "transparent",
              borderColor: "var(--color-border)",
            }}
            title="Fill color"
          >
            {!fillColor && (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="2" y1="2" x2="22" y2="22" />
              </svg>
            )}
            <input
              type="color"
              value={fillColor || "#ffffff"}
              onChange={(e) => setFillColor(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </button>
        </div>
        <button
          onClick={() => setFillColor(null)}
          className="flex h-6 w-6 items-center justify-center rounded text-xs hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-muted)" }}
          title="No fill"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
        </button>
      </div>

      <div className="mx-1 h-6 w-px bg-[--color-border]" />

      {/* Stroke width */}
      <div className="flex items-center gap-0.5">
        {STROKE_WIDTHS.slice(0, 4).map((sw) => (
          <button
            key={sw.value}
            onClick={() => setStrokeWidth(sw.value)}
            className={`flex h-8 w-6 items-center justify-center rounded-lg transition-all ${
              strokeWidth === sw.value
                ? "bg-[--color-accent]"
                : "hover:bg-[--color-bg-tertiary]"
            }`}
            title={sw.name}
          >
            <div
              className="rounded-full"
              style={{
                width: Math.min(sw.value * 1.5, 12),
                height: Math.min(sw.value * 1.5, 12),
                backgroundColor:
                  strokeWidth === sw.value
                    ? "white"
                    : "var(--color-text-primary)",
              }}
            />
          </button>
        ))}
      </div>

      <div className="mx-1 h-6 w-px bg-[--color-border]" />

      {/* View controls */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onZoomOut}
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-primary)" }}
          title="Zoom out"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <span
          className="w-12 text-center text-xs"
          style={{ color: "var(--color-text-muted)" }}
        >
          {Math.round(viewport.zoom * 100)}%
        </span>
        <button
          onClick={onZoomIn}
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-primary)" }}
          title="Zoom in"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </button>
        <button
          onClick={onResetView}
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-primary)" }}
          title="Reset view (100%)"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
        </button>
        <button
          onClick={onFitToContent}
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-primary)" }}
          title="Fit to content"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 3h6v6" />
            <path d="M9 21H3v-6" />
            <path d="M21 3l-7 7" />
            <path d="M3 21l7-7" />
          </svg>
        </button>
      </div>

      <div className="mx-1 h-6 w-px bg-[--color-border]" />

      {/* Grid toggle */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={toggleGrid}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
            settings.gridEnabled
              ? "bg-[--color-accent] text-white"
              : "hover:bg-[--color-bg-tertiary]"
          }`}
          style={{
            color: settings.gridEnabled ? "white" : "var(--color-text-primary)",
          }}
          title="Toggle grid"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9" x2="21" y2="9" />
            <line x1="3" y1="15" x2="21" y2="15" />
            <line x1="9" y1="3" x2="9" y2="21" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
        <button
          onClick={toggleSnapToGrid}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all ${
            settings.snapToGrid
              ? "bg-[--color-accent] text-white"
              : "hover:bg-[--color-bg-tertiary]"
          }`}
          style={{
            color: settings.snapToGrid ? "white" : "var(--color-text-primary)",
          }}
          title="Snap to grid"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 3v18" />
            <path d="M3 12h18" />
            <circle cx="12" cy="12" r="2" fill="currentColor" />
          </svg>
        </button>
      </div>

      <div className="mx-1 h-6 w-px bg-[--color-border]" />

      {/* History controls */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[--color-bg-tertiary] disabled:opacity-30"
          style={{ color: "var(--color-text-primary)" }}
          title="Undo"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[--color-bg-tertiary] disabled:opacity-30"
          style={{ color: "var(--color-text-primary)" }}
          title="Redo"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
          </svg>
        </button>
      </div>

      {/* Export/Clear */}
      {(onExport || onClear) && (
        <>
          <div className="mx-1 h-6 w-px bg-[--color-border]" />
          <div className="flex items-center gap-0.5">
            {onExport && (
              <button
                onClick={onExport}
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[--color-bg-tertiary]"
                style={{ color: "var(--color-text-primary)" }}
                title="Export as PNG"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            )}
            {onClear && (
              <button
                onClick={onClear}
                className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-[--color-bg-tertiary]"
                style={{ color: "var(--color-text-primary)" }}
                title="Clear canvas"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
