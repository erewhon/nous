/**
 * Library Store
 *
 * Manages library state - collections of notebooks stored at different paths.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Library, LibraryStats } from "../types/library";
import * as api from "../utils/api";

interface LibraryState {
  // State
  libraries: Library[];
  currentLibrary: Library | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchLibraries: () => Promise<void>;
  fetchCurrentLibrary: () => Promise<void>;
  switchLibrary: (libraryId: string) => Promise<void>;
  createLibrary: (name: string, path: string) => Promise<Library>;
  updateLibrary: (
    libraryId: string,
    updates: { name?: string; icon?: string; color?: string }
  ) => Promise<void>;
  deleteLibrary: (libraryId: string) => Promise<void>;
  getLibraryStats: (libraryId: string) => Promise<LibraryStats>;
  clearError: () => void;
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set) => ({
      // Initial state
      libraries: [],
      currentLibrary: null,
      isLoading: false,
      error: null,

      // Fetch all libraries
      fetchLibraries: async () => {
        set({ isLoading: true, error: null });
        try {
          const libraries = await api.listLibraries();
          set({ libraries, isLoading: false });
        } catch (e) {
          const error = e instanceof Error ? e.message : "Failed to fetch libraries";
          set({ error, isLoading: false });
        }
      },

      // Fetch current library
      fetchCurrentLibrary: async () => {
        set({ isLoading: true, error: null });
        try {
          const currentLibrary = await api.getCurrentLibrary();
          set({ currentLibrary, isLoading: false });
        } catch (e) {
          const error = e instanceof Error ? e.message : "Failed to fetch current library";
          set({ error, isLoading: false });
        }
      },

      // Switch to a different library
      switchLibrary: async (libraryId: string) => {
        set({ isLoading: true, error: null });
        try {
          const library = await api.switchLibrary(libraryId);
          set({ currentLibrary: library, isLoading: false });
        } catch (e) {
          const error = e instanceof Error ? e.message : "Failed to switch library";
          set({ error, isLoading: false });
          throw e;
        }
      },

      // Create a new library
      createLibrary: async (name: string, path: string) => {
        set({ isLoading: true, error: null });
        try {
          const library = await api.createLibrary(name, path);
          set((state) => ({
            libraries: [...state.libraries, library],
            isLoading: false,
          }));
          return library;
        } catch (e) {
          const error = e instanceof Error ? e.message : "Failed to create library";
          set({ error, isLoading: false });
          throw e;
        }
      },

      // Update a library
      updateLibrary: async (
        libraryId: string,
        updates: { name?: string; icon?: string; color?: string }
      ) => {
        set({ isLoading: true, error: null });
        try {
          const updated = await api.updateLibrary(libraryId, updates);
          set((state) => ({
            libraries: state.libraries.map((lib) =>
              lib.id === libraryId ? updated : lib
            ),
            currentLibrary:
              state.currentLibrary?.id === libraryId
                ? updated
                : state.currentLibrary,
            isLoading: false,
          }));
        } catch (e) {
          const error = e instanceof Error ? e.message : "Failed to update library";
          set({ error, isLoading: false });
          throw e;
        }
      },

      // Delete a library
      deleteLibrary: async (libraryId: string) => {
        set({ isLoading: true, error: null });
        try {
          await api.deleteLibrary(libraryId);
          set((state) => ({
            libraries: state.libraries.filter((lib) => lib.id !== libraryId),
            isLoading: false,
          }));
        } catch (e) {
          const error = e instanceof Error ? e.message : "Failed to delete library";
          set({ error, isLoading: false });
          throw e;
        }
      },

      // Get library statistics
      getLibraryStats: async (libraryId: string) => {
        try {
          return await api.getLibraryStats(libraryId);
        } catch (e) {
          const error = e instanceof Error ? e.message : "Failed to get library stats";
          set({ error });
          throw e;
        }
      },

      // Clear error
      clearError: () => set({ error: null }),
    }),
    {
      name: "nous-library",
      partialize: () => ({
        // Only persist the current library ID for quick restore
        // Full data is fetched from backend
      }),
    }
  )
);
