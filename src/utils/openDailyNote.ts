import { useDailyNotesStore } from "../stores/dailyNotesStore";
import { useNotebookStore } from "../stores/notebookStore";
import { usePageStore } from "../stores/pageStore";

/**
 * Which notebook daily notes live in: the explicit Daily Notes setting if
 * that notebook still exists, otherwise the currently selected notebook
 * (the historical behavior when nothing is configured).
 */
export function resolveDailyNotesNotebookId(): string | null {
  const configured = useDailyNotesStore.getState().settings.notebookId;
  const { notebooks, selectedNotebookId } = useNotebookStore.getState();
  if (configured && notebooks.some((n) => n.id === configured)) {
    return configured;
  }
  return selectedNotebookId;
}

/**
 * Open (or create) today's daily note in the configured daily-notes
 * notebook, switching notebooks first when it isn't the selected one.
 * Returns false when no notebook could be resolved (nothing selected and
 * nothing configured).
 */
export async function openTodayDailyNote(): Promise<boolean> {
  const notebookId = resolveDailyNotesNotebookId();
  if (!notebookId) return false;

  const note = await useDailyNotesStore.getState().openTodayNote(notebookId);

  const { selectedNotebookId, selectNotebook } = useNotebookStore.getState();
  if (selectedNotebookId !== notebookId) {
    selectNotebook(notebookId);
  }
  // Panes only render pages present in the store — a just-created note (or
  // any page from a different notebook) isn't there yet; reload first.
  await usePageStore.getState().loadPages(notebookId);
  await usePageStore.getState().selectPage(note.id);
  return true;
}
