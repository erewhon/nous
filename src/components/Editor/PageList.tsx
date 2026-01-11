import type { Page } from "../../types/page";
import { usePageStore } from "../../stores/pageStore";

interface PageListProps {
  pages: Page[];
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  notebookId: string;
}

export function PageList({
  pages,
  selectedPageId,
  onSelectPage,
  notebookId,
}: PageListProps) {
  const { createPage } = usePageStore();

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[--color-border] px-3 py-2">
        <span className="text-sm font-medium text-[--color-text-secondary]">
          Pages
        </span>
        <button
          onClick={() => createPage(notebookId, "Untitled")}
          className="rounded p-1 text-[--color-text-muted] transition-colors hover:bg-[--color-bg-tertiary] hover:text-[--color-text-primary]"
          title="Create page"
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
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* Page list */}
      <div className="flex-1 overflow-y-auto p-2">
        {pages.length === 0 ? (
          <div className="flex h-20 items-center justify-center text-xs text-[--color-text-muted]">
            No pages yet
          </div>
        ) : (
          <ul className="space-y-1">
            {pages.map((page) => (
              <li key={page.id}>
                <button
                  onClick={() => onSelectPage(page.id)}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
                    selectedPageId === page.id
                      ? "bg-[--color-bg-tertiary] text-[--color-text-primary]"
                      : "text-[--color-text-secondary] hover:bg-[--color-bg-tertiary]/50"
                  }`}
                >
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
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14,2 14,8 20,8" />
                  </svg>
                  <span className="truncate">{page.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
