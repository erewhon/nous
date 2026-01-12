import { useNotebookStore } from "../../stores/notebookStore";
import { NotebookList } from "../NotebookList/NotebookList";

export function Sidebar() {
  const { notebooks, selectedNotebookId, createNotebook } = useNotebookStore();

  return (
    <aside
      className="flex h-full w-64 flex-col border-r"
      style={{
        backgroundColor: "var(--color-bg-sidebar)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-5">
        <div className="flex items-center gap-2">
          <div
            className="flex h-7 w-7 items-center justify-center rounded-md"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
          </div>
          <span
            className="text-base font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Katt
          </span>
        </div>
        <button
          onClick={() => createNotebook("New Notebook")}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
          style={{ color: "var(--color-text-muted)" }}
          title="Create notebook"
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

      {/* Search */}
      <div className="px-4 pb-4">
        <button
          className="flex w-full items-center gap-2 rounded-md border text-left text-sm px-3 py-2"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
          onClick={() => {
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
          <span>Search...</span>
          <kbd
            className="ml-auto text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Section label */}
      <div className="px-5 py-3">
        <span
          className="text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--color-text-muted)" }}
        >
          Notebooks
        </span>
      </div>

      {/* Notebook List */}
      <div className="flex-1 overflow-y-auto px-3">
        <NotebookList
          notebooks={notebooks}
          selectedNotebookId={selectedNotebookId}
        />
      </div>

      {/* Footer */}
      <div
        className="border-t px-5 py-4"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            {notebooks.length} notebook{notebooks.length !== 1 ? "s" : ""}
          </span>
          <div className="flex items-center gap-1">
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
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              style={{ color: "var(--color-text-muted)" }}
              title="AI Chat"
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
              </svg>
            </button>
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
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              style={{ color: "var(--color-text-muted)" }}
              title="Graph View"
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
          </div>
        </div>
      </div>
    </aside>
  );
}
