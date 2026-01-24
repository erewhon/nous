import { useEffect, useRef } from "react";
import { useNotebookStore } from "../stores/notebookStore";
import { usePageStore } from "../stores/pageStore";
import { useGoalsStore } from "../stores/goalsStore";
import { useWindowLibrary } from "../contexts/WindowContext";

// Check goals every 15 minutes
const GOALS_CHECK_INTERVAL = 15 * 60 * 1000;

export function useAppInit() {
  const { loadNotebooks, selectedNotebookId } = useNotebookStore();
  const { loadPages, clearPages } = usePageStore();
  const { loadGoals, checkAutoGoals, loadSummary } = useGoalsStore();
  const { library } = useWindowLibrary();
  const goalsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
