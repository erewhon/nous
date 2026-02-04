import { useState, useEffect, useCallback, useRef } from "react";
import type { Page } from "../../types/page";
import type { StudyPageContent } from "../../types/studyTools";
import { useStudyToolsStore } from "../../stores/studyToolsStore";

interface PageContextMenuProps {
  page: Page;
  position: { x: number; y: number };
  onClose: () => void;
  onOpenStudyTools: (pages: StudyPageContent[]) => void;
}

// Helper to extract plain text from Editor.js content
function extractPageContent(page: Page): string {
  if (!page.content?.blocks) return "";

  return page.content.blocks
    .map((block: { type?: string; data?: { text?: string; items?: string[] } }) => {
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

export function PageContextMenu({
  page,
  position,
  onClose,
  onOpenStudyTools,
}: PageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const { setActiveTool } = useStudyToolsStore();

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Adjust position to stay on screen
  const [adjustedPosition, setAdjustedPosition] = useState(position);

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let x = position.x;
      let y = position.y;

      if (position.x + rect.width > viewportWidth) {
        x = viewportWidth - rect.width - 8;
      }
      if (position.y + rect.height > viewportHeight) {
        y = viewportHeight - rect.height - 8;
      }

      setAdjustedPosition({ x, y });
    }
  }, [position]);

  const handleOpenStudyTool = useCallback(
    (tool: "study-guide" | "faq" | "flashcards" | "briefing" | "timeline" | "concept-map") => {
      const pageContent: StudyPageContent = {
        pageId: page.id,
        title: page.title,
        content: extractPageContent(page),
        tags: page.tags || [],
      };
      setActiveTool(tool);
      onOpenStudyTools([pageContent]);
      onClose();
    },
    [page, setActiveTool, onOpenStudyTools, onClose]
  );

  const menuItems = [
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
      ),
      label: "Generate Study Guide",
      action: () => handleOpenStudyTool("study-guide"),
      color: "#10b981",
    },
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </svg>
      ),
      label: "Generate FAQ",
      action: () => handleOpenStudyTool("faq"),
      color: "#8b5cf6",
    },
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <line x1="2" y1="12" x2="22" y2="12" />
        </svg>
      ),
      label: "Generate Flashcards",
      action: () => handleOpenStudyTool("flashcards"),
      color: "#f59e0b",
    },
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
      label: "Generate Briefing",
      action: () => handleOpenStudyTool("briefing"),
      color: "#06b6d4",
    },
    { type: "divider" as const },
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="20" x2="12" y2="4" />
          <polyline points="6 10 12 4 18 10" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="20" r="2" />
        </svg>
      ),
      label: "Extract Timeline",
      action: () => handleOpenStudyTool("timeline"),
      color: "#ec4899",
    },
    {
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
      label: "Extract Concepts",
      action: () => handleOpenStudyTool("concept-map"),
      color: "#3b82f6",
    },
  ];

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] rounded-lg border shadow-xl py-1"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        backgroundColor: "var(--color-bg-primary)",
        borderColor: "var(--color-border)",
      }}
    >
      <div
        className="px-3 py-1.5 text-xs font-medium"
        style={{ color: "var(--color-text-muted)" }}
      >
        Study Tools
      </div>
      {menuItems.map((item, index) =>
        "type" in item && item.type === "divider" ? (
          <div
            key={`divider-${index}`}
            className="my-1 h-px"
            style={{ backgroundColor: "var(--color-border)" }}
          />
        ) : (
          <button
            key={item.label}
            onClick={item.action}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-[--color-bg-tertiary] transition-colors"
            style={{ color: "var(--color-text-primary)" }}
          >
            <span style={{ color: item.color }}>{item.icon}</span>
            {item.label}
          </button>
        )
      )}
    </div>
  );
}
