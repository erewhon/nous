import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Page, EditorData } from "../types/page";
import * as api from "../utils/api";
import { useRAGStore } from "./ragStore";

// Recent page entry for tracking access history
export interface RecentPageEntry {
  pageId: string;
  notebookId: string;
  title: string;
  accessedAt: string;
}

// Tab within a pane
export interface PaneTab {
  pageId: string;
  title: string;
  isPinned: boolean;
}

// Editor pane for split view support
export interface EditorPane {
  id: string;
  pageId: string | null;
  tabs: PaneTab[];
}

interface PageState {
  pages: Page[];
  // Multi-pane support
  panes: EditorPane[];
  activePaneId: string | null;
  // Legacy support - computed from active pane
  selectedPageId: string | null;
  isLoading: boolean;
  error: string | null;
  // Incremented when page data is fetched fresh, to force memo recomputation
  pageDataVersion: number;
  // Recent pages tracking
  recentPages: RecentPageEntry[];
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
    parentPageId?: string,
    sectionId?: string
  ) => Promise<Page | null>;
  createSubpage: (
    notebookId: string,
    parentPageId: string,
    title: string
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
  movePageToParent: (
    notebookId: string,
    pageId: string,
    parentPageId?: string,
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

  // Pane management
  openPageInNewPane: (pageId: string | null) => void;
  openPageInPane: (paneId: string, pageId: string | null) => void;
  closePane: (paneId: string) => void;
  setActivePane: (paneId: string) => void;
  splitPane: (paneId: string, direction: "horizontal" | "vertical") => void;

  // Pane tab management
  openTabInPane: (paneId: string, pageId: string, title: string) => void;
  closeTabInPane: (paneId: string, pageId: string) => void;
  closeOtherTabsInPane: (paneId: string, keepPageId: string) => void;
  closeAllTabsInPane: (paneId: string) => void;
  pinTabInPane: (paneId: string, pageId: string) => void;
  unpinTabInPane: (paneId: string, pageId: string) => void;
  updateTabTitleInPane: (paneId: string, pageId: string, title: string) => void;
  selectTabInPane: (paneId: string, pageId: string) => void;

  // Utilities
  getChildPages: (parentPageId: string) => Page[];
  getActivePane: () => EditorPane | null;
  getPaneById: (paneId: string) => EditorPane | null;

  // Favorites
  toggleFavorite: (notebookId: string, pageId: string) => Promise<void>;
  getFavoritePages: () => Page[];

  // Recent pages
  clearRecentPages: () => void;
  getRecentPages: (limit?: number) => RecentPageEntry[];

  // Error handling
  clearError: () => void;
}

type PageStore = PageState & PageActions;

// Generate unique pane ID
function generatePaneId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Default pane
const DEFAULT_PANE: EditorPane = { id: "pane-main", pageId: null, tabs: [] };

export const usePageStore = create<PageStore>()(
  persist(
    (set, get) => ({
  // Initial state
  pages: [],
  panes: [DEFAULT_PANE],
  activePaneId: "pane-main",
  selectedPageId: null,
  isLoading: false,
  error: null,
  pageDataVersion: 0,
  recentPages: [],

  // Actions
  loadPages: async (notebookId, includeArchived) => {
    set({ isLoading: true, error: null });
    try {
      const loadedPages = await api.listPages(notebookId, includeArchived);
      // Deduplicate pages by ID (keep first occurrence)
      const seen = new Set<string>();
      const pages = loadedPages.filter((p) => {
        if (seen.has(p.id)) {
          console.warn('[pageStore] Duplicate page ID from API:', p.id, p.title);
          return false;
        }
        seen.add(p.id);
        return true;
      });
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

  createPage: async (notebookId, title, folderId, parentPageId, sectionId) => {
    set({ error: null });
    try {
      const page = await api.createPage(notebookId, title, folderId, parentPageId, sectionId);
      const state = get();
      const activePaneId = state.activePaneId || state.panes[0]?.id;

      set((state) => {
        // Filter out any existing page with same ID before adding (prevents duplicates)
        const pages = [page, ...state.pages.filter(p => p.id !== page.id)];

        // Open the page in the active pane
        const panes = state.panes.map((pane) => {
          if (pane.id !== activePaneId) return pane;

          // Add to tabs
          const newTabs = [...pane.tabs, { pageId: page.id, title: page.title, isPinned: false }];
          return { ...pane, pageId: page.id, tabs: newTabs };
        });

        return {
          pages,
          panes,
          selectedPageId: page.id,
        };
      });

      // Trigger RAG indexing in background (non-blocking)
      useRAGStore.getState().indexPage(notebookId, page.id).catch(() => {});

      return page;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create page",
      });
      return null;
    }
  },

  createSubpage: async (notebookId, parentPageId, title) => {
    set({ error: null });
    try {
      // Get parent page to inherit its section and folder
      const state = usePageStore.getState();
      const parentPage = state.pages.find((p) => p.id === parentPageId);
      const sectionId = parentPage?.sectionId ?? undefined;
      const folderId = parentPage?.folderId ?? undefined;
      const activePaneId = state.activePaneId || state.panes[0]?.id;

      const page = await api.createPage(notebookId, title, folderId, parentPageId, sectionId);
      set((state) => {
        // Filter out any existing page with same ID before adding (prevents duplicates)
        const pages = [page, ...state.pages.filter(p => p.id !== page.id)];

        // Open the page in the active pane
        const panes = state.panes.map((pane) => {
          if (pane.id !== activePaneId) return pane;

          // Add to tabs
          const newTabs = [...pane.tabs, { pageId: page.id, title: page.title, isPinned: false }];
          return { ...pane, pageId: page.id, tabs: newTabs };
        });

        return {
          pages,
          panes,
          selectedPageId: page.id,
        };
      });
      return page;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create subpage",
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

      // Trigger RAG re-indexing in background (non-blocking)
      // Only index on explicit commits to avoid excessive indexing during typing
      if (commit) {
        useRAGStore.getState().indexPage(notebookId, pageId).catch(() => {});
      }
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

      // Remove from RAG index in background (non-blocking)
      useRAGStore.getState().removePage(pageId).catch(() => {});
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
      const activePaneId = state.activePaneId || state.panes[0]?.id;

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

      set((state) => {
        // Filter out any existing page with same ID before adding (prevents duplicates)
        const pages = [newPage, ...state.pages.filter(p => p.id !== newPage.id)];

        // Open the page in the active pane
        const panes = state.panes.map((pane) => {
          if (pane.id !== activePaneId) return pane;

          // Add to tabs
          const newTabs = [...pane.tabs, { pageId: newPage.id, title: newPage.title, isPinned: false }];
          return { ...pane, pageId: newPage.id, tabs: newTabs };
        });

        return {
          pages,
          panes,
          selectedPageId: newPage.id,
        };
      });

      // Trigger RAG indexing for the duplicated page in background (non-blocking)
      useRAGStore.getState().indexPage(notebookId, newPage.id).catch(() => {});
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

  movePageToParent: async (notebookId, pageId, parentPageId, position) => {
    set({ error: null });
    try {
      const page = await api.movePageToParent(
        notebookId,
        pageId,
        parentPageId,
        position
      );
      set((state) => ({
        pages: state.pages.map((p) => (p.id === pageId ? page : p)),
      }));
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to move page",
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
    const state = get();
    const activePaneId = state.activePaneId || state.panes[0]?.id;

    if (activePaneId) {
      // Update the active pane's pageId
      set((state) => ({
        selectedPageId: id,
        panes: state.panes.map((p) =>
          p.id === activePaneId ? { ...p, pageId: id } : p
        ),
      }));
    } else {
      set({ selectedPageId: id });
    }

    // When selecting a page, fetch fresh data from backend and track in recent pages
    if (id) {
      const page = state.pages.find((p) => p.id === id);
      if (page) {
        // Track in recent pages
        const recentEntry: RecentPageEntry = {
          pageId: page.id,
          notebookId: page.notebookId,
          title: page.title,
          accessedAt: new Date().toISOString(),
        };
        set((state) => {
          // Remove existing entry for this page if present
          const filtered = state.recentPages.filter((r) => r.pageId !== id);
          // Add to front, limit to 20
          const newRecent = [recentEntry, ...filtered].slice(0, 20);
          return { recentPages: newRecent };
        });

        api.getPage(page.notebookId, id).then((freshPage) => {
          set((state) => ({
            pages: state.pages.map((p) => (p.id === id ? freshPage : p)),
            pageDataVersion: state.pageDataVersion + 1,
          }));
        }).catch(() => {
          // Silently ignore errors
        });
      }
    }
  },

  // Pane management
  openPageInNewPane: (pageId) => {
    const state = get();
    const page = pageId ? state.pages.find((p) => p.id === pageId) : null;
    const tabs: PaneTab[] = page ? [{ pageId: page.id, title: page.title, isPinned: false }] : [];
    const newPane: EditorPane = { id: generatePaneId(), pageId, tabs };
    set((state) => ({
      panes: [...state.panes, newPane],
      activePaneId: newPane.id,
      selectedPageId: pageId,
    }));

    // Fetch fresh data if opening a page
    if (pageId && page) {
      api.getPage(page.notebookId, pageId).then((freshPage) => {
        set((state) => ({
          pages: state.pages.map((p) => (p.id === pageId ? freshPage : p)),
          pageDataVersion: state.pageDataVersion + 1,
        }));
      }).catch(() => {});
    }
  },

  openPageInPane: (paneId, pageId) => {
    const state = get();
    const page = pageId ? state.pages.find((p) => p.id === pageId) : null;

    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;

        // Add to tabs if not already present
        let newTabs = pane.tabs;
        if (pageId && page && !pane.tabs.find((t) => t.pageId === pageId)) {
          newTabs = [...pane.tabs, { pageId, title: page.title, isPinned: false }];
        }

        return { ...pane, pageId, tabs: newTabs };
      }),
      activePaneId: paneId,
      selectedPageId: pageId,
    }));

    // Fetch fresh data if opening a page
    if (pageId && page) {
      api.getPage(page.notebookId, pageId).then((freshPage) => {
        set((state) => ({
          pages: state.pages.map((p) => (p.id === pageId ? freshPage : p)),
          pageDataVersion: state.pageDataVersion + 1,
        }));
      }).catch(() => {});
    }
  },

  closePane: (paneId) => {
    const state = get();
    // Don't close the last pane
    if (state.panes.length <= 1) return;

    const paneIndex = state.panes.findIndex((p) => p.id === paneId);
    const newPanes = state.panes.filter((p) => p.id !== paneId);

    // If closing the active pane, activate an adjacent one
    let newActivePaneId = state.activePaneId;
    let newSelectedPageId = state.selectedPageId;

    if (state.activePaneId === paneId) {
      const newActivePane = newPanes[Math.min(paneIndex, newPanes.length - 1)];
      newActivePaneId = newActivePane?.id || null;
      newSelectedPageId = newActivePane?.pageId || null;
    }

    set({
      panes: newPanes,
      activePaneId: newActivePaneId,
      selectedPageId: newSelectedPageId,
    });
  },

  setActivePane: (paneId) => {
    const state = get();
    const pane = state.panes.find((p) => p.id === paneId);
    if (pane) {
      set({
        activePaneId: paneId,
        selectedPageId: pane.pageId,
      });
    }
  },

  splitPane: (paneId, _direction) => {
    const state = get();
    const sourcePaneIndex = state.panes.findIndex((p) => p.id === paneId);
    if (sourcePaneIndex === -1) return;

    const sourcePane = state.panes[sourcePaneIndex];
    // Copy current page as a single tab in new pane
    const currentTab = sourcePane.tabs.find((t) => t.pageId === sourcePane.pageId);
    const tabs: PaneTab[] = currentTab ? [{ ...currentTab }] : [];
    const newPane: EditorPane = { id: generatePaneId(), pageId: sourcePane.pageId, tabs };

    // Insert the new pane after the source pane
    const newPanes = [...state.panes];
    newPanes.splice(sourcePaneIndex + 1, 0, newPane);

    set({
      panes: newPanes,
      activePaneId: newPane.id,
    });
  },

  // Pane tab management
  openTabInPane: (paneId, pageId, title) => {
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;

        // Check if tab already exists
        if (pane.tabs.find((t) => t.pageId === pageId)) {
          return { ...pane, pageId }; // Just switch to it
        }

        // Add new tab
        return {
          ...pane,
          pageId,
          tabs: [...pane.tabs, { pageId, title, isPinned: false }],
        };
      }),
    }));
  },

  closeTabInPane: (paneId, pageId) => {
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;

        const tabIndex = pane.tabs.findIndex((t) => t.pageId === pageId);
        if (tabIndex === -1) return pane;

        const newTabs = pane.tabs.filter((t) => t.pageId !== pageId);

        // Determine new active page if we're closing the active one
        let newPageId = pane.pageId;
        if (pane.pageId === pageId) {
          if (newTabs.length === 0) {
            newPageId = null;
          } else if (tabIndex >= newTabs.length) {
            // Closed last tab, activate the new last tab
            newPageId = newTabs[newTabs.length - 1].pageId;
          } else {
            // Activate the tab that took its place
            newPageId = newTabs[tabIndex].pageId;
          }
        }

        return { ...pane, pageId: newPageId, tabs: newTabs };
      }),
    }));
  },

  closeOtherTabsInPane: (paneId, keepPageId) => {
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;

        // Keep pinned tabs and the specified tab
        const newTabs = pane.tabs.filter((t) => t.pageId === keepPageId || t.isPinned);

        return { ...pane, pageId: keepPageId, tabs: newTabs };
      }),
    }));
  },

  closeAllTabsInPane: (paneId) => {
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;

        // Keep only pinned tabs
        const pinnedTabs = pane.tabs.filter((t) => t.isPinned);
        const newPageId = pinnedTabs.length > 0 ? pinnedTabs[0].pageId : null;

        return { ...pane, pageId: newPageId, tabs: pinnedTabs };
      }),
    }));
  },

  pinTabInPane: (paneId, pageId) => {
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;

        const tabs = [...pane.tabs];
        const tabIndex = tabs.findIndex((t) => t.pageId === pageId);
        if (tabIndex === -1) return pane;

        // Pin the tab
        tabs[tabIndex] = { ...tabs[tabIndex], isPinned: true };

        // Move pinned tab to the front (after other pinned tabs)
        const pinnedCount = tabs.filter((t) => t.isPinned && t.pageId !== pageId).length;
        const [tab] = tabs.splice(tabIndex, 1);
        tabs.splice(pinnedCount, 0, tab);

        return { ...pane, tabs };
      }),
    }));
  },

  unpinTabInPane: (paneId, pageId) => {
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;

        return {
          ...pane,
          tabs: pane.tabs.map((t) =>
            t.pageId === pageId ? { ...t, isPinned: false } : t
          ),
        };
      }),
    }));
  },

  updateTabTitleInPane: (paneId, pageId, title) => {
    set((state) => ({
      panes: state.panes.map((pane) => {
        if (pane.id !== paneId) return pane;

        return {
          ...pane,
          tabs: pane.tabs.map((t) =>
            t.pageId === pageId ? { ...t, title } : t
          ),
        };
      }),
    }));
  },

  selectTabInPane: (paneId, pageId) => {
    const state = get();
    const page = state.pages.find((p) => p.id === pageId);

    set((state) => ({
      panes: state.panes.map((pane) =>
        pane.id === paneId ? { ...pane, pageId } : pane
      ),
      selectedPageId: state.activePaneId === paneId ? pageId : state.selectedPageId,
    }));

    // Fetch fresh data
    if (page) {
      api.getPage(page.notebookId, pageId).then((freshPage) => {
        set((state) => ({
          pages: state.pages.map((p) => (p.id === pageId ? freshPage : p)),
          pageDataVersion: state.pageDataVersion + 1,
        }));
      }).catch(() => {});
    }
  },

  getChildPages: (parentPageId) => {
    const { pages } = get();
    return pages
      .filter((p) => p.parentPageId === parentPageId)
      .sort((a, b) => a.position - b.position);
  },

  getActivePane: () => {
    const state = get();
    return state.panes.find((p) => p.id === state.activePaneId) || null;
  },

  getPaneById: (paneId) => {
    const state = get();
    return state.panes.find((p) => p.id === paneId) || null;
  },

  // Favorites
  toggleFavorite: async (notebookId, pageId) => {
    const state = get();
    const page = state.pages.find((p) => p.id === pageId);
    if (!page) return;

    const newFavorite = !page.isFavorite;
    try {
      const updatedPage = await api.updatePage(notebookId, pageId, { isFavorite: newFavorite });
      set((state) => ({
        pages: state.pages.map((p) => (p.id === pageId ? updatedPage : p)),
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to toggle favorite",
      });
    }
  },

  getFavoritePages: () => {
    const { pages } = get();
    return pages.filter((p) => p.isFavorite && !p.deletedAt);
  },

  // Recent pages
  clearRecentPages: () => {
    set({ recentPages: [] });
  },

  getRecentPages: (limit = 20) => {
    const { recentPages } = get();
    return recentPages.slice(0, limit);
  },

  clearError: () => {
    set({ error: null });
  },
    }),
    {
      name: "katt-pages",
      partialize: (state) => ({
        panes: state.panes,
        activePaneId: state.activePaneId,
        recentPages: state.recentPages,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Ensure at least one pane exists
          if (!state.panes || state.panes.length === 0) {
            state.panes = [DEFAULT_PANE];
            state.activePaneId = "pane-main";
          }
          // Ensure each pane has a tabs array
          state.panes = state.panes.map((pane) => ({
            ...pane,
            tabs: pane.tabs || [],
          }));
          // Set selectedPageId from active pane
          const activePane = state.panes.find((p) => p.id === state.activePaneId);
          state.selectedPageId = activePane?.pageId || null;
          // Ensure recentPages array exists
          if (!state.recentPages) {
            state.recentPages = [];
          }
        }
      },
    }
  )
);
