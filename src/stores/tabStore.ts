import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface OpenTab {
  pageId: string;
  notebookId: string;
  title: string;
  isPinned: boolean;
}

interface TabState {
  openTabs: OpenTab[];
  activeTabId: string | null;
}

interface TabActions {
  // Tab management
  openTab: (pageId: string, notebookId: string, title: string) => void;
  closeTab: (pageId: string) => void;
  closeOtherTabs: (pageId: string) => void;
  closeAllTabs: () => void;
  closeTabsForNotebook: (notebookId: string) => void;
  setActiveTab: (pageId: string) => void;

  // Tab updates
  updateTabTitle: (pageId: string, title: string) => void;
  pinTab: (pageId: string) => void;
  unpinTab: (pageId: string) => void;

  // Tab reordering
  reorderTabs: (fromIndex: number, toIndex: number) => void;

  // Utilities
  getTab: (pageId: string) => OpenTab | undefined;
  isTabOpen: (pageId: string) => boolean;
}

type TabStore = TabState & TabActions;

export const useTabStore = create<TabStore>()(
  persist(
    (set, get) => ({
      // Initial state
      openTabs: [],
      activeTabId: null,

      // Actions
      openTab: (pageId, notebookId, title) => {
        const { openTabs, activeTabId } = get();

        // Check if tab is already open
        const existingTab = openTabs.find((t) => t.pageId === pageId);
        if (existingTab) {
          // Just activate it
          if (activeTabId !== pageId) {
            set({ activeTabId: pageId });
          }
          return;
        }

        // Add new tab
        const newTab: OpenTab = {
          pageId,
          notebookId,
          title,
          isPinned: false,
        };

        set({
          openTabs: [...openTabs, newTab],
          activeTabId: pageId,
        });
      },

      closeTab: (pageId) => {
        const { openTabs, activeTabId } = get();
        const tabIndex = openTabs.findIndex((t) => t.pageId === pageId);

        if (tabIndex === -1) return;

        const newTabs = openTabs.filter((t) => t.pageId !== pageId);

        // Determine new active tab if we're closing the active one
        let newActiveTabId = activeTabId;
        if (activeTabId === pageId) {
          if (newTabs.length === 0) {
            newActiveTabId = null;
          } else if (tabIndex >= newTabs.length) {
            // Closed last tab, activate the new last tab
            newActiveTabId = newTabs[newTabs.length - 1].pageId;
          } else {
            // Activate the tab that took its place
            newActiveTabId = newTabs[tabIndex].pageId;
          }
        }

        set({
          openTabs: newTabs,
          activeTabId: newActiveTabId,
        });
      },

      closeOtherTabs: (pageId) => {
        const { openTabs } = get();
        const tabToKeep = openTabs.find((t) => t.pageId === pageId);

        if (!tabToKeep) return;

        // Keep pinned tabs and the specified tab
        const newTabs = openTabs.filter((t) => t.pageId === pageId || t.isPinned);

        set({
          openTabs: newTabs,
          activeTabId: pageId,
        });
      },

      closeAllTabs: () => {
        const { openTabs } = get();

        // Keep only pinned tabs
        const pinnedTabs = openTabs.filter((t) => t.isPinned);

        set({
          openTabs: pinnedTabs,
          activeTabId: pinnedTabs.length > 0 ? pinnedTabs[0].pageId : null,
        });
      },

      closeTabsForNotebook: (notebookId) => {
        const { openTabs, activeTabId } = get();
        const newTabs = openTabs.filter((t) => t.notebookId !== notebookId);

        // Check if active tab was closed
        const activeTabClosed = !newTabs.find((t) => t.pageId === activeTabId);

        set({
          openTabs: newTabs,
          activeTabId: activeTabClosed
            ? newTabs.length > 0
              ? newTabs[0].pageId
              : null
            : activeTabId,
        });
      },

      setActiveTab: (pageId) => {
        const { openTabs } = get();
        const tab = openTabs.find((t) => t.pageId === pageId);

        if (tab) {
          set({ activeTabId: pageId });
        }
      },

      updateTabTitle: (pageId, title) => {
        set((state) => ({
          openTabs: state.openTabs.map((t) =>
            t.pageId === pageId ? { ...t, title } : t
          ),
        }));
      },

      pinTab: (pageId) => {
        set((state) => {
          const tabs = [...state.openTabs];
          const tabIndex = tabs.findIndex((t) => t.pageId === pageId);

          if (tabIndex === -1) return state;

          // Pin the tab
          tabs[tabIndex] = { ...tabs[tabIndex], isPinned: true };

          // Move pinned tab to the front (after other pinned tabs)
          const pinnedCount = tabs.filter((t) => t.isPinned && t.pageId !== pageId).length;
          const [tab] = tabs.splice(tabIndex, 1);
          tabs.splice(pinnedCount, 0, tab);

          return { openTabs: tabs };
        });
      },

      unpinTab: (pageId) => {
        set((state) => ({
          openTabs: state.openTabs.map((t) =>
            t.pageId === pageId ? { ...t, isPinned: false } : t
          ),
        }));
      },

      reorderTabs: (fromIndex, toIndex) => {
        set((state) => {
          const tabs = [...state.openTabs];
          const [movedTab] = tabs.splice(fromIndex, 1);
          tabs.splice(toIndex, 0, movedTab);
          return { openTabs: tabs };
        });
      },

      getTab: (pageId) => {
        return get().openTabs.find((t) => t.pageId === pageId);
      },

      isTabOpen: (pageId) => {
        return get().openTabs.some((t) => t.pageId === pageId);
      },
    }),
    {
      name: "nous-tabs",
      partialize: (state) => ({
        openTabs: state.openTabs,
        activeTabId: state.activeTabId,
      }),
    }
  )
);
