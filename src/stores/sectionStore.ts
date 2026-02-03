import { create } from "zustand";
import type { Section } from "../types/page";
import * as api from "../utils/api";

interface SectionState {
  sections: Section[];
  selectedSectionId: string | null;
  isLoading: boolean;
  error: string | null;
}

interface SectionActions {
  // Data loading
  loadSections: (notebookId: string) => Promise<void>;
  clearSections: () => void;

  // Section CRUD
  createSection: (
    notebookId: string,
    name: string,
    color?: string
  ) => Promise<Section | null>;
  updateSection: (
    notebookId: string,
    sectionId: string,
    updates: { name?: string; description?: string | null; color?: string | null; systemPrompt?: string | null; systemPromptMode?: string }
  ) => Promise<void>;
  deleteSection: (
    notebookId: string,
    sectionId: string,
    moveItemsTo?: string
  ) => Promise<void>;

  // Selection
  selectSection: (sectionId: string | null) => void;

  // Reordering
  reorderSections: (notebookId: string, sectionIds: string[]) => Promise<void>;

  // Move section
  moveSectionToNotebook: (
    sourceNotebookId: string,
    sectionId: string,
    targetNotebookId: string
  ) => Promise<Section | null>;

  // Error handling
  clearError: () => void;
}

type SectionStore = SectionState & SectionActions;

export const useSectionStore = create<SectionStore>()((set, _get) => ({
  // Initial state
  sections: [],
  selectedSectionId: null,
  isLoading: false,
  error: null,

  // Actions
  loadSections: async (notebookId) => {
    set({ isLoading: true, error: null });
    try {
      const sections = await api.listSections(notebookId);
      set({ sections, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load sections",
        isLoading: false,
      });
    }
  },

  clearSections: () => {
    set({ sections: [], selectedSectionId: null });
  },

  createSection: async (notebookId, name, color) => {
    set({ error: null });
    try {
      const section = await api.createSection(notebookId, name, color);
      set((state) => ({
        sections: [...state.sections, section],
      }));
      return section;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create section",
      });
      return null;
    }
  },

  updateSection: async (notebookId, sectionId, updates) => {
    set({ error: null });
    try {
      const section = await api.updateSection(notebookId, sectionId, updates);
      set((state) => ({
        sections: state.sections.map((s) => (s.id === sectionId ? section : s)),
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to update section",
      });
    }
  },

  deleteSection: async (notebookId, sectionId, moveItemsTo) => {
    set({ error: null });
    try {
      await api.deleteSection(notebookId, sectionId, moveItemsTo);
      set((state) => ({
        sections: state.sections.filter((s) => s.id !== sectionId),
        selectedSectionId:
          state.selectedSectionId === sectionId
            ? null
            : state.selectedSectionId,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to delete section",
      });
    }
  },

  selectSection: (sectionId) => {
    set({ selectedSectionId: sectionId });
  },

  reorderSections: async (notebookId, sectionIds) => {
    set({ error: null });
    try {
      await api.reorderSections(notebookId, sectionIds);
      // Update local state with new positions
      set((state) => {
        const updatedSections = state.sections.map((s) => {
          const idx = sectionIds.indexOf(s.id);
          if (idx !== -1) {
            return { ...s, position: idx };
          }
          return s;
        });
        // Sort by position
        updatedSections.sort((a, b) => a.position - b.position);
        return { sections: updatedSections };
      });
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to reorder sections",
      });
    }
  },

  moveSectionToNotebook: async (
    sourceNotebookId,
    sectionId,
    targetNotebookId
  ) => {
    set({ error: null });
    try {
      const newSection = await api.moveSectionToNotebook(
        sourceNotebookId,
        sectionId,
        targetNotebookId
      );
      // Remove the section from local state (it's now in another notebook)
      set((state) => ({
        sections: state.sections.filter((s) => s.id !== sectionId),
        selectedSectionId:
          state.selectedSectionId === sectionId
            ? null
            : state.selectedSectionId,
      }));
      return newSection;
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to move section",
      });
      return null;
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));
