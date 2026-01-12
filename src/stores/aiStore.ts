import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage, ProviderType } from "../types/ai";

interface AISettings {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

interface ConversationState {
  messages: ChatMessage[];
  isLoading: boolean;
}

interface AIState {
  // Settings (persisted)
  settings: AISettings;

  // Conversation state (not persisted)
  conversation: ConversationState;

  // Actions
  setProvider: (providerType: ProviderType) => void;
  setApiKey: (apiKey: string) => void;
  setModel: (model: string) => void;
  setTemperature: (temperature: number) => void;
  setMaxTokens: (maxTokens: number) => void;

  // Conversation actions
  addMessage: (message: ChatMessage) => void;
  clearConversation: () => void;
  setLoading: (loading: boolean) => void;
}

const defaultSettings: AISettings = {
  providerType: "openai",
  apiKey: "",
  model: "",
  temperature: 0.7,
  maxTokens: 4096,
};

export const useAIStore = create<AIState>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      conversation: {
        messages: [],
        isLoading: false,
      },

      setProvider: (providerType) =>
        set((state) => ({
          settings: { ...state.settings, providerType, model: "" },
        })),

      setApiKey: (apiKey) =>
        set((state) => ({
          settings: { ...state.settings, apiKey },
        })),

      setModel: (model) =>
        set((state) => ({
          settings: { ...state.settings, model },
        })),

      setTemperature: (temperature) =>
        set((state) => ({
          settings: { ...state.settings, temperature },
        })),

      setMaxTokens: (maxTokens) =>
        set((state) => ({
          settings: { ...state.settings, maxTokens },
        })),

      addMessage: (message) =>
        set((state) => ({
          conversation: {
            ...state.conversation,
            messages: [...state.conversation.messages, message],
          },
        })),

      clearConversation: () =>
        set((state) => ({
          conversation: {
            ...state.conversation,
            messages: [],
          },
        })),

      setLoading: (isLoading) =>
        set((state) => ({
          conversation: {
            ...state.conversation,
            isLoading,
          },
        })),
    }),
    {
      name: "katt-ai-settings",
      // Only persist settings, not conversation
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);
