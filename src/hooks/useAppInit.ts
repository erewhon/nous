import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useNotebookStore } from "../stores/notebookStore";
import { usePageStore } from "../stores/pageStore";
import { useSectionStore } from "../stores/sectionStore";
import { useGoalsStore } from "../stores/goalsStore";
import { useContactStore } from "../stores/contactStore";
import { useEnergyStore } from "../stores/energyStore";
import { useWindowLibrary } from "../contexts/WindowContext";

// Check goals every 15 minutes
const GOALS_CHECK_INTERVAL = 15 * 60 * 1000;

export function useAppInit() {
  const { loadNotebooks, notebooks, selectedNotebookId, selectNotebook, getNotebookViewState, saveNotebookViewState } = useNotebookStore();
  const loadPages = usePageStore((s) => s.loadPages);
  const clearPages = usePageStore((s) => s.clearPages);
  const selectPage = usePageStore((s) => s.selectPage);
  const selectedPageId = usePageStore((s) => s.selectedPageId);
  const pages = usePageStore((s) => s.pages);
  const pagesLoading = usePageStore((s) => s.isLoading);
  const refreshPages = usePageStore((s) => s.refreshPages);
  const { sections, selectedSectionId, selectSection, loadSections } = useSectionStore();
  const { loadGoals, checkAutoGoals, loadSummary } = useGoalsStore();
  const { loadContacts: loadContactsFromStore } = useContactStore();
  const loadTodayCheckIn = useEnergyStore((s) => s.loadTodayCheckIn);
  const { library } = useWindowLibrary();
  const goalsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restoredForNotebookRef = useRef<string | null>(null);

  // Load notebooks when library is available
  useEffect(() => {
    if (library) {
      loadNotebooks();
    }
  }, [loadNotebooks, library]);

  // Validate persisted selectedNotebookId still exists after notebooks load
  useEffect(() => {
    if (notebooks.length === 0 || !selectedNotebookId) return;
    if (!notebooks.some((n) => n.id === selectedNotebookId)) {
      selectNotebook(null);
    }
  }, [notebooks, selectedNotebookId, selectNotebook]);

  // Load pages when notebook selection changes
  useEffect(() => {
    if (selectedNotebookId) {
      loadPages(selectedNotebookId);
    } else {
      clearPages();
    }
  }, [selectedNotebookId, loadPages, clearPages]);

  // Restore last-viewed section and page when switching back to a notebook
  useEffect(() => {
    if (!selectedNotebookId || pagesLoading) return;
    if (selectedNotebookId === restoredForNotebookRef.current) return;

    restoredForNotebookRef.current = selectedNotebookId;

    const savedState = getNotebookViewState(selectedNotebookId);
    if (!savedState) return;

    if (savedState.sectionId) {
      // Validate section still exists if sections are loaded
      if (sections.length === 0 || sections.some((s) => s.id === savedState.sectionId)) {
        selectSection(savedState.sectionId);
      }
    }
    if (savedState.pageId && pages.some((p) => p.id === savedState.pageId)) {
      selectPage(savedState.pageId);
    }
  }, [selectedNotebookId, pagesLoading, pages, sections, getNotebookViewState, selectPage, selectSection]);

  // Continuously persist current section/page into notebookViewState so it
  // survives an app restart (selectNotebook only saves on *switch*, not on quit)
  useEffect(() => {
    if (!selectedNotebookId) return;
    // Skip during the initial restore to avoid overwriting saved state with
    // stale defaults before the restore effect has run
    if (restoredForNotebookRef.current !== selectedNotebookId) return;

    saveNotebookViewState(selectedNotebookId, selectedSectionId, selectedPageId);
  }, [selectedNotebookId, selectedSectionId, selectedPageId, saveNotebookViewState]);

  // Listen for sync-pages-updated events from the backend.
  // When sync pulls or merges pages from remote, the editor may have stale
  // in-memory data. Refreshing from disk prevents the editor's auto-save
  // from overwriting the sync'd content.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen<{ notebookId: string; pageIds: string[] }>(
        "sync-pages-updated",
        (event) => {
          const { pageIds } = event.payload;
          if (pageIds.length > 0) {
            console.log(
              `[sync] Refreshing ${pageIds.length} page(s) updated by sync`
            );
            refreshPages(pageIds);
          }
        }
      );
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [refreshPages]);

  // Listen for sync-goals-updated events from the backend.
  // When sync pulls goal or progress changes from remote, refresh displays.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen("sync-goals-updated", () => {
        console.log("[sync] Goals updated by sync, refreshing");
        loadGoals();
        loadSummary();
        checkAutoGoals();
      });
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadGoals, loadSummary, checkAutoGoals]);

  // Listen for sync-contacts-updated events from the backend.
  // When sync pulls contact or activity changes from remote, refresh displays.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen("sync-contacts-updated", () => {
        console.log("[sync] Contacts updated by sync, refreshing");
        loadContactsFromStore();
      });
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadContactsFromStore]);

  // Listen for sync-energy-updated events from the backend.
  // When sync pulls energy check-in changes from remote, refresh displays.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen("sync-energy-updated", () => {
        console.log("[sync] Energy updated by sync, refreshing");
        loadTodayCheckIn();
      });
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadTodayCheckIn]);

  // Listen for sync-notebook-updated events from the backend.
  // When sync pulls notebook metadata or section changes, reload them.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setup = async () => {
      unlisten = await listen<{ notebookId: string }>(
        "sync-notebook-updated",
        (event) => {
          const { notebookId } = event.payload;
          console.log(`[sync] Notebook ${notebookId} updated by sync, refreshing`);
          loadNotebooks();
          loadSections(notebookId);
        }
      );
    };

    setup();

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadNotebooks, loadSections]);

  // Load goals and check auto-detected goals on app init and periodically
  useEffect(() => {
    // Initial load
    loadGoals();
    loadSummary();
    checkAutoGoals();

    // Set up periodic checking
    goalsIntervalRef.current = setInterval(() => {
      checkAutoGoals();
      loadSummary();
    }, GOALS_CHECK_INTERVAL);

    // Also check on window focus
    const handleFocus = () => {
      checkAutoGoals();
      loadSummary();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      if (goalsIntervalRef.current) {
        clearInterval(goalsIntervalRef.current);
      }
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadGoals, loadSummary, checkAutoGoals]);
}
