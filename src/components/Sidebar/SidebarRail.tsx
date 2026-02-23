import { useCallback, useMemo } from "react";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useInboxStore } from "../../stores/inboxStore";
import { useActionStore } from "../../stores/actionStore";
import { useFlashcardStore } from "../../stores/flashcardStore";
import { useGoalsStore } from "../../stores/goalsStore";
import { useDailyNotesStore } from "../../stores/dailyNotesStore";
import { useTasksStore } from "../../stores/tasksStore";
import { useContactStore } from "../../stores/contactStore";
import { useMonitorStore } from "../../stores/monitorStore";
import { useThemeStore, type ToolButtonId } from "../../stores/themeStore";

export type RailSection = "notebooks" | "sections" | "pages" | null;

interface SidebarRailProps {
  activeSection: RailSection;
  onSectionClick: (section: RailSection) => void;
  sectionsEnabled: boolean;
}

export function SidebarRail({ activeSection, onSectionClick, sectionsEnabled }: SidebarRailProps) {
  const sidebarMode = useThemeStore((s) => s.sidebarMode);
  const setSidebarMode = useThemeStore((s) => s.setSidebarMode);
  const pinnedToolButtons = useThemeStore((s) => s.pinnedToolButtons);

  const { openQuickCapture, openInboxPanel, summary } = useInboxStore();
  const openActionLibrary = useActionStore((s) => s.openActionLibrary);
  const { togglePanel: toggleFlashcards, stats: flashcardStats } = useFlashcardStore();
  const { summary: goalsSummary, togglePanel: toggleGoals } = useGoalsStore();
  const { togglePanel: toggleDailyNotes } = useDailyNotesStore();
  const { summary: tasksSummary, togglePanel: toggleTasks } = useTasksStore();
  const { togglePanel: togglePeople } = useContactStore();
  const { openMonitorPanel, unreadCount: monitorUnread } = useMonitorStore();
  const { pages, selectedPageId, selectPage } = usePageStore();
  const { selectedNotebookId } = useNotebookStore();

  const handleNavClick = useCallback(
    (section: "notebooks" | "sections" | "pages") => {
      if (activeSection === section) {
        onSectionClick(null);
      } else {
        onSectionClick(section);
      }
    },
    [activeSection, onSectionClick]
  );

  const handleSearchClick = useCallback(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
    );
  }, []);

  const dispatchKey = useCallback((key: string, meta: boolean, shift: boolean) => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key, metaKey: meta, shiftKey: shift, bubbles: true })
    );
  }, []);

  const openRandomNote = useCallback(() => {
    const candidates = pages.filter(
      (p) => p.notebookId === selectedNotebookId && !p.deletedAt && p.id !== selectedPageId
    );
    if (candidates.length > 0) {
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      selectPage(pick.id);
    }
  }, [pages, selectedNotebookId, selectedPageId, selectPage]);

  // Build tool button action map
  const toolActions = useMemo(() => {
    const taskBadge = tasksSummary.overdueCount > 0 ? tasksSummary.overdueCount : tasksSummary.dueTodayCount > 0 ? tasksSummary.dueTodayCount : 0;
    return new Map<ToolButtonId, { onClick: () => void; badge?: number; badgeEmoji?: string; icon: string }>([
      ["quick-capture", { onClick: openQuickCapture, icon: "M12 5v14M5 12h14" }],
      ["web-clipper", { onClick: () => window.dispatchEvent(new CustomEvent("open-web-clipper")), icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM2 12h20" }],
      ["inbox", { onClick: openInboxPanel, badge: summary?.unprocessed_count ?? 0, icon: "M22 12l-6 0-2 3H10L8 12l-6 0M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }],
      ["flashcards", { onClick: toggleFlashcards, badge: flashcardStats?.dueCards ?? 0, icon: "M2 4h20v16H2zM2 12h20" }],
      ["tasks", { onClick: toggleTasks, badge: taskBadge, icon: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" }],
      ["goals", { onClick: toggleGoals, badge: goalsSummary?.highestStreak ?? 0, badgeEmoji: (goalsSummary?.highestStreak ?? 0) > 0 ? "\uD83D\uDD25" : undefined, icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" }],
      ["people", { onClick: togglePeople, icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" }],
      ["daily-notes", { onClick: toggleDailyNotes, icon: "M3 4h18v18H3zM16 2v4M8 2v4M3 10h18" }],
      ["ai-chat", { onClick: () => dispatchKey("A", true, true), icon: "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" }],
      ["actions", { onClick: openActionLibrary, icon: "M13 2L3 14h9l-1 8 10-12h-9l1-8" }],
      ["graph-view", { onClick: () => dispatchKey("g", true, false), icon: "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM14.5 9.5l3-3M9.5 14.5l-3 3" }],
      ["random-note", { onClick: openRandomNote, icon: "M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M18 2l4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8M18 14l4 4-4 4" }],
      ["monitor", { onClick: openMonitorPanel, badge: monitorUnread, icon: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" }],
      ["settings", { onClick: () => dispatchKey(",", true, false), icon: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" }],
    ]);
  }, [
    openQuickCapture, openInboxPanel, toggleFlashcards, toggleTasks, toggleGoals,
    togglePeople, toggleDailyNotes, openActionLibrary, openRandomNote, dispatchKey,
    openMonitorPanel, summary, flashcardStats, goalsSummary, tasksSummary, monitorUnread,
  ]);

  // Resolve pinned buttons (excluding settings which is always shown at bottom)
  const pinnedButtons = useMemo(
    () => pinnedToolButtons.filter((id) => id !== "settings").map((id) => {
      const action = toolActions.get(id);
      return action ? { id, ...action } : null;
    }).filter(Boolean) as Array<{ id: ToolButtonId; onClick: () => void; badge?: number; badgeEmoji?: string; icon: string }>,
    [pinnedToolButtons, toolActions]
  );

  const settingsAction = toolActions.get("settings");

  return (
    <div
      className="flex h-full w-12 flex-shrink-0 flex-col items-center border-r py-3"
      style={{
        backgroundColor: "var(--color-bg-sidebar)",
        borderColor: "var(--color-border)",
      }}
    >
      {/* Logo */}
      <button
        onClick={() => setSidebarMode(sidebarMode === "rail" ? "full" : "rail")}
        className="mb-1 flex h-8 w-8 items-center justify-center rounded-md"
        style={{ backgroundColor: "var(--color-accent)" }}
        title="Expand sidebar"
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
      </button>

      {/* Divider */}
      <div className="mx-2 my-2 w-6 border-t" style={{ borderColor: "var(--color-border)" }} />

      {/* Navigation icons */}
      <RailIcon
        active={activeSection === "notebooks"}
        onClick={() => handleNavClick("notebooks")}
        title="Notebooks"
      >
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
      </RailIcon>

      {sectionsEnabled && (
        <RailIcon
          active={activeSection === "sections"}
          onClick={() => handleNavClick("sections")}
          title="Sections"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </RailIcon>
      )}

      <RailIcon
        active={activeSection === "pages"}
        onClick={() => handleNavClick("pages")}
        title="Pages"
      >
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
        <polyline points="14,2 14,8 20,8" />
      </RailIcon>

      <RailIcon
        active={false}
        onClick={handleSearchClick}
        title="Search (Cmd+K)"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </RailIcon>

      {/* Divider */}
      <div className="mx-2 my-2 w-6 border-t" style={{ borderColor: "var(--color-border)" }} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Divider before tools */}
      <div className="mx-2 my-2 w-6 border-t" style={{ borderColor: "var(--color-border)" }} />

      {/* Pinned tool buttons */}
      {pinnedButtons.map((btn) => (
        <RailToolIcon key={btn.id} onClick={btn.onClick} title={btn.id} badge={btn.badge} badgeEmoji={btn.badgeEmoji}>
          <path d={btn.icon} />
        </RailToolIcon>
      ))}

      {/* Settings always at bottom */}
      {settingsAction && (
        <RailToolIcon onClick={settingsAction.onClick} title="Settings (Cmd+,)">
          <path d={settingsAction.icon} />
        </RailToolIcon>
      )}
    </div>
  );
}

function RailIcon({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="mb-1 flex h-10 w-10 items-center justify-center rounded-lg transition-colors"
      style={{
        backgroundColor: active ? "var(--color-selection)" : "transparent",
        color: active ? "var(--color-accent)" : "var(--color-text-muted)",
      }}
      title={title}
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
        {children}
      </svg>
    </button>
  );
}

function RailToolIcon({
  onClick,
  title,
  badge,
  badgeEmoji,
  children,
}: {
  onClick: () => void;
  title: string;
  badge?: number;
  badgeEmoji?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="relative mb-1 flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-[--color-bg-tertiary]"
      style={{ color: "var(--color-text-muted)" }}
      title={title}
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
        {children}
      </svg>
      {badge !== undefined && badge > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-0.5 text-[8px] font-bold"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
          }}
        >
          {badgeEmoji || (badge > 9 ? "9+" : badge)}
        </span>
      )}
    </button>
  );
}
