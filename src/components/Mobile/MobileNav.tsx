import { useCallback } from "react";
import { useMobileStore } from "../../stores/mobileStore";
import { useInboxStore } from "../../stores/inboxStore";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useDailyNotesStore } from "../../stores/dailyNotesStore";
import { searchPages } from "../../utils/api";

/**
 * Phone bottom navigation: Capture · Today · Tasks · Search · Browse
 * (Forge "Spec: Nous Mobile Web Experience" §2, decisions A/B 2026-07-06).
 * Thumb-zone placement, 44px+ targets, safe-area padded.
 */

// The Tasks slot opens the Forge task board (decision B2). Resolved by
// title search so nothing is hardcoded to a page id.
const TASKS_PAGE_TITLE = "Project Tasks";

function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="flex flex-1 flex-col items-center justify-center gap-0.5"
      style={{ minHeight: 56, color: "var(--color-text-secondary)" }}
    >
      {children}
      <span style={{ fontSize: 10 }}>{label}</span>
    </button>
  );
}

export function MobileNav() {
  const toggleDrawer = useMobileStore((s) => s.toggleDrawer);
  const closeDrawer = useMobileStore((s) => s.closeDrawer);
  const openQuickCapture = useInboxStore((s) => s.openQuickCapture);
  const openTodayNote = useDailyNotesStore((s) => s.openTodayNote);

  const handleCapture = useCallback(() => {
    closeDrawer();
    openQuickCapture();
  }, [closeDrawer, openQuickCapture]);

  const handleToday = useCallback(async () => {
    closeDrawer();
    const notebookId = useNotebookStore.getState().selectedNotebookId;
    if (!notebookId) {
      toggleDrawer(); // pick a notebook first
      return;
    }
    try {
      const note = await openTodayNote(notebookId);
      // A just-created note isn't in the store's page list yet, and panes
      // only render pages they can find there — reload before selecting.
      await usePageStore.getState().loadPages(notebookId);
      await usePageStore.getState().selectPage(note.id);
    } catch (err) {
      console.error("Failed to open daily note:", err);
    }
  }, [closeDrawer, openTodayNote, toggleDrawer]);

  const handleTasks = useCallback(async () => {
    closeDrawer();
    try {
      const results = await searchPages(TASKS_PAGE_TITLE, 10);
      const hit =
        results.find((r) => r.title === TASKS_PAGE_TITLE) ?? results[0];
      if (!hit) return;
      const { selectedNotebookId, selectNotebook } =
        useNotebookStore.getState();
      if (selectedNotebookId !== hit.notebookId) {
        selectNotebook(hit.notebookId);
      }
      // Panes only render pages present in the store — make sure the
      // target notebook's pages are loaded before selecting.
      await usePageStore.getState().loadPages(hit.notebookId);
      await usePageStore.getState().selectPage(hit.pageId);
    } catch (err) {
      console.error("Failed to open tasks board:", err);
    }
  }, [closeDrawer]);

  const handleSearch = useCallback(() => {
    closeDrawer();
    window.dispatchEvent(new CustomEvent("open-command-palette"));
  }, [closeDrawer]);

  return (
    <nav
      className="flex flex-shrink-0 border-t"
      style={{
        backgroundColor: "var(--color-bg-secondary)",
        borderColor: "var(--color-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      aria-label="Mobile navigation"
    >
      <NavButton label="Capture" onClick={handleCapture}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </NavButton>
      <NavButton label="Today" onClick={handleToday}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </NavButton>
      <NavButton label="Tasks" onClick={handleTasks}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      </NavButton>
      <NavButton label="Search" onClick={handleSearch}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </NavButton>
      <NavButton label="Browse" onClick={toggleDrawer}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </NavButton>
    </nav>
  );
}
