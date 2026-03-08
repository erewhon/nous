import { z } from "zod";

// Provider types
export const ProviderTypeSchema = z.enum(["openai", "anthropic", "ollama", "lmstudio", "bedrock"]);
export type ProviderType = z.infer<typeof ProviderTypeSchema>;

// Model configuration for a provider
export const ModelConfigSchema = z.object({
  id: z.string(),              // Model identifier (e.g., "gpt-4o")
  name: z.string(),            // Display name (e.g., "GPT-4o")
  enabled: z.boolean(),        // Show in model selectors
  isDefault: z.boolean(),      // Is this a built-in default model
  isCustom: z.boolean(),       // User-added model
  contextLength: z.number().optional(), // Max context window (tokens), discovered from API
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// Provider configuration
export const ProviderConfigSchema = z.object({
  type: ProviderTypeSchema,
  enabled: z.boolean(),                    // Whether this provider is configured/active
  apiKey: z.string().optional(),           // For cloud providers
  baseUrl: z.string().optional(),          // For Ollama/LMStudio (custom endpoints)
  models: z.array(ModelConfigSchema),      // Available models for this provider
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

// Default models for each provider
export const DEFAULT_MODELS: Record<ProviderType, Array<{ id: string; name: string }>> = {
  openai: [
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "o3", name: "o3" },
    { id: "o3-mini", name: "o3 Mini" },
    { id: "o1", name: "o1" },
  ],
  anthropic: [
    { id: "claude-opus-4-6-20260320", name: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6-20260320", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
  ],
  ollama: [
    { id: "llama3.2", name: "Llama 3.2" },
    { id: "llama3.1", name: "Llama 3.1" },
    { id: "mistral", name: "Mistral" },
    { id: "codellama", name: "Code Llama" },
    { id: "phi3", name: "Phi-3" },
  ],
  lmstudio: [
    { id: "local-model", name: "Local Model" },
  ],
  bedrock: [
    { id: "anthropic.claude-sonnet-4-6-20260320-v1:0", name: "Claude Sonnet 4.6" },
    { id: "anthropic.claude-sonnet-4-20250514-v1:0", name: "Claude Sonnet 4" },
    { id: "anthropic.claude-haiku-4-5-20251001-v1:0", name: "Claude Haiku 4.5" },
    { id: "amazon.titan-text-premier-v1:0", name: "Titan Text Premier" },
    { id: "amazon.titan-text-express-v1", name: "Titan Text Express" },
    { id: "meta.llama3-2-90b-instruct-v1:0", name: "Llama 3.2 90B" },
    { id: "meta.llama3-2-11b-instruct-v1:0", name: "Llama 3.2 11B" },
    { id: "mistral.mistral-large-2407-v1:0", name: "Mistral Large" },
  ],
};

// Default base URLs for local providers (or region for Bedrock)
export const DEFAULT_BASE_URLS: Partial<Record<ProviderType, string>> = {
  ollama: "http://localhost:11434",
  lmstudio: "http://localhost:1234/v1",
  bedrock: "us-east-1",
};

// Helper to create default provider config
export function createDefaultProviderConfig(type: ProviderType): ProviderConfig {
  return {
    type,
    enabled: false,
    apiKey: "",
    baseUrl: DEFAULT_BASE_URLS[type],
    models: DEFAULT_MODELS[type].map((m) => ({
      ...m,
      enabled: true,
      isDefault: true,
      isCustom: false,
    })),
  };
}

// Chat message schema
export const ChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// Chat response schema
export const ChatResponseSchema = z.object({
  content: z.string(),
  model: z.string(),
  provider: z.string(),
  tokensUsed: z.number().nullable().optional(),
  finishReason: z.string().nullable().optional(),
});

export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// Page context for AI operations
export const PageContextSchema = z.object({
  pageId: z.string(),
  title: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  notebookName: z.string().optional(),
});

export type PageContext = z.infer<typeof PageContextSchema>;

// Legacy AI configuration (kept for backward compatibility)
export const AIConfigSchema = z.object({
  providerType: ProviderTypeSchema.default("openai"),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(1).default(4096),
});

export type AIConfig = z.infer<typeof AIConfigSchema>;

// Notebook info for AI context
export const NotebookInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type NotebookInfo = z.infer<typeof NotebookInfoSchema>;

// AI action from tool use
export const AIActionSchema = z.object({
  tool: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  toolCallId: z.string(),
});

export type AIAction = z.infer<typeof AIActionSchema>;

// Chat response with actions
export const ChatResponseWithActionsSchema = z.object({
  content: z.string(),
  model: z.string(),
  provider: z.string(),
  tokensUsed: z.number().nullable().optional(),
  finishReason: z.string().nullable().optional(),
  actions: z.array(AIActionSchema),
  thinking: z.string().nullable().optional(),
});

export type ChatResponseWithActions = z.infer<typeof ChatResponseWithActionsSchema>;

// Create notebook action arguments
export const CreateNotebookArgsSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

export type CreateNotebookArgs = z.infer<typeof CreateNotebookArgsSchema>;

// Create page action arguments
export const CreatePageArgsSchema = z.object({
  notebook_name: z.string(),
  title: z.string(),
  content_blocks: z.array(
    z.object({
      type: z.string(),
      data: z.record(z.string(), z.unknown()),
    })
  ),
  tags: z.array(z.string()).optional(),
});

export type CreatePageArgs = z.infer<typeof CreatePageArgsSchema>;

// Stream event types
export type StreamChunkEvent = {
  type: "chunk";
  content: string;
};

export type StreamThinkingEvent = {
  type: "thinking";
  content: string;
};

export type StreamActionEvent = {
  type: "action";
  tool: string;
  arguments: Record<string, unknown>;
  toolCallId: string;
};

export type StreamDoneEvent = {
  type: "done";
  model: string;
  tokensUsed: number;
};

export type StreamErrorEvent = {
  type: "error";
  message: string;
};

export type StreamEvent =
  | StreamChunkEvent
  | StreamThinkingEvent
  | StreamActionEvent
  | StreamDoneEvent
  | StreamErrorEvent;
