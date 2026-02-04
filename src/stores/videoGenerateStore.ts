import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  SlideContent,
  VideoTheme,
  VideoTransition,
  VideoGenerationResult,
  VideoAvailability,
  VideoTTSConfig,
} from "../types/videoGenerate";
import * as api from "../utils/api";
import { useAudioStore } from "./audioStore";

interface VideoGenerateSettings {
  theme: VideoTheme;
  transition: VideoTransition;
  width: number;
  height: number;
}

interface VideoGenerateState {
  // Generation state
  isGenerating: boolean;
  error: string | null;
  result: VideoGenerationResult | null;
  progress: number;

  // Configuration
  settings: VideoGenerateSettings;
  ttsConfig: Partial<VideoTTSConfig>;

  // Slides for preview/editing
  slides: SlideContent[];

  // Availability
  availability: VideoAvailability | null;
  isLoadingAvailability: boolean;
}

interface VideoGenerateActions {
  // Settings
  setTheme: (theme: VideoTheme) => void;
  setTransition: (transition: VideoTransition) => void;
  setWidth: (width: number) => void;
  setHeight: (height: number) => void;
  setAspectRatio: (width: number, height: number) => void;

  // TTS config
  setTTSConfig: (config: Partial<VideoTTSConfig>) => void;

  // Slides management
  setSlides: (slides: SlideContent[]) => void;
  updateSlide: (index: number, slide: Partial<SlideContent>) => void;
  removeSlide: (index: number) => void;
  addSlide: (slide: SlideContent) => void;
  reorderSlides: (fromIndex: number, toIndex: number) => void;
  clearSlides: () => void;

  // Generation
  generateVideo: (
    notebookId: string,
    title?: string
  ) => Promise<VideoGenerationResult | null>;

  // Availability check
  checkAvailability: () => Promise<void>;

  // Clear operations
  clearResult: () => void;
  clearError: () => void;
  reset: () => void;
}

type VideoGenerateStore = VideoGenerateState & VideoGenerateActions;

// Helper to get TTS config from audio store
function getDefaultTTSConfig(): Partial<VideoTTSConfig> {
  const audioStore = useAudioStore.getState();
  return {
    provider: audioStore.settings.ttsProvider,
    voice: audioStore.settings.ttsVoice,
    apiKey: audioStore.settings.ttsApiKey || undefined,
    baseUrl: audioStore.settings.ttsBaseUrl || undefined,
    model: audioStore.settings.ttsModel || undefined,
    speed: audioStore.settings.ttsSpeed || undefined,
  };
}

export const useVideoGenerateStore = create<VideoGenerateStore>()(
  persist(
    (set, get) => ({
      // Initial state
      isGenerating: false,
      error: null,
      result: null,
      progress: 0,
      settings: {
        theme: "light",
        transition: "cut",
        width: 1920,
        height: 1080,
      },
      ttsConfig: {},
      slides: [],
      availability: null,
      isLoadingAvailability: false,

      // Settings
      setTheme: (theme) =>
        set((state) => ({
          settings: { ...state.settings, theme },
        })),
      setTransition: (transition) =>
        set((state) => ({
          settings: { ...state.settings, transition },
        })),
      setWidth: (width) =>
        set((state) => ({
          settings: { ...state.settings, width },
        })),
      setHeight: (height) =>
        set((state) => ({
          settings: { ...state.settings, height },
        })),
      setAspectRatio: (width, height) =>
        set((state) => ({
          settings: { ...state.settings, width, height },
        })),

      // TTS config
      setTTSConfig: (config) =>
        set((state) => ({
          ttsConfig: { ...state.ttsConfig, ...config },
        })),

      // Slides management
      setSlides: (slides) => set({ slides }),
      updateSlide: (index, slideUpdate) =>
        set((state) => ({
          slides: state.slides.map((slide, i) =>
            i === index ? { ...slide, ...slideUpdate } : slide
          ),
        })),
      removeSlide: (index) =>
        set((state) => ({
          slides: state.slides.filter((_, i) => i !== index),
        })),
      addSlide: (slide) =>
        set((state) => ({
          slides: [...state.slides, slide],
        })),
      reorderSlides: (fromIndex, toIndex) =>
        set((state) => {
          const newSlides = [...state.slides];
          const [removed] = newSlides.splice(fromIndex, 1);
          newSlides.splice(toIndex, 0, removed);
          return { slides: newSlides };
        }),
      clearSlides: () => set({ slides: [] }),

      // Generation
      generateVideo: async (notebookId, title) => {
        const { slides, settings, ttsConfig } = get();

        if (slides.length === 0) {
          set({ error: "No slides to generate video from" });
          return null;
        }

        set({ isGenerating: true, error: null, progress: 0 });

        try {
          // Merge with default TTS config from audio store
          const defaultTTS = getDefaultTTSConfig();
          const finalTTSConfig = {
            provider: ttsConfig.provider || defaultTTS.provider || "openai",
            voice: ttsConfig.voice || defaultTTS.voice || "alloy",
            apiKey: ttsConfig.apiKey || defaultTTS.apiKey,
            baseUrl: ttsConfig.baseUrl || defaultTTS.baseUrl,
            model: ttsConfig.model || defaultTTS.model,
            speed: ttsConfig.speed ?? defaultTTS.speed ?? 1.0,
          };

          const result = await api.generateStudyVideo(
            notebookId,
            slides,
            finalTTSConfig,
            {
              width: settings.width,
              height: settings.height,
              theme: settings.theme,
              transition: settings.transition,
              title,
            }
          );

          set({ result, isGenerating: false, progress: 100 });
          return result;
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to generate video";
          set({ error: message, isGenerating: false, progress: 0 });
          return null;
        }
      },

      // Availability check
      checkAvailability: async () => {
        set({ isLoadingAvailability: true });
        try {
          const availability = await api.checkVideoGenerationAvailability();
          set({
            availability: {
              pillow: availability.pillow ?? false,
              ffmpeg: availability.ffmpeg ?? false,
              pydub: availability.pydub ?? false,
              fullyAvailable: availability.fully_available ?? false,
            },
            isLoadingAvailability: false,
          });
        } catch (err) {
          console.error("Failed to check video generation availability:", err);
          set({ isLoadingAvailability: false });
        }
      },

      // Clear operations
      clearResult: () => set({ result: null }),
      clearError: () => set({ error: null }),
      reset: () =>
        set({
          result: null,
          error: null,
          progress: 0,
          slides: [],
        }),
    }),
    {
      name: "video-generate-settings",
      version: 1,
      partialize: (state) => ({
        settings: state.settings,
        ttsConfig: state.ttsConfig,
      }),
    }
  )
);

// Selector for checking if ready to generate
export const selectCanGenerate = (state: VideoGenerateState) =>
  state.slides.length > 0 && !state.isGenerating;
