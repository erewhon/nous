import { useState, useCallback, useEffect } from "react";
import { usePageStore } from "../../stores/pageStore";
import { useLinkStore } from "../../stores/linkStore";
import { useAIStore } from "../../stores/aiStore";
import { useRAGStore } from "../../stores/ragStore";
import { aiSuggestRelatedPages, type RelatedPageSuggestion } from "../../utils/api";
import type { Page } from "../../types/page";
import type { SemanticSearchResult } from "../../types/rag";

interface SimilarPagesPanelProps {
  page: Page;
  notebookId: string;
  allPages: Page[];
}

type SearchMode = "ai" | "semantic";

// Unified result type for display
interface SimilarPageResult {
  id: string;
  title: string;
  detail: string; // "reason" for AI, "content snippet" for semantic
  score?: number;
}

// Helper to extract plain text from Editor.js content
function extractPlainText(content?: Page["content"]): string {
  if (!content?.blocks) return "";
  return content.blocks
    .map((block) => {
      if (block.type === "paragraph" || block.type === "header") {
        return (block.data as { text?: string }).text || "";
      }
      if (block.type === "list" || block.type === "checklist") {
        const items = (block.data as { items?: unknown[] }).items || [];
        return items
          .map((item) => {
            if (typeof item === "string") return item;
            if (typeof item === "object" && item !== null) {
              return (item as { text?: string }).text || "";
            }
            return "";
          })
          .join(" ");
      }
      return "";
    })
    .join(" ")
    .replace(/<[^>]*>/g, "")
    .trim();
}

export function SimilarPagesPanel({ page, notebookId, allPages }: SimilarPagesPanelProps) {
  const [results, setResults] = useState<SimilarPageResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [mode, setMode] = useState<SearchMode>("semantic");

  const { selectPage } = usePageStore();
  const { outgoingLinks } = useLinkStore();
  const { getActiveProviderType, getActiveApiKey, getActiveModel } = useAIStore();
  const { findSimilarPages, isConfigured: ragConfigured, settings: ragSettings } = useRAGStore();

  const activeApiKey = getActiveApiKey();
  const ragAvailable = ragConfigured && ragSettings.ragEnabled;

  // Auto-select mode based on availability
  useEffect(() => {
    if (mode === "semantic" && !ragAvailable && activeApiKey) {
      setMode("ai");
    } else if (mode === "ai" && !activeApiKey && ragAvailable) {
      setMode("semantic");
    }
  }, [ragAvailable, activeApiKey, mode]);

  const fetchSuggestions = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (mode === "semantic") {
        if (!ragAvailable) {
          setError("Configure embeddings in Settings to use semantic search");
          return;
        }

        const semanticResults: SemanticSearchResult[] = await findSimilarPages(page.id, undefined, 10);

        setResults(
          semanticResults.map((r) => ({
            id: r.pageId,
            title: r.title || "Untitled",
            detail: r.content.slice(0, 150) + (r.content.length > 150 ? "..." : ""),
            score: r.score,
          }))
        );
      } else {
        // AI mode
        const apiKey = getActiveApiKey();
        if (!apiKey) {
          setError("Configure AI in Settings to get suggestions");
          return;
        }

        const content = extractPlainText(page.content);
        if (!content || content.length < 50) {
          setResults([]);
          return;
        }

        const existingLinks = outgoingLinks.get(page.id) || [];

        const availablePages = allPages
          .filter((p) => p.id !== page.id && p.notebookId === notebookId)
          .map((p) => ({
            id: p.id,
            title: p.title,
            summary: extractPlainText(p.content).slice(0, 200),
          }));

        if (availablePages.length === 0) {
          setResults([]);
          return;
        }

        const aiResults: RelatedPageSuggestion[] = await aiSuggestRelatedPages(
          content,
          page.title,
          availablePages,
          {
            existingLinks,
            maxSuggestions: 5,
            providerType: getActiveProviderType(),
            apiKey,
            model: getActiveModel() || undefined,
          }
        );

        setResults(
          aiResults.map((r) => ({
            id: r.id,
            title: r.title,
            detail: r.reason,
          }))
        );
      }

      setHasLoaded(true);
    } catch (err) {
      console.error("Failed to get similar pages:", err);
      setError(err instanceof Error ? err.message : "Failed to get suggestions");
    } finally {
      setIsLoading(false);
    }
  }, [
    mode,
    page,
    notebookId,
    allPages,
    outgoingLinks,
    ragAvailable,
    findSimilarPages,
    getActiveProviderType,
    getActiveApiKey,
    getActiveModel,
  ]);

  // Reset when page changes
  useEffect(() => {
    setResults([]);
    setHasLoaded(false);
    setError(null);
  }, [page.id]);

  const handlePageClick = (pageId: string) => {
    selectPage(pageId);
  };

  // Don't show if neither mode is available
  if (!activeApiKey && !ragAvailable && !hasLoaded) {
    return null;
  }

  const canSearch = mode === "semantic" ? ragAvailable : !!activeApiKey;

  return (
    <div className="mt-6 border-t pt-6" style={{ borderColor: "var(--color-border)" }}>
      <div className="mb-3 flex items-center justify-between">
        <h3
          className="flex items-center gap-2 text-sm font-medium"
          style={{ color: "var(--color-text-secondary)" }}
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
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
          Similar Pages
        </h3>
        <div className="flex items-center gap-1">
          {/* Mode toggle */}
          {ragAvailable && activeApiKey && (
            <div
              className="mr-1 flex rounded text-xs"
              style={{ border: "1px solid var(--color-border)" }}
            >
              <button
                onClick={() => {
                  setMode("semantic");
                  setResults([]);
                  setHasLoaded(false);
                }}
                className="rounded-l px-2 py-0.5 transition-colors"
                style={{
                  backgroundColor:
                    mode === "semantic" ? "var(--color-accent)" : "transparent",
                  color:
                    mode === "semantic" ? "white" : "var(--color-text-muted)",
                }}
                title="Vector similarity (fast, requires indexed pages)"
              >
                Semantic
              </button>
              <button
                onClick={() => {
                  setMode("ai");
                  setResults([]);
                  setHasLoaded(false);
                }}
                className="rounded-r px-2 py-0.5 transition-colors"
                style={{
                  backgroundColor:
                    mode === "ai" ? "var(--color-accent)" : "transparent",
                  color: mode === "ai" ? "white" : "var(--color-text-muted)",
                }}
                title="AI analysis (slower, more contextual)"
              >
                AI
              </button>
            </div>
          )}
          <button
            onClick={fetchSuggestions}
            disabled={isLoading || !canSearch}
            className="rounded px-2 py-1 text-xs transition-colors hover:bg-white/10 disabled:opacity-50"
            style={{ color: "var(--color-accent)" }}
            title={
              mode === "semantic"
                ? "Find similar pages using vector similarity"
                : "Find similar pages using AI"
            }
          >
            {isLoading ? (
              <span className="flex items-center gap-1">
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                {mode === "semantic" ? "Searching..." : "Analyzing..."}
              </span>
            ) : (
              <span className="flex items-center gap-1">
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
                  <path d="M12 2a4 4 0 0 1 4 4c0 1.1-.5 2-1 3l6 6-3 3-6-6c-1 .5-1.9 1-3 1a4 4 0 1 1 0-8" />
                  <circle cx="8" cy="8" r="2" />
                </svg>
                Find Similar
              </span>
            )}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {error}
        </p>
      )}

      {results.length === 0 && hasLoaded && !isLoading && !error && (
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {mode === "semantic"
            ? "No similar pages found. Ensure pages are indexed in Settings > Embeddings."
            : "No related pages found. Add more content to get suggestions."}
        </p>
      )}

      {results.length > 0 && (
        <ul className="space-y-2">
          {results.map((result) => (
            <li key={result.id}>
              <button
                onClick={() => handlePageClick(result.id)}
                className="flex w-full flex-col gap-1 rounded px-3 py-2 text-left transition-colors hover:bg-white/5"
                style={{ backgroundColor: "rgba(139, 92, 246, 0.05)" }}
              >
                <div className="flex items-center gap-2">
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
                    style={{ color: "var(--color-accent)" }}
                  >
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14,2 14,8 20,8" />
                  </svg>
                  <span
                    className="truncate text-sm font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {result.title}
                  </span>
                  {result.score !== undefined && (
                    <span
                      className="ml-auto shrink-0 text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {Math.round(result.score * 100)}%
                    </span>
                  )}
                </div>
                <p
                  className="text-xs leading-relaxed"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {result.detail}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
