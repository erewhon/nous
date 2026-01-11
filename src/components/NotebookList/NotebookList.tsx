import type { Notebook } from "../../types/notebook";
import { useNotebookStore } from "../../stores/notebookStore";

interface NotebookListProps {
  notebooks: Notebook[];
  selectedNotebookId: string | null;
}

export function NotebookList({
  notebooks,
  selectedNotebookId,
}: NotebookListProps) {
  const { selectNotebook } = useNotebookStore();

  if (notebooks.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[--color-text-muted]">
        No notebooks yet
      </div>
    );
  }

  return (
    <ul className="space-y-1">
      {notebooks.map((notebook) => (
        <li key={notebook.id}>
          <button
            onClick={() => selectNotebook(notebook.id)}
            className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors ${
              selectedNotebookId === notebook.id
                ? "bg-[--color-accent] text-white"
                : "text-[--color-text-secondary] hover:bg-[--color-bg-tertiary]"
            }`}
          >
            <NotebookIcon type={notebook.type} />
            <span className="truncate">{notebook.name}</span>
          </button>
        </li>
      ))}
    </ul>
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
