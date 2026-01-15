import { z } from "zod";
import { SyncConfigSchema } from "./sync";

export const NotebookTypeSchema = z.enum(["standard", "zettelkasten"]);
export type NotebookType = z.infer<typeof NotebookTypeSchema>;

export const AIProviderTypeSchema = z.enum(["openai", "anthropic", "ollama", "lmstudio"]);
export type AIProviderType = z.infer<typeof AIProviderTypeSchema>;

export const NotebookSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: NotebookTypeSchema,
  icon: z.string().optional(),
  color: z.string().optional(),
  sectionsEnabled: z.boolean().default(false),
  systemPrompt: z.string().optional(),
  aiProvider: AIProviderTypeSchema.optional(),
  aiModel: z.string().optional(),
  syncConfig: SyncConfigSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Notebook = z.infer<typeof NotebookSchema>;

export const NotebookMetadataSchema = NotebookSchema.omit({
  id: true,
}).extend({
  pageCount: z.number().int().nonnegative(),
});

export type NotebookMetadata = z.infer<typeof NotebookMetadataSchema>;
