import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useThemeStore } from "../../stores/themeStore";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useTasksStore } from "../../stores/tasksStore";
import { useFlashcardStore } from "../../stores/flashcardStore";
import { useInboxStore } from "../../stores/inboxStore";
import { useDailyNotesStore } from "../../stores/dailyNotesStore";

// The Study sidebar — Direction A's editorial left column (design brief
// nous-app.md; mockup design/direction-a-editor.html). A third SidebarMode
// alongside "full" and "rail": a flat, calm PINNED / NOTEBOOKS / VIEWS frame.

interface StudySidebarProps {
  width: number;
}

// Fire a synthetic keystroke — the app's global keyboard handler owns these
// shortcuts (Cmd+, opens Settings, Cmd+G opens Graph, …), so dispatching the
// key reuses the exact path the classic sidebar/rail already trigger.
function dispatchKey(key: string, meta: boolean, shift: boolean) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, metaKey: meta, shiftKey: shift, bubbles: true })
  );
}

const openCommandPalette = () =>
  window.dispatchEvent(new CustomEvent("open-command-palette"));

const PAGE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <path d="M6 3h9l4 4v14H6z" />
    <path d="M14 3v5h5" />
  </svg>
);

export function StudySidebar({ width }: StudySidebarProps) {
  const uiMode = useThemeStore((s) => s.uiMode);
  const selectNotebook = useNotebookStore((s) => s.selectNotebook);

  // Wordmark → notebook overview front door (only meaningful in overview
  // uiMode; a no-op in classic where there is no library home to return to).
  // Matches OverviewLayout's "All Notebooks" affordance (selectNotebook(null)).
  const handleWordmark = () => {
    if (uiMode === "overview") {
      selectNotebook(null);
    }
  };

  return (
    <div
      className="flex h-full flex-col"
      style={{
        width: `${width}px`,
        backgroundColor: "var(--color-bg-sidebar)",
        borderRight: "1px solid var(--color-border-muted)",
      }}
    >
      {/* Top: wordmark + new-page, then the ⌘K search box */}
      <div className="flex-none px-4 pb-3 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={handleWordmark}
            className="leading-none"
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 22,
              letterSpacing: "0.01em",
              color: "var(--color-text-primary)",
              cursor: uiMode === "overview" ? "pointer" : "default",
            }}
            title={uiMode === "overview" ? "All notebooks" : "Nous"}
          >
            Nou<span style={{ color: "var(--color-accent)" }}>s</span>
          </button>
          <StudyIconButton
            title="New page"
            onClick={() => window.dispatchEvent(new CustomEvent("new-page"))}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </StudyIconButton>
        </div>

        <button
          type="button"
          onClick={openCommandPalette}
          className="flex w-full items-center gap-2 transition-colors"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)",
            padding: "6px 10px",
            color: "var(--color-text-muted)",
            fontSize: 12.5,
            cursor: "text",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.borderColor = "var(--color-text-muted)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.borderColor = "var(--color-border)")
          }
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="flex-1 text-left">Search or jump to…</span>
          <StudyKbd>⌘K</StudyKbd>
        </button>
      </div>

      {/* Scroll: the three editorial sections */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
        <PinnedSection />
        <NotebooksSection />
        <ViewsSection />
      </nav>

      {/* Footer: Settings */}
      <div
        className="flex flex-none items-center justify-between px-4 py-3"
        style={{ borderTop: "1px solid var(--color-border-muted)" }}
      >
        <StudyRow onClick={() => dispatchKey(",", true, false)} width="auto">
          <StudyRowIcon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M4.5 4.5l2 2M17.5 17.5l2 2M2 12h3M19 12h3M4.5 19.5l2-2M17.5 6.5l2-2" />
            </svg>
          </StudyRowIcon>
          <span className="flex-1">Settings</span>
        </StudyRow>
        <StudyKbd>⌘,</StudyKbd>
      </div>
    </div>
  );
}

// ---- PINNED: today's daily note + favorite pages ----

function PinnedSection() {
  const selectedNotebookId = useNotebookStore((s) => s.selectedNotebookId);
  const selectNotebook = useNotebookStore((s) => s.selectNotebook);
  const allFavoritePages = usePageStore((s) => s.allFavoritePages);
  const selectPage = usePageStore((s) => s.selectPage);
  const selectedPageId = usePageStore((s) => s.selectedPageId);
  const openTodayNote = useDailyNotesStore((s) => s.openTodayNote);

  // Resolve a notebook for the daily note the way the rest of the app does
  // (the selected notebook). If none, we hide the Today row rather than guess.
  const todayNotebookId = selectedNotebookId;

  const todayLabel = useMemo(
    () =>
      new Date().toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    []
  );

  const favorites = allFavoritePages.slice(0, 6);
  const hasContent = !!todayNotebookId || favorites.length > 0;
  if (!hasContent) return null;

  const openToday = async () => {
    if (!todayNotebookId) return;
    try {
      const note = await openTodayNote(todayNotebookId);
      // A just-created note isn't in the page list yet; reload before selecting.
      await usePageStore.getState().loadPages(todayNotebookId);
      await selectPage(note.id);
    } catch (err) {
      console.error("Failed to open today's daily note:", err);
    }
  };

  return (
    <>
      <StudySectionLabel>Pinned</StudySectionLabel>
      {todayNotebookId && (
        <StudyRow onClick={openToday}>
          <StudyRowIcon>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="4" y="5" width="16" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M4 11h16" />
            </svg>
          </StudyRowIcon>
          <span className="flex-1 truncate">Today · {todayLabel}</span>
        </StudyRow>
      )}
      {favorites.map((fav) => (
        <StudyRow
          key={fav.id}
          selected={fav.id === selectedPageId}
          title={`${fav.title} — ${fav.notebookName}`}
          onClick={() => {
            selectNotebook(fav.notebookId);
            selectPage(fav.id);
          }}
        >
          <StudyRowIcon selected={fav.id === selectedPageId}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3 2.7 5.6 6.3.9-4.5 4.3 1 6.2-5.5-3-5.5 3 1-6.2L3 9.5l6.3-.9z" />
            </svg>
          </StudyRowIcon>
          <span className="flex-1 truncate">{fav.title}</span>
        </StudyRow>
      ))}
    </>
  );
}

// ---- NOTEBOOKS: flat list; active notebook expands to its recent pages ----

function NotebooksSection() {
  const notebooks = useNotebookStore((s) => s.notebooks);
  const showArchived = useNotebookStore((s) => s.showArchived);
  const pageCounts = useNotebookStore((s) => s.pageCounts);
  const selectedNotebookId = useNotebookStore((s) => s.selectedNotebookId);
  const selectNotebook = useNotebookStore((s) => s.selectNotebook);
  const createNotebook = useNotebookStore((s) => s.createNotebook);
  const pages = usePageStore((s) => s.pages);
  const selectPage = usePageStore((s) => s.selectPage);
  const selectedPageId = usePageStore((s) => s.selectedPageId);
  const setSidebarMode = useThemeStore((s) => s.setSidebarMode);

  const visibleNotebooks = useMemo(
    () => (showArchived ? notebooks : notebooks.filter((n) => !n.archived)),
    [notebooks, showArchived]
  );

  // Accordion: exactly one notebook open, following the selection. External
  // selection (breadcrumb, ⌘K) expands the right notebook; clicking the open
  // one collapses it without deselecting.
  const [expandedId, setExpandedId] = useState<string | null>(selectedNotebookId);
  useEffect(() => {
    setExpandedId(selectedNotebookId);
  }, [selectedNotebookId]);

  // pageStore.pages holds the SELECTED notebook's pages, so only show the
  // inline page list when the open notebook is the selected one.
  const recentPages = useMemo(() => {
    if (!expandedId || expandedId !== selectedNotebookId) return [];
    return pages
      .filter((p) => !p.isCover)
      .slice()
      .sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      )
      .slice(0, 8);
  }, [pages, expandedId, selectedNotebookId]);

  const onNotebookClick = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null); // collapse (stays selected)
    } else {
      selectNotebook(id);
      setExpandedId(id);
    }
  };

  return (
    <>
      <StudySectionLabel
        action={
          <StudyIconButton
            title="New notebook"
            size={20}
            onClick={() => createNotebook("New Notebook")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </StudyIconButton>
        }
      >
        Notebooks
      </StudySectionLabel>

      {visibleNotebooks.map((nb) => {
        const isOpen = expandedId === nb.id;
        const count = pageCounts[nb.id];
        return (
          <div key={nb.id}>
            <StudyRow emphasis onClick={() => onNotebookClick(nb.id)}>
              <span
                aria-hidden
                className="flex-none transition-transform"
                style={{
                  width: 12,
                  height: 12,
                  color: "var(--color-text-muted)",
                  transform: isOpen ? "rotate(90deg)" : "none",
                }}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </span>
              <span
                aria-hidden
                className="flex-none"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2.5,
                  backgroundColor: nb.color || "var(--color-accent)",
                }}
              />
              <span className="flex-1 truncate">{nb.name}</span>
              {count !== undefined && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--color-text-muted)",
                  }}
                >
                  {count}
                </span>
              )}
            </StudyRow>

            {isOpen && (
              <>
                {recentPages.map((p) => (
                  <StudyRow
                    key={p.id}
                    indent
                    selected={p.id === selectedPageId}
                    title={p.title || "Untitled"}
                    onClick={() => selectPage(p.id)}
                  >
                    <StudyRowIcon selected={p.id === selectedPageId}>
                      {PAGE_ICON}
                    </StudyRowIcon>
                    <span className="flex-1 truncate">{p.title || "Untitled"}</span>
                  </StudyRow>
                ))}
                {/* Escape hatch to the full sidebar — the reachability answer
                    for folders / sections / drag-and-drop that this flat list
                    deliberately omits. Keeps the notebook selected. */}
                <StudyRow indent onClick={() => setSidebarMode("full")}>
                  <span
                    className="flex-1 truncate"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    All pages →
                  </span>
                </StudyRow>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

// ---- VIEWS: global tools with live badge counts ----

function ViewsSection() {
  const tasksSummary = useTasksStore((s) => s.summary);
  const toggleTasks = useTasksStore((s) => s.togglePanel);
  const toggleFlashcards = useFlashcardStore((s) => s.togglePanel);
  const flashcardStats = useFlashcardStore((s) => s.stats);
  const inboxSummary = useInboxStore((s) => s.summary);
  const openInboxPanel = useInboxStore((s) => s.openInboxPanel);

  const taskBadge =
    tasksSummary.overdueCount > 0
      ? tasksSummary.overdueCount
      : tasksSummary.dueTodayCount > 0
        ? tasksSummary.dueTodayCount
        : 0;
  const dueCards = flashcardStats?.dueCards ?? 0;
  const inboxCount = inboxSummary?.unprocessed_count ?? 0;

  return (
    <>
      <StudySectionLabel>Views</StudySectionLabel>
      <StudyRow onClick={() => dispatchKey("g", true, false)}>
        <StudyRowIcon>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="6" cy="6" r="2.5" />
            <circle cx="18" cy="8" r="2.5" />
            <circle cx="12" cy="17" r="2.5" />
            <path d="m8 7 7.5.8M7.5 7.8l3 7M16.5 10l-3 5.2" />
          </svg>
        </StudyRowIcon>
        <span className="flex-1">Graph</span>
      </StudyRow>
      <StudyRow onClick={toggleTasks}>
        <StudyRowIcon>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
          </svg>
        </StudyRowIcon>
        <span className="flex-1">All tasks</span>
        {taskBadge > 0 && <StudyBadge>{taskBadge}</StudyBadge>}
      </StudyRow>
      <StudyRow onClick={toggleFlashcards}>
        <StudyRowIcon>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="m4.9 13.5 3.6-8.3c.3-.8 1.5-.8 1.8 0l3.6 8.3M6 11h6.8M15 9.5l2.2 4c.3.5 1.1.5 1.4 0l2.2-4" />
          </svg>
        </StudyRowIcon>
        <span className="flex-1">Flashcards</span>
        {dueCards > 0 && <StudyBadge>{dueCards} due</StudyBadge>}
      </StudyRow>
      <StudyRow onClick={openInboxPanel}>
        <StudyRowIcon>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.5 6.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-5.5A2 2 0 0 0 16.8 5H7.2a2 2 0 0 0-1.7 1.5z" />
          </svg>
        </StudyRowIcon>
        <span className="flex-1">Inbox</span>
        {inboxCount > 0 && <StudyBadge>{inboxCount}</StudyBadge>}
      </StudyRow>
    </>
  );
}

// ---- Shared presentational primitives (reused across sections) ----

export function StudySectionLabel({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-between px-2 pb-1 pt-4"
      style={{
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.09em",
        textTransform: "uppercase",
        color: "var(--color-text-muted)",
      }}
    >
      <span>{children}</span>
      {action}
    </div>
  );
}

export function StudyRow({
  children,
  onClick,
  selected = false,
  indent = false,
  emphasis = false,
  width = "100%",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  indent?: boolean;
  emphasis?: boolean;
  width?: string;
  title?: string;
}) {
  const restColor = emphasis
    ? "var(--color-text-primary)"
    : "var(--color-text-secondary)";
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-2 text-left transition-colors"
      style={{
        width,
        padding: indent ? "5px 8px 5px 28px" : "5px 8px",
        borderRadius: "var(--radius-sm)",
        fontSize: 13,
        fontWeight: emphasis ? 500 : 400,
        color: selected ? "var(--color-text-primary)" : restColor,
        backgroundColor: selected ? "var(--color-selection)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
          e.currentTarget.style.color = "var(--color-text-primary)";
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = restColor;
        }
      }}
    >
      {children}
    </button>
  );
}

export function StudyRowIcon({
  children,
  selected = false,
}: {
  children: ReactNode;
  selected?: boolean;
}) {
  return (
    <span
      aria-hidden
      className="flex-none"
      style={{
        width: 15,
        height: 15,
        color: selected ? "var(--color-accent)" : "var(--color-text-muted)",
      }}
    >
      {children}
    </span>
  );
}

export function StudyBadge({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 500,
        borderRadius: "var(--radius-full)",
        padding: "1px 7px",
        color: "var(--color-accent)",
        backgroundColor: "var(--color-selection)",
      }}
    >
      {children}
    </span>
  );
}

export function StudyKbd({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--color-text-secondary)",
        backgroundColor: "var(--color-bg-tertiary)",
        border: "1px solid var(--color-border)",
        borderBottomWidth: 2,
        borderRadius: "var(--radius-xs)",
        padding: "1px 5px",
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  );
}

export function StudyIconButton({
  children,
  onClick,
  title,
  size = 26,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  size?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex items-center justify-center transition-colors"
      style={{
        width: size,
        height: size,
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text-muted)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
        e.currentTarget.style.color = "var(--color-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = "var(--color-text-muted)";
      }}
    >
      {children}
    </button>
  );
}
