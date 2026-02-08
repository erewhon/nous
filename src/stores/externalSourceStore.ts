import { create } from "zustand";
import type {
  ExternalSource,
  ExternalFileFormat,
  ResolvedFileInfo,
} from "../types/externalSource";
import {
  listExternalSources,
  createExternalSource,
  updateExternalSource,
  deleteExternalSource,
  previewExternalSourceFiles,
  previewPathPatternFiles,
} from "../utils/api";

interface ExternalSourceState {
  sources: ExternalSource[];
  isLoading: boolean;
  error: string | null;
  previewFiles: ResolvedFileInfo[];
  isPreviewLoading: boolean;
}

interface ExternalSourceActions {
  // Data fetching
  loadSources: () => Promise<void>;

  // CRUD operations
  createSource: (
    name: string,
    pathPattern: string,
    options?: {
      fileFormats?: ExternalFileFormat[];
      enabled?: boolean;
    }
  ) => Promise<ExternalSource>;
  updateSource: (
    sourceId: string,
    updates: {
      name?: string;
      pathPattern?: string;
      fileFormats?: ExternalFileFormat[];
      enabled?: boolean;
    }
  ) => Promise<ExternalSource>;
  deleteSource: (sourceId: string) => Promise<void>;

  // Preview
  loadPreviewFiles: (sourceId: string) => Promise<ResolvedFileInfo[]>;
  previewPathPattern: (
    pathPattern: string,
    fileFormats?: ExternalFileFormat[]
  ) => Promise<ResolvedFileInfo[]>;
  clearPreview: () => void;

  // Enable/disable
  setEnabled: (sourceId: string, enabled: boolean) => Promise<ExternalSource>;

  // Error handling
  clearError: () => void;
}

type ExternalSourceStore = ExternalSourceState & ExternalSourceActions;

export const useExternalSourceStore = create<ExternalSourceStore>()(
  (set, get) => ({
    // Initial state
    sources: [],
    isLoading: false,
    error: null,
    previewFiles: [],
    isPreviewLoading: false,

    // Data fetching
    loadSources: async () => {
      set({ isLoading: true, error: null });
      try {
        const sources = await listExternalSources();
        set({ sources, isLoading: false });
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : "Failed to load external sources",
          isLoading: false,
        });
      }
    },

    // CRUD operations
    createSource: async (name, pathPattern, options) => {
      set({ isLoading: true, error: null });
      try {
        const source = await createExternalSource(
          name,
          pathPattern,
          options?.fileFormats,
          options?.enabled
        );
        set((state) => ({
          sources: [...state.sources, source],
          isLoading: false,
        }));
        return source;
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : "Failed to create external source",
          isLoading: false,
        });
        throw error;
      }
    },

    updateSource: async (sourceId, updates) => {
      set({ isLoading: true, error: null });
      try {
        const source = await updateExternalSource(sourceId, updates);
        set((state) => ({
          sources: state.sources.map((s) => (s.id === sourceId ? source : s)),
          isLoading: false,
        }));
        return source;
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : "Failed to update external source",
          isLoading: false,
        });
        throw error;
      }
    },

    deleteSource: async (sourceId) => {
      set({ isLoading: true, error: null });
      try {
        await deleteExternalSource(sourceId);
        set((state) => ({
          sources: state.sources.filter((s) => s.id !== sourceId),
          isLoading: false,
        }));
      } catch (error) {
        set({
          error:
            error instanceof Error
              ? error.message
              : "Failed to delete external source",
          isLoading: false,
        });
        throw error;
      }
    },

    // Preview
    loadPreviewFiles: async (sourceId) => {
      set({ isPreviewLoading: true });
      try {
        const files = await previewExternalSourceFiles(sourceId);
        set({ previewFiles: files, isPreviewLoading: false });
        return files;
      } catch (error) {
        set({
          error:
            error instanceof Error ? error.message : "Failed to preview files",
          isPreviewLoading: false,
        });
        throw error;
      }
    },

    previewPathPattern: async (pathPattern, fileFormats) => {
      set({ isPreviewLoading: true });
      try {
        const files = await previewPathPatternFiles(pathPattern, fileFormats);
        set({ previewFiles: files, isPreviewLoading: false });
        return files;
      } catch (error) {
        set({
          error:
            error instanceof Error ? error.message : "Failed to preview files",
          isPreviewLoading: false,
        });
        throw error;
      }
    },

    clearPreview: () => {
      set({ previewFiles: [], isPreviewLoading: false });
    },

    // Enable/disable
    setEnabled: async (sourceId, enabled) => {
      return get().updateSource(sourceId, { enabled });
    },

    // Error handling
    clearError: () => {
      set({ error: null });
    },
  })
);
