import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type {
  EmbeddingConfig,
  EmbeddingProvider,
  SemanticSearchResult,
  VectorIndexStats,
  DiscoveredModel,
} from "../types/rag";
import { EMBEDDING_MODELS, DEFAULT_EMBEDDING_BASE_URLS, getModelDimensions, EMBEDDING_PROVIDER_INFO } from "../types/rag";
import type { SearchResult } from "../types/page";
import { listNotebooks, listPages } from "../utils/api";

interface RAGSettings {
  // Embedding configuration
  provider: EmbeddingProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
  // Feature flags
  ragEnabled: boolean;
  autoIndexPages: boolean;
  useHybridSearch: boolean;
  semanticWeight: number; // 0.0-1.0 for hybrid search
}

interface RAGState {
  // Settings (persisted)
  settings: RAGSettings;
  // Runtime state (not persisted)
  isConfigured: boolean;
  isIndexing: boolean;
  isDiscoveringModels: boolean;
  indexingProgress: { current: number; total: number } | null;
  stats: VectorIndexStats | null;
  discoveredModels: Record<EmbeddingProvider, DiscoveredModel[]>;
  lastError: string | null;
}

interface RAGActions {
  // Configuration
  loadConfig: () => Promise<void>;
  configure: (
    provider: EmbeddingProvider,
    model: string,
    apiKey?: string,
    baseUrl?: string
  ) => Promise<void>;
  setProvider: (provider: EmbeddingProvider) => void;
  setModel: (model: string) => void;
  setApiKey: (apiKey: string) => void;
  setBaseUrl: (baseUrl: string) => void;

  // Feature toggles
  setRagEnabled: (enabled: boolean) => void;
  setAutoIndexPages: (enabled: boolean) => void;
  setUseHybridSearch: (enabled: boolean) => void;
  setSemanticWeight: (weight: number) => void;

  // Search operations
  semanticSearch: (
    query: string,
    notebookId?: string,
    limit?: number
  ) => Promise<SemanticSearchResult[]>;
  hybridSearch: (
    query: string,
    notebookId?: string,
    limit?: number,
    semanticWeight?: number
  ) => Promise<SearchResult[]>;
  getContext: (
    query: string,
    notebookId?: string,
    maxChunks?: number
  ) => Promise<SemanticSearchResult[]>;
  findSimilarPages: (
    pageId: string,
    notebookId?: string,
    limit?: number
  ) => Promise<SemanticSearchResult[]>;

  // Index operations
  indexPage: (notebookId: string, pageId: string) => Promise<void>;
  removePage: (pageId: string) => Promise<void>;
  rebuildIndex: () => Promise<void>;
  getStats: () => Promise<VectorIndexStats>;

  // Utility
  getEmbedding: (text: string) => Promise<number[]>;
  getEmbeddings: (texts: string[]) => Promise<number[][]>;
  clearError: () => void;

  // Model discovery
  discoverModels: (provider?: EmbeddingProvider) => Promise<DiscoveredModel[]>;
}

type RAGStore = RAGState & RAGActions;

const defaultSettings: RAGSettings = {
  provider: "openai",
  model: "text-embedding-3-small",
  apiKey: "",
  baseUrl: "",
  ragEnabled: false,
  autoIndexPages: true,
  useHybridSearch: true,
  semanticWeight: 0.5,
};

export const useRAGStore = create<RAGStore>()(
  persist(
    (set, get) => ({
      // Initial state
      settings: defaultSettings,
      isConfigured: false,
      isIndexing: false,
      isDiscoveringModels: false,
      indexingProgress: null,
      stats: null,
      discoveredModels: {
        openai: [],
        ollama: [],
        lmstudio: [],
        bedrock: [],
      },
      lastError: null,

      // Load configuration from backend
      loadConfig: async () => {
        try {
          const config = await invoke<EmbeddingConfig | null>("get_embedding_config");
          if (config) {
            set((state) => ({
              settings: {
                ...state.settings,
                provider: config.provider as EmbeddingProvider,
                model: config.model,
                apiKey: config.apiKey || "",
                baseUrl: config.baseUrl || "",
              },
              isConfigured: true,
            }));
          }
        } catch (error) {
          console.error("Failed to load RAG config:", error);
          set({ lastError: String(error) });
        }
      },

      // Configure embedding model
      configure: async (provider, model, apiKey, baseUrl) => {
        try {
          const dimensions = getModelDimensions(provider, model);
          await invoke("configure_embeddings", {
            provider,
            model,
            dimensions,
            apiKey: apiKey || null,
            baseUrl: baseUrl || DEFAULT_EMBEDDING_BASE_URLS[provider] || null,
          });

          set((state) => ({
            settings: {
              ...state.settings,
              provider,
              model,
              apiKey: apiKey || "",
              baseUrl: baseUrl || DEFAULT_EMBEDDING_BASE_URLS[provider] || "",
            },
            isConfigured: true,
            lastError: null,
          }));
        } catch (error) {
          console.error("Failed to configure embeddings:", error);
          set({ lastError: String(error) });
          throw error;
        }
      },

      // Setting updates
      setProvider: (provider) => {
        const models = EMBEDDING_MODELS[provider];
        const defaultModel = models[0]?.id || "";
        set((state) => ({
          settings: {
            ...state.settings,
            provider,
            model: defaultModel,
            baseUrl: DEFAULT_EMBEDDING_BASE_URLS[provider] || "",
          },
        }));
      },

      setModel: (model) =>
        set((state) => ({
          settings: { ...state.settings, model },
        })),

      setApiKey: (apiKey) =>
        set((state) => ({
          settings: { ...state.settings, apiKey },
        })),

      setBaseUrl: (baseUrl) =>
        set((state) => ({
          settings: { ...state.settings, baseUrl },
        })),

      setRagEnabled: (enabled) =>
        set((state) => ({
          settings: { ...state.settings, ragEnabled: enabled },
        })),

      setAutoIndexPages: (enabled) =>
        set((state) => ({
          settings: { ...state.settings, autoIndexPages: enabled },
        })),

      setUseHybridSearch: (enabled) =>
        set((state) => ({
          settings: { ...state.settings, useHybridSearch: enabled },
        })),

      setSemanticWeight: (weight) =>
        set((state) => ({
          settings: { ...state.settings, semanticWeight: Math.max(0, Math.min(1, weight)) },
        })),

      // Semantic search
      semanticSearch: async (query, notebookId, limit = 10) => {
        const state = get();
        if (!state.isConfigured || !state.settings.ragEnabled) {
          return [];
        }

        try {
          // Generate query embedding
          const queryEmbedding = await get().getEmbedding(query);

          // Search
          const results = await invoke<SemanticSearchResult[]>("semantic_search", {
            queryEmbedding,
            notebookId,
            limit,
          });

          return results;
        } catch (error) {
          console.error("Semantic search failed:", error);
          set({ lastError: String(error) });
          return [];
        }
      },

      // Hybrid search
      hybridSearch: async (query, notebookId, limit = 10, semanticWeight) => {
        const state = get();
        if (!state.isConfigured || !state.settings.ragEnabled) {
          return [];
        }

        try {
          // Generate query embedding
          const queryEmbedding = await get().getEmbedding(query);

          // Search
          const results = await invoke<SearchResult[]>("hybrid_search", {
            query,
            queryEmbedding,
            notebookId,
            limit,
            semanticWeight: semanticWeight ?? state.settings.semanticWeight,
          });

          return results;
        } catch (error) {
          console.error("Hybrid search failed:", error);
          set({ lastError: String(error) });
          return [];
        }
      },

      // Get context for RAG
      getContext: async (query, notebookId, maxChunks = 5) => {
        const state = get();
        if (!state.isConfigured || !state.settings.ragEnabled) {
          return [];
        }

        try {
          // Generate query embedding
          const queryEmbedding = await get().getEmbedding(query);

          // Get context
          const results = await invoke<SemanticSearchResult[]>("get_rag_context", {
            queryEmbedding,
            notebookId,
            maxChunks,
          });

          return results;
        } catch (error) {
          console.error("Get RAG context failed:", error);
          set({ lastError: String(error) });
          return [];
        }
      },

      // Find similar pages using vector embeddings
      findSimilarPages: async (pageId, notebookId, limit = 10) => {
        const state = get();
        if (!state.isConfigured || !state.settings.ragEnabled) {
          return [];
        }

        try {
          const results = await invoke<SemanticSearchResult[]>("find_similar_pages", {
            pageId,
            notebookId,
            limit,
          });

          return results;
        } catch (error) {
          console.error("Find similar pages failed:", error);
          set({ lastError: String(error) });
          return [];
        }
      },

      // Index a page
      indexPage: async (notebookId, pageId) => {
        const state = get();
        if (!state.isConfigured || !state.settings.autoIndexPages) {
          return;
        }

        try {
          set({ isIndexing: true });

          // Get page chunks
          const chunks = await invoke<string[]>("get_page_chunks", { notebookId, pageId });

          if (chunks.length === 0) {
            return;
          }

          // Generate embeddings for chunks
          const embeddings = await get().getEmbeddings(chunks);

          // Index the page
          await invoke("index_page_embedding", {
            notebookId,
            pageId,
            embeddings,
          });

          // Update stats
          await get().getStats();
        } catch (error) {
          console.error("Failed to index page:", error);
          set({ lastError: String(error) });
        } finally {
          set({ isIndexing: false });
        }
      },

      // Remove a page from the index
      removePage: async (pageId) => {
        try {
          await invoke("remove_page_embedding", { pageId });
          await get().getStats();
        } catch (error) {
          console.error("Failed to remove page from index:", error);
          set({ lastError: String(error) });
        }
      },

      // Rebuild the entire index
      rebuildIndex: async () => {
        const state = get();
        if (!state.isConfigured) {
          throw new Error("RAG not configured");
        }

        try {
          set({ isIndexing: true, indexingProgress: null, lastError: null });

          // Clear the existing index
          await invoke("rebuild_vector_index");

          // Get all non-archived notebooks
          const notebooks = await listNotebooks();
          const activeNotebooks = notebooks.filter((nb) => !nb.archived);

          // Collect all pages from all notebooks
          const allPages: Array<{ notebookId: string; pageId: string }> = [];
          for (const notebook of activeNotebooks) {
            const pages = await listPages(notebook.id, false); // Don't include archived pages
            for (const page of pages) {
              allPages.push({ notebookId: notebook.id, pageId: page.id });
            }
          }

          const total = allPages.length;
          set({ indexingProgress: { current: 0, total } });

          // Index each page
          for (let i = 0; i < allPages.length; i++) {
            const { notebookId, pageId } = allPages[i];
            try {
              // Get page chunks
              const chunks = await invoke<string[]>("get_page_chunks", { notebookId, pageId });

              if (chunks.length > 0) {
                // Generate embeddings for chunks
                const embeddings = await get().getEmbeddings(chunks);

                // Index the page
                await invoke("index_page_embedding", {
                  notebookId,
                  pageId,
                  embeddings,
                });
              }
            } catch (pageError) {
              console.warn(`Failed to index page ${pageId}:`, pageError);
              // Continue with other pages
            }

            set({ indexingProgress: { current: i + 1, total } });
          }

          // Update stats
          await get().getStats();
        } catch (error) {
          console.error("Failed to rebuild index:", error);
          set({ lastError: String(error) });
          throw error;
        } finally {
          set({ isIndexing: false, indexingProgress: null });
        }
      },

      // Get index statistics
      getStats: async () => {
        try {
          const stats = await invoke<VectorIndexStats>("get_vector_index_stats");
          set({ stats });
          return stats;
        } catch (error) {
          console.error("Failed to get index stats:", error);
          set({ lastError: String(error) });
          throw error;
        }
      },

      // Generate embedding for a single text
      getEmbedding: async (text) => {
        const state = get();
        const config = {
          provider: state.settings.provider,
          model: state.settings.model,
          api_key: state.settings.apiKey || undefined,
          base_url: state.settings.baseUrl || undefined,
        };

        // Call Python via Tauri command that wraps Python bridge
        const embedding = await invoke<number[]>("generate_embedding", {
          text,
          config: JSON.stringify(config),
        });

        return embedding;
      },

      // Generate embeddings for multiple texts
      getEmbeddings: async (texts) => {
        const state = get();
        const config = {
          provider: state.settings.provider,
          model: state.settings.model,
          api_key: state.settings.apiKey || undefined,
          base_url: state.settings.baseUrl || undefined,
        };

        // Call Python via Tauri command that wraps Python bridge
        const embeddings = await invoke<number[][]>("generate_embeddings_batch", {
          texts,
          config: JSON.stringify(config),
        });

        return embeddings;
      },

      // Clear error
      clearError: () => set({ lastError: null }),

      // Discover available embedding models from provider
      discoverModels: async (provider) => {
        const state = get();
        const targetProvider = provider || state.settings.provider;
        const providerInfo = EMBEDDING_PROVIDER_INFO[targetProvider];

        // Only discover for providers that support it
        if (!providerInfo.supportsDiscovery) {
          return EMBEDDING_MODELS[targetProvider].map((m) => ({
            id: m.id,
            name: m.name,
            dimensions: m.dimensions,
          }));
        }

        try {
          set({ isDiscoveringModels: true, lastError: null });

          const baseUrl = state.settings.baseUrl || DEFAULT_EMBEDDING_BASE_URLS[targetProvider];
          const models = await invoke<DiscoveredModel[]>("discover_embedding_models", {
            provider: targetProvider,
            baseUrl,
          });

          set((s) => ({
            discoveredModels: {
              ...s.discoveredModels,
              [targetProvider]: models,
            },
          }));

          return models;
        } catch (error) {
          console.error("Failed to discover models:", error);
          set({ lastError: String(error) });
          // Return static list as fallback
          return EMBEDDING_MODELS[targetProvider].map((m) => ({
            id: m.id,
            name: m.name,
            dimensions: m.dimensions,
          }));
        } finally {
          set({ isDiscoveringModels: false });
        }
      },
    }),
    {
      name: "nous-rag-settings",
      version: 1,
      // Only persist settings, not runtime state
      partialize: (state) => ({
        settings: state.settings,
      }),
    }
  )
);
