import * as api from "./api";
import { usePageStore } from "../stores/pageStore";
import {
  createDatabaseFromObjectType,
  createDefaultDatabaseContent,
  type ObjectType,
} from "../types/database";

/**
 * Create a database page: page shell → set the database page type + file
 * extension (which allocates the backing file) → write the initial content
 * (from an object-type template, or a one-column default). Shared by the
 * folder-tree "New Page" menu and the template dialog. Returns the new page
 * id, or null on failure.
 */
export async function createDatabasePage(
  notebookId: string,
  sectionId?: string,
  objectType?: ObjectType | null,
): Promise<string | null> {
  const { createPage } = usePageStore.getState();
  const title = objectType ? `New ${objectType.name}` : "New Database";
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
    fileExtension: "database",
    pageType: "database",
  });
  usePageStore.setState((state) => ({
    pages: state.pages.map((p) => (p.id === pageData.id ? updatedPage : p)),
  }));
  const dbContent = objectType
    ? createDatabaseFromObjectType(objectType)
    : createDefaultDatabaseContent();
  await api.updateFileContent(
    notebookId,
    pageData.id,
    JSON.stringify(dbContent, null, 2),
  );
  return pageData.id;
}
