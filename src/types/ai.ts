import { z } from "zod";

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

// AI configuration
export const AIConfigSchema = z.object({
  providerType: z.enum(["openai", "anthropic", "ollama"]).default("openai"),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().min(1).default(4096),
});

export type AIConfig = z.infer<typeof AIConfigSchema>;

// Provider types
export type ProviderType = "openai" | "anthropic" | "ollama";

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
