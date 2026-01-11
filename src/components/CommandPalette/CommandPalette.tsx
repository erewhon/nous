import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  Fragment,
} from "react";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { searchPages } from "../../utils/api";
import type { SearchResult } from "../../types/page";

interface Command {
  id: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  category: "page" | "action" | "notebook" | "search";
  action: () => void;
  keywords?: string[];
  score?: number;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenGraph: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  onOpenGraph,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { notebooks, selectedNotebookId, selectNotebook, createNotebook } =
    useNotebookStore();
  const { pages, selectPage, createPage } = usePageStore();

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchPages(query, 20);
        setSearchResults(results);
      } catch (error) {
        console.error("Search error:", error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 150);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query]);

  // Build commands list
  const commands = useMemo<Command[]>(() => {
    const cmds: Command[] = [];

    // Actions
    cmds.push({
      id: "action-new-page",
      title: "New Page",
      subtitle: "Create a new page in current notebook",
      icon: <IconPlus />,
      category: "action",
      action: () => {
        if (selectedNotebookId) {
          createPage(selectedNotebookId, "Untitled");
          onClose();
        }
      },
      keywords: ["create", "add", "page"],
    });

    cmds.push({
      id: "action-new-notebook",
      title: "New Notebook",
      subtitle: "Create a new notebook",
      icon: <IconBook />,
      category: "action",
      action: () => {
        createNotebook("New Notebook");
        onClose();
      },
      keywords: ["create", "add", "notebook"],
    });

    cmds.push({
      id: "action-graph",
      title: "Open Graph View",
      subtitle: "Visualize page connections",
      icon: <IconGraph />,
      category: "action",
      action: () => {
        onOpenGraph();
        onClose();
      },
      keywords: ["graph", "network", "links", "connections", "visualize"],
    });

    // Only show local pages/notebooks if no search query (to avoid duplication)
    if (!query.trim()) {
      // Pages in current notebook
      const currentNotebookPages = pages.filter(
        (p) => p.notebookId === selectedNotebookId
      );
      for (const page of currentNotebookPages) {
        cmds.push({
          id: `page-${page.id}`,
          title: page.title || "Untitled",
          subtitle: "Page",
          icon: <IconPage />,
          category: "page",
          action: () => {
            selectPage(page.id);
            onClose();
          },
        });
      }

      // Notebooks
      for (const notebook of notebooks) {
        cmds.push({
          id: `notebook-${notebook.id}`,
          title: notebook.name,
          subtitle:
            notebook.type === "zettelkasten" ? "Zettelkasten" : "Notebook",
          icon:
            notebook.type === "zettelkasten" ? <IconGraph /> : <IconNotebook />,
          category: "notebook",
          action: () => {
            selectNotebook(notebook.id);
            onClose();
          },
        });
      }
    }

    return cmds;
  }, [
    pages,
    notebooks,
    selectedNotebookId,
    selectPage,
    selectNotebook,
    createPage,
    createNotebook,
    onClose,
    onOpenGraph,
    query,
  ]);

  // Convert search results to commands
  const searchCommands = useMemo<Command[]>(() => {
    // Get notebook names for display
    const notebookMap = new Map(notebooks.map((n) => [n.id, n.name]));

    return searchResults.map((result) => ({
      id: `search-${result.pageId}`,
      title: result.title || "Untitled",
      subtitle: notebookMap.get(result.notebookId) || "Unknown notebook",
      icon: <IconSearch className="text-[--color-accent]" />,
      category: "search" as const,
      score: result.score,
      action: () => {
        // First select the notebook if different
        if (result.notebookId !== selectedNotebookId) {
          selectNotebook(result.notebookId);
        }
        selectPage(result.pageId);
        onClose();
      },
    }));
  }, [searchResults, notebooks, selectedNotebookId, selectNotebook, selectPage, onClose]);

  // Filter commands based on query
  const filteredCommands = useMemo(() => {
    if (!query.trim()) {
      return commands;
    }

    const lowerQuery = query.toLowerCase();
    return commands.filter((cmd) => {
      const titleMatch = cmd.title.toLowerCase().includes(lowerQuery);
      const subtitleMatch = cmd.subtitle?.toLowerCase().includes(lowerQuery);
      const keywordMatch = cmd.keywords?.some((k) =>
        k.toLowerCase().includes(lowerQuery)
      );
      return titleMatch || subtitleMatch || keywordMatch;
    });
  }, [commands, query]);

  // Combine filtered commands with search results
  const allCommands = useMemo(() => {
    return [...filteredCommands, ...searchCommands];
  }, [filteredCommands, searchCommands]);

  // Group filtered commands by category
  const groupedCommands = useMemo(() => {
    const groups: { category: string; commands: Command[] }[] = [];

    const searchMatches = allCommands.filter((c) => c.category === "search");
    const actions = allCommands.filter((c) => c.category === "action");
    const pageResults = allCommands.filter((c) => c.category === "page");
    const notebookResults = allCommands.filter((c) => c.category === "notebook");

    // Show search results first when there's a query
    if (searchMatches.length > 0) {
      groups.push({ category: "Search Results", commands: searchMatches });
    }
    if (actions.length > 0) {
      groups.push({ category: "Actions", commands: actions });
    }
    if (pageResults.length > 0) {
      groups.push({ category: "Pages", commands: pageResults });
    }
    if (notebookResults.length > 0) {
      groups.push({ category: "Notebooks", commands: notebookResults });
    }

    return groups;
  }, [allCommands]);

  // Reset state when opening
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setSearchResults([]);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Reset selected index when filtered results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (listRef.current) {
      const selectedElement = listRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      );
      selectedElement?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) =>
            Math.min(i + 1, allCommands.length - 1)
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (allCommands[selectedIndex]) {
            allCommands[selectedIndex].action();
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [allCommands, selectedIndex, onClose]
  );

  if (!isOpen) return null;

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Palette */}
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-xl border border-[--color-border] bg-[--color-bg-secondary] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-[--color-border] px-4 py-3">
          <IconSearchBox />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, notebooks, or actions..."
            className="flex-1 bg-transparent text-[--color-text-primary] placeholder-[--color-text-muted] outline-none"
          />
          {isSearching && (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[--color-accent] border-t-transparent" />
          )}
          <kbd className="rounded bg-[--color-bg-tertiary] px-1.5 py-0.5 text-xs text-[--color-text-muted]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto p-2"
        >
          {allCommands.length === 0 ? (
            <div className="py-8 text-center text-[--color-text-muted]">
              {isSearching ? "Searching..." : "No results found"}
            </div>
          ) : (
            groupedCommands.map((group) => (
              <Fragment key={group.category}>
                <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
                  {group.category}
                </div>
                {group.commands.map((cmd) => {
                  flatIndex++;
                  const currentIndex = flatIndex;
                  return (
                    <button
                      key={cmd.id}
                      data-index={currentIndex}
                      onClick={() => cmd.action()}
                      onMouseEnter={() => setSelectedIndex(currentIndex)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                        selectedIndex === currentIndex
                          ? "bg-[--color-accent] text-white"
                          : "text-[--color-text-secondary] hover:bg-[--color-bg-tertiary]"
                      }`}
                    >
                      <span
                        className={
                          selectedIndex === currentIndex
                            ? "text-white/80"
                            : "text-[--color-text-muted]"
                        }
                      >
                        {cmd.icon}
                      </span>
                      <div className="flex-1 truncate">
                        <div className="truncate font-medium">{cmd.title}</div>
                        {cmd.subtitle && (
                          <div
                            className={`truncate text-xs ${
                              selectedIndex === currentIndex
                                ? "text-white/70"
                                : "text-[--color-text-muted]"
                            }`}
                          >
                            {cmd.subtitle}
                          </div>
                        )}
                      </div>
                      {cmd.score !== undefined && (
                        <span
                          className={`text-xs ${
                            selectedIndex === currentIndex
                              ? "text-white/50"
                              : "text-[--color-text-muted]"
                          }`}
                        >
                          {cmd.score.toFixed(1)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </Fragment>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[--color-border] px-4 py-2 text-xs text-[--color-text-muted]">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-[--color-bg-tertiary] px-1 py-0.5">
                ↑
              </kbd>
              <kbd className="rounded bg-[--color-bg-tertiary] px-1 py-0.5">
                ↓
              </kbd>
              <span>Navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-[--color-bg-tertiary] px-1 py-0.5">
                ↵
              </kbd>
              <span>Select</span>
            </span>
          </div>
          <span>{allCommands.length} results</span>
        </div>
      </div>
    </div>
  );
}

// Icons
function IconSearchBox() {
  return (
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
      className="text-[--color-text-muted]"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
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
      className={className}
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function IconPlus() {
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
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function IconBook() {
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

function IconGraph() {
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

function IconPage() {
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
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14,2 14,8 20,8" />
    </svg>
  );
}

function IconNotebook() {
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
      <path d="M8 7h6" />
      <path d="M8 11h8" />
    </svg>
  );
}
