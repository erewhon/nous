import { create } from "zustand";
import type { Notebook, NotebookType } from "../types/notebook";
import * as api from "../utils/api";

interface NotebookState {
  notebooks: Notebook[];
  selectedNotebookId: string | null;
  isLoading: boolean;
  error: string | null;
}

interface NotebookActions {
  // Data loading
  loadNotebooks: () => Promise<void>;

  // Notebook CRUD
  createNotebook: (name: string, type?: NotebookType) => Promise<void>;
  updateNotebook: (id: string, updates: Partial<Notebook>) => Promise<void>;
  deleteNotebook: (id: string) => Promise<void>;

  // Selection
  selectNotebook: (id: string | null) => void;

  // Error handling
  clearError: () => void;
}

type NotebookStore = NotebookState & NotebookActions;

export const useNotebookStore = create<NotebookStore>((set) => ({
  // Initial state
  notebooks: [],
  selectedNotebookId: null,
  isLoading: false,
  error: null,

  // Actions
  loadNotebooks: async () => {
    set({ isLoading: true, error: null });
    try {
      const notebooks = await api.listNotebooks();
      set({ notebooks, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load notebooks",
        isLoading: false,
      });
    }
  },

  createNotebook: async (name, type = "standard") => {
    set({ error: null });
    try {
      const notebook = await api.createNotebook(name, type);
      set((state) => ({
        notebooks: [notebook, ...state.notebooks],
        selectedNotebookId: notebook.id,
      }));
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to create notebook",
      });
    }
  },

  updateNotebook: async (id, updates) => {
    set({ error: null });
    try {
      const notebook = await api.updateNotebook(id, updates);
      set((state) => ({
        notebooks: state.notebooks.map((n) => (n.id === id ? notebook : n)),
      }));
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to update notebook",
      });
    }
  },

  deleteNotebook: async (id) => {
    set({ error: null });
    try {
      await api.deleteNotebook(id);
      set((state) => ({
        notebooks: state.notebooks.filter((n) => n.id !== id),
        selectedNotebookId:
          state.selectedNotebookId === id ? null : state.selectedNotebookId,
      }));
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to delete notebook",
      });
    }
  },

  selectNotebook: (id) => {
    set({ selectedNotebookId: id });
  },

  clearError: () => {
    set({ error: null });
  },
}));
