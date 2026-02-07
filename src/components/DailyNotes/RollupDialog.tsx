import { useState, useCallback } from "react";
import {
  listDailyNotes,
  aiSummarizePages,
  type PageSummaryInput,
} from "../../utils/api";
import { usePageStore } from "../../stores/pageStore";
import {
  getWeekRange,
  getLastWeekRange,
  getMonthRange,
  getLastMonthRange,
  buildRollupPrompt,
  type DateRange,
  type SummaryStyle,
} from "../../utils/rollupHelpers";
import { calculatePageStats } from "../../utils/pageStats";

interface RollupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  notebookId: string;
}

const PERIOD_OPTIONS = [
  { key: "thisWeek", label: "This Week", getRanges: getWeekRange },
  { key: "lastWeek", label: "Last Week", getRanges: getLastWeekRange },
  { key: "thisMonth", label: "This Month", getRanges: getMonthRange },
  { key: "lastMonth", label: "Last Month", getRanges: getLastMonthRange },
] as const;

const STYLE_OPTIONS: { value: SummaryStyle; label: string }[] = [
  { value: "concise", label: "Concise" },
  { value: "detailed", label: "Detailed" },
  { value: "bullets", label: "Bullet Points" },
  { value: "narrative", label: "Narrative" },
];

export function RollupDialog({ isOpen, onClose, notebookId }: RollupDialogProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<string>("thisWeek");
  const [summaryStyle, setSummaryStyle] = useState<SummaryStyle>("bullets");
  const [customPrompt, setCustomPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { createPage, updatePageContent } = usePageStore();

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      const periodOption = PERIOD_OPTIONS.find((p) => p.key === selectedPeriod);
      if (!periodOption) return;

      const dateRange: DateRange = periodOption.getRanges();

      // Fetch daily notes for the period
      const notes = await listDailyNotes(
        notebookId,
        dateRange.startDate,
        dateRange.endDate
      );

      if (notes.length === 0) {
        setError("No daily notes found for this period.");
        setIsGenerating(false);
        return;
      }

      // Extract text from each note
      const pageSummaries: PageSummaryInput[] = notes.map((note) => {
        const stats = note.content?.blocks
          ? calculatePageStats(note.content.blocks)
          : null;
        return {
          title: note.title,
          content: stats?.text || "",
          tags: note.tags || [],
        };
      });

      // Build prompt and call AI
      const prompt = buildRollupPrompt(summaryStyle, dateRange, customPrompt);
      const aiResult = await aiSummarizePages(pageSummaries, {
        customPrompt: prompt,
        summaryStyle,
      });

      setResult(aiResult.summary);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate rollup"
      );
    } finally {
      setIsGenerating(false);
    }
  }, [notebookId, selectedPeriod, summaryStyle, customPrompt]);

  const handleSaveAsPage = useCallback(async () => {
    if (!result) return;

    const periodOption = PERIOD_OPTIONS.find((p) => p.key === selectedPeriod);
    const label = periodOption?.label || "Rollup";
    const title = `${label} Rollup - ${new Date().toLocaleDateString()}`;

    const newPage = await createPage(notebookId, title);
    if (newPage) {
      await updatePageContent(notebookId, newPage.id, {
        time: Date.now(),
        version: "2.28.0",
        blocks: [
          {
            id: crypto.randomUUID(),
            type: "paragraph",
            data: { text: result },
          },
        ],
      });
      onClose();
    }
  }, [result, selectedPeriod, notebookId, createPage, updatePageContent, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" />
      <div
        role="dialog"
        className="relative z-10 w-full max-w-lg rounded-xl border p-6 shadow-xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Generate Rollup
          </h2>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {!result ? (
          <>
            {/* Period selector */}
            <div className="mb-4">
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: "var(--color-text-primary)" }}
              >
                Period
              </label>
              <div className="grid grid-cols-2 gap-2">
                {PERIOD_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => setSelectedPeriod(option.key)}
                    className="rounded-md border px-3 py-2 text-sm transition-colors"
                    style={{
                      borderColor:
                        selectedPeriod === option.key
                          ? "var(--color-accent)"
                          : "var(--color-border)",
                      backgroundColor:
                        selectedPeriod === option.key
                          ? "rgba(139, 92, 246, 0.1)"
                          : "transparent",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary style */}
            <div className="mb-4">
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: "var(--color-text-primary)" }}
              >
                Style
              </label>
              <div className="grid grid-cols-2 gap-2">
                {STYLE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setSummaryStyle(option.value)}
                    className="rounded-md border px-3 py-2 text-sm transition-colors"
                    style={{
                      borderColor:
                        summaryStyle === option.value
                          ? "var(--color-accent)"
                          : "var(--color-border)",
                      backgroundColor:
                        summaryStyle === option.value
                          ? "rgba(139, 92, 246, 0.1)"
                          : "transparent",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom prompt */}
            <div className="mb-4">
              <label
                className="block text-sm font-medium mb-1"
                style={{ color: "var(--color-text-primary)" }}
              >
                Custom Instructions (optional)
              </label>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="e.g., Focus on productivity themes..."
                rows={2}
                className="w-full rounded-md border px-3 py-2 text-sm resize-none"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>

            {/* Error */}
            {error && (
              <div
                className="mb-4 rounded-md px-3 py-2 text-sm"
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.1)",
                  color: "var(--color-error)",
                }}
              >
                {error}
              </div>
            )}

            {/* Generate button */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full rounded-md px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              {isGenerating ? "Generating..." : "Generate Rollup"}
            </button>
          </>
        ) : (
          <>
            {/* Result */}
            <div
              className="mb-4 max-h-64 overflow-y-auto rounded-lg border p-4 text-sm whitespace-pre-wrap"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
              }}
            >
              {result}
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleSaveAsPage}
                className="flex-1 rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                Save as Page
              </button>
              <button
                onClick={() => setResult(null)}
                className="rounded-md border px-4 py-2 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                style={{
                  borderColor: "var(--color-border)",
                  color: "var(--color-text-secondary)",
                }}
              >
                Back
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
