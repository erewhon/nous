import { useState, useCallback } from "react";
import { useDigestStore, type DailyDigest } from "../../stores/digestStore";

interface DigestPanelProps {
  notebookId: string;
  date?: string;
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${months[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
}

function DigestContent({ digest }: { digest: DailyDigest }) {
  return (
    <div className="space-y-4">
      {/* Summary */}
      <div>
        <p
          className="text-sm leading-relaxed whitespace-pre-wrap"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {digest.summary}
        </p>
      </div>

      {/* Connections */}
      {digest.connections.length > 0 && (
        <div>
          <h4
            className="text-xs font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--color-text-muted)" }}
          >
            Connections
          </h4>
          <div className="space-y-1.5">
            {digest.connections.map((conn, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs px-2 py-1.5 rounded"
                style={{ backgroundColor: "var(--color-bg-secondary)" }}
              >
                <span style={{ color: "var(--color-text-primary)" }}>
                  {conn.fromPageTitle}
                </span>
                <span style={{ color: "var(--color-text-muted)" }}>
                  {conn.relationship}
                </span>
                <span style={{ color: "var(--color-text-primary)" }}>
                  {conn.toPageTitle}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Follow-ups */}
      {digest.followUps.length > 0 && (
        <div>
          <h4
            className="text-xs font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--color-text-muted)" }}
          >
            Follow-ups
          </h4>
          <ul className="space-y-1">
            {digest.followUps.map((item, i) => (
              <li
                key={i}
                className="text-xs flex items-start gap-2"
                style={{ color: "var(--color-text-secondary)" }}
              >
                <span
                  className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: "var(--color-accent)" }}
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Themes */}
      {digest.themes.length > 0 && (
        <div>
          <h4
            className="text-xs font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--color-text-muted)" }}
          >
            Themes
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {digest.themes.map((theme, i) => (
              <span
                key={i}
                className="text-xs px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
                  color: "var(--color-accent)",
                }}
              >
                {theme}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Generated at */}
      <div
        className="text-xs pt-2"
        style={{
          color: "var(--color-text-muted)",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        Generated {new Date(digest.generatedAt).toLocaleTimeString()}
      </div>
    </div>
  );
}

export function DigestPanel({ notebookId, date }: DigestPanelProps) {
  const targetDate = date || getToday();
  const [selectedDate] = useState(targetDate);
  const generateDigest = useDigestStore((s) => s.generateDigest);
  const isGenerating = useDigestStore((s) => s.isGenerating);
  const error = useDigestStore((s) => s.error);
  const clearError = useDigestStore((s) => s.clearError);
  const digest = useDigestStore((s) => s.getDigestForDate(notebookId, selectedDate));

  const handleGenerate = useCallback(() => {
    clearError();
    generateDigest(notebookId, selectedDate);
  }, [notebookId, selectedDate, generateDigest, clearError]);

  return (
    <div
      className="rounded-lg p-4"
      style={{
        backgroundColor: "var(--color-bg-tertiary)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3
          className="text-sm font-semibold"
          style={{ color: "var(--color-text-primary)" }}
        >
          AI Digest — {formatDate(selectedDate)}
        </h3>
        {!isGenerating && (
          <button
            onClick={handleGenerate}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs hover:opacity-80 transition-opacity"
            style={{
              backgroundColor: "var(--color-accent)",
              color: "white",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            {digest ? "Regenerate" : "Generate Digest"}
          </button>
        )}
      </div>

      {isGenerating && (
        <div className="flex items-center gap-2 py-6 justify-center">
          <div
            className="w-4 h-4 border-2 rounded-full animate-spin"
            style={{
              borderColor: "var(--color-border)",
              borderTopColor: "var(--color-accent)",
            }}
          />
          <span
            className="text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Generating digest...
          </span>
        </div>
      )}

      {error && (
        <div
          className="text-xs px-3 py-2 rounded mb-3"
          style={{
            backgroundColor: "color-mix(in srgb, #ef4444 15%, transparent)",
            color: "#ef4444",
          }}
        >
          {error}
        </div>
      )}

      {!isGenerating && digest && <DigestContent digest={digest} />}

      {!isGenerating && !digest && !error && (
        <div
          className="text-center py-6"
          style={{ color: "var(--color-text-muted)" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mx-auto mb-2 opacity-50"
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          <p className="text-sm">No digest for this date yet</p>
          <p className="text-xs mt-1">
            Click "Generate Digest" to create an AI summary
          </p>
        </div>
      )}
    </div>
  );
}
