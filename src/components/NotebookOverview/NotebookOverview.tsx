import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Notebook } from "../../types/notebook";
import type { Page } from "../../types/page";
import { NotebookCard } from "./NotebookCard";
import * as api from "../../utils/api";

interface NotebookWithMeta {
  notebook: Notebook;
  coverPage: Page | null;
  pageCount: number;
}

interface NotebookOverviewProps {
  notebooks: Notebook[];
  onSelectNotebook: (id: string) => void;
  onCreateNotebook: () => void;
}

export function NotebookOverview({
  notebooks,
  onSelectNotebook,
  onCreateNotebook,
}: NotebookOverviewProps) {
  const [notebooksWithMeta, setNotebooksWithMeta] = useState<NotebookWithMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter notebooks based on search query
  const filteredNotebooks = useMemo(() => {
    if (!searchQuery.trim()) return notebooksWithMeta;
    const query = searchQuery.toLowerCase();
    return notebooksWithMeta.filter(({ notebook }) =>
      notebook.name.toLowerCase().includes(query)
    );
  }, [notebooksWithMeta, searchQuery]);

  // Keyboard shortcut to focus search (Cmd/Ctrl + F)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      // Clear search on Escape
      if (e.key === "Escape" && searchQuery) {
        setSearchQuery("");
        searchInputRef.current?.blur();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [searchQuery]);

  // Load cover pages and page counts for all notebooks
  useEffect(() => {
    let cancelled = false;

    async function loadNotebookMeta() {
      setIsLoading(true);
      const results: NotebookWithMeta[] = [];

      for (const notebook of notebooks) {
        try {
          const [coverPage, pages] = await Promise.all([
            api.getCoverPage(notebook.id),
            api.listPages(notebook.id),
          ]);
          if (!cancelled) {
            results.push({
              notebook,
              coverPage,
              pageCount: pages.filter((p) => !p.isCover).length,
            });
          }
        } catch (error) {
          if (!cancelled) {
            results.push({
              notebook,
              coverPage: null,
              pageCount: 0,
            });
          }
        }
      }

      if (!cancelled) {
        setNotebooksWithMeta(results);
        setIsLoading(false);
      }
    }

    loadNotebookMeta();

    return () => {
      cancelled = true;
    };
  }, [notebooks]);

  const handleCreateNotebook = useCallback(() => {
    onCreateNotebook();
  }, [onCreateNotebook]);

  return (
    <div
      className="flex h-full flex-col"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between border-b px-8 py-6"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{ backgroundColor: "var(--color-accent)" }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
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
          <div>
            <h1
              className="text-2xl font-bold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Katt
            </h1>
            <p
              className="text-sm"
              style={{ color: "var(--color-text-muted)" }}
            >
              Your notebooks
            </p>
          </div>
        </div>
        <button
          onClick={handleCreateNotebook}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90"
          style={{ backgroundColor: "var(--color-accent)" }}
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
          New Notebook
        </button>
      </header>

      {/* Notebook grid */}
      <div className="flex-1 overflow-y-auto p-8">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <div
              className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--color-accent)", borderTopColor: "transparent" }}
            />
          </div>
        ) : notebooks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center">
            <div
              className="mb-6 flex h-24 w-24 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--color-text-muted)" }}
              >
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
              </svg>
            </div>
            <h2
              className="mb-2 text-xl font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              No notebooks yet
            </h2>
            <p
              className="mb-6 text-center"
              style={{ color: "var(--color-text-muted)" }}
            >
              Create your first notebook to start capturing ideas
            </p>
            <button
              onClick={handleCreateNotebook}
              className="flex items-center gap-2 rounded-lg px-6 py-3 font-medium text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: "var(--color-accent)" }}
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
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Create Notebook
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-6">
            {notebooksWithMeta.map(({ notebook, coverPage, pageCount }) => (
              <NotebookCard
                key={notebook.id}
                notebook={notebook}
                coverPage={coverPage}
                pageCount={pageCount}
                onClick={() => onSelectNotebook(notebook.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
