import { create } from "zustand";
import type { Page, EditorData } from "../types/page";
import * as api from "../utils/api";

interface PageState {
  pages: Page[];
  selectedPageId: string | null;
  isLoading: boolean;
  error: string | null;
}

interface PageActions {
  // Data loading
  loadPages: (notebookId: string) => Promise<void>;
  clearPages: () => void;

  // Page CRUD
  createPage: (notebookId: string, title: string) => Promise<void>;
  updatePage: (
    notebookId: string,
    pageId: string,
    updates: Partial<Page>
  ) => Promise<void>;
  updatePageContent: (
    notebookId: string,
    pageId: string,
    content: EditorData
  ) => Promise<void>;
  deletePage: (notebookId: string, pageId: string) => Promise<void>;
  duplicatePage: (notebookId: string, pageId: string) => Promise<void>;

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

  // Actions
  loadPages: async (notebookId) => {
    set({ isLoading: true, error: null });
    try {
      const pages = await api.listPages(notebookId);
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

  createPage: async (notebookId, title) => {
    set({ error: null });
    try {
      const page = await api.createPage(notebookId, title);
      set((state) => ({
        pages: [page, ...state.pages],
        selectedPageId: page.id,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create page",
      });
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

  updatePageContent: async (notebookId, pageId, content) => {
    set({ error: null });
    try {
      const page = await api.updatePage(notebookId, pageId, { content });
      set((state) => ({
        pages: state.pages.map((p) => (p.id === pageId ? page : p)),
      }));
    } catch (err) {
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

  selectPage: (id) => {
    set({ selectedPageId: id });
  },

  clearError: () => {
    set({ error: null });
  },
}));
