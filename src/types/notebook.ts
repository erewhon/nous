import { z } from "zod";
import { EncryptionConfigSchema } from "./encryption";
import { SyncConfigSchema } from "./sync";
import { SystemPromptModeSchema } from "./page";
import { DailyNotesConfigSchema } from "./dailyNotes";

export const NotebookTypeSchema = z.enum(["standard", "zettelkasten"]);
export type NotebookType = z.infer<typeof NotebookTypeSchema>;

export const AIProviderTypeSchema = z.enum(["openai", "anthropic", "ollama", "lmstudio"]);
export type AIProviderType = z.infer<typeof AIProviderTypeSchema>;

export const PageSortOptionSchema = z.enum(["position", "name-asc", "name-desc", "updated", "created"]);
export type PageSortOption = z.infer<typeof PageSortOptionSchema>;

export const NotebookSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: NotebookTypeSchema,
  icon: z.string().optional(),
  color: z.string().optional(),
  sectionsEnabled: z.boolean().default(false),
  archived: z.boolean().default(false),
  systemPrompt: z.string().optional(),
  systemPromptMode: SystemPromptModeSchema.default("override"),
  aiProvider: AIProviderTypeSchema.optional(),
  aiModel: z.string().optional(),
  syncConfig: SyncConfigSchema.optional(),
  encryptionConfig: EncryptionConfigSchema.optional(),
  isPinned: z.boolean().default(false),
  position: z.number().default(0),
  pageSortBy: PageSortOptionSchema.optional(),
  dailyNotesConfig: DailyNotesConfigSchema.optional(),
  coverImage: z.string().optional(),
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
