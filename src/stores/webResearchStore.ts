import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  SearchResult,
  ScrapedContent,
  ResearchSummary,
  ResearchSession,
  WebResearchSettings,
} from "../types/webResearch";

interface WebResearchState {
  // Settings (persisted)
  settings: WebResearchSettings;

  // Current research session (not persisted)
  session: ResearchSession | null;

  // Loading states
  isSearching: boolean;
  isScraping: boolean;
  isSummarizing: boolean;
  scrapingUrls: Set<string>; // URLs currently being scraped

  // Error state
  error: string | null;

  // Settings actions
  setTavilyApiKey: (key: string) => void;
  setMaxResults: (n: number) => void;
  setSearchDepth: (depth: "basic" | "advanced") => void;
  setIncludeAnswer: (include: boolean) => void;

  // Session actions
  startNewSession: (query: string) => void;
  setSearchResults: (results: SearchResult[], answer?: string | null) => void;
  toggleResultSelection: (url: string) => void;
  selectAllResults: () => void;
  deselectAllResults: () => void;
  addScrapedContent: (url: string, content: ScrapedContent) => void;
  setSummary: (summary: ResearchSummary) => void;
  clearSession: () => void;

  // Loading state actions
  setSearching: (loading: boolean) => void;
  setScraping: (loading: boolean) => void;
  setSummarizing: (loading: boolean) => void;
  addScrapingUrl: (url: string) => void;
  removeScrapingUrl: (url: string) => void;
  setError: (error: string | null) => void;
}

const defaultSettings: WebResearchSettings = {
  tavilyApiKey: "",
  maxResults: 10,
  searchDepth: "basic",
  includeAnswer: true,
};

export const useWebResearchStore = create<WebResearchState>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      session: null,
      isSearching: false,
      isScraping: false,
      isSummarizing: false,
      scrapingUrls: new Set(),
      error: null,

      // Settings setters
      setTavilyApiKey: (key) =>
        set((state) => ({
          settings: { ...state.settings, tavilyApiKey: key },
        })),

      setMaxResults: (n) =>
        set((state) => ({
          settings: { ...state.settings, maxResults: n },
        })),

      setSearchDepth: (depth) =>
        set((state) => ({
          settings: { ...state.settings, searchDepth: depth },
        })),

      setIncludeAnswer: (include) =>
        set((state) => ({
          settings: { ...state.settings, includeAnswer: include },
        })),

      // Session management
      startNewSession: (query) =>
        set({
          session: {
            id: crypto.randomUUID(),
            query,
            searchResults: [],
            tavilyAnswer: null,
            selectedUrls: [],
            scrapedContent: {},
            summary: null,
            createdAt: new Date().toISOString(),
          },
          error: null,
        }),

      setSearchResults: (results, answer) =>
        set((state) => ({
          session: state.session
            ? {
                ...state.session,
                searchResults: results,
                tavilyAnswer: answer ?? null,
              }
            : null,
        })),

      toggleResultSelection: (url) =>
        set((state) => {
          if (!state.session) return state;
          const selected = state.session.selectedUrls;
          const newSelected = selected.includes(url)
            ? selected.filter((u) => u !== url)
            : [...selected, url];
          return {
            session: { ...state.session, selectedUrls: newSelected },
          };
        }),

      selectAllResults: () =>
        set((state) => {
          if (!state.session) return state;
          return {
            session: {
              ...state.session,
              selectedUrls: state.session.searchResults.map((r) => r.url),
            },
          };
        }),

      deselectAllResults: () =>
        set((state) => {
          if (!state.session) return state;
          return {
            session: { ...state.session, selectedUrls: [] },
          };
        }),

      addScrapedContent: (url, content) =>
        set((state) => ({
          session: state.session
            ? {
                ...state.session,
                scrapedContent: {
                  ...state.session.scrapedContent,
                  [url]: content,
                },
              }
            : null,
        })),

      setSummary: (summary) =>
        set((state) => ({
          session: state.session
            ? {
                ...state.session,
                summary,
              }
            : null,
        })),

      clearSession: () => set({ session: null, error: null }),

      // Loading states
      setSearching: (isSearching) => set({ isSearching }),
      setScraping: (isScraping) => set({ isScraping }),
      setSummarizing: (isSummarizing) => set({ isSummarizing }),

      addScrapingUrl: (url) =>
        set((state) => {
          const newSet = new Set(state.scrapingUrls);
          newSet.add(url);
          return { scrapingUrls: newSet };
        }),

      removeScrapingUrl: (url) =>
        set((state) => {
          const newSet = new Set(state.scrapingUrls);
          newSet.delete(url);
          return { scrapingUrls: newSet };
        }),

      setError: (error) => set({ error }),
    }),
    {
      name: "katt-web-research-settings",
      // Only persist settings, not session state
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);
