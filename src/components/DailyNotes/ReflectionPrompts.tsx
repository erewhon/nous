import { useState, useCallback } from "react";
import {
  listDailyNotes,
  aiSummarizePages,
  type PageSummaryInput,
} from "../../utils/api";
import { usePageStore } from "../../stores/pageStore";
import { calculatePageStats } from "../../utils/pageStats";
import {
  PROMPT_CATEGORIES,
  FALLBACK_PROMPTS,
  buildReflectionPrompt,
  parsePromptsResponse,
  type PromptCategory,
} from "../../utils/reflectionPromptHelpers";

interface ReflectionPromptsProps {
  notebookId: string;
}

export function ReflectionPrompts({ notebookId }: ReflectionPromptsProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [category, setCategory] = useState<PromptCategory>("gratitude");
  const [prompts, setPrompts] = useState<string[]>(FALLBACK_PROMPTS.gratitude);
  const [isLoading, setIsLoading] = useState(false);
  const [isAIGenerated, setIsAIGenerated] = useState(false);

  const generatePrompts = useCallback(
    async (cat: PromptCategory) => {
      setIsLoading(true);
      try {
        // Get recent daily notes (last 7 days)
        const endDate = new Date().toISOString().split("T")[0];
        const startDate = new Date(
          Date.now() - 7 * 24 * 60 * 60 * 1000
        )
          .toISOString()
          .split("T")[0];

        const notes = await listDailyNotes(notebookId, startDate, endDate);

        // Extract text content
        const pageSummaries: PageSummaryInput[] = notes
          .slice(0, 5)
          .map((note) => {
            const stats = note.content?.blocks
              ? calculatePageStats(note.content.blocks)
              : null;
            return {
              title: note.title,
              content: stats?.text || "",
              tags: note.tags || [],
            };
          });

        const recentContent = pageSummaries
          .map((p) => `${p.title}: ${p.content}`)
          .join("\n\n");

        const prompt = buildReflectionPrompt(cat, recentContent);
        const result = await aiSummarizePages(pageSummaries, {
          customPrompt: prompt,
        });

        const parsed = parsePromptsResponse(result.summary);
        if (parsed.length > 0) {
          setPrompts(parsed);
          setIsAIGenerated(true);
        } else {
          setPrompts(FALLBACK_PROMPTS[cat]);
          setIsAIGenerated(false);
        }
      } catch {
        // Fall back to static prompts
        setPrompts(FALLBACK_PROMPTS[cat]);
        setIsAIGenerated(false);
      } finally {
        setIsLoading(false);
      }
    },
    [notebookId]
  );

  const handleCategoryChange = useCallback(
    (cat: PromptCategory) => {
      setCategory(cat);
      // Use fallback prompts immediately, optionally generate AI ones
      setPrompts(FALLBACK_PROMPTS[cat]);
      setIsAIGenerated(false);
    },
    []
  );

  const handleUsePrompt = useCallback(
    (prompt: string) => {
      // Insert prompt into the current daily note by appending a paragraph
      const { pages, panes, activePaneId, updatePageContent } =
        usePageStore.getState();
      const activePaneIdToUse = activePaneId || panes[0]?.id;
      const activePane = panes.find((p) => p.id === activePaneIdToUse);
      if (!activePane?.pageId) return;

      const page = pages.find((p) => p.id === activePane.pageId);
      if (!page?.content) return;

      const newBlock = {
        id: crypto.randomUUID(),
        type: "paragraph" as const,
        data: { text: `<i>${prompt}</i>` },
      };

      const updatedContent = {
        ...page.content,
        time: Date.now(),
        blocks: [...page.content.blocks, newBlock],
      };

      updatePageContent(notebookId, page.id, updatedContent);

      // Update local state
      usePageStore.setState((state) => ({
        pages: state.pages.map((p) =>
          p.id === page.id ? { ...p, content: updatedContent } : p
        ),
        pageDataVersion: state.pageDataVersion + 1,
      }));
    },
    [notebookId]
  );

  return (
    <div className="mb-3">
      {/* Collapse header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors hover:bg-[--color-bg-tertiary]"
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
          style={{
            color: "var(--color-text-muted)",
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span
          className="text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--color-text-muted)" }}
        >
          Reflection Prompts
        </span>
        {isAIGenerated && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[10px]"
            style={{
              backgroundColor: "rgba(139, 92, 246, 0.15)",
              color: "var(--color-accent)",
            }}
          >
            AI
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          {/* Category tabs */}
          <div className="flex flex-wrap gap-1">
            {PROMPT_CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => handleCategoryChange(cat.value)}
                className="rounded-md px-2 py-0.5 text-[11px] transition-colors"
                style={{
                  backgroundColor:
                    category === cat.value
                      ? "rgba(139, 92, 246, 0.15)"
                      : "transparent",
                  color:
                    category === cat.value
                      ? "var(--color-accent)"
                      : "var(--color-text-muted)",
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Prompts */}
          <div className="space-y-1.5">
            {isLoading ? (
              <div
                className="text-xs text-center py-3"
                style={{ color: "var(--color-text-muted)" }}
              >
                Generating prompts...
              </div>
            ) : (
              prompts.map((prompt, i) => (
                <div
                  key={i}
                  className="group flex items-start gap-2 rounded-md border px-2.5 py-2"
                  style={{
                    borderColor: "var(--color-border)",
                    backgroundColor: "var(--color-bg-secondary)",
                  }}
                >
                  <span
                    className="flex-1 text-xs leading-relaxed"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {prompt}
                  </span>
                  <button
                    onClick={() => handleUsePrompt(prompt)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] opacity-0 transition-opacity group-hover:opacity-100"
                    style={{
                      backgroundColor: "var(--color-accent)",
                      color: "white",
                    }}
                    title="Insert this prompt into your note"
                  >
                    Use
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Refresh button */}
          <button
            onClick={() => generatePrompts(category)}
            disabled={isLoading}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-[--color-bg-tertiary] disabled:opacity-50"
            style={{ color: "var(--color-accent)" }}
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
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            Generate with AI
          </button>
        </div>
      )}
    </div>
  );
}
