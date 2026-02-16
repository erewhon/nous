import { useState, useEffect, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Page } from "../../types/page";
import * as api from "../../utils/api";

interface HtmlViewerProps {
  page: Page;
  notebookId: string;
  className?: string;
}

const ZOOM_LEVELS = [50, 75, 100, 125, 150, 200];

export function HtmlViewer({
  page,
  notebookId,
  className = "",
}: HtmlViewerProps) {
  const [assetUrl, setAssetUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    const loadPath = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const filePath = await api.getFilePath(notebookId, page.id);
        const url = convertFileSrc(filePath);
        setAssetUrl(url);
      } catch (err) {
        setError(
          `Failed to load HTML file: ${err instanceof Error ? err.message : String(err)}`
        );
      } finally {
        setIsLoading(false);
      }
    };

    loadPath();
  }, [notebookId, page.id]);

  const zoomIn = useCallback(() => {
    setZoom((z) => {
      const next = ZOOM_LEVELS.find((l) => l > z);
      return next ?? z;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const prev = [...ZOOM_LEVELS].reverse().find((l) => l < z);
      return prev ?? z;
    });
  }, []);

  const resetZoom = useCallback(() => setZoom(100), []);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center p-8 ${className}`}
        style={{ color: "var(--color-text-muted)" }}
      >
        <div className="text-center">
          <div className="mb-2 text-lg font-medium" style={{ color: "var(--color-error)" }}>
            Error loading HTML page
          </div>
          <div className="text-sm">{error}</div>
        </div>
      </div>
    );
  }

  if (isLoading || !assetUrl) {
    return (
      <div
        className={`flex items-center justify-center p-8 ${className}`}
        style={{ color: "var(--color-text-muted)" }}
      >
        Loading...
      </div>
    );
  }

  const scale = zoom / 100;

  return (
    <div className={`flex h-full w-full flex-col ${className}`}>
      {/* Zoom toolbar */}
      <div
        className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-bg-secondary)",
        }}
      >
        <button
          onClick={zoomOut}
          disabled={zoom <= ZOOM_LEVELS[0]}
          className="flex h-7 w-7 items-center justify-center rounded text-sm transition-colors"
          style={{
            color: zoom <= ZOOM_LEVELS[0] ? "var(--color-text-muted)" : "var(--color-text-primary)",
            backgroundColor: "transparent",
          }}
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetZoom}
          className="rounded px-2 py-0.5 text-xs tabular-nums transition-colors"
          style={{
            color: "var(--color-text-secondary)",
            backgroundColor: "transparent",
          }}
          title="Reset zoom"
        >
          {zoom}%
        </button>
        <button
          onClick={zoomIn}
          disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
          className="flex h-7 w-7 items-center justify-center rounded text-sm transition-colors"
          style={{
            color: zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1] ? "var(--color-text-muted)" : "var(--color-text-primary)",
            backgroundColor: "transparent",
          }}
          title="Zoom in"
        >
          +
        </button>
      </div>

      {/* iframe container */}
      <div className="flex-1 overflow-auto">
        <iframe
          src={assetUrl}
          sandbox="allow-same-origin"
          style={{
            width: `${100 / scale}%`,
            height: `${100 / scale}%`,
            minHeight: `calc((100vh - 200px) / ${scale})`,
            border: "none",
            backgroundColor: "white",
            transform: `scale(${scale})`,
            transformOrigin: "0 0",
          }}
          title={page.title}
        />
      </div>
    </div>
  );
}
