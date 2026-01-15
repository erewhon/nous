import { useState, useEffect, useRef, useCallback } from "react";
import type { TranscriptionResult, TranscriptSegment } from "../../types/video";

interface TranscriptPanelProps {
  transcription: TranscriptionResult;
  currentTime: number;
  onSegmentClick: (segment: TranscriptSegment) => void;
  onCopySegment?: (text: string) => void;
}

/**
 * Full transcript panel with search, auto-scroll, and copy functionality.
 */
export function TranscriptPanel({
  transcription,
  currentTime,
  onSegmentClick,
  onCopySegment,
}: TranscriptPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeSegmentRef = useRef<HTMLDivElement>(null);

  // Filter segments by search query
  const filteredSegments = searchQuery.trim()
    ? transcription.segments.filter((seg) =>
        seg.text.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : transcription.segments;

  // Find current segment based on playback time
  const currentSegment = transcription.segments.find(
    (seg) => currentTime >= seg.start && currentTime < seg.end
  );

  // Auto-scroll to active segment
  useEffect(() => {
    if (autoScroll && activeSegmentRef.current && containerRef.current && !searchQuery) {
      const container = containerRef.current;
      const element = activeSegmentRef.current;

      const containerRect = container.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      if (
        elementRect.top < containerRect.top ||
        elementRect.bottom > containerRect.bottom
      ) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [currentSegment?.id, autoScroll, searchQuery]);

  // Handle segment click
  const handleSegmentClick = useCallback(
    (segment: TranscriptSegment) => {
      onSegmentClick(segment);
    },
    [onSegmentClick]
  );

  // Copy segment text
  const handleCopy = useCallback(
    (text: string, e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text);
      onCopySegment?.(text);
    },
    [onCopySegment]
  );

  // Export full transcript
  const exportTranscript = useCallback(() => {
    const text = transcription.segments
      .map((seg) => `[${formatTime(seg.start)}] ${seg.text}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transcript.txt";
    a.click();
    URL.revokeObjectURL(url);
  }, [transcription]);

  return (
    <div className="transcript-panel">
      {/* Header with search and controls */}
      <div className="transcript-panel-header">
        <input
          type="text"
          placeholder="Search transcript..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="transcript-search"
        />
        <div className="transcript-controls">
          <button
            type="button"
            onClick={() => setAutoScroll(!autoScroll)}
            className={`transcript-btn ${autoScroll ? "transcript-btn--active" : ""}`}
            title={autoScroll ? "Auto-scroll enabled" : "Auto-scroll disabled"}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={exportTranscript}
            className="transcript-btn"
            title="Export transcript"
          >
            <svg
              width="14"
              height="14"
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
        </div>
      </div>

      {/* Info bar */}
      <div className="transcript-info">
        <span>
          {filteredSegments.length} segment{filteredSegments.length !== 1 ? "s" : ""}
          {searchQuery && ` matching "${searchQuery}"`}
        </span>
        <span className="transcript-info-lang">
          {transcription.language.toUpperCase()} ({Math.round(transcription.languageProbability * 100)}%)
        </span>
      </div>

      {/* Transcript content */}
      <div ref={containerRef} className="transcript-content">
        {filteredSegments.length === 0 ? (
          <div className="transcript-empty">
            No matches found for "{searchQuery}"
          </div>
        ) : (
          filteredSegments.map((segment) => {
            const isActive = segment.id === currentSegment?.id && !searchQuery;

            return (
              <div
                key={segment.id}
                ref={isActive ? activeSegmentRef : null}
                onClick={() => handleSegmentClick(segment)}
                className={`transcript-segment ${isActive ? "transcript-segment--active" : ""}`}
              >
                <span className="transcript-timestamp">
                  {formatTime(segment.start)}
                </span>
                <span className="transcript-text">
                  {searchQuery ? highlightMatch(segment.text, searchQuery) : segment.text}
                </span>
                <button
                  type="button"
                  onClick={(e) => handleCopy(segment.text, e)}
                  className="transcript-copy-btn"
                  title="Copy text"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
              </div>
            );
          })
        )}
      </div>

      <style>{`
        .transcript-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--color-bg-secondary);
          border-left: 1px solid var(--color-border);
        }

        .transcript-panel-header {
          display: flex;
          gap: 8px;
          padding: 12px;
          border-bottom: 1px solid var(--color-border);
        }

        .transcript-search {
          flex: 1;
          padding: 6px 10px;
          border: 1px solid var(--color-border);
          border-radius: 4px;
          background: var(--color-bg-primary);
          color: var(--color-text-primary);
          font-size: 13px;
        }

        .transcript-search:focus {
          outline: none;
          border-color: var(--color-accent);
        }

        .transcript-controls {
          display: flex;
          gap: 4px;
        }

        .transcript-btn {
          padding: 6px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--color-text-secondary);
          cursor: pointer;
        }

        .transcript-btn:hover {
          background: var(--color-bg-tertiary);
        }

        .transcript-btn--active {
          color: var(--color-accent);
          background: var(--color-accent-bg);
        }

        .transcript-info {
          display: flex;
          justify-content: space-between;
          padding: 8px 12px;
          font-size: 11px;
          color: var(--color-text-muted);
          border-bottom: 1px solid var(--color-border);
        }

        .transcript-info-lang {
          font-family: monospace;
        }

        .transcript-content {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .transcript-segment {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 8px;
          border-radius: 4px;
          cursor: pointer;
          transition: background-color 0.15s;
        }

        .transcript-segment:hover {
          background: var(--color-bg-tertiary);
        }

        .transcript-segment--active {
          background: var(--color-accent-bg);
        }

        .transcript-timestamp {
          font-family: monospace;
          font-size: 11px;
          color: var(--color-text-muted);
          min-width: 45px;
          padding-top: 2px;
        }

        .transcript-text {
          flex: 1;
          font-size: 13px;
          line-height: 1.5;
          color: var(--color-text-primary);
        }

        .transcript-copy-btn {
          opacity: 0;
          padding: 4px;
          border: none;
          border-radius: 4px;
          background: transparent;
          color: var(--color-text-muted);
          cursor: pointer;
          transition: opacity 0.15s;
        }

        .transcript-segment:hover .transcript-copy-btn {
          opacity: 1;
        }

        .transcript-copy-btn:hover {
          color: var(--color-text-primary);
          background: var(--color-bg-secondary);
        }

        .transcript-empty {
          text-align: center;
          padding: 24px;
          color: var(--color-text-muted);
          font-size: 13px;
        }

        .transcript-highlight {
          background: var(--color-warning-bg);
          color: var(--color-warning);
          padding: 0 2px;
          border-radius: 2px;
        }
      `}</style>
    </div>
  );
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <span key={i} className="transcript-highlight">
        {part}
      </span>
    ) : (
      part
    )
  );
}

function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
