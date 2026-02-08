import { useState, useCallback, useEffect } from "react";
import { useStudyToolsStore } from "../../stores/studyToolsStore";
import { usePageStore } from "../../stores/pageStore";
import { useToastStore } from "../../stores/toastStore";
import type { StudyToolType, StudyPageContent } from "../../types/studyTools";

interface QuickGenerateDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const QUICK_TOOLS: Array<{
  id: StudyToolType;
  label: string;
  icon: string;
  description: string;
}> = [
  {
    id: "study-guide",
    label: "Study Guide",
    icon: "📖",
    description: "Structured learning materials",
  },
  {
    id: "faq",
    label: "FAQ",
    icon: "❓",
    description: "Q&A pairs from content",
  },
  {
    id: "briefing",
    label: "Briefing",
    icon: "📋",
    description: "Executive summary",
  },
  {
    id: "timeline",
    label: "Timeline",
    icon: "📅",
    description: "Chronological events",
  },
  {
    id: "concept-map",
    label: "Concept Map",
    icon: "🔗",
    description: "Relationship mapping",
  },
];

// Extract plain text from Editor.js content
function extractPageContent(page: {
  content?: {
    blocks?: Array<{
      type?: string;
      data?: { text?: string; items?: string[] };
    }>;
  };
}): string {
  if (!page.content?.blocks) return "";
  return page.content.blocks
    .map((block) => {
      if (block.data?.text) return block.data.text.replace(/<[^>]*>/g, "");
      if (block.data?.items) return block.data.items.join("\n");
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export function QuickGenerateDialog({
  isOpen,
  onClose,
}: QuickGenerateDialogProps) {
  const [selectedTool, setSelectedTool] = useState<StudyToolType | null>(null);
  const { pages, selectedPageId } = usePageStore();
  const {
    isGenerating,
    generateStudyGuide,
    generateFaq,
    generateBriefing,
    extractTimeline,
    extractConcepts,
    studyGuide,
    faq,
    briefing,
    timeline,
    conceptGraph,
  } = useStudyToolsStore();
  const toast = useToastStore();

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setSelectedTool(null);
    }
  }, [isOpen]);

  const currentPage = pages.find((p) => p.id === selectedPageId);

  const handleGenerate = useCallback(
    async (toolId: StudyToolType) => {
      if (!currentPage) {
        toast.error("No page selected");
        return;
      }

      setSelectedTool(toolId);

      const pageContent: StudyPageContent[] = [
        {
          pageId: currentPage.id,
          title: currentPage.title,
          content: extractPageContent(currentPage),
          tags: currentPage.tags || [],
        },
      ];

      try {
        switch (toolId) {
          case "study-guide":
            await generateStudyGuide(pageContent);
            break;
          case "faq":
            await generateFaq(pageContent);
            break;
          case "briefing":
            await generateBriefing(pageContent);
            break;
          case "timeline":
            await extractTimeline(pageContent);
            break;
          case "concept-map":
            await extractConcepts(pageContent);
            break;
        }
        toast.success(
          `${QUICK_TOOLS.find((t) => t.id === toolId)?.label} generated`
        );
        onClose();
      } catch {
        toast.error("Generation failed");
      }
    },
    [
      currentPage,
      generateStudyGuide,
      generateFaq,
      generateBriefing,
      extractTimeline,
      extractConcepts,
      toast,
      onClose,
    ]
  );

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const hasResult =
    studyGuide || faq || briefing || timeline || conceptGraph;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-4 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2
            className="text-sm font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Quick Generate
          </h2>
          <p
            className="text-xs mt-0.5"
            style={{ color: "var(--color-text-muted)" }}
          >
            {currentPage
              ? `From: ${currentPage.title}`
              : "Select a page first"}
          </p>
        </div>

        {/* Tool buttons */}
        <div className="p-3">
          {!currentPage ? (
            <div
              className="py-6 text-center text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              Open a page to generate study materials
            </div>
          ) : (
            <div className="space-y-1">
              {QUICK_TOOLS.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => handleGenerate(tool.id)}
                  disabled={isGenerating}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[--color-bg-tertiary] disabled:opacity-50"
                >
                  <span className="text-lg">{tool.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-sm font-medium"
                      style={{ color: "var(--color-text-primary)" }}
                    >
                      {tool.label}
                    </div>
                    <div
                      className="text-xs"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      {tool.description}
                    </div>
                  </div>
                  {isGenerating && selectedTool === tool.id && (
                    <div
                      className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                      style={{ color: "var(--color-accent)" }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        {hasResult && (
          <div
            className="px-5 py-3 border-t text-xs text-center"
            style={{
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
            }}
          >
            Open Study Tools panel to view generated content
          </div>
        )}
      </div>
    </div>
  );
}
