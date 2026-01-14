import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Notebook } from "../../types/notebook";
import type { Page } from "../../types/page";
import { NotebookCard } from "./NotebookCard";
import { NotebookSettingsDialog } from "../NotebookSettings";
import { useThemeStore, type NotebookSortOption } from "../../stores/themeStore";
import * as api from "../../utils/api";

const SORT_OPTIONS: { value: NotebookSortOption; label: string }[] = [
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "updated", label: "Recently updated" },
  { value: "created", label: "Recently created" },
  { value: "pages", label: "Most pages" },
];

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
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [settingsNotebook, setSettingsNotebook] = useState<Notebook | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Get persisted sort preference from store
  const { notebookSortBy: sortBy, setNotebookSortBy: setSortBy } = useThemeStore();

  // Close sort menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(event.target as Node)) {
        setShowSortMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Filter and sort notebooks
  const filteredNotebooks = useMemo(() => {
    let result = notebooksWithMeta;

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(({ notebook }) =>
        notebook.name.toLowerCase().includes(query)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "name-asc":
          return a.notebook.name.localeCompare(b.notebook.name);
        case "name-desc":
          return b.notebook.name.localeCompare(a.notebook.name);
        case "updated":
          return new Date(b.notebook.updatedAt).getTime() - new Date(a.notebook.updatedAt).getTime();
        case "created":
          return new Date(b.notebook.createdAt).getTime() - new Date(a.notebook.createdAt).getTime();
        case "pages":
          return b.pageCount - a.pageCount;
        default:
          return 0;
      }
    });

    return result;
  }, [notebooksWithMeta, searchQuery, sortBy]);

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

        {/* Search and actions */}
        <div className="flex items-center gap-4">
          {/* Search input */}
          <div className="relative">
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
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--color-text-muted)" }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search notebooks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 rounded-lg border py-2 pl-10 pr-10 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-[--color-accent]"
              style={{
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
                color: "var(--color-text-primary)",
              }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 transition-colors hover:bg-[--color-bg-tertiary]"
                style={{ color: "var(--color-text-muted)" }}
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
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>

          {/* Sort dropdown */}
          <div ref={sortMenuRef} className="relative">
            <button
              onClick={() => setShowSortMenu(!showSortMenu)}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
              style={{
                borderColor: "var(--color-border)",
                color: "var(--color-text-secondary)",
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
                <path d="M11 5h10" />
                <path d="M11 9h7" />
                <path d="M11 13h4" />
                <path d="M3 17l3 3 3-3" />
                <path d="M6 18V4" />
              </svg>
              {SORT_OPTIONS.find((o) => o.value === sortBy)?.label}
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
                className={`transition-transform ${showSortMenu ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {showSortMenu && (
              <div
                className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border shadow-lg"
                style={{
                  backgroundColor: "var(--color-bg-secondary)",
                  borderColor: "var(--color-border)",
                }}
              >
                {SORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => {
                      setSortBy(option.value);
                      setShowSortMenu(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{
                      color: sortBy === option.value ? "var(--color-accent)" : "var(--color-text-primary)",
                      backgroundColor: sortBy === option.value ? "var(--color-bg-tertiary)" : undefined,
                    }}
                  >
                    {option.label}
                    {sortBy === option.value && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* New Notebook button */}
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

          {/* Global Settings button */}
          <button
            onClick={() => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: ",",
                  metaKey: true,
                  bubbles: true,
                })
              );
            }}
            className="flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Settings (Cmd+,)"
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
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
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
        ) : filteredNotebooks.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center">
            <div
              className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl"
              style={{ backgroundColor: "var(--color-bg-tertiary)" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--color-text-muted)" }}
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <h2
              className="mb-2 text-lg font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              No notebooks found
            </h2>
            <p
              className="mb-4 text-center"
              style={{ color: "var(--color-text-muted)" }}
            >
              No notebooks match "{searchQuery}"
            </p>
            <button
              onClick={() => setSearchQuery("")}
              className="rounded-lg px-4 py-2 text-sm font-medium transition-colors hover:bg-[--color-bg-tertiary]"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Clear search
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-6">
            {filteredNotebooks.map(({ notebook, coverPage, pageCount }) => (
              <NotebookCard
                key={notebook.id}
                notebook={notebook}
                coverPage={coverPage}
                pageCount={pageCount}
                onClick={() => onSelectNotebook(notebook.id)}
                onSettings={() => setSettingsNotebook(notebook)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Notebook Settings Dialog */}
      <NotebookSettingsDialog
        isOpen={settingsNotebook !== null}
        notebook={settingsNotebook}
        onClose={() => setSettingsNotebook(null)}
      />
    </div>
  );
}
