import { z } from "zod";

// Editor.js block structure
export const EditorBlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export type EditorBlock = z.infer<typeof EditorBlockSchema>;

export const EditorDataSchema = z.object({
  time: z.number().optional(),
  version: z.string().optional(),
  blocks: z.array(EditorBlockSchema),
});

export type EditorData = z.infer<typeof EditorDataSchema>;

// Page schema
export const PageSchema = z.object({
  id: z.string().uuid(),
  notebookId: z.string().uuid(),
  title: z.string(),
  content: EditorDataSchema,
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Page = z.infer<typeof PageSchema>;

// Zettel extends Page with additional metadata
export const ZettelSchema = PageSchema.extend({
  links: z.array(z.string().uuid()), // IDs of linked zettels
  backlinks: z.array(z.string().uuid()), // IDs of zettels linking to this one
  zettelId: z.string(), // Human-readable zettel ID (e.g., "202401011200")
});

export type Zettel = z.infer<typeof ZettelSchema>;

// Link structure for bi-directional linking
export const LinkSchema = z.object({
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  context: z.string().optional(), // Surrounding text for context
});

export type Link = z.infer<typeof LinkSchema>;

// Search result from Tantivy
export const SearchResultSchema = z.object({
  pageId: z.string(),
  notebookId: z.string(),
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
});

export type SearchResult = z.infer<typeof SearchResultSchema>;
