import { z } from "zod";

export const OrganizeSuggestionSchema = z.object({
  pageId: z.string().uuid(),
  pageTitle: z.string(),
  suggestedNotebookId: z.string().uuid().nullable(),
  suggestedNotebookName: z.string().nullable(),
  confidence: z.number(),
  reasoning: z.string(),
});

export type OrganizeSuggestion = z.infer<typeof OrganizeSuggestionSchema>;

export const OrganizeMoveSchema = z.object({
  pageId: z.string().uuid(),
  targetNotebookId: z.string().uuid(),
});

export type OrganizeMove = z.infer<typeof OrganizeMoveSchema>;

export const OrganizeApplyResultSchema = z.object({
  movedCount: z.number(),
  errors: z.array(z.string()),
});

export type OrganizeApplyResult = z.infer<typeof OrganizeApplyResultSchema>;
