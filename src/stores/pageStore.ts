import { create } from "zustand";
import type { Page, EditorData } from "../types/page";
import * as api from "../utils/api";

interface PageState {
  pages: Page[];
  selectedPageId: string | null;
  isLoading: boolean;
  error: string | null;
  // Incremented when page data is fetched fresh, to force memo recomputation
  pageDataVersion: number;
}

interface PageActions {
  // Data loading
  loadPages: (notebookId: string, includeArchived?: boolean) => Promise<void>;
  clearPages: () => void;

  // Page CRUD
  createPage: (
    notebookId: string,
    title: string,
    folderId?: string,
    sectionId?: string
  ) => Promise<Page | null>;
  updatePage: (
    notebookId: string,
    pageId: string,
    updates: Partial<Page>
  ) => Promise<void>;
  updatePageContent: (
    notebookId: string,
    pageId: string,
    content: EditorData,
    commit?: boolean // Whether to create a git commit (default: false)
  ) => Promise<void>;
  deletePage: (notebookId: string, pageId: string) => Promise<void>;
  duplicatePage: (notebookId: string, pageId: string) => Promise<void>;

  // Folder operations
  movePageToFolder: (
    notebookId: string,
    pageId: string,
    folderId?: string,
    position?: number
  ) => Promise<void>;
  archivePage: (notebookId: string, pageId: string) => Promise<void>;
  unarchivePage: (
    notebookId: string,
    pageId: string,
    targetFolderId?: string
  ) => Promise<void>;
  reorderPages: (
    notebookId: string,
    folderId: string | null,
    pageIds: string[]
  ) => Promise<void>;
  movePageToSection: (
    notebookId: string,
    pageId: string,
    sectionId: string | null
  ) => Promise<void>;

  // Selection
  selectPage: (id: string | null) => void;

  // Error handling
  clearError: () => void;
}

type PageStore = PageState & PageActions;

export const usePageStore = create<PageStore>((set) => ({
  // Initial state
  pages: [],
  selectedPageId: null,
  isLoading: false,
  error: null,
  pageDataVersion: 0,

  // Actions
  loadPages: async (notebookId, includeArchived) => {
    set({ isLoading: true, error: null });
    try {
      const pages = await api.listPages(notebookId, includeArchived);
      set({ pages, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load pages",
        isLoading: false,
      });
    }
  },

  clearPages: () => {
    set({ pages: [], selectedPageId: null });
  },

  createPage: async (notebookId, title, folderId, sectionId) => {
    set({ error: null });
    try {
      const page = await api.createPage(notebookId, title, folderId, sectionId);
      set((state) => ({
        pages: [page, ...state.pages],
        selectedPageId: page.id,
      }));
      return page;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create page",
      });
      return null;
    }
  },

  updatePage: async (notebookId, pageId, updates) => {
    set({ error: null });
    try {
      const page = await api.updatePage(notebookId, pageId, updates);
      set((state) => ({
        pages: state.pages.map((p) => (p.id === pageId ? page : p)),
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to update page",
      });
    }
  },

  updatePageContent: async (notebookId, pageId, content, commit) => {
    // Don't set error state here - it causes re-renders
    try {
      // Save to backend but don't update local store during editing
      // Updating the store causes re-renders that steal focus from the editor
      // Fresh content is fetched when switching pages via selectPage
      await api.updatePage(notebookId, pageId, { content }, commit);
    } catch (err) {
      // Only update state on error
      set({
        error:
          err instanceof Error ? err.message : "Failed to update page content",
      });
    }
  },

  deletePage: async (notebookId, pageId) => {
    set({ error: null });
    try {
      await api.deletePage(notebookId, pageId);
      set((state) => ({
        pages: state.pages.filter((p) => p.id !== pageId),
        selectedPageId:
          state.selectedPageId === pageId ? null : state.selectedPageId,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to delete page",
      });
    }
  },

  duplicatePage: async (notebookId, pageId) => {
    set({ error: null });
    try {
      const state = usePageStore.getState();
      const sourcePage = state.pages.find((p) => p.id === pageId);
      if (!sourcePage) {
        throw new Error("Page not found");
      }

      // Create new page with "(Copy)" suffix
      const newTitle = `${sourcePage.title} (Copy)`;
      const newPage = await api.createPage(notebookId, newTitle);

      // If source has content, copy it to the new page
      if (sourcePage.content) {
        await api.updatePage(notebookId, newPage.id, {
          content: sourcePage.content,
        });
        newPage.content = sourcePage.content;
      }

      set((state) => ({
        pages: [newPage, ...state.pages],
        selectedPageId: newPage.id,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to duplicate page",
      });
    }
  },

  // Folder operations
  movePageToFolder: async (notebookId, pageId, folderId, position) => {
    set({ error: null });
    try {
      const page = await api.movePageToFolder(
        notebookId,
        pageId,
        folderId,
        position
      );
      set((state) => ({
        pages: state.pages.map((p) => (p.id === pageId ? page : p)),
      }));
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to move page to folder",
      });
    }
  },

  archivePage: async (notebookId, pageId) => {
    set({ error: null });
    try {
      const page = await api.archivePage(notebookId, pageId);
      set((state) => ({
        pages: state.pages.map((p) => (p.id === pageId ? page : p)),
        // Deselect if archived
        selectedPageId:
          state.selectedPageId === pageId ? null : state.selectedPageId,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to archive page",
      });
    }
  },

  unarchivePage: async (notebookId, pageId, targetFolderId) => {
    set({ error: null });
    try {
      const page = await api.unarchivePage(notebookId, pageId, targetFolderId);
      set((state) => ({
        pages: state.pages.map((p) => (p.id === pageId ? page : p)),
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to unarchive page",
      });
    }
  },

  reorderPages: async (notebookId, folderId, pageIds) => {
    set({ error: null });
    try {
      await api.reorderPages(notebookId, folderId, pageIds);
      // Update local state with new positions
      set((state) => {
        const updatedPages = state.pages.map((p) => {
          const idx = pageIds.indexOf(p.id);
          if (idx !== -1 && (p.folderId ?? null) === folderId) {
            return { ...p, position: idx };
          }
          return p;
        });
        return { pages: updatedPages };
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to reorder pages",
      });
    }
  },

  movePageToSection: async (notebookId, pageId, sectionId) => {
    set({ error: null });
    try {
      const page = await api.updatePage(notebookId, pageId, { sectionId });
      set((state) => ({
        pages: state.pages.map((p) => (p.id === pageId ? page : p)),
      }));
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to move page to section",
      });
    }
  },

  selectPage: (id) => {
    set({ selectedPageId: id });
    // When selecting a page, fetch fresh data from backend
    // This ensures we have the latest content even if it was saved
    // without updating the local store (to prevent focus loss during editing)
    if (id) {
      const state = usePageStore.getState();
      const page = state.pages.find((p) => p.id === id);
      if (page) {
        // Fetch fresh page data in the background
        api.getPage(page.notebookId, id).then((freshPage) => {
          set((state) => ({
            pages: state.pages.map((p) => (p.id === id ? freshPage : p)),
            // Increment version to force memo recomputation in EditorArea
            pageDataVersion: state.pageDataVersion + 1,
          }));
        }).catch(() => {
          // Silently ignore errors - we still have the cached version
        });
      }
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
