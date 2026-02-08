import { useState, useEffect } from "react";
import type { SlideContent } from "../../types/videoGenerate";

interface SlideEditorProps {
  slide: SlideContent;
  slideNumber: number;
  totalSlides: number;
  theme: "light" | "dark";
  onUpdate: (updates: Partial<SlideContent>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
}

export function SlideEditor({
  slide,
  slideNumber,
  totalSlides,
  theme,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDuplicate,
}: SlideEditorProps) {
  const [localTitle, setLocalTitle] = useState(slide.title);
  const [localBody, setLocalBody] = useState(slide.body);
  const [localBullets, setLocalBullets] = useState(slide.bulletPoints.join("\n"));
  const [localDuration, setLocalDuration] = useState<string>(
    slide.durationHint?.toString() ?? ""
  );
  const [localNotes, setLocalNotes] = useState(slide.notes ?? "");

  // Update local state when slide changes
  useEffect(() => {
    setLocalTitle(slide.title);
    setLocalBody(slide.body);
    setLocalBullets(slide.bulletPoints.join("\n"));
    setLocalDuration(slide.durationHint?.toString() ?? "");
    setLocalNotes(slide.notes ?? "");
  }, [slide]);

  // Debounced update
  useEffect(() => {
    const timeout = setTimeout(() => {
      const bullets = localBullets
        .split("\n")
        .map((b) => b.trim())
        .filter((b) => b.length > 0);
      const duration = localDuration ? parseFloat(localDuration) : undefined;
      onUpdate({
        title: localTitle,
        body: localBody,
        bulletPoints: bullets,
        durationHint: duration && !isNaN(duration) ? duration : undefined,
        notes: localNotes || undefined,
      });
    }, 300);
    return () => clearTimeout(timeout);
  }, [localTitle, localBody, localBullets, localDuration, localNotes, onUpdate]);

  const colors =
    theme === "dark"
      ? {
          background: "#1a1a2e",
          text: "#eaeaea",
          textSecondary: "#b0b0b0",
          primary: "#0f4c75",
          border: "#3a3a5a",
        }
      : {
          background: "#ffffff",
          text: "#2c3e50",
          textSecondary: "#7f8c8d",
          primary: "#3498db",
          border: "#bdc3c7",
        };

  return (
    <div
      className="rounded-lg border p-4"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div
          className="text-sm font-medium"
          style={{ color: "var(--color-text-primary)" }}
        >
          Editing Slide {slideNumber} of {totalSlides}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onMoveUp}
            disabled={slideNumber === 1}
            className="p-1.5 rounded hover:bg-[--color-bg-tertiary] disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move up"
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
              style={{ color: "var(--color-text-muted)" }}
            >
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </button>
          <button
            onClick={onMoveDown}
            disabled={slideNumber === totalSlides}
            className="p-1.5 rounded hover:bg-[--color-bg-tertiary] disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move down"
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
              style={{ color: "var(--color-text-muted)" }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <button
            onClick={onDuplicate}
            className="p-1.5 rounded hover:bg-[--color-bg-tertiary]"
            title="Duplicate slide"
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
              style={{ color: "var(--color-text-muted)" }}
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-red-500/10 text-red-500"
            title="Delete slide"
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
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Live Preview */}
      <div className="flex gap-4">
        {/* Editor side */}
        <div className="flex-1 space-y-3">
          {/* Title */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Title
            </label>
            <input
              type="text"
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border text-sm"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
          </div>

          {/* Body */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Body Text
            </label>
            <textarea
              value={localBody}
              onChange={(e) => setLocalBody(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              placeholder="Optional body text..."
            />
          </div>

          {/* Bullet points */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Bullet Points (one per line)
            </label>
            <textarea
              value={localBullets}
              onChange={(e) => setLocalBullets(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              placeholder="Enter bullet points, one per line..."
            />
          </div>

          {/* Duration */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Duration (seconds)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={localDuration}
                onChange={(e) => setLocalDuration(e.target.value)}
                min="1"
                max="60"
                step="0.5"
                className="w-24 px-3 py-2 rounded-lg border text-sm"
                style={{
                  backgroundColor: "var(--color-bg-primary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
                placeholder="Auto"
              />
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Leave empty for auto (based on narration)
              </span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Speaker Notes
              <span
                className="font-normal ml-1"
                style={{ color: "var(--color-text-muted)" }}
              >
                (not shown in video)
              </span>
            </label>
            <textarea
              value={localNotes}
              onChange={(e) => setLocalNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 rounded-lg border text-sm resize-none"
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
              placeholder="Add notes for your reference..."
            />
          </div>
        </div>

        {/* Preview side */}
        <div className="w-64">
          <label
            className="block text-xs font-medium mb-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Preview
          </label>
          <div
            className="aspect-video rounded-lg p-3 relative"
            style={{
              backgroundColor: colors.background,
              border: `1px solid ${colors.border}`,
            }}
          >
            {/* Title */}
            <div
              className="text-xs font-semibold truncate mb-1"
              style={{ color: colors.text }}
            >
              {localTitle || "Slide Title"}
            </div>

            {/* Divider */}
            <div
              className="h-0.5 w-8 mb-2"
              style={{ backgroundColor: colors.primary }}
            />

            {/* Body preview */}
            {localBody && (
              <div
                className="text-[8px] line-clamp-2 mb-1"
                style={{ color: colors.textSecondary }}
              >
                {localBody}
              </div>
            )}

            {/* Bullet points preview */}
            {localBullets
              .split("\n")
              .filter((b) => b.trim())
              .slice(0, 4)
              .map((point, i) => (
                <div
                  key={i}
                  className="flex items-start gap-1 text-[8px]"
                  style={{ color: colors.textSecondary }}
                >
                  <span
                    className="w-1 h-1 rounded-full mt-0.5 flex-shrink-0"
                    style={{ backgroundColor: colors.primary }}
                  />
                  <span className="line-clamp-1">{point.trim()}</span>
                </div>
              ))}

            {/* Slide number */}
            <div
              className="absolute bottom-1 right-2 text-[8px]"
              style={{ color: colors.textSecondary }}
            >
              {slideNumber} / {totalSlides}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
