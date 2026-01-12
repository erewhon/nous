import { useNotebookStore } from "../../stores/notebookStore";
import { NotebookList } from "../NotebookList/NotebookList";

export function Sidebar() {
  const { notebooks, selectedNotebookId, createNotebook } = useNotebookStore();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-[--color-border] bg-[--color-bg-secondary]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[--color-border] px-4 py-3">
        <h1 className="text-lg font-semibold text-[--color-text-primary]">
          Katt
        </h1>
        <div className="flex items-center gap-1">
          {/* Create notebook button */}
          <button
            onClick={() => createNotebook("New Notebook")}
            className="rounded p-1 text-[--color-text-muted] transition-colors hover:bg-[--color-bg-tertiary] hover:text-[--color-text-primary]"
            title="Create notebook (⌘⇧N)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
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
      </div>

      {/* Quick actions hint */}
      <div className="border-b border-[--color-border] px-4 py-2">
        <button
          className="flex w-full items-center gap-2 rounded bg-[--color-bg-tertiary]/50 px-3 py-1.5 text-left text-sm text-[--color-text-muted] transition-colors hover:bg-[--color-bg-tertiary]"
          onClick={() => {
            // Dispatch keyboard event to trigger command palette
            window.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "k",
                metaKey: true,
                bubbles: true,
              })
            );
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
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <span>Quick search...</span>
          <kbd className="ml-auto rounded bg-[--color-bg-secondary] px-1.5 py-0.5 text-xs">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Notebook List */}
      <div className="flex-1 overflow-y-auto p-2">
        <NotebookList
          notebooks={notebooks}
          selectedNotebookId={selectedNotebookId}
        />
      </div>

      {/* Footer */}
      <div className="border-t border-[--color-border] px-4 py-2">
        <div className="flex items-center justify-between text-xs text-[--color-text-muted]">
          <span>
            {notebooks.length} notebook{notebooks.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-2">
            <span title="Open AI Chat (⌘⇧A)">
              <button
                onClick={() => {
                  window.dispatchEvent(
                    new KeyboardEvent("keydown", {
                      key: "A",
                      metaKey: true,
                      shiftKey: true,
                      bubbles: true,
                    })
                  );
                }}
                className="rounded p-1 transition-colors hover:bg-[--color-bg-tertiary] hover:text-[--color-text-primary]"
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
                  <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
                  <path d="M19 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
                </svg>
              </button>
            </span>
            <span title="Open Graph (⌘G)">
              <button
                onClick={() => {
                  window.dispatchEvent(
                    new KeyboardEvent("keydown", {
                      key: "g",
                      metaKey: true,
                      bubbles: true,
                    })
                  );
                }}
                className="rounded p-1 transition-colors hover:bg-[--color-bg-tertiary] hover:text-[--color-text-primary]"
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
                  <circle cx="12" cy="12" r="3" />
                  <circle cx="19" cy="5" r="2" />
                  <circle cx="5" cy="19" r="2" />
                  <line x1="14.5" y1="9.5" x2="17.5" y2="6.5" />
                  <line x1="9.5" y1="14.5" x2="6.5" y2="17.5" />
                </svg>
              </button>
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
