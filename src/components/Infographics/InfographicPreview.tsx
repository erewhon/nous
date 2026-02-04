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
  const [isSaving, setIsSaving] = useState(false);

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

  const handleSaveSVG = async () => {
    const defaultName = `${title || "infographic"}.svg`;
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "SVG", extensions: ["svg"] }],
    });

    if (path) {
      setIsSaving(true);
      try {
        await writeFile(path, new TextEncoder().encode(result.svgContent));
      } catch (error) {
        console.error("Failed to save SVG:", error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  const handleSavePNG = async () => {
    if (!result.pngPath) return;

    const defaultName = `${title || "infographic"}.png`;
    const path = await save({
      defaultPath: defaultName,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });

    if (path) {
      setIsSaving(true);
      try {
        await copyFile(result.pngPath, path);
      } catch (error) {
        console.error("Failed to save PNG:", error);
      } finally {
        setIsSaving(false);
      }
    }
  };

  return (
    <div className="space-y-4">
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
            onClick={handleSaveSVG}
            disabled={isSaving}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-border)",
            }}
          >
            {isSaving ? "Saving..." : "Save SVG"}
          </button>

          {result.pngPath && (
            <button
              onClick={handleSavePNG}
              disabled={isSaving}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
              style={{
                backgroundColor: "var(--color-accent)",
                color: "white",
              }}
            >
              {isSaving ? "Saving..." : "Save PNG"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
