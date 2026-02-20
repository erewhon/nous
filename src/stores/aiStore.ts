import { create } from "zustand";
import { persist } from "zustand/middleware";
import { invoke } from "@tauri-apps/api/core";
import type { ChatMessage, ProviderType, ProviderConfig, ModelConfig } from "../types/ai";
import { createDefaultProviderConfig, DEFAULT_MODELS } from "../types/ai";
import { libraryScopedKey } from "../utils/libraryStorage";

const AI_STORE_KEY = libraryScopedKey("nous-ai-settings");

interface AISettings {
  // Multi-provider configuration
  providers: ProviderConfig[];
  defaultProvider: ProviderType;
  defaultModel: string;  // Format: "provider:model" or just "model" for default provider
  temperature: number;
  maxTokens: number;
  systemPrompt: string; // App-level default system prompt
}

// Legacy settings format for migration
interface LegacyAISettings {
  providerType: ProviderType;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
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
  pendingPrompt: string | null; // Auto-submit prompt when panel opens
}

interface AIState {
  // Settings (persisted)
  settings: AISettings;

  // Panel state (persisted)
  panel: AIPanelState;

  // Conversation state (not persisted)
  conversation: ConversationState;

  // Provider configuration actions
  updateProviderConfig: (type: ProviderType, updates: Partial<Omit<ProviderConfig, "type" | "models">>) => void;
  setProviderEnabled: (type: ProviderType, enabled: boolean) => void;
  setProviderApiKey: (type: ProviderType, apiKey: string) => void;
  setProviderBaseUrl: (type: ProviderType, baseUrl: string) => void;

  // Model management actions
  addModel: (providerType: ProviderType, model: { id: string; name: string }) => void;
  removeModel: (providerType: ProviderType, modelId: string) => void;
  toggleModel: (providerType: ProviderType, modelId: string, enabled: boolean) => void;

  // Default settings actions
  setDefaultProvider: (providerType: ProviderType) => void;
  setDefaultModel: (model: string) => void;
  setTemperature: (temperature: number) => void;
  setMaxTokens: (maxTokens: number) => void;
  setSystemPrompt: (systemPrompt: string) => void;

  // Helper to get provider config
  getProviderConfig: (type: ProviderType) => ProviderConfig | undefined;
  getEnabledModels: () => Array<{ provider: ProviderType; model: ModelConfig }>;
  getProviderForModel: (modelId: string) => ProviderType;

  // Legacy compatibility helpers - return active provider/model info
  getActiveProviderType: () => ProviderType;
  getActiveApiKey: () => string;
  getActiveModel: () => string;
  getActiveBaseUrl: () => string | undefined;

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

  // Model discovery
  isDiscoveringModels: boolean;
  discoverModels: (providerType: ProviderType) => Promise<{ found: number; added: number }>;

  // Conversation actions
  addMessage: (message: ChatMessage) => void;
  clearConversation: () => void;
  setLoading: (loading: boolean) => void;
  setPendingPrompt: (prompt: string | null) => void;
  openPanelWithPrompt: (prompt: string) => void;
}

const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant integrated into a note-taking application called Nous. You help users with their notes, answer questions about their content, provide summaries, brainstorm ideas, and assist with writing and organizing information. Be concise, helpful, and context-aware.

IMPORTANT: You have access to tools for creating and managing content. When the user asks you to create, write, or save content:
- USE create_page to create pages with Editor.js blocks
- USE create_notebook to create new notebooks
- USE run_action to run custom workflows
- USE nous_* tools to search, read, update, and organize pages
- USE nous_create_database to create structured databases
- USE nous_add_database_rows / nous_update_database_rows to manage database data

Always actually call the appropriate tool rather than describing what you would do.`;

// Create default settings with all providers initialized
function createDefaultSettings(): AISettings {
  const providers: ProviderConfig[] = [
    createDefaultProviderConfig("openai"),
    createDefaultProviderConfig("anthropic"),
    createDefaultProviderConfig("ollama"),
    createDefaultProviderConfig("lmstudio"),
    createDefaultProviderConfig("bedrock"),
  ];

  return {
    providers,
    defaultProvider: "openai",
    defaultModel: "gpt-4o",
    temperature: 0.7,
    maxTokens: 4096,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  };
}

// Migrate legacy settings to new format
function migrateSettings(stored: unknown): AISettings {
  // Check if it's already the new format
  if (stored && typeof stored === "object" && "providers" in stored) {
    return stored as AISettings;
  }

  // Check if it's the legacy format
  if (stored && typeof stored === "object" && "providerType" in stored) {
    const legacy = stored as LegacyAISettings;
    const newSettings = createDefaultSettings();

    // Migrate the legacy settings
    newSettings.defaultProvider = legacy.providerType;
    newSettings.defaultModel = legacy.model || DEFAULT_MODELS[legacy.providerType][0]?.id || "";
    newSettings.temperature = legacy.temperature;
    newSettings.maxTokens = legacy.maxTokens;
    newSettings.systemPrompt = legacy.systemPrompt;

    // Enable and configure the legacy provider
    const providerIndex = newSettings.providers.findIndex(p => p.type === legacy.providerType);
    if (providerIndex !== -1) {
      newSettings.providers[providerIndex].enabled = true;
      newSettings.providers[providerIndex].apiKey = legacy.apiKey;
    }

    return newSettings;
  }

  // Return fresh default settings
  return createDefaultSettings();
}

const defaultSettings: AISettings = createDefaultSettings();

const DEFAULT_PANEL_WIDTH = 480;
const DEFAULT_PANEL_HEIGHT = 650;
const MIN_PANEL_WIDTH = 320;
const MIN_PANEL_HEIGHT = 400;
const MAX_PANEL_WIDTH = 1200;
const MAX_PANEL_HEIGHT = 1200;

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
    (set, get) => ({
      settings: defaultSettings,
      panel: defaultPanelState,
      conversation: {
        messages: [],
        isLoading: false,
        pendingPrompt: null,
      },
      isDiscoveringModels: false,

      // Provider configuration actions
      updateProviderConfig: (type, updates) =>
        set((state) => ({
          settings: {
            ...state.settings,
            providers: state.settings.providers.map((p) =>
              p.type === type ? { ...p, ...updates } : p
            ),
          },
        })),

      setProviderEnabled: (type, enabled) =>
        set((state) => ({
          settings: {
            ...state.settings,
            providers: state.settings.providers.map((p) =>
              p.type === type ? { ...p, enabled } : p
            ),
          },
        })),

      setProviderApiKey: (type, apiKey) =>
        set((state) => ({
          settings: {
            ...state.settings,
            providers: state.settings.providers.map((p) =>
              p.type === type ? { ...p, apiKey } : p
            ),
          },
        })),

      setProviderBaseUrl: (type, baseUrl) =>
        set((state) => ({
          settings: {
            ...state.settings,
            providers: state.settings.providers.map((p) =>
              p.type === type ? { ...p, baseUrl } : p
            ),
          },
        })),

      // Model management actions
      addModel: (providerType, model) =>
        set((state) => ({
          settings: {
            ...state.settings,
            providers: state.settings.providers.map((p) =>
              p.type === providerType
                ? {
                    ...p,
                    models: [
                      ...p.models,
                      { ...model, enabled: true, isDefault: false, isCustom: true },
                    ],
                  }
                : p
            ),
          },
        })),

      removeModel: (providerType, modelId) =>
        set((state) => ({
          settings: {
            ...state.settings,
            providers: state.settings.providers.map((p) =>
              p.type === providerType
                ? {
                    ...p,
                    models: p.models.filter((m) => !(m.id === modelId && m.isCustom)),
                  }
                : p
            ),
          },
        })),

      toggleModel: (providerType, modelId, enabled) =>
        set((state) => ({
          settings: {
            ...state.settings,
            providers: state.settings.providers.map((p) =>
              p.type === providerType
                ? {
                    ...p,
                    models: p.models.map((m) =>
                      m.id === modelId ? { ...m, enabled } : m
                    ),
                  }
                : p
            ),
          },
        })),

      // Default settings actions
      setDefaultProvider: (providerType) =>
        set((state) => {
          // Get the first enabled model from the new provider
          const provider = state.settings.providers.find((p) => p.type === providerType);
          const firstModel = provider?.models.find((m) => m.enabled)?.id || "";
          return {
            settings: {
              ...state.settings,
              defaultProvider: providerType,
              defaultModel: firstModel,
            },
          };
        }),

      setDefaultModel: (model) =>
        set((state) => ({
          settings: { ...state.settings, defaultModel: model },
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

      // Helper functions
      getProviderConfig: (type) => {
        return get().settings.providers.find((p) => p.type === type);
      },

      getEnabledModels: () => {
        const providers = get().settings.providers;
        const result: Array<{ provider: ProviderType; model: ModelConfig }> = [];
        for (const provider of providers) {
          if (provider.enabled) {
            for (const model of provider.models) {
              if (model.enabled) {
                result.push({ provider: provider.type, model });
              }
            }
          }
        }
        return result;
      },

      getProviderForModel: (modelId: string) => {
        const providers = get().settings.providers;
        for (const provider of providers) {
          if (provider.models.some((m) => m.id === modelId)) {
            return provider.type;
          }
        }
        return get().settings.defaultProvider;
      },

      // Legacy compatibility helpers
      getActiveProviderType: () => {
        return get().settings.defaultProvider;
      },

      getActiveApiKey: () => {
        const settings = get().settings;
        const provider = settings.providers.find((p) => p.type === settings.defaultProvider);
        return provider?.apiKey || "";
      },

      getActiveModel: () => {
        return get().settings.defaultModel;
      },

      getActiveBaseUrl: () => {
        const settings = get().settings;
        const provider = settings.providers.find((p) => p.type === settings.defaultProvider);
        return provider?.baseUrl;
      },

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

      discoverModels: async (providerType: ProviderType) => {
        set({ isDiscoveringModels: true });
        try {
          const providerConfig = get().settings.providers.find((p) => p.type === providerType);
          const baseUrl = providerConfig?.baseUrl || (providerType === "ollama" ? "http://localhost:11434" : "http://localhost:1234");
          const models = await invoke<Array<{ id: string; name: string }>>("discover_ai_models", {
            provider: providerType,
            baseUrl,
          });
          const existingIds = new Set(providerConfig?.models.map((m) => m.id) || []);
          let added = 0;
          for (const model of models) {
            if (!existingIds.has(model.id)) {
              get().addModel(providerType, { id: model.id, name: model.name });
              added++;
            }
          }
          return { found: models.length, added };
        } finally {
          set({ isDiscoveringModels: false });
        }
      },

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

      setPendingPrompt: (prompt) =>
        set((state) => ({
          conversation: {
            ...state.conversation,
            pendingPrompt: prompt,
          },
        })),

      openPanelWithPrompt: (prompt) => {
        set((state) => ({
          panel: { ...state.panel, isOpen: true },
          conversation: {
            ...state.conversation,
            messages: [], // Clear conversation for fresh context
            pendingPrompt: prompt,
          },
        }));
      },
    }),
    {
      name: AI_STORE_KEY,
      version: 2, // Increment when making breaking changes
      // Persist settings and panel state, not conversation
      partialize: (state) => ({
        settings: state.settings,
        panel: state.panel,
      }),
      // Migration from old format to new format
      migrate: (persistedState, version) => {
        if (version < 2) {
          // Version 1 or undefined - migrate from legacy format
          const state = persistedState as { settings?: unknown; panel?: AIPanelState };
          return {
            settings: migrateSettings(state?.settings),
            panel: state?.panel || defaultPanelState,
          };
        }
        return persistedState;
      },
    }
  )
);
