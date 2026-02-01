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
import { useSearchStore, type SearchMode } from "../../stores/searchStore";
import { useActionStore } from "../../stores/actionStore";
import { useRAGStore } from "../../stores/ragStore";
import { searchPages, exportPageToFile, importMarkdownFile, convertDocument, importMarkdown } from "../../utils/api";
import { save, open } from "@tauri-apps/plugin-dialog";
import { highlightText } from "../../utils/highlightText";
import type { SearchResult, PageType } from "../../types/page";

interface Command {
  id: string;
  title: string;
  subtitle?: string;
  snippet?: string;
  icon: React.ReactNode;
  category: "page" | "action" | "notebook" | "search" | "recent" | "automation";
  action: () => void;
  keywords?: string[];
  score?: number;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenGraph: () => void;
  onNewPage?: () => void;
  onOpenBackup?: () => void;
}

export function CommandPalette({
  isOpen,
  onClose,
  onOpenGraph,
  onNewPage,
  onOpenBackup,
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
  const { recentSearches, searchScope, searchMode, addRecentSearch, setSearchScope, setSearchMode, clearRecentSearches } =
    useSearchStore();
  const { actions, runAction: executeAction, openActionLibrary } = useActionStore();
  const { isConfigured: ragConfigured, settings: ragSettings, hybridSearch, semanticSearch } = useRAGStore();

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
        let results: SearchResult[];
        const notebookFilter = searchScope === "current" ? selectedNotebookId : undefined;

        // Choose search method based on mode and RAG availability
        if (searchMode === "hybrid" && ragConfigured && ragSettings.ragEnabled) {
          results = await hybridSearch(query, notebookFilter ?? undefined, 50);
        } else if (searchMode === "semantic" && ragConfigured && ragSettings.ragEnabled) {
          // Semantic search returns SemanticSearchResult, convert to SearchResult
          const semanticResults = await semanticSearch(query, notebookFilter ?? undefined, 50);
          results = semanticResults.map((r) => ({
            pageId: r.pageId,
            notebookId: r.notebookId,
            title: r.title,
            snippet: r.content,
            score: r.score,
            pageType: "standard" as PageType,
          }));
        } else {
          // Default to keyword search
          results = await searchPages(query, 50);
          // Filter by notebook scope if set to "current"
          if (searchScope === "current" && selectedNotebookId) {
            results = results.filter((r) => r.notebookId === selectedNotebookId);
          }
        }

        setSearchResults(results.slice(0, 20));
        // Save to recent searches
        addRecentSearch(query);
      } catch (error) {
        console.error("Search error:", error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, searchMode === "keyword" ? 150 : 300); // Slightly longer debounce for semantic search

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, searchScope, searchMode, selectedNotebookId, addRecentSearch, ragConfigured, ragSettings.ragEnabled, hybridSearch, semanticSearch]);

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
          onClose();
          // Use onNewPage callback if provided (opens template dialog)
          // Otherwise fall back to direct creation
          if (onNewPage) {
            onNewPage();
          } else {
            createPage(selectedNotebookId, "Untitled");
          }
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

    cmds.push({
      id: "action-export-markdown",
      title: "Export Page to Markdown",
      subtitle: "Save current page as .md file",
      icon: <IconExport />,
      category: "action",
      action: async () => {
        const selectedPageId = usePageStore.getState().selectedPageId;
        if (selectedNotebookId && selectedPageId) {
          const selectedPage = pages.find((p) => p.id === selectedPageId);
          const suggestedName = selectedPage?.title?.replace(/[/\\?%*:|"<>]/g, "-") || "page";
          const path = await save({
            defaultPath: `${suggestedName}.md`,
            filters: [{ name: "Markdown", extensions: ["md"] }],
          });
          if (path) {
            await exportPageToFile(selectedNotebookId, selectedPageId, path);
          }
        }
        onClose();
      },
      keywords: ["export", "markdown", "md", "save", "file"],
    });

    cmds.push({
      id: "action-import-markdown",
      title: "Import Markdown File",
      subtitle: "Create page from .md file",
      icon: <IconImport />,
      category: "action",
      action: async () => {
        if (selectedNotebookId) {
          const selected = await open({
            multiple: false,
            filters: [{ name: "Markdown", extensions: ["md", "markdown"] }],
          });
          if (selected) {
            const newPage = await importMarkdownFile(selectedNotebookId, selected);
            selectPage(newPage.id);
          }
        }
        onClose();
      },
      keywords: ["import", "markdown", "md", "load", "file"],
    });

    cmds.push({
      id: "action-import-document",
      title: "Import Document",
      subtitle: "Import PDF, Word, Excel, PowerPoint, and more",
      icon: <IconDocument />,
      category: "action",
      action: async () => {
        if (selectedNotebookId) {
          const selected = await open({
            multiple: false,
            filters: [
              {
                name: "Documents",
                extensions: [
                  "pdf", "docx", "doc", "pptx", "ppt", "xlsx", "xls",
                  "html", "htm", "csv", "json", "xml", "epub", "zip",
                  "png", "jpg", "jpeg", "gif", "webp",
                  "mp3", "wav", "m4a", "ogg"
                ],
              },
            ],
          });
          if (selected) {
            try {
              // Convert document to markdown using markitdown
              const result = await convertDocument(selected);
              if (result.error) {
                console.error("Document conversion error:", result.error);
                return;
              }
              // Import the converted markdown as a new page
              const filename = selected.split("/").pop() || selected.split("\\").pop() || "Imported";
              const newPage = await importMarkdown(
                selectedNotebookId,
                result.content,
                filename
              );
              selectPage(newPage.id);
            } catch (err) {
              console.error("Failed to import document:", err);
            }
          }
        }
        onClose();
      },
      keywords: ["import", "document", "pdf", "word", "excel", "powerpoint", "docx", "xlsx", "pptx", "convert"],
    });

    cmds.push({
      id: "action-backup",
      title: "Backup & Restore",
      subtitle: "Export or import notebook backups",
      icon: <IconArchive />,
      category: "action",
      action: () => {
        onClose();
        if (onOpenBackup) {
          onOpenBackup();
        }
      },
      keywords: ["backup", "restore", "export", "import", "zip", "archive"],
    });

    // Browse all actions
    cmds.push({
      id: "action-browse-actions",
      title: "Browse Actions",
      subtitle: "View and manage all automations",
      icon: <IconZap />,
      category: "action",
      action: () => {
        onClose();
        openActionLibrary();
      },
      keywords: ["actions", "automations", "workflows", "browse", "library"],
    });

    // Smart Organize
    if (selectedNotebookId) {
      cmds.push({
        id: "action-smart-organize",
        title: "Smart Organize",
        subtitle: "AI suggests where pages should go",
        icon: <IconWand />,
        category: "action",
        action: () => {
          onClose();
          window.dispatchEvent(new CustomEvent("smart-organize-open"));
        },
        keywords: ["organize", "sort", "move", "ai", "classify", "smart"],
      });
    }

    // Add runnable actions (enabled actions with manual trigger)
    const runnableActions = actions.filter(
      (a) => a.enabled && a.triggers.some((t) => t.type === "manual")
    );

    for (const action of runnableActions) {
      cmds.push({
        id: `automation-${action.id}`,
        title: `Run: ${action.name}`,
        subtitle: action.description,
        icon: <IconZap />,
        category: "automation",
        action: async () => {
          onClose();
          try {
            await executeAction(action.id, {
              currentNotebookId: selectedNotebookId || undefined,
            });
          } catch (error) {
            console.error("Failed to run action:", error);
          }
        },
        keywords: [
          action.name.toLowerCase(),
          ...action.triggers
            .filter((t): t is { type: "aiChat"; keywords: string[] } => t.type === "aiChat")
            .flatMap((t) => t.keywords),
        ],
      });
    }

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
    onNewPage,
    onOpenBackup,
    query,
    actions,
    executeAction,
    openActionLibrary,
  ]);

  // Convert search results to commands
  const searchCommands = useMemo<Command[]>(() => {
    // Get notebook names for display
    const notebookMap = new Map(notebooks.map((n) => [n.id, n.name]));

    return searchResults.map((result) => ({
      id: `search-${result.pageId}`,
      title: result.title || "Untitled",
      subtitle: notebookMap.get(result.notebookId) || "Unknown notebook",
      snippet: result.snippet,
      icon: <PageTypeIcon pageType={result.pageType} />,
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

  // Recent searches as commands
  const recentCommands = useMemo<Command[]>(() => {
    if (query.trim()) return []; // Don't show recent when actively searching

    return recentSearches.slice(0, 5).map((search, index) => ({
      id: `recent-${index}`,
      title: search,
      subtitle: "Recent search",
      icon: <IconHistory />,
      category: "recent" as const,
      action: () => {
        setQuery(search);
      },
    }));
  }, [recentSearches, query]);

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

  // Combine filtered commands with search results and recent searches
  const allCommands = useMemo(() => {
    return [...recentCommands, ...filteredCommands, ...searchCommands];
  }, [recentCommands, filteredCommands, searchCommands]);

  // Group filtered commands by category
  const groupedCommands = useMemo(() => {
    const groups: { category: string; commands: Command[] }[] = [];

    const recentMatches = allCommands.filter((c) => c.category === "recent");
    const searchMatches = allCommands.filter((c) => c.category === "search");
    const actionCommands = allCommands.filter((c) => c.category === "action");
    const automationCommands = allCommands.filter((c) => c.category === "automation");
    const pageResults = allCommands.filter((c) => c.category === "page");
    const notebookResults = allCommands.filter((c) => c.category === "notebook");

    // Show recent searches when there's no query
    if (recentMatches.length > 0) {
      groups.push({ category: "Recent Searches", commands: recentMatches });
    }
    // Show search results first when there's a query
    if (searchMatches.length > 0) {
      groups.push({ category: "Search Results", commands: searchMatches });
    }
    if (actionCommands.length > 0) {
      groups.push({ category: "Actions", commands: actionCommands });
    }
    if (automationCommands.length > 0) {
      groups.push({ category: "Automations", commands: automationCommands });
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
        className="relative w-full max-w-xl overflow-hidden rounded-xl border shadow-2xl"
        style={{
          backgroundColor: "var(--color-bg-primary)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div
          className="flex items-center gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--color-border)" }}
        >
          <IconSearchBox />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages, notebooks, or actions..."
            className="flex-1 bg-transparent outline-none"
            style={{
              color: "var(--color-text-primary)",
            }}
          />
          {isSearching && (
            <div
              className="h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--color-accent)" }}
            />
          )}
          <kbd
            className="rounded text-xs px-1.5 py-0.5"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-muted)",
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Scope filter */}
        <div
          className="flex items-center gap-2 border-b px-5 py-2"
          style={{ borderColor: "var(--color-border)" }}
        >
          <span
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Search in:
          </span>
          <button
            onClick={() => setSearchScope("all")}
            className="rounded-full text-xs px-3 py-1 transition-colors"
            style={{
              backgroundColor:
                searchScope === "all"
                  ? "var(--color-accent)"
                  : "var(--color-bg-tertiary)",
              color: searchScope === "all" ? "white" : "var(--color-text-secondary)",
            }}
          >
            All notebooks
          </button>
          <button
            onClick={() => setSearchScope("current")}
            className="rounded-full text-xs px-3 py-1 transition-colors"
            style={{
              backgroundColor:
                searchScope === "current"
                  ? "var(--color-accent)"
                  : "var(--color-bg-tertiary)",
              color: searchScope === "current" ? "white" : "var(--color-text-secondary)",
            }}
          >
            Current notebook
          </button>

          {/* Divider */}
          <div
            className="h-4 w-px mx-1"
            style={{ backgroundColor: "var(--color-border)" }}
          />

          {/* Search mode toggle */}
          <span
            className="text-xs"
            style={{ color: "var(--color-text-muted)" }}
          >
            Mode:
          </span>
          {(["keyword", "hybrid", "semantic"] as SearchMode[]).map((mode) => {
            const isActive = searchMode === mode;
            const isDisabled = mode !== "keyword" && (!ragConfigured || !ragSettings.ragEnabled);
            return (
              <button
                key={mode}
                onClick={() => !isDisabled && setSearchMode(mode)}
                disabled={isDisabled}
                className="rounded-full text-xs px-3 py-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: isActive
                    ? "var(--color-accent)"
                    : "var(--color-bg-tertiary)",
                  color: isActive ? "white" : "var(--color-text-secondary)",
                }}
                title={isDisabled ? "Enable Semantic Search in Settings to use this mode" : undefined}
              >
                {mode === "keyword" ? "Keyword" : mode === "hybrid" ? "Hybrid" : "Semantic"}
              </button>
            );
          })}

          {recentSearches.length > 0 && !query.trim() && (
            <button
              onClick={clearRecentSearches}
              className="ml-auto text-xs transition-colors hover:opacity-80"
              style={{ color: "var(--color-text-muted)" }}
            >
              Clear history
            </button>
          )}
        </div>

        {/* Results */}
        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto p-2"
        >
          {allCommands.length === 0 ? (
            <div
              className="text-center py-8"
              style={{ color: "var(--color-text-muted)" }}
            >
              {isSearching ? "Searching..." : "No results found"}
            </div>
          ) : (
            groupedCommands.map((group) => (
              <Fragment key={group.category}>
                <div
                  className="text-xs font-medium uppercase tracking-wide px-2 py-1.5"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  {group.category}
                </div>
                {group.commands.map((cmd) => {
                  flatIndex++;
                  const currentIndex = flatIndex;
                  const isSelected = selectedIndex === currentIndex;
                  const isSearchResult = cmd.category === "search";
                  return (
                    <button
                      key={cmd.id}
                      data-index={currentIndex}
                      onClick={() => cmd.action()}
                      onMouseEnter={() => setSelectedIndex(currentIndex)}
                      className="flex w-full items-center gap-3 rounded-lg text-left transition-colors px-3 py-2.5"
                      style={{
                        backgroundColor: isSelected ? "var(--color-accent)" : "transparent",
                        color: isSelected ? "white" : "var(--color-text-secondary)",
                      }}
                    >
                      <span
                        className="flex-shrink-0"
                        style={{
                          color: isSelected ? "rgba(255,255,255,0.8)" : "var(--color-text-muted)",
                        }}
                      >
                        {cmd.icon}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="truncate font-medium">
                          {isSearchResult && query.trim()
                            ? highlightText(cmd.title, query, {
                                backgroundColor: isSelected
                                  ? "rgba(255,255,255,0.3)"
                                  : "rgba(139, 92, 246, 0.3)",
                                color: "inherit",
                                borderRadius: "2px",
                                padding: "0 2px",
                              })
                            : cmd.title}
                        </div>
                        {cmd.subtitle && (
                          <div
                            className="truncate text-xs"
                            style={{
                              color: isSelected ? "rgba(255,255,255,0.7)" : "var(--color-text-muted)",
                            }}
                          >
                            {cmd.subtitle}
                          </div>
                        )}
                        {cmd.snippet && (
                          <div
                            className="truncate text-xs mt-0.5"
                            style={{
                              color: isSelected ? "rgba(255,255,255,0.6)" : "var(--color-text-muted)",
                            }}
                          >
                            {query.trim()
                              ? highlightText(cmd.snippet, query, {
                                  backgroundColor: isSelected
                                    ? "rgba(255,255,255,0.3)"
                                    : "rgba(139, 92, 246, 0.3)",
                                  color: "inherit",
                                  borderRadius: "2px",
                                  padding: "0 2px",
                                })
                              : cmd.snippet}
                          </div>
                        )}
                      </div>
                      {cmd.score !== undefined && (
                        <span
                          className="flex-shrink-0 text-xs"
                          style={{
                            color: isSelected ? "rgba(255,255,255,0.5)" : "var(--color-text-muted)",
                          }}
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
        <div
          className="flex items-center justify-between border-t text-xs px-5 py-3"
          style={{
            borderColor: "var(--color-border)",
            color: "var(--color-text-muted)",
          }}
        >
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd
                className="rounded px-1 py-0.5"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                ↑
              </kbd>
              <kbd
                className="rounded px-1 py-0.5"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
                ↓
              </kbd>
              <span>Navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd
                className="rounded px-1 py-0.5"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
              >
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
      style={{ color: "var(--color-text-muted)" }}
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

function IconExport() {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function IconImport() {
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
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function IconDocument() {
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
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  );
}

function IconHistory() {
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
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </svg>
  );
}

function IconArchive() {
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
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function IconZap() {
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
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function IconWand() {
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
      <path d="M15 4V2" />
      <path d="M15 16v-2" />
      <path d="M8 9h2" />
      <path d="M20 9h2" />
      <path d="M17.8 11.8 19 13" />
      <path d="M15 9h.01" />
      <path d="M17.8 6.2 19 5" />
      <path d="m3 21 9-9" />
      <path d="M12.2 6.2 11 5" />
    </svg>
  );
}

function PageTypeIcon({ pageType }: { pageType: PageType }) {
  const style = { color: "var(--color-accent)" };

  switch (pageType) {
    case "chat":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
          <path d="M19 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
        </svg>
      );
    case "markdown":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
          <path d="M9 15v-3l2 2 2-2v3" />
        </svg>
      );
    case "pdf":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
          <path d="M10 12h4" />
          <path d="M10 16h4" />
        </svg>
      );
    case "jupyter":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "calendar":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "epub":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
      );
    default:
      // Standard page
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
        </svg>
      );
  }
}
