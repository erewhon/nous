import { useState, useCallback } from "react";
import type { Citation } from "../../types/studyTools";

interface SourceCitationProps {
  citations: Citation[];
  onNavigateToPage?: (pageId: string) => void;
}

/**
 * Displays source citations with expandable details and navigation.
 */
export function SourceCitations({
  citations,
  onNavigateToPage,
}: SourceCitationProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const toggleExpand = useCallback((id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  if (citations.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--color-border)" }}>
      <div
        className="text-xs font-medium mb-2 flex items-center gap-2"
        style={{ color: "var(--color-text-muted)" }}
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
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
        Sources ({citations.length})
      </div>
      <div className="space-y-1">
        {citations.map((citation) => (
          <div key={citation.id}>
            <button
              onClick={() => toggleExpand(citation.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-[--color-bg-tertiary] transition-colors"
            >
              <span
                className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium"
                style={{
                  backgroundColor: "rgba(139, 92, 246, 0.15)",
                  color: "#8b5cf6",
                }}
              >
                {citation.id}
              </span>
              <span
                className="flex-1 text-sm truncate"
                style={{ color: "var(--color-text-primary)" }}
              >
                {citation.pageTitle}
              </span>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`flex-shrink-0 transition-transform ${expandedId === citation.id ? "rotate-180" : ""}`}
                style={{ color: "var(--color-text-muted)" }}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {expandedId === citation.id && (
              <div
                className="ml-7 mt-1 p-2 rounded text-sm"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-secondary)",
                }}
              >
                <p className="italic">"{citation.excerpt}"</p>
                <div className="mt-2 flex items-center justify-between">
                  <span
                    className="text-xs"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Relevance: {Math.round(citation.relevanceScore * 100)}%
                  </span>
                  {onNavigateToPage && (
                    <button
                      onClick={() => onNavigateToPage(citation.pageId)}
                      className="text-xs flex items-center gap-1 hover:underline"
                      style={{ color: "var(--color-accent)" }}
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
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      View page
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface CitationBadgeProps {
  id: number;
  onClick?: () => void;
  isActive?: boolean;
}

/**
 * Inline citation badge [1], [2], etc.
 */
export function CitationBadge({ id, onClick, isActive }: CitationBadgeProps) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-medium transition-colors ${isActive ? "ring-1 ring-offset-1 ring-[#8b5cf6]" : ""}`}
      style={{
        backgroundColor: isActive ? "#8b5cf6" : "rgba(139, 92, 246, 0.15)",
        color: isActive ? "white" : "#8b5cf6",
      }}
    >
      {id}
    </button>
  );
}

interface CitedContentProps {
  content: string;
  citations: Citation[];
  onCitationClick?: (citationId: number) => void;
  activeCitationId?: number | null;
}

/**
 * Renders content with inline citation badges replacing [1], [2], etc.
 */
export function CitedContent({
  content,
  citations,
  onCitationClick,
  activeCitationId,
}: CitedContentProps) {
  // Parse content and replace [1], [2], etc. with citation badges
  const citationPattern = /\[(\d+)\]/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = citationPattern.exec(content)) !== null) {
    // Add text before the citation
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }

    const citationId = parseInt(match[1], 10);
    const citation = citations.find((c) => c.id === citationId);

    if (citation) {
      parts.push(
        <CitationBadge
          key={`citation-${match.index}`}
          id={citationId}
          onClick={() => onCitationClick?.(citationId)}
          isActive={activeCitationId === citationId}
        />
      );
    } else {
      // Keep original text if citation not found
      parts.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return <span>{parts}</span>;
}
