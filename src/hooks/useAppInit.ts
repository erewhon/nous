import { useEffect } from "react";
import { useNotebookStore } from "../stores/notebookStore";
import { usePageStore } from "../stores/pageStore";
import { useGoalsStore } from "../stores/goalsStore";
import { useWindowLibrary } from "../contexts/WindowContext";

export function useAppInit() {
  const { loadNotebooks, selectedNotebookId } = useNotebookStore();
  const { loadPages, clearPages } = usePageStore();
  const { loadGoals, checkAutoGoals, loadSummary } = useGoalsStore();
  const { library } = useWindowLibrary();

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

  // Load goals and check auto-detected goals on app init
  useEffect(() => {
    loadGoals();
    loadSummary();
    checkAutoGoals();
  }, [loadGoals, loadSummary, checkAutoGoals]);
}
