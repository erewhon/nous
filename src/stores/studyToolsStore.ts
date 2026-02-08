import { create } from "zustand";
import type {
  StudyGuide,
  FAQ,
  FlashcardGenerationResult,
  BriefingDocument,
  Timeline,
  ConceptGraph,
  StudyToolType,
  StudyPageContent,
  StudyGuideOptions,
} from "../types/studyTools";
import * as api from "../utils/api";
import { useAIStore } from "./aiStore";

interface StudyToolsState {
  // Panel state
  isOpen: boolean;
  activeTool: StudyToolType | null;
  selectedPageIds: string[];

  // Generation state
  isGenerating: boolean;
  error: string | null;

  // Generated content
  studyGuide: StudyGuide | null;
  faq: FAQ | null;
  flashcards: FlashcardGenerationResult | null;
  briefing: BriefingDocument | null;
  timeline: Timeline | null;
  conceptGraph: ConceptGraph | null;
}

interface StudyToolsActions {
  // Panel operations
  openPanel: (tool?: StudyToolType) => void;
  closePanel: () => void;
  setActiveTool: (tool: StudyToolType | null) => void;

  // Page selection
  setSelectedPageIds: (pageIds: string[]) => void;
  addSelectedPageId: (pageId: string) => void;
  removeSelectedPageId: (pageId: string) => void;
  clearSelectedPageIds: () => void;

  // Generation operations
  generateStudyGuide: (
    pages: StudyPageContent[],
    options?: Partial<StudyGuideOptions>
  ) => Promise<StudyGuide | null>;
  generateFaq: (
    pages: StudyPageContent[],
    numQuestions?: number
  ) => Promise<FAQ | null>;
  generateFlashcards: (
    pages: StudyPageContent[],
    numCards?: number,
    cardTypes?: string[]
  ) => Promise<FlashcardGenerationResult | null>;
  generateBriefing: (
    pages: StudyPageContent[],
    includeActionItems?: boolean
  ) => Promise<BriefingDocument | null>;
  extractTimeline: (pages: StudyPageContent[]) => Promise<Timeline | null>;
  extractConcepts: (
    pages: StudyPageContent[],
    maxNodes?: number
  ) => Promise<ConceptGraph | null>;

  // Clear operations
  clearStudyGuide: () => void;
  clearFaq: () => void;
  clearFlashcards: () => void;
  clearBriefing: () => void;
  clearTimeline: () => void;
  clearConceptGraph: () => void;
  clearAll: () => void;
  clearError: () => void;
}

type StudyToolsStore = StudyToolsState & StudyToolsActions;

// Helper to get AI config from the AI store
function getAIConfig() {
  const aiStore = useAIStore.getState();
  return {
    providerType: aiStore.getActiveProviderType(),
    apiKey: aiStore.getActiveApiKey(),
    model: aiStore.getActiveModel(),
    temperature: aiStore.settings.temperature,
    maxTokens: aiStore.settings.maxTokens,
  };
}

export const useStudyToolsStore = create<StudyToolsStore>()((set) => ({
  // Initial state
  isOpen: false,
  activeTool: null,
  selectedPageIds: [],
  isGenerating: false,
  error: null,
  studyGuide: null,
  faq: null,
  flashcards: null,
  briefing: null,
  timeline: null,
  conceptGraph: null,

  // Panel operations
  openPanel: (tool) =>
    set({
      isOpen: true,
      activeTool: tool ?? null,
    }),
  closePanel: () =>
    set({
      isOpen: false,
    }),
  setActiveTool: (tool) => set({ activeTool: tool }),

  // Page selection
  setSelectedPageIds: (pageIds) => set({ selectedPageIds: pageIds }),
  addSelectedPageId: (pageId) =>
    set((state) => ({
      selectedPageIds: state.selectedPageIds.includes(pageId)
        ? state.selectedPageIds
        : [...state.selectedPageIds, pageId],
    })),
  removeSelectedPageId: (pageId) =>
    set((state) => ({
      selectedPageIds: state.selectedPageIds.filter((id) => id !== pageId),
    })),
  clearSelectedPageIds: () => set({ selectedPageIds: [] }),

  // Generation operations
  generateStudyGuide: async (pages, options) => {
    set({ isGenerating: true, error: null });
    try {
      const aiConfig = getAIConfig();
      const studyGuide = await api.generateStudyGuide(pages, {
        ...aiConfig,
        depth: options?.depth,
        focusAreas: options?.focusAreas,
        numPracticeQuestions: options?.numPracticeQuestions,
      });
      set({ studyGuide, isGenerating: false });
      return studyGuide;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate study guide";
      set({ error: message, isGenerating: false });
      return null;
    }
  },

  generateFaq: async (pages, numQuestions) => {
    set({ isGenerating: true, error: null });
    try {
      const aiConfig = getAIConfig();
      const faq = await api.generateFaq(pages, numQuestions, aiConfig);
      set({ faq, isGenerating: false });
      return faq;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate FAQ";
      set({ error: message, isGenerating: false });
      return null;
    }
  },

  generateFlashcards: async (pages, numCards, cardTypes) => {
    set({ isGenerating: true, error: null });
    try {
      const aiConfig = getAIConfig();
      const flashcards = await api.aiGenerateFlashcards(
        pages,
        numCards,
        cardTypes,
        aiConfig
      );
      set({ flashcards, isGenerating: false });
      return flashcards;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate flashcards";
      set({ error: message, isGenerating: false });
      return null;
    }
  },

  generateBriefing: async (pages, includeActionItems) => {
    set({ isGenerating: true, error: null });
    try {
      const aiConfig = getAIConfig();
      const briefing = await api.generateBriefing(
        pages,
        includeActionItems,
        aiConfig
      );
      set({ briefing, isGenerating: false });
      return briefing;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to generate briefing";
      set({ error: message, isGenerating: false });
      return null;
    }
  },

  extractTimeline: async (pages) => {
    set({ isGenerating: true, error: null });
    try {
      const aiConfig = getAIConfig();
      const timeline = await api.extractTimeline(pages, aiConfig);
      set({ timeline, isGenerating: false });
      return timeline;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to extract timeline";
      set({ error: message, isGenerating: false });
      return null;
    }
  },

  extractConcepts: async (pages, maxNodes) => {
    set({ isGenerating: true, error: null });
    try {
      const aiConfig = getAIConfig();
      const conceptGraph = await api.extractConcepts(pages, maxNodes, aiConfig);
      set({ conceptGraph, isGenerating: false });
      return conceptGraph;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to extract concepts";
      set({ error: message, isGenerating: false });
      return null;
    }
  },

  // Clear operations
  clearStudyGuide: () => set({ studyGuide: null }),
  clearFaq: () => set({ faq: null }),
  clearFlashcards: () => set({ flashcards: null }),
  clearBriefing: () => set({ briefing: null }),
  clearTimeline: () => set({ timeline: null }),
  clearConceptGraph: () => set({ conceptGraph: null }),
  clearAll: () =>
    set({
      studyGuide: null,
      faq: null,
      flashcards: null,
      briefing: null,
      timeline: null,
      conceptGraph: null,
      error: null,
    }),
  clearError: () => set({ error: null }),
}));

// Selectors
export const selectHasGeneratedContent = (state: StudyToolsState) =>
  state.studyGuide !== null ||
  state.faq !== null ||
  state.flashcards !== null ||
  state.briefing !== null ||
  state.timeline !== null ||
  state.conceptGraph !== null;

export const selectSelectedPagesCount = (state: StudyToolsState) =>
  state.selectedPageIds.length;
