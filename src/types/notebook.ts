import { z } from "zod";

export const NotebookTypeSchema = z.enum(["standard", "zettelkasten"]);
export type NotebookType = z.infer<typeof NotebookTypeSchema>;

export const NotebookSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: NotebookTypeSchema,
  icon: z.string().optional(),
  color: z.string().optional(),
  sectionsEnabled: z.boolean().default(false),
  systemPrompt: z.string().optional(),
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
