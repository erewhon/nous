import { useState, useCallback } from "react";
import type { StudyGuide, StudyPageContent } from "../../types/studyTools";

interface StudyGuidePanelProps {
  studyGuide: StudyGuide | null;
  isGenerating: boolean;
  error: string | null;
  onGenerate: (
    pages: StudyPageContent[],
    options?: { depth?: "brief" | "standard" | "comprehensive"; focusAreas?: string[]; numPracticeQuestions?: number }
  ) => Promise<StudyGuide | null>;
  onClear: () => void;
  pages: StudyPageContent[];
}

export function StudyGuidePanel({
  studyGuide,
  isGenerating,
  error,
  onGenerate,
  onClear,
  pages,
}: StudyGuidePanelProps) {
  const [depth, setDepth] = useState<"brief" | "standard" | "comprehensive">("standard");
  const [numQuestions, setNumQuestions] = useState(5);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [showAnswers, setShowAnswers] = useState<Set<number>>(new Set());

  const handleGenerate = useCallback(async () => {
    await onGenerate(pages, {
      depth,
      numPracticeQuestions: numQuestions,
    });
  }, [onGenerate, pages, depth, numQuestions]);

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

  const toggleAnswer = useCallback((index: number) => {
    setShowAnswers((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  if (!studyGuide) {
    return (
      <div className="space-y-4">
        <p
          className="text-sm"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Generate a comprehensive study guide from your selected pages. The AI will create
          learning objectives, key concepts, section summaries, and practice questions.
        </p>

        {/* Options */}
        <div className="space-y-4">
          {/* Depth */}
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: "var(--color-text-primary)" }}
            >
              Depth
            </label>
            <div className="flex gap-2">
              {(["brief", "standard", "comprehensive"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setDepth(d)}
                  className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                    depth === d ? "border-[--color-accent]" : "border-[--color-border]"
                  }`}
                  style={{
                    backgroundColor: depth === d ? "rgba(139, 92, 246, 0.1)" : "var(--color-bg-primary)",
                    color: depth === d ? "var(--color-accent)" : "var(--color-text-secondary)",
                  }}
                >
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Number of practice questions */}
          <div>
            <label
              className="block text-sm font-medium mb-2"
              style={{ color: "var(--color-text-primary)" }}
            >
              Practice questions
            </label>
            <input
              type="range"
              min={1}
              max={15}
              value={numQuestions}
              onChange={(e) => setNumQuestions(parseInt(e.target.value))}
              className="w-full"
            />
            <div
              className="text-sm mt-1"
              style={{ color: "var(--color-text-muted)" }}
            >
              {numQuestions} question{numQuestions !== 1 ? "s" : ""}
            </div>
          </div>
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
            `Generate Study Guide from ${pages.length} page${pages.length !== 1 ? "s" : ""}`
          )}
        </button>
      </div>
    );
  }

  // Display generated study guide
  return (
    <div className="space-y-6">
      {/* Header with clear button */}
      <div className="flex items-center justify-between">
        <h3
          className="font-semibold"
          style={{ color: "var(--color-text-primary)" }}
        >
          {studyGuide.title}
        </h3>
        <button
          onClick={onClear}
          className="text-sm hover:underline"
          style={{ color: "var(--color-text-muted)" }}
        >
          Generate new
        </button>
      </div>

      {/* Learning Objectives */}
      {studyGuide.learningObjectives.length > 0 && (
        <div>
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
              style={{ color: "var(--color-accent)" }}
            >
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
            Learning Objectives
          </h4>
          <ul className="space-y-1.5">
            {studyGuide.learningObjectives.map((objective, i) => (
              <li
                key={i}
                className="text-sm pl-4 border-l-2"
                style={{
                  color: "var(--color-text-secondary)",
                  borderColor: "var(--color-accent)",
                }}
              >
                {objective}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Key Concepts */}
      {studyGuide.keyConcepts.length > 0 && (
        <div>
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
              style={{ color: "#f59e0b" }}
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            Key Concepts
          </h4>
          <div className="space-y-2">
            {studyGuide.keyConcepts.map((concept, i) => (
              <div
                key={i}
                className="p-3 rounded-lg"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <div
                  className="font-medium text-sm"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {concept.term}
                </div>
                <div
                  className="text-sm mt-1"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {concept.definition}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sections */}
      {studyGuide.sections.length > 0 && (
        <div>
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
              style={{ color: "#10b981" }}
            >
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
            Sections
          </h4>
          <div className="space-y-2">
            {studyGuide.sections.map((section, i) => (
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
                              <span style={{ color: "var(--color-accent)" }}>•</span>
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

      {/* Practice Questions */}
      {studyGuide.practiceQuestions.length > 0 && (
        <div>
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
              style={{ color: "#8b5cf6" }}
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
            Practice Questions
          </h4>
          <div className="space-y-3">
            {studyGuide.practiceQuestions.map((q, i) => (
              <div
                key={i}
                className="p-3 rounded-lg"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                <div
                  className="text-sm font-medium"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {i + 1}. {q.question}
                </div>
                <button
                  onClick={() => toggleAnswer(i)}
                  className="text-xs mt-2 hover:underline"
                  style={{ color: "var(--color-accent)" }}
                >
                  {showAnswers.has(i) ? "Hide answer" : "Show answer"}
                </button>
                {showAnswers.has(i) && (
                  <div
                    className="mt-2 pt-2 border-t text-sm"
                    style={{
                      borderColor: "var(--color-border)",
                      color: "var(--color-text-secondary)",
                    }}
                  >
                    {q.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary */}
      {studyGuide.summary && (
        <div>
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
              <polyline points="10 9 9 9 8 9" />
            </svg>
            Summary
          </h4>
          <p
            className="text-sm p-3 rounded-lg"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-secondary)",
            }}
          >
            {studyGuide.summary}
          </p>
        </div>
      )}
    </div>
  );
}
