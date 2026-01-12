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
      <div className="flex items-center justify-between p-5">
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-text-muted)" }}
        >
          Pages
        </span>
        <button
          onClick={() => createPage(notebookId, "Untitled")}
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
          style={{ color: "var(--color-text-muted)" }}
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
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {pages.length === 0 ? (
          <div
            className="flex h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center"
            style={{ borderColor: "var(--color-border)" }}
          >
            <div className="text-xl opacity-50">📄</div>
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              No pages yet
            </span>
          </div>
        ) : (
          <ul className="space-y-1">
            {pages.map((page) => {
              const isSelected = selectedPageId === page.id;
              return (
                <li key={page.id}>
                  <button
                    onClick={() => onSelectPage(page.id)}
                    className="flex w-full items-center gap-3 rounded-lg text-left transition-all p-3"
                    style={{
                      backgroundColor: isSelected ? "var(--color-bg-tertiary)" : "transparent",
                      color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                      borderLeft: `3px solid ${isSelected ? "var(--color-accent)" : "transparent"}`,
                    }}
                  >
                    <div
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{
                        backgroundColor: isSelected
                          ? "rgba(139, 92, 246, 0.2)"
                          : "var(--color-bg-tertiary)",
                        color: isSelected ? "var(--color-accent)" : "var(--color-text-muted)",
                      }}
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
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {page.title}
                      </span>
                      {page.tags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {page.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full text-xs px-2 py-0.5"
                              style={{
                                backgroundColor: "rgba(139, 92, 246, 0.1)",
                                color: "var(--color-accent)",
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                          {page.tags.length > 2 && (
                            <span
                              className="text-xs"
                              style={{ color: "var(--color-text-muted)" }}
                            >
                              +{page.tags.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
