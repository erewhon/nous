import { useState, useCallback, useEffect } from "react";
import { useStudyToolsStore } from "../../stores/studyToolsStore";
import { usePageStore } from "../../stores/pageStore";
import { useNotebookStore } from "../../stores/notebookStore";
import { PageSelector } from "./PageSelector";
import { StudyGuidePanel } from "./StudyGuidePanel";
import { FAQPanel } from "./FAQPanel";
import { BriefingPanel } from "./BriefingPanel";
import { TimelineView } from "./TimelineView";
import { ConceptMapView } from "./ConceptMapView";
import { InfographicGenerator } from "../Infographics/InfographicGenerator";
import { VideoGeneratorDialog } from "../VideoGenerator/VideoGeneratorDialog";
import type { StudyToolType, StudyPageContent } from "../../types/studyTools";

interface StudyToolsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const STUDY_TOOLS: Array<{
  id: StudyToolType;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}> = [
  {
    id: "study-guide",
    name: "Study Guide",
    description: "Generate structured learning materials",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      </svg>
    ),
    color: "#10b981",
  },
  {
    id: "faq",
    name: "FAQ",
    description: "Extract Q&A pairs from content",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
        <path d="M12 17h.01" />
      </svg>
    ),
    color: "#8b5cf6",
  },
  {
    id: "flashcards",
    name: "Flashcards",
    description: "Auto-generate study flashcards",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <line x1="2" y1="12" x2="22" y2="12" />
      </svg>
    ),
    color: "#f59e0b",
  },
  {
    id: "briefing",
    name: "Briefing",
    description: "Executive summary with action items",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    color: "#06b6d4",
  },
  {
    id: "timeline",
    name: "Timeline",
    description: "Chronological event visualization",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="20" x2="12" y2="4" />
        <polyline points="6 10 12 4 18 10" />
        <circle cx="12" cy="12" r="2" />
        <circle cx="12" cy="20" r="2" />
      </svg>
    ),
    color: "#ec4899",
  },
  {
    id: "concept-map",
    name: "Concept Map",
    description: "Visual relationship mapping",
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="5" cy="5" r="2" />
        <circle cx="5" cy="19" r="2" />
        <circle cx="19" cy="19" r="2" />
        <line x1="12" y1="9" x2="12" y2="5" />
        <line x1="9.5" y1="13.5" x2="6" y2="17" />
        <line x1="14.5" y1="13.5" x2="18" y2="17" />
      </svg>
    ),
    color: "#3b82f6",
  },
];

export function StudyToolsPanel({ isOpen, onClose }: StudyToolsPanelProps) {
  const {
    activeTool,
    setActiveTool,
    isGenerating,
    error,
    studyGuide,
    faq,
    briefing,
    timeline,
    conceptGraph,
    generateStudyGuide,
    generateFaq,
    generateBriefing,
    extractTimeline,
    extractConcepts,
    clearStudyGuide,
    clearFaq,
    clearBriefing,
    clearTimeline,
    clearConceptGraph,
  } = useStudyToolsStore();

  const { pages, selectedPageId } = usePageStore();
  const { selectedNotebookId } = useNotebookStore();

  const [showPageSelector, setShowPageSelector] = useState(false);
  const [selectedPages, setSelectedPages] = useState<StudyPageContent[]>([]);
  const [showInfographicGenerator, setShowInfographicGenerator] = useState(false);
  const [showVideoGenerator, setShowVideoGenerator] = useState(false);

  // Initialize with current page if available
  useEffect(() => {
    if (isOpen && selectedPageId && pages.length > 0) {
      const currentPage = pages.find((p) => p.id === selectedPageId);
      if (currentPage) {
        const content = extractPageContent(currentPage);
        setSelectedPages([{
          pageId: currentPage.id,
          title: currentPage.title,
          content,
          tags: currentPage.tags || [],
        }]);
      }
    }
  }, [isOpen, selectedPageId, pages]);

  const handleSelectPages = useCallback((pages: StudyPageContent[]) => {
    setSelectedPages(pages);
    setShowPageSelector(false);
  }, []);

  const handleNavigateToPage = useCallback((pageId: string) => {
    // This would navigate to the page - implement based on your navigation system
    console.log("Navigate to page:", pageId);
  }, []);

  if (!isOpen) return null;

  const currentTool = STUDY_TOOLS.find((t) => t.id === activeTool);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={onClose}
      >
        <div
          className="flex h-[85vh] w-full max-w-4xl flex-col rounded-xl border shadow-2xl"
          style={{
            backgroundColor: "var(--color-bg-primary)",
            borderColor: "var(--color-border)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between border-b px-6 py-4"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="flex items-center gap-3">
              {activeTool && (
                <button
                  onClick={() => setActiveTool(null)}
                  className="p-1 rounded hover:bg-[--color-bg-tertiary]"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              )}
              <div>
                <h2
                  className="text-lg font-semibold"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {activeTool ? currentTool?.name : "Study Tools"}
                </h2>
                <p
                  className="text-sm"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {activeTool
                    ? currentTool?.description
                    : "AI-powered tools to enhance your learning"}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-2 transition-colors hover:bg-[--color-bg-tertiary]"
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
                style={{ color: "var(--color-text-muted)" }}
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {!activeTool ? (
              // Tool selection grid
              <div className="p-6">
                {/* Page selection info */}
                <div
                  className="mb-6 p-4 rounded-lg border flex items-center justify-between"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderColor: "var(--color-border)",
                  }}
                >
                  <div>
                    <div
                      className="text-sm font-medium"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {selectedPages.length > 0
                        ? `${selectedPages.length} page${selectedPages.length !== 1 ? "s" : ""} selected`
                        : "No pages selected"}
                    </div>
                    {selectedPages.length > 0 && (
                      <div
                        className="text-xs mt-1"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {selectedPages.map((p) => p.title).join(", ")}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => setShowPageSelector(true)}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:opacity-90"
                    style={{
                      backgroundColor: "var(--color-accent)",
                      color: "white",
                    }}
                  >
                    {selectedPages.length > 0 ? "Change" : "Select Pages"}
                  </button>
                </div>

                {/* Tools grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {STUDY_TOOLS.map((tool) => (
                    <button
                      key={tool.id}
                      onClick={() => setActiveTool(tool.id)}
                      disabled={selectedPages.length === 0}
                      className="p-4 rounded-xl border text-left transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed hover:border-[--color-accent]"
                      style={{
                        backgroundColor: "var(--color-bg-secondary)",
                        borderColor: "var(--color-border)",
                      }}
                    >
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                        style={{
                          backgroundColor: `${tool.color}20`,
                          color: tool.color,
                        }}
                      >
                        {tool.icon}
                      </div>
                      <div
                        className="font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        {tool.name}
                      </div>
                      <div
                        className="text-sm mt-1"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {tool.description}
                      </div>
                    </button>
                  ))}
                </div>

                {/* Media Generation Section */}
                <div className="mt-8 pt-6 border-t" style={{ borderColor: "var(--color-border)" }}>
                  <h3
                    className="text-sm font-semibold mb-4"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    Media Generation
                  </h3>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Infographic Button */}
                    <button
                      onClick={() => setShowInfographicGenerator(true)}
                      disabled={!studyGuide && !briefing && !timeline && !conceptGraph}
                      className="p-4 rounded-xl border text-left transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed hover:border-[--color-accent]"
                      style={{
                        backgroundColor: "var(--color-bg-secondary)",
                        borderColor: "var(--color-border)",
                      }}
                    >
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                        style={{
                          backgroundColor: "#e11d4820",
                          color: "#e11d48",
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                      </div>
                      <div
                        className="font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        Infographic
                      </div>
                      <div
                        className="text-sm mt-1"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        Visual summaries (SVG/PNG)
                      </div>
                    </button>

                    {/* Video Button */}
                    <button
                      onClick={() => setShowVideoGenerator(true)}
                      disabled={!studyGuide && !briefing}
                      className="p-4 rounded-xl border text-left transition-all hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed hover:border-[--color-accent]"
                      style={{
                        backgroundColor: "var(--color-bg-secondary)",
                        borderColor: "var(--color-border)",
                      }}
                    >
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center mb-3"
                        style={{
                          backgroundColor: "#7c3aed20",
                          color: "#7c3aed",
                        }}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7" />
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        </svg>
                      </div>
                      <div
                        className="font-medium"
                        style={{ color: "var(--color-text-primary)" }}
                      >
                        Video
                      </div>
                      <div
                        className="text-sm mt-1"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        Narrated presentation
                      </div>
                    </button>
                  </div>
                  <p
                    className="text-xs mt-3"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Generate study content first using the tools above, then create media from it.
                  </p>
                </div>
              </div>
            ) : (
              // Active tool panel
              <div className="p-6">
                {/* Page info bar */}
                <div
                  className="mb-4 p-3 rounded-lg flex items-center justify-between"
                  style={{ backgroundColor: "var(--color-bg-secondary)" }}
                >
                  <span
                    className="text-sm"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    Using {selectedPages.length} page{selectedPages.length !== 1 ? "s" : ""}:
                    <span className="font-medium ml-1">
                      {selectedPages.map((p) => p.title).join(", ")}
                    </span>
                  </span>
                  <button
                    onClick={() => setShowPageSelector(true)}
                    className="text-sm hover:underline"
                    style={{ color: "var(--color-accent)" }}
                  >
                    Change
                  </button>
                </div>

                {/* Tool-specific content */}
                {activeTool === "study-guide" && (
                  <StudyGuidePanel
                    studyGuide={studyGuide}
                    isGenerating={isGenerating}
                    error={error}
                    onGenerate={generateStudyGuide}
                    onClear={clearStudyGuide}
                    pages={selectedPages}
                  />
                )}

                {activeTool === "faq" && (
                  <FAQPanel
                    faq={faq}
                    isGenerating={isGenerating}
                    error={error}
                    onGenerate={generateFaq}
                    onClear={clearFaq}
                    pages={selectedPages}
                    onNavigateToPage={handleNavigateToPage}
                  />
                )}

                {activeTool === "flashcards" && (
                  <div
                    className="text-center py-12"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    <p>Flashcard generation is available in the Flashcards panel.</p>
                    <p className="text-sm mt-2">
                      Open the Flashcards panel and click the AI button on a deck.
                    </p>
                  </div>
                )}

                {activeTool === "briefing" && (
                  <BriefingPanel
                    briefing={briefing}
                    isGenerating={isGenerating}
                    error={error}
                    onGenerate={generateBriefing}
                    onClear={clearBriefing}
                    pages={selectedPages}
                  />
                )}

                {activeTool === "timeline" && (
                  <TimelinePanel
                    timeline={timeline}
                    isGenerating={isGenerating}
                    error={error}
                    onGenerate={extractTimeline}
                    onClear={clearTimeline}
                    pages={selectedPages}
                    onNavigateToPage={handleNavigateToPage}
                  />
                )}

                {activeTool === "concept-map" && (
                  <ConceptMapPanel
                    conceptGraph={conceptGraph}
                    isGenerating={isGenerating}
                    error={error}
                    onGenerate={extractConcepts}
                    onClear={clearConceptGraph}
                    pages={selectedPages}
                  />
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="border-t px-6 py-3 text-center text-xs"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
            }}
          >
            Press{" "}
            <kbd
              className="rounded px-1"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              Esc
            </kbd>{" "}
            to close
          </div>
        </div>
      </div>

      {/* Page selector dialog */}
      <PageSelector
        isOpen={showPageSelector}
        onClose={() => setShowPageSelector(false)}
        onSelect={handleSelectPages}
        title="Select Pages"
        description="Choose pages to use for content generation"
      />

      {/* Infographic generator dialog */}
      {selectedNotebookId && (
        <InfographicGenerator
          isOpen={showInfographicGenerator}
          onClose={() => setShowInfographicGenerator(false)}
          notebookId={selectedNotebookId}
        />
      )}

      {/* Video generator dialog */}
      {selectedNotebookId && (
        <VideoGeneratorDialog
          isOpen={showVideoGenerator}
          onClose={() => setShowVideoGenerator(false)}
          notebookId={selectedNotebookId}
        />
      )}
    </>
  );
}

// Helper to extract plain text from Editor.js content
function extractPageContent(page: { content?: { blocks?: Array<{ type?: string; data?: { text?: string; items?: string[] } }> } }): string {
  if (!page.content?.blocks) return "";

  return page.content.blocks
    .map((block) => {
      if (block.data?.text) {
        return block.data.text.replace(/<[^>]*>/g, "");
      }
      if (block.data?.items) {
        return block.data.items.join("\n");
      }
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

// Timeline panel with D3.js visualization
function TimelinePanel({
  timeline,
  isGenerating,
  error,
  onGenerate,
  onClear,
  pages,
  onNavigateToPage,
}: {
  timeline: any;
  isGenerating: boolean;
  error: string | null;
  onGenerate: (pages: StudyPageContent[]) => Promise<any>;
  onClear: () => void;
  pages: StudyPageContent[];
  onNavigateToPage?: (pageId: string) => void;
}) {
  if (!timeline) {
    return (
      <div className="space-y-4">
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          Extract a chronological timeline of events from your pages. The AI will identify dates and create an interactive visual timeline.
        </p>

        {error && (
          <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }}>
            {error}
          </div>
        )}

        <button
          onClick={() => onGenerate(pages)}
          disabled={isGenerating || pages.length === 0}
          className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          {isGenerating ? "Extracting..." : `Extract Timeline from ${pages.length} page${pages.length !== 1 ? "s" : ""}`}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
          {timeline.title || "Timeline"} ({timeline.events?.length || 0} events)
        </h3>
        <button onClick={onClear} className="text-sm hover:underline" style={{ color: "var(--color-text-muted)" }}>
          Generate new
        </button>
      </div>

      <TimelineView
        timeline={timeline}
        onNavigateToPage={onNavigateToPage}
      />
    </div>
  );
}

// Concept map panel with D3.js force-directed visualization
function ConceptMapPanel({
  conceptGraph,
  isGenerating,
  error,
  onGenerate,
  onClear,
  pages,
}: {
  conceptGraph: any;
  isGenerating: boolean;
  error: string | null;
  onGenerate: (pages: StudyPageContent[], maxNodes?: number) => Promise<any>;
  onClear: () => void;
  pages: StudyPageContent[];
}) {
  const [maxNodes, setMaxNodes] = useState(30);

  if (!conceptGraph) {
    return (
      <div className="space-y-4">
        <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
          Extract key concepts and their relationships from your pages. Creates an interactive visual map of how ideas connect.
        </p>

        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: "var(--color-text-primary)" }}>
            Maximum concepts
          </label>
          <input
            type="range"
            min={10}
            max={50}
            value={maxNodes}
            onChange={(e) => setMaxNodes(parseInt(e.target.value))}
            className="w-full"
          />
          <div className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
            {maxNodes} concepts
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg text-sm" style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }}>
            {error}
          </div>
        )}

        <button
          onClick={() => onGenerate(pages, maxNodes)}
          disabled={isGenerating || pages.length === 0}
          className="w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: "var(--color-accent)" }}
        >
          {isGenerating ? "Extracting..." : `Extract Concepts from ${pages.length} page${pages.length !== 1 ? "s" : ""}`}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
          Concept Map ({conceptGraph.nodes?.length || 0} concepts, {conceptGraph.links?.length || 0} connections)
        </h3>
        <button onClick={onClear} className="text-sm hover:underline" style={{ color: "var(--color-text-muted)" }}>
          Generate new
        </button>
      </div>

      <div className="h-[400px]">
        <ConceptMapView conceptGraph={conceptGraph} />
      </div>
    </div>
  );
}
