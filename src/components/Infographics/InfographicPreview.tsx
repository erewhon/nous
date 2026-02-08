import { useEffect, useRef, useState } from "react";
import type { InfographicResult } from "../../types/infographic";
import { save } from "@tauri-apps/plugin-dialog";
import { copyFile, writeFile } from "@tauri-apps/plugin-fs";

interface InfographicPreviewProps {
  result: InfographicResult;
  title?: string;
}

export function InfographicPreview({ result, title }: InfographicPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [isExporting, setIsExporting] = useState(false);

  // Calculate scale to fit preview
  useEffect(() => {
    if (containerRef.current) {
      const containerWidth = containerRef.current.clientWidth - 32; // Account for padding
      const containerHeight = containerRef.current.clientHeight - 32;
      const scaleX = containerWidth / result.width;
      const scaleY = containerHeight / result.height;
      setScale(Math.min(scaleX, scaleY, 1));
    }
  }, [result.width, result.height]);

  const handleExportSVG = async () => {
    const defaultName = `${title || "infographic"}.svg`;
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });

    if (path) {
      setIsExporting(true);
      try {
        await writeFile(path, new TextEncoder().encode(result.svgContent));
      } catch (error) {
        console.error("Failed to export SVG:", error);
      } finally {
        setIsExporting(false);
      }
    }
  };

  const handleExportPNG = async () => {
    if (!result.pngPath) return;

    const defaultName = `${title || "infographic"}.png`;
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });

    if (path) {
      setIsExporting(true);
      try {
        await copyFile(result.pngPath, path);
      } catch (error) {
        console.error("Failed to export PNG:", error);
      } finally {
        setIsExporting(false);
      }
    }
  };

  // Extract filename from PNG path for display
  const savedFilename = result.pngPath
    ? result.pngPath.split("/").pop() || result.pngPath.split("\\").pop()
    : null;

  return (
    <div className="space-y-4">
      {/* Saved to notebook indicator */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm"
        style={{
          backgroundColor: "rgba(34, 197, 94, 0.1)",
          color: "#22c55e",
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
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
        <span>
          Saved to notebook
          {savedFilename && (
            <span style={{ color: "var(--color-text-muted)" }}>
              {" "}
              ({savedFilename})
            </span>
          )}
        </span>
      </div>

      {/* Preview container */}
      <div
        ref={containerRef}
        className="relative h-[400px] overflow-hidden rounded-lg border flex items-center justify-center p-4"
        style={{
          backgroundColor: "var(--color-bg-tertiary)",
          borderColor: "var(--color-border)",
        }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "center center",
            width: result.width,
            height: result.height,
          }}
          dangerouslySetInnerHTML={{ __html: result.svgContent }}
        />
      </div>

      {/* Info and actions */}
      <div className="flex items-center justify-between">
        <div
          className="text-sm"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {result.width} x {result.height}px
          <span className="mx-2">|</span>
          Generated in {result.generationTimeSeconds.toFixed(2)}s
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleExportSVG}
            disabled={isExporting}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-border)",
            }}
          >
            {isExporting ? "Exporting..." : "Export SVG"}
          </button>

          {result.pngPath && (
            <button
              onClick={handleExportPNG}
              disabled={isExporting}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              {isExporting ? "Exporting..." : "Export PNG"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
