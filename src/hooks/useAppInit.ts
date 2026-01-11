import { useEffect } from "react";
import { useNotebookStore } from "../stores/notebookStore";
import { usePageStore } from "../stores/pageStore";

export function useAppInit() {
  const { loadNotebooks, selectedNotebookId } = useNotebookStore();
  const { loadPages, clearPages } = usePageStore();

  // Load notebooks on app start
  useEffect(() => {
    loadNotebooks();
  }, [loadNotebooks]);

  // Load pages when notebook selection changes
  useEffect(() => {
    if (selectedNotebookId) {
      loadPages(selectedNotebookId);
    } else {
      clearPages();
    }
  }, [selectedNotebookId, loadPages, clearPages]);
}
