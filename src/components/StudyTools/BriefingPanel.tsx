import { useState, useCallback } from "react";
import type { BriefingDocument, StudyPageContent, ActionItem } from "../../types/studyTools";

interface BriefingPanelProps {
  briefing: BriefingDocument | null;
  isGenerating: boolean;
  error: string | null;
  onGenerate: (pages: StudyPageContent[], includeActionItems?: boolean) => Promise<BriefingDocument | null>;
  onClear: () => void;
  pages: StudyPageContent[];
}

export function BriefingPanel({
  briefing,
  isGenerating,
  error,
  onGenerate,
  onClear,
  pages,
}: BriefingPanelProps) {
  const [includeActionItems, setIncludeActionItems] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  const handleGenerate = useCallback(async () => {
    await onGenerate(pages, includeActionItems);
  }, [onGenerate, pages, includeActionItems]);

  const toggleSection = useCallback((index: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const getPriorityColor = (priority: ActionItem["priority"]) => {
    switch (priority) {
      case "high":
        return { bg: "rgba(239, 68, 68, 0.1)", text: "#ef4444" };
      case "medium":
        return { bg: "rgba(245, 158, 11, 0.1)", text: "#f59e0b" };
      case "low":
        return { bg: "rgba(107, 114, 128, 0.1)", text: "#6b7280" };
      default:
        return { bg: "var(--color-bg-tertiary)", text: "var(--color-text-muted)" };
    }
  };

  if (!briefing) {
    return (
      <div className="space-y-4">
        <p
          className="text-sm"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Generate an executive briefing document from your selected pages. The AI will create
          a concise summary with key findings, recommendations, and actionable items.
        </p>

        {/* Options */}
        <div className="space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                includeActionItems
                  ? "border-[--color-accent] bg-[--color-accent]"
                  : "border-[--color-border]"
              }`}
              onClick={() => setIncludeActionItems(!includeActionItems)}
            >
              {includeActionItems && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="white"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
            <div>
              <span
                className="text-sm font-medium"
                style={{ color: "var(--color-text-primary)" }}
              >
                Include action items
              </span>
              <p
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                Extract tasks, owners, and deadlines from the content
              </p>
            </div>
          </label>
        </div>

        {error && (
          <div
            className="p-3 rounded-lg text-sm"
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.1)",
              color: "#ef4444",
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={handleGenerate}
          disabled={isGenerating || pages.length === 0}
          className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          {isGenerating ? (
            <span className="flex items-center justify-center gap-2">
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Generating...
            </span>
          ) : (
            `Generate Briefing from ${pages.length} page${pages.length !== 1 ? "s" : ""}`
          )}
        </button>
      </div>
    );
  }

  // Display generated briefing
  return (
    <div className="space-y-6">
      {/* Header with clear button */}
      <div className="flex items-center justify-between">
        <h3
          className="font-semibold"
          style={{ color: "var(--color-text-primary)" }}
        >
          {briefing.title}
        </h3>
        <button
          onClick={onClear}
          className="text-sm hover:underline"
          style={{ color: "var(--color-text-muted)" }}
        >
          Generate new
        </button>
      </div>

      {/* Executive Summary */}
      <div
        className="p-4 rounded-lg"
        style={{ backgroundColor: "var(--color-bg-tertiary)" }}
      >
        <h4
          className="text-sm font-medium mb-2 flex items-center gap-2"
          style={{ color: "var(--color-text-primary)" }}
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
            style={{ color: "#06b6d4" }}
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          Executive Summary
        </h4>
        <p
          className="text-sm leading-relaxed"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {briefing.executiveSummary}
        </p>
      </div>

      {/* Key Findings */}
      {briefing.keyFindings.length > 0 && (
        <div>
          <h4
            className="text-sm font-medium mb-3 flex items-center gap-2"
            style={{ color: "var(--color-text-primary)" }}
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
              style={{ color: "#f59e0b" }}
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            Key Findings
          </h4>
          <ul className="space-y-2">
            {briefing.keyFindings.map((finding, i) => (
              <li
                key={i}
                className="text-sm pl-4 border-l-2 py-1"
                style={{
                  color: "var(--color-text-secondary)",
                  borderColor: "#f59e0b",
                }}
              >
                {finding}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommendations */}
      {briefing.recommendations.length > 0 && (
        <div>
          <h4
            className="text-sm font-medium mb-3 flex items-center gap-2"
            style={{ color: "var(--color-text-primary)" }}
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
              style={{ color: "#10b981" }}
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Recommendations
          </h4>
          <ul className="space-y-2">
            {briefing.recommendations.map((rec, i) => (
              <li
                key={i}
                className="text-sm pl-4 border-l-2 py-1"
                style={{
                  color: "var(--color-text-secondary)",
                  borderColor: "#10b981",
                }}
              >
                {rec}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Items */}
      {briefing.actionItems.length > 0 && (
        <div>
          <h4
            className="text-sm font-medium mb-3 flex items-center gap-2"
            style={{ color: "var(--color-text-primary)" }}
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
              style={{ color: "#8b5cf6" }}
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            Action Items
          </h4>
          <div className="space-y-2">
            {briefing.actionItems.map((item, i) => {
              const priorityColor = getPriorityColor(item.priority);
              return (
                <div
                  key={i}
                  className="p-3 rounded-lg border"
                  style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: "var(--color-bg-secondary)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-5 h-5 rounded border-2 flex-shrink-0 mt-0.5"
                      style={{ borderColor: "var(--color-border)" }}
                    />
                    <div className="flex-1">
                      <div
                        className="text-sm font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {item.description}
                      </div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {item.owner && (
                          <span
                            className="text-xs px-2 py-0.5 rounded flex items-center gap-1"
                            style={{
                              backgroundColor: "var(--color-bg-tertiary)",
                              color: "var(--color-text-muted)",
                            }}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                            {item.owner}
                          </span>
                        )}
                        {item.deadline && (
                          <span
                            className="text-xs px-2 py-0.5 rounded flex items-center gap-1"
                            style={{
                              backgroundColor: "var(--color-bg-tertiary)",
                              color: "var(--color-text-muted)",
                            }}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                              <line x1="16" y1="2" x2="16" y2="6" />
                              <line x1="8" y1="2" x2="8" y2="6" />
                              <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                            {item.deadline}
                          </span>
                        )}
                        {item.priority && (
                          <span
                            className="text-xs px-2 py-0.5 rounded font-medium"
                            style={{
                              backgroundColor: priorityColor.bg,
                              color: priorityColor.text,
                            }}
                          >
                            {item.priority}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detailed Sections */}
      {briefing.detailedSections.length > 0 && (
        <div>
          <h4
            className="text-sm font-medium mb-3 flex items-center gap-2"
            style={{ color: "var(--color-text-primary)" }}
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
              style={{ color: "#3b82f6" }}
            >
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
            Detailed Analysis
          </h4>
          <div className="space-y-2">
            {briefing.detailedSections.map((section, i) => (
              <div
                key={i}
                className="border rounded-lg overflow-hidden"
                style={{ borderColor: "var(--color-border)" }}
              >
                <button
                  onClick={() => toggleSection(i)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-[--color-bg-tertiary] transition-colors"
                >
                  <span
                    className="font-medium text-sm"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {section.heading}
                  </span>
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
                    className={`transition-transform ${expandedSections.has(i) ? "rotate-180" : ""}`}
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {expandedSections.has(i) && (
                  <div
                    className="p-3 border-t"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <p
                      className="text-sm whitespace-pre-wrap"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {section.content}
                    </p>
                    {section.keyPoints.length > 0 && (
                      <div className="mt-3">
                        <div
                          className="text-xs font-medium mb-1"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          Key Points:
                        </div>
                        <ul className="space-y-1">
                          {section.keyPoints.map((point, j) => (
                            <li
                              key={j}
                              className="text-sm flex items-start gap-2"
                              style={{ color: "var(--color-text-secondary)" }}
                            >
                              <span style={{ color: "#3b82f6" }}>•</span>
                              {point}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
