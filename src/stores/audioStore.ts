import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type {
  TTSProviderType,
  TTSProviderInfo,
  TTSVoiceInfo,
  PodcastLength,
} from "../types/audio";

interface AudioSettings {
  ttsProvider: TTSProviderType;
  ttsVoice: string;
  ttsApiKey: string;
  ttsBaseUrl: string;
  ttsModel: string;
  ttsSpeed: number;
  // Podcast defaults
  podcastVoiceB: string;
  podcastLength: PodcastLength;
}

interface AudioState {
  settings: AudioSettings;

  // Cached data (not persisted)
  providers: TTSProviderInfo[];
  voices: TTSVoiceInfo[];
  isLoadingProviders: boolean;
  isLoadingVoices: boolean;

  // Settings actions
  setTtsProvider: (provider: TTSProviderType) => void;
  setTtsVoice: (voice: string) => void;
  setTtsApiKey: (key: string) => void;
  setTtsBaseUrl: (url: string) => void;
  setTtsModel: (model: string) => void;
  setTtsSpeed: (speed: number) => void;
  setPodcastVoiceB: (voice: string) => void;
  setPodcastLength: (length: PodcastLength) => void;

  // Data loading
  loadProviders: () => Promise<void>;
  loadVoices: (provider?: TTSProviderType) => Promise<void>;
}

const defaultSettings: AudioSettings = {
  ttsProvider: "openai",
  ttsVoice: "alloy",
  ttsApiKey: "",
  ttsBaseUrl: "",
  ttsModel: "",
  ttsSpeed: 1.0,
  podcastVoiceB: "nova",
  podcastLength: "medium",
};

export const useAudioStore = create<AudioState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      providers: [],
      voices: [],
      isLoadingProviders: false,
      isLoadingVoices: false,

      setTtsProvider: (provider) =>
        set((state) => ({
          settings: { ...state.settings, ttsProvider: provider },
        })),

      setTtsVoice: (voice) =>
        set((state) => ({
          settings: { ...state.settings, ttsVoice: voice },
        })),

      setTtsApiKey: (key) =>
        set((state) => ({
          settings: { ...state.settings, ttsApiKey: key },
        })),

      setTtsBaseUrl: (url) =>
        set((state) => ({
          settings: { ...state.settings, ttsBaseUrl: url },
        })),

      setTtsModel: (model) =>
        set((state) => ({
          settings: { ...state.settings, ttsModel: model },
        })),

      setTtsSpeed: (speed) =>
        set((state) => ({
          settings: { ...state.settings, ttsSpeed: speed },
        })),

      setPodcastVoiceB: (voice) =>
        set((state) => ({
          settings: { ...state.settings, podcastVoiceB: voice },
        })),

      setPodcastLength: (length) =>
        set((state) => ({
          settings: { ...state.settings, podcastLength: length },
        })),

      loadProviders: async () => {
        set({ isLoadingProviders: true });
        try {
          const providers =
            await invoke<TTSProviderInfo[]>("get_tts_providers");
          set({ providers });
        } catch (e) {
          console.error("Failed to load TTS providers:", e);
        } finally {
          set({ isLoadingProviders: false });
        }
      },

      loadVoices: async (provider?: TTSProviderType) => {
        const p = provider ?? get().settings.ttsProvider;
        set({ isLoadingVoices: true });
        try {
          const apiKey = get().settings.ttsApiKey || undefined;
          const baseUrl = get().settings.ttsBaseUrl || undefined;
          const voices = await invoke<TTSVoiceInfo[]>("list_tts_voices", {
            provider: p,
            apiKey,
            baseUrl,
          });
          set({ voices });
        } catch (e) {
          console.error("Failed to load TTS voices:", e);
          set({ voices: [] });
        } finally {
          set({ isLoadingVoices: false });
        }
      },
    }),
    {
      name: "nous-audio-settings",
      version: 1,
      partialize: (state) => ({
        settings: state.settings,
      }),
    }
  )
);
