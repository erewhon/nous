import * as api from "./api";
import { usePageStore } from "../stores/pageStore";
import { createDefaultCalendarConfig } from "../types/calendar";

/**
 * Create an aggregating calendar page: page shell → set the calendar page
 * type + file extension (which allocates the backing file) → write an empty
 * v1 source config. Shared by the folder-tree "New Page" menu and the
 * template dialog. Returns the new page id, or null on failure.
 */
export async function createCalendarPage(
  notebookId: string,
  sectionId?: string,
  title = "New Calendar",
): Promise<string | null> {
  const { createPage } = usePageStore.getState();
  const pageData = await createPage(
    notebookId,
    title,
    undefined,
    undefined,
    sectionId,
  );
  if (!pageData) {
    return null;
  }
  // Use api.updatePage directly so errors propagate (store method swallows them)
  const updatedPage = await api.updatePage(notebookId, pageData.id, {
    fileExtension: "calendar",
    pageType: "calendar",
  });
  usePageStore.setState((state) => ({
    pages: state.pages.map((p) => (p.id === pageData.id ? updatedPage : p)),
  }));
  await api.updateFileContent(
    notebookId,
    pageData.id,
    JSON.stringify(createDefaultCalendarConfig(), null, 2),
  );
  return pageData.id;
}
