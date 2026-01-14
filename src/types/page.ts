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

// Folder type enum
export const FolderTypeSchema = z.enum(["standard", "archive"]);
export type FolderType = z.infer<typeof FolderTypeSchema>;

// Section schema (OneNote-style organizational layer)
export const SectionSchema = z.object({
  id: z.string().uuid(),
  notebookId: z.string().uuid(),
  name: z.string(),
  color: z.string().optional(),
  position: z.number().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Section = z.infer<typeof SectionSchema>;

// Folder schema
export const FolderSchema = z.object({
  id: z.string().uuid(),
  notebookId: z.string().uuid(),
  name: z.string(),
  parentId: z.string().uuid().nullable().optional(),
  sectionId: z.string().uuid().nullable().optional(),
  folderType: FolderTypeSchema.default("standard"),
  color: z.string().optional(),
  position: z.number().default(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Folder = z.infer<typeof FolderSchema>;

// Page schema
export const PageSchema = z.object({
  id: z.string().uuid(),
  notebookId: z.string().uuid(),
  title: z.string(),
  content: EditorDataSchema,
  tags: z.array(z.string()),
  folderId: z.string().uuid().nullable().optional(),
  sectionId: z.string().uuid().nullable().optional(),
  isArchived: z.boolean().default(false),
  isCover: z.boolean().default(false),
  position: z.number().default(0),
  systemPrompt: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Page = z.infer<typeof PageSchema>;

// Tree node for folder hierarchy
export interface FolderTreeNode {
  folder: Folder;
  children: FolderTreeNode[];
  pages: Page[];
  isExpanded: boolean;
}

// Root level items (pages without folders)
export interface PageTreeRoot {
  folders: FolderTreeNode[];
  pages: Page[]; // Pages at root level (no folder)
}

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
