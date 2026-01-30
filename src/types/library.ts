/**
 * Library types
 *
 * A Library represents a collection of notebooks stored at a specific path.
 */

import { z } from "zod";
import { EncryptionConfigSchema } from "./encryption";
import { LibrarySyncConfigSchema } from "./sync";

/**
 * Library schema - represents a notebook storage location
 */
export const LibrarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  path: z.string(),
  isDefault: z.boolean(),
  icon: z.string().optional(),
  color: z.string().optional(),
  encryptionConfig: EncryptionConfigSchema.optional(),
  syncConfig: LibrarySyncConfigSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Library = z.infer<typeof LibrarySchema>;

/**
 * Library statistics
 */
export const LibraryStatsSchema = z.object({
  libraryId: z.string().uuid(),
  notebookCount: z.number(),
  archivedNotebookCount: z.number(),
  pageCount: z.number(),
  assetCount: z.number(),
  totalSizeBytes: z.number(),
  lastModified: z.string().nullable(),
});

export type LibraryStats = z.infer<typeof LibraryStatsSchema>;

/**
 * Library creation input
 */
export interface CreateLibraryInput {
  name: string;
  path: string;
}

/**
 * Library update input
 */
export interface UpdateLibraryInput {
  name?: string;
  icon?: string;
  color?: string;
}
