import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SearchMode = "keyword" | "hybrid" | "semantic";

interface SearchState {
  recentSearches: string[];
  searchScope: "all" | "current";
  searchMode: SearchMode;
  selectedNotebookFilter: string | null;
}

interface SearchActions {
  addRecentSearch: (query: string) => void;
  clearRecentSearches: () => void;
  setSearchScope: (scope: "all" | "current") => void;
  setSearchMode: (mode: SearchMode) => void;
  setNotebookFilter: (notebookId: string | null) => void;
}

type SearchStore = SearchState & SearchActions;

const MAX_RECENT_SEARCHES = 10;

export const useSearchStore = create<SearchStore>()(
  persist(
    (set) => ({
      recentSearches: [],
      searchScope: "all",
      searchMode: "keyword" as SearchMode,
      selectedNotebookFilter: null,

      addRecentSearch: (query: string) => {
        if (!query.trim() || query.length < 2) return;

        set((state) => {
          // Remove if already exists, then add to front
          const filtered = state.recentSearches.filter(
            (s) => s.toLowerCase() !== query.toLowerCase()
          );
          return {
            recentSearches: [query, ...filtered].slice(0, MAX_RECENT_SEARCHES),
          };
        });
      },

      clearRecentSearches: () => {
        set({ recentSearches: [] });
      },

      setSearchScope: (scope) => {
        set({ searchScope: scope });
      },

      setSearchMode: (mode) => {
        set({ searchMode: mode });
      },

      setNotebookFilter: (notebookId) => {
        set({ selectedNotebookFilter: notebookId });
      },
    }),
    {
      name: "katt-search",
      partialize: (state) => ({
        recentSearches: state.recentSearches,
        searchScope: state.searchScope,
        searchMode: state.searchMode,
      }),
    }
  )
);
