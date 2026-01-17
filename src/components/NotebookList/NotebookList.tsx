import { useState } from "react";
import type { Notebook } from "../../types/notebook";
import { useNotebookStore } from "../../stores/notebookStore";
import { NotebookSettingsDialog } from "../NotebookSettings";

interface NotebookListProps {
  notebooks: Notebook[];
  selectedNotebookId: string | null;
}

export function NotebookList({
  notebooks,
  selectedNotebookId,
}: NotebookListProps) {
  const { selectNotebook } = useNotebookStore();
  const [settingsNotebook, setSettingsNotebook] = useState<Notebook | null>(null);
  const [hoveredNotebookId, setHoveredNotebookId] = useState<string | null>(null);

  if (notebooks.length === 0) {
    return (
      <div
        className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="text-2xl opacity-50">📓</div>
        <span className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          No notebooks yet
        </span>
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          Create one to get started
        </span>
      </div>
    );
  }

  return (
    <>
      <ul className="space-y-1">
        {notebooks.map((notebook) => {
          const isSelected = selectedNotebookId === notebook.id;
          const isHovered = hoveredNotebookId === notebook.id;
          return (
            <li
              key={notebook.id}
              onMouseEnter={() => setHoveredNotebookId(notebook.id)}
              onMouseLeave={() => setHoveredNotebookId(null)}
            >
              <div
                className="relative flex w-full items-center gap-3 rounded-lg text-left transition-all p-3"
                style={{
                  backgroundColor: isSelected ? "var(--color-bg-tertiary)" : "transparent",
                  color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  borderLeft: `3px solid ${
                    isSelected
                      ? notebook.color || "var(--color-accent)"
                      : notebook.color
                        ? `${notebook.color}40`
                        : "transparent"
                  }`,
                }}
              >
                <button
                  onClick={() => selectNotebook(notebook.id)}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <div
                    className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: notebook.color
                        ? notebook.color
                        : isSelected
                          ? "var(--color-accent)"
                          : "var(--color-bg-tertiary)",
                      color: notebook.color || isSelected ? "white" : "var(--color-text-muted)",
                    }}
                  >
                    <NotebookIcon type={notebook.type} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="block truncate font-medium">{notebook.name}</span>
                      {notebook.archived && (
                        <span
                          title="Archived"
                          className="flex h-4 w-4 items-center justify-center"
                          style={{ color: "var(--color-text-muted)" }}
                        >
                          <IconArchive />
                        </span>
                      )}
                      {notebook.systemPrompt && (
                        <span
                          title="Has custom AI prompt"
                          className="flex h-4 w-4 items-center justify-center"
                          style={{ color: "var(--color-accent)" }}
                        >
                          <IconPrompt />
                        </span>
                      )}
                    </div>
                    <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                      {notebook.type === "zettelkasten" ? "Zettelkasten" : "Notebook"}
                    </span>
                  </div>
                </button>
                {/* Settings button - visible on hover */}
                {(isHovered || isSelected) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSettingsNotebook(notebook);
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-secondary]"
                    style={{ color: "var(--color-text-muted)" }}
                    title="Notebook settings"
                  >
                    <IconSettings />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Notebook Settings Dialog */}
      <NotebookSettingsDialog
        isOpen={settingsNotebook !== null}
        notebook={settingsNotebook}
        onClose={() => setSettingsNotebook(null)}
      />
    </>
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
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function IconPrompt() {
  return (
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
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconArchive() {
  return (
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
      <rect x="2" y="4" width="20" height="5" rx="2" />
      <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
      <path d="M10 13h4" />
    </svg>
  );
}

function NotebookIcon({ type }: { type: Notebook["type"] }) {
  if (type === "zettelkasten") {
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
        <circle cx="12" cy="12" r="3" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="5" cy="19" r="2" />
        <line x1="14.5" y1="9.5" x2="17.5" y2="6.5" />
        <line x1="9.5" y1="14.5" x2="6.5" y2="17.5" />
      </svg>
    );
  }

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
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}
