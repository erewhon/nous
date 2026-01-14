import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ChatMessage, ProviderType } from "../types/ai";

interface AISettings {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string; // App-level default system prompt
}

// Locked context for pinned chat - when set, the chat uses this context instead of current page
export interface LockedContext {
  pageId: string;
  pageTitle: string;
  notebookId: string;
  notebookName: string;
}

interface AIPanelSize {
  width: number;
  height: number;
}

interface AIPanelPosition {
  x: number;
  y: number;
}

interface AIPanelState {
  isPinned: boolean;
  isOpen: boolean;
  lockedContext: LockedContext | null; // null = follow current page
  size: AIPanelSize;
  isDetached: boolean; // true = floating mode with custom position
  position: AIPanelPosition | null; // null = default bottom-right position
}

interface ConversationState {
  messages: ChatMessage[];
  isLoading: boolean;
}

interface AIState {
  // Settings (persisted)
  settings: AISettings;

  // Panel state (persisted)
  panel: AIPanelState;

  // Conversation state (not persisted)
  conversation: ConversationState;

  // Actions
  setProvider: (providerType: ProviderType) => void;
  setApiKey: (apiKey: string) => void;
  setModel: (model: string) => void;
  setTemperature: (temperature: number) => void;
  setMaxTokens: (maxTokens: number) => void;
  setSystemPrompt: (systemPrompt: string) => void;

  // Panel actions
  togglePin: () => void;
  setIsPinned: (isPinned: boolean) => void;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  lockContext: (context: LockedContext) => void;
  unlockContext: () => void;
  setPanelSize: (size: Partial<AIPanelSize>) => void;
  resetPanelSize: () => void;
  setPanelPosition: (position: AIPanelPosition) => void;
  resetPanelPosition: () => void;
  setDetached: (isDetached: boolean) => void;
  toggleDetached: () => void;

  // Conversation actions
  addMessage: (message: ChatMessage) => void;
  clearConversation: () => void;
  setLoading: (loading: boolean) => void;
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant integrated into a note-taking application called Katt. You help users with their notes, answer questions about their content, provide summaries, brainstorm ideas, and assist with writing and organizing information. Be concise, helpful, and context-aware.`;

const defaultSettings: AISettings = {
  providerType: "openai",
  apiKey: "",
  model: "",
  temperature: 0.7,
  maxTokens: 4096,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

const DEFAULT_PANEL_WIDTH = 480;
const DEFAULT_PANEL_HEIGHT = 650;
const MIN_PANEL_WIDTH = 320;
const MIN_PANEL_HEIGHT = 400;
const MAX_PANEL_WIDTH = 800;
const MAX_PANEL_HEIGHT = 900;

const defaultPanelState: AIPanelState = {
  isPinned: false,
  isOpen: false,
  lockedContext: null,
  size: {
    width: DEFAULT_PANEL_WIDTH,
    height: DEFAULT_PANEL_HEIGHT,
  },
  isDetached: false,
  position: null,
};

// Export constants for use in components
export { DEFAULT_SYSTEM_PROMPT };

export const AI_PANEL_CONSTRAINTS = {
  minWidth: MIN_PANEL_WIDTH,
  minHeight: MIN_PANEL_HEIGHT,
  maxWidth: MAX_PANEL_WIDTH,
  maxHeight: MAX_PANEL_HEIGHT,
  defaultWidth: DEFAULT_PANEL_WIDTH,
  defaultHeight: DEFAULT_PANEL_HEIGHT,
};

export const useAIStore = create<AIState>()(
  persist(
    (set) => ({
      settings: defaultSettings,
      panel: defaultPanelState,
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

      setSystemPrompt: (systemPrompt) =>
        set((state) => ({
          settings: { ...state.settings, systemPrompt },
        })),

      // Panel actions
      togglePin: () =>
        set((state) => ({
          panel: { ...state.panel, isPinned: !state.panel.isPinned },
        })),

      setIsPinned: (isPinned) =>
        set((state) => ({
          panel: { ...state.panel, isPinned },
        })),

      openPanel: () =>
        set((state) => ({
          panel: { ...state.panel, isOpen: true },
        })),

      closePanel: () =>
        set((state) => ({
          // Only close if not pinned
          panel: state.panel.isPinned
            ? state.panel
            : { ...state.panel, isOpen: false },
        })),

      togglePanel: () =>
        set((state) => ({
          panel: { ...state.panel, isOpen: !state.panel.isOpen },
        })),

      lockContext: (context) =>
        set((state) => ({
          panel: { ...state.panel, lockedContext: context },
        })),

      unlockContext: () =>
        set((state) => ({
          panel: { ...state.panel, lockedContext: null },
        })),

      setPanelSize: (size) =>
        set((state) => ({
          panel: {
            ...state.panel,
            size: {
              width: Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, size.width ?? state.panel.size.width)),
              height: Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, size.height ?? state.panel.size.height)),
            },
          },
        })),

      resetPanelSize: () =>
        set((state) => ({
          panel: {
            ...state.panel,
            size: {
              width: DEFAULT_PANEL_WIDTH,
              height: DEFAULT_PANEL_HEIGHT,
            },
          },
        })),

      setPanelPosition: (position) =>
        set((state) => ({
          panel: {
            ...state.panel,
            position,
          },
        })),

      resetPanelPosition: () =>
        set((state) => ({
          panel: {
            ...state.panel,
            position: null,
          },
        })),

      setDetached: (isDetached) =>
        set((state) => ({
          panel: {
            ...state.panel,
            isDetached,
            // Reset position when attaching back to corner
            position: isDetached ? state.panel.position : null,
          },
        })),

      toggleDetached: () =>
        set((state) => ({
          panel: {
            ...state.panel,
            isDetached: !state.panel.isDetached,
            // Reset position when attaching back to corner
            position: state.panel.isDetached ? null : state.panel.position,
          },
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
      // Persist settings and panel state, not conversation
      partialize: (state) => ({
        settings: state.settings,
        panel: state.panel,
      }),
    }
  )
);
