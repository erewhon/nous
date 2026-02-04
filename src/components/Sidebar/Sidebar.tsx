import { useState } from "react";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useActionStore } from "../../stores/actionStore";
import { useInboxStore } from "../../stores/inboxStore";
import { useFlashcardStore } from "../../stores/flashcardStore";
import { useGoalsStore } from "../../stores/goalsStore";
import { useThemeStore } from "../../stores/themeStore";
import { useDailyNotesStore } from "../../stores/dailyNotesStore";
import { NotebookList } from "../NotebookList/NotebookList";
import { LibrarySwitcher } from "../Library";

interface SidebarProps {
  width?: number;
}

export function Sidebar({ width = 256 }: SidebarProps) {
  const { selectedNotebookId, selectNotebook, createNotebook, getVisibleNotebooks, showArchived, toggleShowArchived, getArchivedNotebooks } = useNotebookStore();
  const { getRecentPages, clearRecentPages, getFavoritePages, selectPage } = usePageStore();
  const visibleNotebooks = getVisibleNotebooks();
  const archivedCount = getArchivedNotebooks().length;
  const openActionLibrary = useActionStore((state) => state.openActionLibrary);
  const { summary, openQuickCapture, openInboxPanel } = useInboxStore();
  const { togglePanel: toggleFlashcards, stats: flashcardStats } = useFlashcardStore();
  const { summary: goalsSummary, togglePanel: toggleGoals } = useGoalsStore();
  const { togglePanel: toggleDailyNotes } = useDailyNotesStore();
  const autoHidePanels = useThemeStore((state) => state.autoHidePanels);
  const setAutoHidePanels = useThemeStore((state) => state.setAutoHidePanels);
  const showRecentPages = useThemeStore((state) => state.showRecentPages);
  const showFavoritePages = useThemeStore((state) => state.showFavoritePages);

  // Collapsible section states
  const [recentExpanded, setRecentExpanded] = useState(true);
  const [favoritesExpanded, setFavoritesExpanded] = useState(true);
  const [showAllRecent, setShowAllRecent] = useState(false);

  // Get recent and favorite pages
  const recentPages = getRecentPages(showAllRecent ? 20 : 5);
  const favoritePages = getFavoritePages();

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

      {/* Favorites Section */}
      {showFavoritePages && favoritePages.length > 0 && (
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
              {favoritePages.map((page) => {
                const notebook = visibleNotebooks.find((n) => n.id === page.notebookId);
                return (
                  <li key={page.id}>
                    <button
                      onClick={() => {
                        if (notebook) {
                          selectNotebook(notebook.id);
                        }
                        selectPage(page.id);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                      style={{ color: "var(--color-text-secondary)" }}
                      title={`${page.title} (${notebook?.name || "Unknown notebook"})`}
                    >
                      <IconStarFilled />
                      <span className="flex-1 truncate">{page.title}</span>
                    </button>
                  </li>
                );
              })}
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
      <div
        className="border-t px-4 py-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        {/* Tool buttons - arranged in a flex grid */}
        <div className="flex flex-wrap justify-center gap-1">
          {/* Quick Capture */}
          <button
            onClick={openQuickCapture}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Quick Capture (⌘⇧C)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
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
          {/* Inbox */}
          <button
            onClick={openInboxPanel}
            className="relative flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Inbox (⌘⇧I)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
              <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
            </svg>
            {summary && summary.unprocessed_count > 0 && (
              <span
                className="absolute right-1 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                {summary.unprocessed_count > 9 ? "9+" : summary.unprocessed_count}
              </span>
            )}
          </button>
          {/* AI Chat */}
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
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="AI Chat (⌘⇧A)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
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
          {/* Actions */}
          <button
            onClick={openActionLibrary}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Actions (⌘⇧X)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
          </button>
          {/* Flashcards */}
          <button
            onClick={toggleFlashcards}
            className="relative flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Flashcards (⌘⇧F)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <line x1="2" y1="12" x2="22" y2="12" />
            </svg>
            {flashcardStats && flashcardStats.dueCards > 0 && (
              <span
                className="absolute right-1 top-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                {flashcardStats.dueCards > 9 ? "9+" : flashcardStats.dueCards}
              </span>
            )}
          </button>
          {/* Goals */}
          <button
            onClick={toggleGoals}
            className="relative flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Goals"
          >
            {goalsSummary && goalsSummary.highestStreak > 0 ? (
              <span className="text-sm">🔥</span>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            )}
            {goalsSummary && goalsSummary.highestStreak > 0 && (
              <span
                className="absolute right-0.5 top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-0.5 text-[9px] font-bold"
                style={{ backgroundColor: "rgba(239, 68, 68, 0.2)", color: "#ef4444" }}
              >
                {goalsSummary.highestStreak}
              </span>
            )}
          </button>
          {/* Daily Notes */}
          <button
            onClick={toggleDailyNotes}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Daily Notes (⌘⇧D)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>
          {/* Graph View */}
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
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Graph View (⌘G)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
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
          {/* Settings */}
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
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Settings (⌘,)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="15"
              height="15"
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
        {/* Notebook count and archive toggle */}
        <div className="mt-2 flex items-center justify-center gap-2">
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
