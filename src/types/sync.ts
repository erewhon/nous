import { z } from "zod";

// ===== Auth Types =====

export const AuthTypeSchema = z.enum(["basic", "oauth2", "apptoken"]);
export type AuthType = z.infer<typeof AuthTypeSchema>;

// ===== Sync Mode Types =====

export const SyncModeSchema = z.enum(["manual", "onsave", "periodic"]);
export type SyncMode = z.infer<typeof SyncModeSchema>;

// ===== Sync Config =====

export const SyncConfigSchema = z.object({
  enabled: z.boolean(),
  serverUrl: z.string().url(),
  remotePath: z.string(),
  authType: AuthTypeSchema,
  syncMode: SyncModeSchema.default("manual"),
  syncInterval: z.number().optional(), // seconds, for periodic mode
  lastSync: z.string().datetime().optional(),
  managedByLibrary: z.boolean().optional(),
});

export type SyncConfig = z.infer<typeof SyncConfigSchema>;

// ===== Sync Config Input (for configuring sync) =====

export const SyncConfigInputSchema = z.object({
  serverUrl: z.string().url(),
  remotePath: z.string(),
  username: z.string(),
  password: z.string(),
  authType: AuthTypeSchema.default("basic"),
  syncMode: SyncModeSchema.default("manual"),
  syncInterval: z.number().optional(),
});

export type SyncConfigInput = z.infer<typeof SyncConfigInputSchema>;

// ===== Sync State =====

export const SyncStateSchema = z.enum([
  "disabled",
  "idle",
  "syncing",
  "success",
  "error",
]);
export type SyncState = z.infer<typeof SyncStateSchema>;

// ===== Sync Status =====

export const SyncStatusSchema = z.object({
  status: SyncStateSchema,
  lastSync: z.string().datetime().optional(),
  pendingChanges: z.number().default(0),
  error: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  currentOperation: z.string().optional(),
});

export type SyncStatus = z.infer<typeof SyncStatusSchema>;

// ===== Sync Result =====

export const SyncResultSchema = z.object({
  success: z.boolean(),
  pagesPulled: z.number().default(0),
  pagesPushed: z.number().default(0),
  conflictsResolved: z.number().default(0),
  error: z.string().optional(),
  duration: z.number().optional(), // milliseconds
  assetsPushed: z.number().default(0),
  assetsPulled: z.number().default(0),
});

export type SyncResult = z.infer<typeof SyncResultSchema>;

// ===== Sync Operation Types =====

export const SyncOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("updatePage"),
    pageId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("deletePage"),
    pageId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("updateFolders"),
  }),
  z.object({
    type: z.literal("updateSections"),
  }),
  z.object({
    type: z.literal("updateNotebook"),
  }),
  z.object({
    type: z.literal("uploadAsset"),
    assetPath: z.string(),
  }),
  z.object({
    type: z.literal("deleteAsset"),
    assetPath: z.string(),
  }),
]);

export type SyncOperation = z.infer<typeof SyncOperationSchema>;

// ===== Queue Item =====

export const QueueItemSchema = z.object({
  id: z.string().uuid(),
  notebookId: z.string().uuid(),
  operation: SyncOperationSchema,
  createdAt: z.string().datetime(),
  retries: z.number().default(0),
});

export type QueueItem = z.infer<typeof QueueItemSchema>;

// ===== Library Sync Config =====

export const LibrarySyncConfigSchema = z.object({
  enabled: z.boolean(),
  serverUrl: z.string().url(),
  remoteBasePath: z.string(),
  authType: AuthTypeSchema,
  syncMode: SyncModeSchema.default("manual"),
  syncInterval: z.number().optional(),
});

export type LibrarySyncConfig = z.infer<typeof LibrarySyncConfigSchema>;

// ===== Library Sync Config Input =====

export const LibrarySyncConfigInputSchema = z.object({
  serverUrl: z.string().url(),
  remoteBasePath: z.string(),
  username: z.string(),
  password: z.string(),
  authType: AuthTypeSchema.default("basic"),
  syncMode: SyncModeSchema.default("manual"),
  syncInterval: z.number().optional(),
});

export type LibrarySyncConfigInput = z.infer<
  typeof LibrarySyncConfigInputSchema
>;
