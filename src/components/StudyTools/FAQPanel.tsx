import { useState, useCallback } from "react";
import type { FAQ, StudyPageContent } from "../../types/studyTools";

interface FAQPanelProps {
  faq: FAQ | null;
  isGenerating: boolean;
  error: string | null;
  onGenerate: (pages: StudyPageContent[], numQuestions?: number) => Promise<FAQ | null>;
  onClear: () => void;
  pages: StudyPageContent[];
  onNavigateToPage?: (pageId: string) => void;
}

export function FAQPanel({
  faq,
  isGenerating,
  error,
  onGenerate,
  onClear,
  pages,
  onNavigateToPage,
}: FAQPanelProps) {
  const [numQuestions, setNumQuestions] = useState(10);
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");

  const handleGenerate = useCallback(async () => {
    await onGenerate(pages, numQuestions);
    // Expand all by default after generation
    setExpandedItems(new Set());
  }, [onGenerate, pages, numQuestions]);

  const toggleItem = useCallback((index: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (faq) {
      setExpandedItems(new Set(faq.questions.map((_, i) => i)));
    }
  }, [faq]);

  const collapseAll = useCallback(() => {
    setExpandedItems(new Set());
  }, []);

  if (!faq) {
    return (
      <div className="space-y-4">
        <p
          className="text-sm"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Generate frequently asked questions from your selected pages. The AI will extract
          key questions and provide comprehensive answers with source references.
        </p>

        {/* Options */}
        <div>
          <label
            className="block text-sm font-medium mb-2"
            style={{ color: "var(--color-text-primary)" }}
          >
            Number of questions
          </label>
          <input
            type="range"
            min={5}
            max={20}
            value={numQuestions}
            onChange={(e) => setNumQuestions(parseInt(e.target.value))}
            className="w-full"
          />
          <div
            className="text-sm mt-1"
            style={{ color: "var(--color-text-muted)" }}
          >
            {numQuestions} questions
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
            `Generate FAQ from ${pages.length} page${pages.length !== 1 ? "s" : ""}`
          )}
        </button>
      </div>
    );
  }

  // Filter questions by search
  const filteredQuestions = faq.questions.filter((q) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      q.question.toLowerCase().includes(query) ||
      q.answer.toLowerCase().includes(query)
    );
  });

  // Display generated FAQ
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3
          className="font-semibold"
          style={{ color: "var(--color-text-primary)" }}
        >
          Generated FAQ ({faq.questions.length} questions)
        </h3>
        <button
          onClick={onClear}
          className="text-sm hover:underline"
          style={{ color: "var(--color-text-muted)" }}
        >
          Generate new
        </button>
      </div>

      {/* Search and controls */}
      <div className="space-y-2">
        <div className="relative">
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
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--color-text-muted)" }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search questions..."
            className="w-full rounded-lg border py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-[--color-accent]"
            style={{
              backgroundColor: "var(--color-bg-primary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={expandAll}
            className="text-xs hover:underline"
            style={{ color: "var(--color-accent)" }}
          >
            Expand all
          </button>
          <button
            onClick={collapseAll}
            className="text-xs hover:underline"
            style={{ color: "var(--color-text-muted)" }}
          >
            Collapse all
          </button>
        </div>
      </div>

      {/* Questions list */}
      <div className="space-y-2">
        {filteredQuestions.length === 0 ? (
          <p
            className="text-sm text-center py-4"
            style={{ color: "var(--color-text-muted)" }}
          >
            No questions match your search
          </p>
        ) : (
          filteredQuestions.map((item) => {
            const originalIndex = faq.questions.indexOf(item);
            return (
              <div
                key={originalIndex}
                className="border rounded-lg overflow-hidden"
                style={{ borderColor: "var(--color-border)" }}
              >
                <button
                  onClick={() => toggleItem(originalIndex)}
                  className="w-full flex items-start gap-3 p-3 text-left hover:bg-[--color-bg-tertiary] transition-colors"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="flex-shrink-0 mt-0.5"
                    style={{ color: "var(--color-accent)" }}
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                    <path d="M12 17h.01" />
                  </svg>
                  <span
                    className="flex-1 font-medium text-sm"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {item.question}
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
                    className={`flex-shrink-0 transition-transform ${
                      expandedItems.has(originalIndex) ? "rotate-180" : ""
                    }`}
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                {expandedItems.has(originalIndex) && (
                  <div
                    className="p-3 border-t"
                    style={{
                      borderColor: "var(--color-border)",
                      backgroundColor: "var(--color-bg-tertiary)",
                    }}
                  >
                    <p
                      className="text-sm whitespace-pre-wrap"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      {item.answer}
                    </p>
                    {item.sourcePageId && onNavigateToPage && (
                      <button
                        onClick={() => onNavigateToPage(item.sourcePageId!)}
                        className="mt-2 text-xs flex items-center gap-1 hover:underline"
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
                        View source page
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
