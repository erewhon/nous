import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { Page } from "../../types/page";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useSectionStore } from "../../stores/sectionStore";
import { useActionStore } from "../../stores/actionStore";
import { useInboxStore } from "../../stores/inboxStore";
import { useFlashcardStore } from "../../stores/flashcardStore";
import { useGoalsStore } from "../../stores/goalsStore";
import { useThemeStore, type ToolButtonId } from "../../stores/themeStore";
import { useDailyNotesStore } from "../../stores/dailyNotesStore";
import { useTasksStore } from "../../stores/tasksStore";
import { useContactStore } from "../../stores/contactStore";
import { NotebookList } from "../NotebookList/NotebookList";
import { LibrarySwitcher } from "../Library";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SidebarProps {
  width?: number;
}

export function Sidebar({ width = 256 }: SidebarProps) {
  const { selectedNotebookId, selectNotebook, createNotebook, getVisibleNotebooks, showArchived, toggleShowArchived, getArchivedNotebooks } = useNotebookStore();
  const { pages, selectedPageId, getRecentPages, clearRecentPages, selectPage } = usePageStore();
  const allFavoritePages = usePageStore((s) => s.allFavoritePages);
  const { selectSection } = useSectionStore();
  const pinnedSections = useThemeStore((s) => s.pinnedSections);
  const removePinnedSection = useThemeStore((s) => s.removePinnedSection);
  const visibleNotebooks = getVisibleNotebooks();
  const archivedCount = getArchivedNotebooks().length;
  const openActionLibrary = useActionStore((state) => state.openActionLibrary);
  const { summary, openQuickCapture, openInboxPanel } = useInboxStore();
  const { togglePanel: toggleFlashcards, stats: flashcardStats } = useFlashcardStore();
  const { summary: goalsSummary, togglePanel: toggleGoals } = useGoalsStore();
  const { togglePanel: toggleDailyNotes } = useDailyNotesStore();
  const { summary: tasksSummary, togglePanel: toggleTasks } = useTasksStore();
  const { togglePanel: togglePeople } = useContactStore();
  const autoHidePanels = useThemeStore((state) => state.autoHidePanels);
  const setAutoHidePanels = useThemeStore((state) => state.setAutoHidePanels);
  const showRecentPages = useThemeStore((state) => state.showRecentPages);
  const showFavoritePages = useThemeStore((state) => state.showFavoritePages);

  // Collapsible section states
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const [showAllRecent, setShowAllRecent] = useState(false);

  // Get recent pages
  const recentPages = getRecentPages(showAllRecent ? 20 : 5);

  // Combined favorites: pinned sections + cross-notebook favorite pages
  const hasFavorites = pinnedSections.length > 0 || allFavoritePages.length > 0;

  return (
    <aside
      className="flex h-full flex-shrink-0 flex-col border-r"
      style={{
        width: `${width}px`,
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
            Nous
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAutoHidePanels(!autoHidePanels)}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: autoHidePanels ? "var(--color-accent)" : "var(--color-text-muted)" }}
            title={autoHidePanels ? "Disable auto-hide panels" : "Enable auto-hide panels"}
          >
            <IconPanelLeftClose />
          </button>
          <button
            onClick={() => {
              window.dispatchEvent(new CustomEvent("open-backup-dialog"));
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Import notebook"
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
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button
            onClick={() => createNotebook("New Notebook")}
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
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

      {/* Library Switcher */}
      <LibrarySwitcher
        onManageLibraries={() => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: ",",
              metaKey: true,
              bubbles: true,
            })
          );
        }}
      />

      {/* Recent Pages Section */}
      {showRecentPages && recentPages.length > 0 && (
        <div className="px-3">
          <button
            onClick={() => setRecentExpanded(!recentExpanded)}
            className="flex w-full items-center justify-between px-2 py-2"
          >
            <span
              className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide"
              style={{ color: "var(--color-text-muted)" }}
            >
              <IconClock />
              Recent
            </span>
            <div className="flex items-center gap-1">
              {recentExpanded && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearRecentPages();
                  }}
                  className="rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                  style={{ color: "var(--color-text-muted)" }}
                  title="Clear recent pages"
                >
                  Clear
                </button>
              )}
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
                style={{
                  color: "var(--color-text-muted)",
                  transform: recentExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </button>
          {recentExpanded && (
            <ul className="space-y-0.5 pb-2">
              {recentPages.map((recent) => {
                const notebook = visibleNotebooks.find((n) => n.id === recent.notebookId);
                return (
                  <li key={recent.pageId}>
                    <button
                      onClick={() => {
                        if (notebook) {
                          selectNotebook(notebook.id);
                        }
                        selectPage(recent.pageId);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                      style={{ color: "var(--color-text-secondary)" }}
                      title={`${recent.title} (${notebook?.name || "Unknown notebook"})`}
                    >
                      <IconPage />
                      <span className="flex-1 truncate">{recent.title}</span>
                    </button>
                  </li>
                );
              })}
              {recentPages.length >= 5 && !showAllRecent && (
                <li>
                  <button
                    onClick={() => setShowAllRecent(true)}
                    className="flex w-full items-center justify-center rounded-md px-2 py-1 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Show more...
                  </button>
                </li>
              )}
              {showAllRecent && (
                <li>
                  <button
                    onClick={() => setShowAllRecent(false)}
                    className="flex w-full items-center justify-center rounded-md px-2 py-1 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Show less
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Favorites Section — pinned sections + cross-notebook favorite pages */}
      {showFavoritePages && hasFavorites && (
        <div className="px-3">
          <button
            onClick={() => setFavoritesExpanded(!favoritesExpanded)}
            className="flex w-full items-center justify-between px-2 py-2"
          >
            <span
              className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide"
              style={{ color: "var(--color-text-muted)" }}
            >
              <IconStar />
              Favorites
            </span>
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
              style={{
                color: "var(--color-text-muted)",
                transform: favoritesExpanded ? "rotate(90deg)" : "rotate(0deg)",
                transition: "transform 0.15s ease",
              }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          {favoritesExpanded && (
            <ul className="space-y-0.5 pb-2">
              {/* Pinned sections first */}
              {pinnedSections.map((pinned) => (
                <li key={`section-${pinned.sectionId}`}>
                  <button
                    onClick={() => {
                      selectNotebook(pinned.notebookId);
                      selectSection(pinned.sectionId);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      removePinnedSection(pinned.sectionId);
                    }}
                    className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{ color: "var(--color-text-secondary)" }}
                    title={`${pinned.sectionName} — ${pinned.notebookName} (right-click to unpin)`}
                  >
                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: pinned.sectionColor || "var(--color-text-muted)" }}
                    />
                    <span className="flex-1 truncate">{pinned.sectionName}</span>
                    <span
                      className="truncate text-[10px]"
                      style={{ color: "var(--color-text-muted)", maxWidth: "80px" }}
                    >
                      {pinned.notebookName}
                    </span>
                  </button>
                </li>
              ))}
              {/* Cross-notebook favorite pages */}
              {allFavoritePages.map((fav) => (
                <li key={fav.id}>
                  <button
                    onClick={() => {
                      selectNotebook(fav.notebookId);
                      selectPage(fav.id);
                    }}
                    className="group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{ color: "var(--color-text-secondary)" }}
                    title={`${fav.title} — ${fav.notebookName}`}
                  >
                    <IconStarFilled />
                    <span className="flex-1 truncate">{fav.title}</span>
                    <span
                      className="truncate text-[10px]"
                      style={{ color: "var(--color-text-muted)", maxWidth: "80px" }}
                    >
                      {fav.notebookName}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

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
          notebooks={visibleNotebooks}
          selectedNotebookId={selectedNotebookId}
        />
      </div>

      {/* Footer */}
      <SidebarToolDock
        openQuickCapture={openQuickCapture}
        openInboxPanel={openInboxPanel}
        openActionLibrary={openActionLibrary}
        toggleFlashcards={toggleFlashcards}
        toggleGoals={toggleGoals}
        togglePeople={togglePeople}
        toggleTasks={toggleTasks}
        toggleDailyNotes={toggleDailyNotes}
        selectPage={selectPage}
        pages={pages}
        selectedNotebookId={selectedNotebookId}
        selectedPageId={selectedPageId}
        inboxCount={summary?.unprocessed_count ?? 0}
        flashcardsDue={flashcardStats?.dueCards ?? 0}
        goalStreak={goalsSummary?.highestStreak ?? 0}
        tasksOverdue={tasksSummary.overdueCount}
        tasksDueToday={tasksSummary.dueTodayCount}
      />
      {/* Notebook count and archive toggle */}
      <div
        className="flex items-center justify-center gap-2 border-t px-3 py-1.5"
        style={{ borderColor: "var(--color-border)" }}
      >
        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {visibleNotebooks.length} notebook{visibleNotebooks.length !== 1 ? "s" : ""}
        </span>
        {archivedCount > 0 && (
          <button
            onClick={toggleShowArchived}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: showArchived ? "var(--color-accent)" : "var(--color-text-muted)" }}
            title={showArchived ? "Hide archived notebooks" : `Show ${archivedCount} archived notebook${archivedCount !== 1 ? "s" : ""}`}
          >
            <IconArchive />
            {archivedCount}
          </button>
        )}
      </div>
    </aside>
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

function IconPanelLeftClose() {
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="M16 15l-3-3 3-3" />
    </svg>
  );
}

function IconClock() {
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
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconStar() {
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
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function IconStarFilled() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: "var(--color-accent)" }}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function IconPage() {
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
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14,2 14,8 20,8" />
    </svg>
  );
}

// --- Sidebar Tool Dock ---

interface ToolButtonDef {
  id: ToolButtonId;
  label: string;
  icon: string;           // SVG path d attribute
  onClick: () => void;
  shortcut?: string;
  badge?: number;
  badgeUrgent?: boolean;
  badgeEmoji?: string;
  compactLabel?: string;  // e.g. "New" for quick-capture
  separator?: boolean;    // divider before this item in popover
}

interface SidebarToolDockProps {
  openQuickCapture: () => void;
  openInboxPanel: () => void;
  openActionLibrary: () => void;
  toggleFlashcards: () => void;
  toggleGoals: () => void;
  togglePeople: () => void;
  toggleTasks: () => void;
  toggleDailyNotes: () => void;
  selectPage: (id: string) => void;
  pages: Page[];
  selectedNotebookId: string | null;
  selectedPageId: string | null;
  inboxCount: number;
  flashcardsDue: number;
  goalStreak: number;
  tasksOverdue: number;
  tasksDueToday: number;
}

// --- SortableToolButton for compact bar ---

function SortableToolButton({ def }: { def: ToolButtonDef }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: def.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    color: "var(--color-text-muted)",
  };

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={def.onClick}
      className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors hover:bg-[--color-bg-tertiary]"
      title={def.label + (def.shortcut ? ` (${def.shortcut})` : "")}
    >
      {/* Hide SVG icon when badgeEmoji is active (e.g. goals streak flame) */}
      {!(def.badgeEmoji && def.badge !== undefined && def.badge > 0) && (
        <SvgIcon d={def.icon} size={13} />
      )}
      {def.compactLabel && (
        <span className="font-medium" style={{ color: "var(--color-text-secondary)" }}>
          {def.compactLabel}
        </span>
      )}
      {def.badgeEmoji && def.badge !== undefined && def.badge > 0 ? (
        <>
          <span className="text-[11px]">{def.badgeEmoji}</span>
          <span
            className="flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-0.5 text-[9px] font-bold"
            style={{ backgroundColor: "rgba(239, 68, 68, 0.2)", color: "#ef4444" }}
          >
            {def.badge}
          </span>
        </>
      ) : def.badge !== undefined && def.badge > 0 && (
        <span
          className="flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-0.5 text-[9px] font-bold"
          style={{
            backgroundColor: def.badgeUrgent ? "rgba(239, 68, 68, 0.2)" : "var(--color-accent)",
            color: def.badgeUrgent ? "#ef4444" : "white",
          }}
        >
          {def.badge > 9 ? "9+" : def.badge}
        </span>
      )}
    </button>
  );
}

function SidebarToolDock({
  openQuickCapture,
  openInboxPanel,
  openActionLibrary,
  toggleFlashcards,
  toggleGoals,
  togglePeople,
  toggleTasks,
  toggleDailyNotes,
  selectPage,
  pages,
  selectedNotebookId,
  selectedPageId,
  inboxCount,
  flashcardsDue,
  goalStreak,
  tasksOverdue,
  tasksDueToday,
}: SidebarToolDockProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const pinnedToolButtons = useThemeStore((s) => s.pinnedToolButtons);
  const setPinnedToolButtons = useThemeStore((s) => s.setPinnedToolButtons);
  const togglePinnedToolButton = useThemeStore((s) => s.togglePinnedToolButton);

  // Close menu when clicking outside
  useEffect(() => {
    if (!moreOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreOpen]);

  const openRandomNote = useCallback(() => {
    const candidates = pages.filter(
      (p) =>
        p.notebookId === selectedNotebookId &&
        !p.deletedAt &&
        p.id !== selectedPageId
    );
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      selectPage(pick.id);
    }
  }, [pages, selectedNotebookId, selectedPageId, selectPage]);

  const dispatchKey = useCallback((key: string, meta: boolean, shift: boolean) => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key, metaKey: meta, shiftKey: shift, bubbles: true })
    );
  }, []);

  // Badge for tasks: overdue takes priority
  const taskBadge = tasksOverdue > 0 ? tasksOverdue : tasksDueToday > 0 ? tasksDueToday : 0;
  const taskBadgeUrgent = tasksOverdue > 0;

  // Button registry — all 13 tool buttons
  const allButtons: ToolButtonDef[] = useMemo(() => [
    {
      id: "quick-capture",
      label: "Quick Capture",
      icon: "M12 5v14M5 12h14",
      onClick: openQuickCapture,
      shortcut: "\u2318\u21e7C",
      compactLabel: "New",
    },
    {
      id: "web-clipper",
      label: "Web Clipper",
      icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20",
      onClick: () => window.dispatchEvent(new CustomEvent("open-web-clipper")),
      shortcut: "\u2318\u21e7L",
    },
    {
      id: "inbox",
      label: "Inbox",
      icon: "M22 12l-6 0-2 3H10L8 12l-6 0M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
      onClick: openInboxPanel,
      shortcut: "\u2318\u21e7I",
      badge: inboxCount,
      separator: true,
    },
    {
      id: "flashcards",
      label: "Flashcards",
      icon: "M2 4h20v16H2zM2 12h20",
      onClick: toggleFlashcards,
      shortcut: "\u2318\u21e7F",
      badge: flashcardsDue,
    },
    {
      id: "tasks",
      label: "Tasks",
      icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
      onClick: toggleTasks,
      badge: taskBadge,
      badgeUrgent: taskBadgeUrgent,
    },
    {
      id: "goals",
      label: "Goals",
      icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
      onClick: toggleGoals,
      badge: goalStreak,
      badgeUrgent: true,
      badgeEmoji: goalStreak > 0 ? "\uD83D\uDD25" : undefined,
    },
    {
      id: "people",
      label: "People",
      icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
      onClick: togglePeople,
    },
    {
      id: "daily-notes",
      label: "Daily Notes",
      icon: "M3 4h18v18H3zM16 2v4M8 2v4M3 10h18",
      onClick: toggleDailyNotes,
      shortcut: "\u2318\u21e7D",
    },
    {
      id: "ai-chat",
      label: "AI Chat",
      icon: "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z",
      onClick: () => dispatchKey("A", true, true),
      shortcut: "\u2318\u21e7A",
      separator: true,
    },
    {
      id: "actions",
      label: "Actions",
      icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8",
      onClick: openActionLibrary,
      shortcut: "\u2318\u21e7X",
    },
    {
      id: "graph-view",
      label: "Graph View",
      icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM14.5 9.5l3-3M9.5 14.5l-3 3",
      onClick: () => dispatchKey("g", true, false),
      shortcut: "\u2318G",
    },
    {
      id: "random-note",
      label: "Random Note",
      icon: "M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4",
      onClick: openRandomNote,
    },
    {
      id: "settings",
      label: "Settings",
      icon: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
      onClick: () => dispatchKey(",", true, false),
      shortcut: "\u2318,",
    },
  ], [
    openQuickCapture, openInboxPanel, toggleFlashcards, toggleTasks, toggleGoals,
    togglePeople, toggleDailyNotes, openActionLibrary, openRandomNote, dispatchKey,
    inboxCount, flashcardsDue, taskBadge, taskBadgeUrgent, goalStreak,
  ]);

  const buttonMap = useMemo(
    () => new Map(allButtons.map((b) => [b.id, b])),
    [allButtons]
  );

  // Resolve pinned buttons
  const pinnedButtons = useMemo(
    () => pinnedToolButtons.map((id) => buttonMap.get(id)).filter((b): b is ToolButtonDef => !!b),
    [pinnedToolButtons, buttonMap]
  );

  const pinnedSet = useMemo(
    () => new Set(pinnedToolButtons),
    [pinnedToolButtons]
  );

  // dnd-kit
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = pinnedToolButtons.indexOf(active.id as ToolButtonId);
        const newIndex = pinnedToolButtons.indexOf(over.id as ToolButtonId);
        if (oldIndex !== -1 && newIndex !== -1) {
          setPinnedToolButtons(arrayMove(pinnedToolButtons, oldIndex, newIndex));
        }
      }
    },
    [pinnedToolButtons, setPinnedToolButtons]
  );

  return (
    <div
      className="relative border-t px-3 py-2.5"
      style={{ borderColor: "var(--color-border)" }}
      ref={menuRef}
    >
      {/* Popover menu for all tools */}
      {moreOpen && (
        <div
          className="absolute bottom-full left-2 right-2 mb-1 rounded-lg border shadow-lg"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <div className="p-1">
            {allButtons.map((btn) => (
              <div key={btn.id}>
                {btn.separator && (
                  <div className="mx-2 my-1 border-t" style={{ borderColor: "var(--color-border)" }} />
                )}
                <div className="group flex items-center">
                  <SidebarMenuItem
                    icon={<SvgIcon d={btn.icon} />}
                    label={btn.label}
                    shortcut={btn.shortcut}
                    badge={btn.badge}
                    badgeUrgent={btn.badgeUrgent}
                    badgeEmoji={btn.badgeEmoji}
                    onClick={() => { btn.onClick(); setMoreOpen(false); }}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); togglePinnedToolButton(btn.id); }}
                    className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-[--color-bg-tertiary] group-hover:opacity-100"
                    style={{ color: pinnedSet.has(btn.id) ? "var(--color-accent)" : "var(--color-text-muted)" }}
                    title={pinnedSet.has(btn.id) ? "Unpin from toolbar" : "Pin to toolbar"}
                  >
                    {pinnedSet.has(btn.id) ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 17v5M9 2h6l1 7h2l-1 4H7L6 9h2z" />
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 17v5M9 2h6l1 7h2l-1 4H7L6 9h2z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compact bar: pinned actions + more button */}
      <div className="flex items-center justify-center gap-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={pinnedButtons.map((b) => b.id)} strategy={horizontalListSortingStrategy}>
            {pinnedButtons.map((btn) => (
              <SortableToolButton key={btn.id} def={btn} />
            ))}
          </SortableContext>
        </DndContext>

        {/* Separator */}
        <div className="mx-0.5 h-4 w-px" style={{ backgroundColor: "var(--color-border)" }} />

        {/* More tools toggle */}
        <button
          onClick={() => setMoreOpen(!moreOpen)}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
          style={{ color: "var(--color-text-muted)" }}
          title="All tools"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="5" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="12" cy="19" r="1" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// --- Shared sidebar menu item ---

function SidebarMenuItem({
  icon,
  label,
  shortcut,
  badge,
  badgeUrgent,
  badgeEmoji,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  badge?: number;
  badgeUrgent?: boolean;
  badgeEmoji?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-1 min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-[--color-bg-tertiary]"
      style={{ color: "var(--color-text-secondary)" }}
    >
      <span className="shrink-0" style={{ color: "var(--color-text-muted)" }}>{icon}</span>
      <span className="flex-1 font-medium">{label}</span>
      {badge !== undefined && badge > 0 && (
        badgeEmoji ? (
          <span className="text-[11px]">{badgeEmoji}{badge}</span>
        ) : (
          <span
            className="flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold"
            style={{
              backgroundColor: badgeUrgent ? "rgba(239, 68, 68, 0.2)" : "var(--color-accent)",
              color: badgeUrgent ? "#ef4444" : "white",
            }}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )
      )}
      {shortcut && (
        <span className="shrink-0 text-[10px]" style={{ color: "var(--color-text-muted)", opacity: 0.4 }}>
          {shortcut}
        </span>
      )}
    </button>
  );
}

// --- Reusable SVG icon helper ---

function SvgIcon({ d, size = 14 }: { d: string; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
