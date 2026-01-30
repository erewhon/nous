import { useEffect, useRef } from "react";
import { useNotebookStore } from "../stores/notebookStore";
import { usePageStore } from "../stores/pageStore";
import { useSectionStore } from "../stores/sectionStore";
import { useGoalsStore } from "../stores/goalsStore";
import { useWindowLibrary } from "../contexts/WindowContext";

// Check goals every 15 minutes
const GOALS_CHECK_INTERVAL = 15 * 60 * 1000;

export function useAppInit() {
  const { loadNotebooks, selectedNotebookId, getNotebookViewState } = useNotebookStore();
  const { loadPages, clearPages, selectPage, pages, isLoading: pagesLoading } = usePageStore();
  const { selectSection } = useSectionStore();
  const { loadGoals, checkAutoGoals, loadSummary } = useGoalsStore();
  const { library } = useWindowLibrary();
  const goalsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restoredForNotebookRef = useRef<string | null>(null);

  // Load notebooks when library is available
  useEffect(() => {
    if (library) {
      loadNotebooks();
    }
  }, [loadNotebooks, library]);

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
      selectSection(savedState.sectionId);
    }
    if (savedState.pageId && pages.some((p) => p.id === savedState.pageId)) {
      selectPage(savedState.pageId);
    }
  }, [selectedNotebookId, pagesLoading, pages, getNotebookViewState, selectPage, selectSection]);

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
