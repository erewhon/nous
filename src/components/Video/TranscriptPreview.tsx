import { useEffect, useRef } from "react";
import type { TranscriptionResult, TranscriptSegment } from "../../types/video";

interface TranscriptPreviewProps {
  transcription: TranscriptionResult;
  currentTime: number;
  onSegmentClick: (segment: TranscriptSegment) => void;
  maxHeight?: string;
}

/**
 * Compact transcript preview for inline display in editor blocks.
 */
export function TranscriptPreview({
  transcription,
  currentTime,
  onSegmentClick,
  maxHeight = "150px",
}: TranscriptPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);

  // Find current segment based on playback time
  const currentSegment = transcription.segments.find(
    (seg) => currentTime >= seg.start && currentTime < seg.end
  );

  // Auto-scroll to active segment
  useEffect(() => {
    if (activeSegmentRef.current && containerRef.current) {
      const container = containerRef.current;
      const element = activeSegmentRef.current;

      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      // Check if element is outside visible area
      if (
        elementRect.top < containerRect.top ||
        elementRect.bottom > containerRect.bottom
      ) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentSegment?.id]);

  return (
    <div
      ref={containerRef}
      className="transcript-preview"
      style={{
        maxHeight,
        overflowY: "auto",
        fontSize: "12px",
        lineHeight: "1.5",
        padding: "8px",
        backgroundColor: "var(--color-bg-secondary)",
        borderRadius: "4px",
        marginTop: "8px",
      }}
    >
      {transcription.segments.map((segment) => {
        const isActive = segment.id === currentSegment?.id;

        return (
          <div
            key={segment.id}
            ref={isActive ? activeSegmentRef : null}
            onClick={() => onSegmentClick(segment)}
            style={{
              padding: "4px 6px",
              borderRadius: "4px",
              cursor: "pointer",
              backgroundColor: isActive
                ? "var(--color-accent-bg)"
                : "transparent",
              color: isActive
                ? "var(--color-accent)"
                : "var(--color-text-secondary)",
              transition: "background-color 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor =
                  "var(--color-bg-tertiary)";
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = "transparent";
              }
            }}
          >
            <span
              style={{
                color: "var(--color-text-muted)",
                fontSize: "10px",
                marginRight: "6px",
              }}
            >
              {formatTime(segment.start)}
            </span>
            {segment.text}
          </div>
        );
      })}
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
