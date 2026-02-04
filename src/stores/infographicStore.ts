import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  InfographicTemplate,
  InfographicTheme,
  InfographicResult,
  InfographicAvailability,
} from "../types/infographic";
import * as api from "../utils/api";

interface InfographicSettings {
  theme: InfographicTheme;
  width: number;
  height: number;
}

interface InfographicState {
  // Generation state
  isGenerating: boolean;
  error: string | null;
  result: InfographicResult | null;

  // Configuration
  selectedTemplate: InfographicTemplate;
  settings: InfographicSettings;

  // Availability
  availability: InfographicAvailability | null;
  isLoadingAvailability: boolean;
}

interface InfographicActions {
  // Template selection
  setSelectedTemplate: (template: InfographicTemplate) => void;

  // Settings
  setTheme: (theme: InfographicTheme) => void;
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;

  // Generation
  generateInfographic: (
    notebookId: string,
    template: InfographicTemplate,
    data: Record<string, unknown>,
    title?: string
  ) => Promise<InfographicResult | null>;

  // Availability check
  checkAvailability: () => Promise<void>;

  // Clear operations
  clearResult: () => void;
  clearError: () => void;
}

type InfographicStore = InfographicState & InfographicActions;

export const useInfographicStore = create<InfographicStore>()(
  persist(
    (set, get) => ({
      // Initial state
      isGenerating: false,
      error: null,
      result: null,
      selectedTemplate: "key_concepts",
      settings: {
        theme: "light",
        width: 1200,
        height: 800,
      },
      availability: null,
      isLoadingAvailability: false,

      // Template selection
      setSelectedTemplate: (template) => set({ selectedTemplate: template }),

      // Settings
      setTheme: (theme) =>
        set((state) => ({
          settings: { ...state.settings, theme },
        })),
      setWidth: (width) =>
        set((state) => ({
          settings: { ...state.settings, width },
        })),
      setHeight: (height) =>
        set((state) => ({
          settings: { ...state.settings, height },
        })),

      // Generation
      generateInfographic: async (notebookId, template, data, title) => {
        set({ isGenerating: true, error: null });
        try {
          const { settings } = get();
          const result = await api.generateInfographic(
            notebookId,
            template,
            data,
            {
              template,
              width: settings.width,
              height: settings.height,
              theme: settings.theme,
              title,
            }
          );
          set({ result, isGenerating: false });
          return result;
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to generate infographic";
          set({ error: message, isGenerating: false });
          return null;
        }
      },

      // Availability check
      checkAvailability: async () => {
        set({ isLoadingAvailability: true });
        try {
          const availability = await api.checkInfographicAvailability();
          set({
            availability: {
              svgGeneration: availability.svg_generation ?? false,
              pngExport: availability.png_export ?? false,
            },
            isLoadingAvailability: false,
          });
        } catch (err) {
          console.error("Failed to check infographic availability:", err);
          set({ isLoadingAvailability: false });
        }
      },

      // Clear operations
      clearResult: () => set({ result: null }),
      clearError: () => set({ error: null }),
    }),
    {
      name: "infographic-settings",
      version: 1,
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);
