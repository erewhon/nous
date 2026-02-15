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

// System prompt mode enum
export const SystemPromptModeSchema = z.enum(["override", "concatenate"]);
export type SystemPromptMode = z.infer<typeof SystemPromptModeSchema>;

// Page type enum - determines storage format and viewer/editor
export const PageTypeSchema = z.enum([
  "standard", // Editor.js block-based content (default)
  "markdown", // Native markdown file (.md)
  "pdf", // PDF document
  "jupyter", // Jupyter notebook (.ipynb)
  "epub", // E-book (.epub)
  "calendar", // Calendar file (.ics)
  "chat", // AI Chat conversation page (.chat)
  "canvas", // Infinite canvas/whiteboard (.canvas)
  "database", // Database/table view (.database)
]);
export type PageType = z.infer<typeof PageTypeSchema>;

// File storage mode - how file-based page content is stored
export const FileStorageModeSchema = z.enum([
  "embedded", // File copied into notebook assets directory
  "linked", // File remains at original location (path stored as reference)
]);
export type FileStorageMode = z.infer<typeof FileStorageModeSchema>;

// Section schema (OneNote-style organizational layer)
export const SectionSchema = z.object({
  id: z.string().uuid(),
  notebookId: z.string().uuid(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  systemPrompt: z.string().optional(),
  systemPromptMode: SystemPromptModeSchema.default("override"),
  aiModel: z.string().optional(), // Model override (format: "provider:model" or just "model")
  pageSortBy: z.enum(["position", "name-asc", "name-desc", "updated", "created"]).optional(),
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
  isArchived: z.boolean().default(false),
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
  parentPageId: z.string().uuid().nullable().optional(), // For nested pages
  sectionId: z.string().uuid().nullable().optional(),
  isArchived: z.boolean().default(false),
  isCover: z.boolean().default(false),
  position: z.number().default(0),
  systemPrompt: z.string().optional(),
  systemPromptMode: SystemPromptModeSchema.default("override"),
  aiModel: z.string().optional(), // Model override (format: "provider:model" or just "model")
  // File type support
  pageType: PageTypeSchema.default("standard"),
  sourceFile: z.string().nullable().optional(), // Path to actual file for non-standard pages
  storageMode: FileStorageModeSchema.nullable().optional(), // How file is stored (embedded/linked)
  fileExtension: z.string().nullable().optional(), // Original file extension (e.g., "pdf", "md")
  lastFileSync: z.string().datetime().nullable().optional(), // Last sync time for linked files
  // Template tracking
  templateId: z.string().nullable().optional(), // Template this page was created from
  // Soft delete support - pages in trash
  deletedAt: z.string().datetime().nullable().optional(), // When page was moved to trash (null = not deleted)
  // Favorites
  color: z.string().optional(),
  isFavorite: z.boolean().default(false),
  // Daily notes
  isDailyNote: z.boolean().default(false),
  dailyNoteDate: z.string().nullable().optional(), // "YYYY-MM-DD" format
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
  pageType: PageTypeSchema,
});

export type SearchResult = z.infer<typeof SearchResultSchema>;
