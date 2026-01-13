import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { useWebResearchStore } from "../../stores/webResearchStore";
import { useAIStore } from "../../stores/aiStore";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { webSearch, scrapeUrl, summarizeResearch } from "../../utils/api";
import { createPage } from "../../utils/api";
import type { SearchResult, ScrapedContent } from "../../types/webResearch";

interface WebResearchPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
}

export function WebResearchPanel({ isOpen, onClose, onOpenSettings }: WebResearchPanelProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    settings,
    session,
    isSearching,
    isScraping,
    isSummarizing,
    scrapingUrls,
    error,
    startNewSession,
    setSearchResults,
    toggleResultSelection,
    selectAllResults,
    deselectAllResults,
    addScrapedContent,
    setSummary,
    clearSession,
    setSearching,
    setScraping,
    addScrapingUrl,
    removeScrapingUrl,
    setSummarizing,
    setError,
  } = useWebResearchStore();

  const { settings: aiSettings } = useAIStore();
  const { selectedNotebookId } = useNotebookStore();
  const { loadPages } = usePageStore();

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleSearch = async () => {
    if (!query.trim() || isSearching) return;

    if (!settings.tavilyApiKey) {
      setError("Please configure your Tavily API key in settings");
      onOpenSettings?.();
      return;
    }

    startNewSession(query);
    setSearching(true);
    setError(null);

    try {
      const response = await webSearch(query, settings.tavilyApiKey, {
        maxResults: settings.maxResults,
        searchDepth: settings.searchDepth,
        includeAnswer: settings.includeAnswer,
      });

      setSearchResults(response.results, response.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const handleScrape = async (url: string) => {
    if (scrapingUrls.has(url)) return;

    addScrapingUrl(url);
    setScraping(true);

    try {
      const content = await scrapeUrl(url);
      addScrapedContent(url, content);
    } catch (err) {
      console.error("Scrape error:", err);
    } finally {
      removeScrapingUrl(url);
      // Check if any URLs are still being scraped
      if (scrapingUrls.size <= 1) {
        setScraping(false);
      }
    }
  };

  const handleScrapeSelected = async () => {
    if (!session || session.selectedUrls.length === 0) return;

    const urlsToScrape = session.selectedUrls.filter(
      (url) => !session.scrapedContent[url] && !scrapingUrls.has(url)
    );

    for (const url of urlsToScrape) {
      handleScrape(url);
    }
  };

  const handleSummarize = async () => {
    if (!session || session.selectedUrls.length === 0 || isSummarizing) return;

    // First, scrape any selected URLs that haven't been scraped yet
    const unscrapedUrls = session.selectedUrls.filter(
      (url) => !session.scrapedContent[url]
    );

    if (unscrapedUrls.length > 0) {
      // Scrape all unscraped URLs first
      setScraping(true);
      try {
        await Promise.all(
          unscrapedUrls.map(async (url) => {
            addScrapingUrl(url);
            try {
              const content = await scrapeUrl(url);
              addScrapedContent(url, content);
            } finally {
              removeScrapingUrl(url);
            }
          })
        );
      } finally {
        setScraping(false);
      }
    }

    // Now summarize
    setSummarizing(true);
    setError(null);

    try {
      // Get scraped content for selected URLs
      const contents: ScrapedContent[] = session.selectedUrls
        .map((url) => session.scrapedContent[url])
        .filter((c): c is ScrapedContent => c !== undefined);

      if (contents.length === 0) {
        setError("No content to summarize");
        return;
      }

      const summary = await summarizeResearch(contents, session.query, {
        providerType: aiSettings.providerType,
        apiKey: aiSettings.apiKey || undefined,
        model: aiSettings.model || undefined,
      });

      setSummary(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Summarization failed");
    } finally {
      setSummarizing(false);
    }
  };

  const handleInsertAsPage = async () => {
    if (!session?.summary || !selectedNotebookId) return;

    // Format summary as markdown content for the new page
    // Note: Currently creating page with title only - content would need to be
    // added separately through the updatePage API
    const _pageContent = formatSummaryAsContent(session);
    void _pageContent; // Used for future enhancement

    try {
      await createPage(selectedNotebookId, `Research: ${session.query}`);
      // Reload pages to include the new one
      loadPages(selectedNotebookId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create page");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSearch();
    }
    if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  const selectedCount = session?.selectedUrls.length ?? 0;
  const scrapedCount = session
    ? Object.keys(session.scrapedContent).length
    : 0;

  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex h-[700px] w-[520px] flex-col overflow-hidden rounded-2xl border shadow-2xl"
      style={{
        backgroundColor: "var(--color-bg-panel)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{
          background:
            "linear-gradient(to right, rgba(137, 180, 250, 0.1), rgba(116, 199, 236, 0.05))",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{
              background:
                "linear-gradient(to bottom right, var(--color-info), var(--color-accent))",
            }}
          >
            <IconGlobe style={{ color: "white" }} />
          </div>
          <div>
            <span
              className="font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Web Research
            </span>
            {session && (
              <p
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {session.searchResults.length} results found
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenSettings}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Settings"
          >
            <IconSettings />
          </button>
          <button
            onClick={clearSession}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Clear session"
          >
            <IconTrash />
          </button>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
          >
            <IconX />
          </button>
        </div>
      </div>

      {/* API Key Warning */}
      {!settings.tavilyApiKey && (
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 border-b px-5 py-3 text-left text-sm transition-all hover:bg-[--color-bg-tertiary]"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "rgba(249, 226, 175, 0.1)",
            color: "var(--color-warning)",
          }}
        >
          <IconWarning />
          <span>Configure your Tavily API key to get started</span>
        </button>
      )}

      {/* Error Message */}
      {error && (
        <div
          className="border-b px-5 py-3 text-sm"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "rgba(243, 139, 168, 0.1)",
            color: "var(--color-error)",
          }}
        >
          {error}
        </div>
      )}

      {/* Search Input */}
      <div
        className="border-b px-5 py-4"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search the web..."
            className="flex-1 rounded-xl border px-4 py-3 text-sm outline-none transition-all"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-primary)",
            }}
          />
          <button
            onClick={handleSearch}
            disabled={!query.trim() || isSearching || !settings.tavilyApiKey}
            className="flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-md transition-all disabled:opacity-50"
            style={{
              background:
                "linear-gradient(to bottom right, var(--color-info), var(--color-accent))",
            }}
          >
            {isSearching ? <IconSpinner /> : <IconSearch />}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!session ? (
          <div className="flex h-full flex-col items-center justify-center p-6 text-center">
            <div
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              <IconGlobe
                style={{ width: 32, height: 32, color: "var(--color-info)" }}
              />
            </div>
            <h3
              className="mb-2 font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Research the Web
            </h3>
            <p
              className="max-w-xs text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              Search, scrape, and summarize web content with AI assistance.
            </p>
          </div>
        ) : (
          <div className="p-4">
            {/* Tavily Answer */}
            {session.tavilyAnswer && (
              <div
                className="mb-4 rounded-xl border p-4"
                style={{
                  backgroundColor: "rgba(137, 180, 250, 0.1)",
                  borderColor: "var(--color-info)",
                }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <IconSparkles
                    style={{ color: "var(--color-info)", width: 14, height: 14 }}
                  />
                  <span
                    className="text-xs font-medium"
                    style={{ color: "var(--color-info)" }}
                  >
                    AI Answer
                  </span>
                </div>
                <p
                  className="text-sm leading-relaxed"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {session.tavilyAnswer}
                </p>
              </div>
            )}

            {/* Selection Controls */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAllResults}
                  className="text-xs transition-colors hover:underline"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Select all
                </button>
                <span style={{ color: "var(--color-text-muted)" }}>|</span>
                <button
                  onClick={deselectAllResults}
                  className="text-xs transition-colors hover:underline"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Deselect all
                </button>
              </div>
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {selectedCount} selected, {scrapedCount} scraped
              </span>
            </div>

            {/* Results List */}
            <div className="space-y-2">
              {session.searchResults.map((result) => (
                <SearchResultItem
                  key={result.url}
                  result={result}
                  isSelected={session.selectedUrls.includes(result.url)}
                  isScraped={!!session.scrapedContent[result.url]}
                  isScraping={scrapingUrls.has(result.url)}
                  onToggle={() => toggleResultSelection(result.url)}
                  onScrape={() => handleScrape(result.url)}
                  scrapedContent={session.scrapedContent[result.url]}
                />
              ))}
            </div>

            {/* Summary Section */}
            {session.summary && (
              <div
                className="mt-4 rounded-xl border p-4"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                <div className="mb-3 flex items-center gap-2">
                  <IconSparkles
                    style={{
                      color: "var(--color-accent)",
                      width: 14,
                      height: 14,
                    }}
                  />
                  <span
                    className="text-sm font-medium"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Research Summary
                  </span>
                </div>
                <div
                  className="prose prose-sm max-w-none"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  <ReactMarkdown>{session.summary.summary}</ReactMarkdown>
                </div>

                {session.summary.keyPoints.length > 0 && (
                  <div className="mt-4">
                    <span
                      className="text-xs font-medium"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Key Points
                    </span>
                    <ul className="mt-2 space-y-1">
                      {session.summary.keyPoints.map((point, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-sm"
                          style={{ color: "var(--color-text-secondary)" }}
                        >
                          <span style={{ color: "var(--color-accent)" }}>
                            •
                          </span>
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {session.summary.suggestedTags.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {session.summary.suggestedTags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full px-2 py-0.5 text-xs"
                        style={{
                          backgroundColor: "var(--color-bg-tertiary)",
                          color: "var(--color-text-muted)",
                        }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Bar */}
      {session && session.searchResults.length > 0 && (
        <div
          className="border-t p-4"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "rgba(30, 30, 46, 0.5)",
          }}
        >
          <div className="flex gap-3">
            <button
              onClick={handleScrapeSelected}
              disabled={selectedCount === 0 || isScraping}
              className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all disabled:opacity-50"
              style={{
                borderColor: "var(--color-border)",
                backgroundColor: "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
              }}
            >
              {isScraping ? "Scraping..." : `Scrape (${selectedCount})`}
            </button>
            <button
              onClick={handleSummarize}
              disabled={selectedCount === 0 || isSummarizing}
              className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-white transition-all disabled:opacity-50"
              style={{
                background:
                  "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-secondary))",
              }}
            >
              {isSummarizing ? "Summarizing..." : "Summarize"}
            </button>
          </div>
          {session.summary && selectedNotebookId && (
            <button
              onClick={handleInsertAsPage}
              className="mt-3 w-full rounded-xl border px-4 py-2.5 text-sm font-medium transition-all hover:bg-[--color-bg-tertiary]"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            >
              Insert as New Page
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Search Result Item Component
interface SearchResultItemProps {
  result: SearchResult;
  isSelected: boolean;
  isScraped: boolean;
  isScraping: boolean;
  onToggle: () => void;
  onScrape: () => void;
  scrapedContent?: ScrapedContent;
}

function SearchResultItem({
  result,
  isSelected,
  isScraped,
  isScraping,
  onToggle,
  onScrape,
  scrapedContent,
}: SearchResultItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className="rounded-lg border p-3 transition-all"
      style={{
        borderColor: isSelected
          ? "var(--color-accent)"
          : "var(--color-border)",
        backgroundColor: isSelected
          ? "rgba(139, 92, 246, 0.05)"
          : "var(--color-bg-secondary)",
      }}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-all"
          style={{
            borderColor: isSelected
              ? "var(--color-accent)"
              : "var(--color-border)",
            backgroundColor: isSelected
              ? "var(--color-accent)"
              : "transparent",
          }}
        >
          {isSelected && <IconCheck style={{ color: "white", width: 12, height: 12 }} />}
        </button>
        <div className="min-w-0 flex-1">
          <a
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-1 text-sm font-medium hover:underline"
            style={{ color: "var(--color-text-primary)" }}
          >
            {result.title}
          </a>
          <p
            className="mt-1 line-clamp-2 text-xs leading-relaxed"
            style={{ color: "var(--color-text-muted)" }}
          >
            {result.content}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <span
              className="line-clamp-1 text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {new URL(result.url).hostname}
            </span>
            {result.score && (
              <span
                className="rounded px-1.5 py-0.5 text-xs"
                style={{
                  backgroundColor: "var(--color-bg-tertiary)",
                  color: "var(--color-text-muted)",
                }}
              >
                {(result.score * 100).toFixed(0)}%
              </span>
            )}
            {isScraped && (
              <span
                className="rounded px-1.5 py-0.5 text-xs"
                style={{
                  backgroundColor: "rgba(166, 227, 161, 0.2)",
                  color: "var(--color-success)",
                }}
              >
                Scraped
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => {
            if (!isScraped && !isScraping) {
              onScrape();
            }
            setIsExpanded(!isExpanded);
          }}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-all hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-muted)" }}
          title={isScraped ? "Toggle content" : "Scrape content"}
        >
          {isScraping ? (
            <IconSpinner style={{ width: 14, height: 14 }} />
          ) : isExpanded ? (
            <IconChevronUp />
          ) : (
            <IconChevronDown />
          )}
        </button>
      </div>

      {/* Expanded Content */}
      {isExpanded && scrapedContent && (
        <div
          className="mt-3 border-t pt-3"
          style={{ borderColor: "var(--color-border)" }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span
              className="text-xs"
              style={{ color: "var(--color-text-muted)" }}
            >
              {scrapedContent.wordCount} words
            </span>
            {scrapedContent.author && (
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                by {scrapedContent.author}
              </span>
            )}
          </div>
          <div
            className="max-h-40 overflow-y-auto text-xs leading-relaxed"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {scrapedContent.content.slice(0, 1000)}
            {scrapedContent.content.length > 1000 && "..."}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper function to format summary as page content
function formatSummaryAsContent(session: NonNullable<ReturnType<typeof useWebResearchStore.getState>["session"]>) {
  if (!session.summary) return "";

  let content = `# Research: ${session.query}\n\n`;
  content += `## Summary\n\n${session.summary.summary}\n\n`;

  if (session.summary.keyPoints.length > 0) {
    content += `## Key Points\n\n`;
    session.summary.keyPoints.forEach((point) => {
      content += `- ${point}\n`;
    });
    content += "\n";
  }

  if (session.summary.sources.length > 0) {
    content += `## Sources\n\n`;
    session.summary.sources.forEach((source) => {
      content += `- [${source.title}](${source.url})\n`;
    });
  }

  return content;
}

// Icons
function IconGlobe({ style }: { style?: React.CSSProperties }) {
  return (
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
      style={style}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconSearch() {
  return (
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
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconX() {
  return (
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
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

function IconTrash() {
  return (
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
    >
      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  );
}

function IconSettings() {
  return (
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
    >
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconWarning() {
  return (
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
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

function IconSpinner({ style }: { style?: React.CSSProperties }) {
  return (
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
      className="animate-spin"
      style={style}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function IconSparkles({ style }: { style?: React.CSSProperties }) {
  return (
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
      style={style}
    >
      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
      <path d="M19 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
    </svg>
  );
}

function IconCheck({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconChevronDown() {
  return (
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
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconChevronUp() {
  return (
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
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}
