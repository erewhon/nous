/**
 * Cloud Store
 *
 * Manages Nous Cloud authentication, encryption keys, and sync state.
 * Tokens are persisted to localStorage; master key stays in memory only.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CloudAPI, ETagConflictError } from "./api";
import type { CloudNotebook } from "./api";
import {
  deriveMasterKey,
  generateSalt,
  generateNotebookKey,
  wrapNotebookKey,
  unwrapNotebookKey,
  encryptJSON,
  decryptJSON,
} from "./crypto";

interface CloudState {
  // Auth
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;

  // Persisted tokens (set via zustand persist)
  accessToken: string | null;
  refreshToken: string | null;

  // Encryption setup
  hasEncryptionSetup: boolean;
  masterKeySalt: string | null;

  // Cloud notebooks
  notebooks: CloudNotebook[];

  // Sync status per notebook (cloudNotebookId → status)
  syncStatus: Record<string, "idle" | "syncing" | "error">;
  syncErrors: Record<string, string>;
  lastSyncAt: Record<string, string>;

  // Auto-sync settings (persisted)
  autoSyncSettings: Record<string, { enabled: boolean; intervalMinutes: number }>;

  // Loading
  isLoading: boolean;
  error: string | null;
}

interface CloudActions {
  // Auth
  register: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;

  // Encryption
  setupEncryption: (masterPassword: string) => Promise<void>;
  unlockEncryption: (masterPassword: string) => Promise<boolean>;
  lockEncryption: () => void;
  isEncryptionUnlocked: () => boolean;

  // Cloud notebooks
  loadNotebooks: () => Promise<void>;
  createCloudNotebook: (
    name: string,
    localNotebookId?: string,
  ) => Promise<CloudNotebook>;
  deleteCloudNotebook: (id: string) => Promise<void>;

  // Sync operations
  syncPage: (
    cloudNotebookId: string,
    pageId: string,
    content: unknown,
  ) => Promise<void>;
  downloadPage: (
    cloudNotebookId: string,
    pageId: string,
  ) => Promise<unknown | null>;
  syncMeta: (cloudNotebookId: string, meta: unknown) => Promise<void>;
  downloadMeta: (cloudNotebookId: string) => Promise<unknown | null>;
  listRemotePageIds: (cloudNotebookId: string) => Promise<string[]>;
  deleteRemotePage: (
    cloudNotebookId: string,
    pageId: string,
  ) => Promise<void>;

  // Full notebook sync
  syncNotebook: (
    localNotebookId: string,
    cloudNotebookId: string,
    onProgress?: (current: number, total: number, message: string) => void,
  ) => Promise<void>;

  // Auto-sync
  setAutoSync: (cloudNotebookId: string, enabled: boolean, intervalMinutes: number) => void;

  // Helpers
  getApi: () => CloudAPI;
  clearError: () => void;
}

type CloudStore = CloudState & CloudActions;

// In-memory only — never persisted
let masterKey: CryptoKey | null = null;
const notebookKeyCache = new Map<string, CryptoKey>();
const pageEtagCache = new Map<string, string>(); // "notebookId:pageId" → etag
const metaEtagCache = new Map<string, string>(); // notebookId → etag
let apiInstance: CloudAPI | null = null;

function getOrCreateApi(
  accessToken: string | null,
  refreshToken: string | null,
  onTokensChanged: (
    tokens: { accessToken: string; refreshToken: string } | null,
  ) => void,
): CloudAPI {
  if (!apiInstance) {
    apiInstance = new CloudAPI({
      accessToken: accessToken ?? undefined,
      refreshToken: refreshToken ?? undefined,
      onTokensChanged,
    });
  } else {
    // Keep tokens in sync with store (e.g., after rehydration)
    apiInstance.updateTokens(accessToken, refreshToken);
  }
  return apiInstance;
}

export const useCloudStore = create<CloudStore>()(
  persist(
    (set, get) => ({
      // Initial state
      isAuthenticated: false,
      userId: null,
      email: null,
      accessToken: null,
      refreshToken: null,
      hasEncryptionSetup: false,
      masterKeySalt: null,
      notebooks: [],
      syncStatus: {},
      syncErrors: {},
      lastSyncAt: {},
      autoSyncSettings: {},
      isLoading: false,
      error: null,

      // ─── Auth ──────────────────────────────────────────────────────────

      register: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const api = get().getApi();
          const result = await api.register(email, password);
          set({
            isAuthenticated: true,
            userId: result.user.id,
            email: result.user.email,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            isLoading: false,
          });
        } catch (err) {
          set({
            error:
              err instanceof Error ? err.message : "Registration failed",
            isLoading: false,
          });
          throw err;
        }
      },

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const api = get().getApi();
          const result = await api.login(email, password);
          set({
            isAuthenticated: true,
            userId: result.user.id,
            email: result.user.email,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            isLoading: false,
          });

          // Check if encryption is set up
          try {
            const params = await api.getEncryptionParams();
            set({
              hasEncryptionSetup: params.salt !== null,
              masterKeySalt: params.salt,
            });
          } catch {
            // Non-fatal
          }
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : "Login failed",
            isLoading: false,
          });
          throw err;
        }
      },

      logout: async () => {
        try {
          const api = get().getApi();
          await api.logout();
        } catch {
          // Best-effort
        }
        masterKey = null;
        notebookKeyCache.clear();
        pageEtagCache.clear();
        metaEtagCache.clear();
        apiInstance = null;
        set({
          isAuthenticated: false,
          userId: null,
          email: null,
          accessToken: null,
          refreshToken: null,
          hasEncryptionSetup: false,
          masterKeySalt: null,
          notebooks: [],
          syncStatus: {},
          syncErrors: {},
          lastSyncAt: {},
          autoSyncSettings: {},
          error: null,
        });
      },

      // ─── Encryption ────────────────────────────────────────────────────

      setupEncryption: async (masterPassword) => {
        set({ isLoading: true, error: null });
        try {
          const salt = generateSalt();
          const api = get().getApi();
          await api.setEncryptionSalt(salt);

          masterKey = await deriveMasterKey(masterPassword, salt);
          set({
            hasEncryptionSetup: true,
            masterKeySalt: salt,
            isLoading: false,
          });
        } catch (err) {
          set({
            error:
              err instanceof Error
                ? err.message
                : "Failed to set up encryption",
            isLoading: false,
          });
          throw err;
        }
      },

      unlockEncryption: async (masterPassword) => {
        const { masterKeySalt } = get();
        if (!masterKeySalt) {
          set({ error: "Encryption not set up" });
          return false;
        }

        try {
          masterKey = await deriveMasterKey(masterPassword, masterKeySalt);
          notebookKeyCache.clear();
          return true;
        } catch {
          set({ error: "Failed to derive master key" });
          return false;
        }
      },

      lockEncryption: () => {
        masterKey = null;
        notebookKeyCache.clear();
      },

      isEncryptionUnlocked: () => {
        return masterKey !== null;
      },

      // ─── Cloud Notebooks ───────────────────────────────────────────────

      loadNotebooks: async () => {
        set({ isLoading: true, error: null });
        try {
          const api = get().getApi();
          const notebooks = await api.listNotebooks();
          set({ notebooks, isLoading: false });
        } catch (err) {
          set({
            error:
              err instanceof Error
                ? err.message
                : "Failed to load notebooks",
            isLoading: false,
          });
        }
      },

      createCloudNotebook: async (name, localNotebookId) => {
        if (!masterKey) throw new Error("Encryption not unlocked");

        set({ isLoading: true, error: null });
        try {
          const notebookKey = await generateNotebookKey();
          const encryptedNotebookKey = await wrapNotebookKey(
            masterKey,
            notebookKey,
          );

          const api = get().getApi();
          const notebook = await api.createNotebook({
            name,
            localNotebookId,
            encryptedNotebookKey,
          });

          // Cache the key
          notebookKeyCache.set(notebook.id, notebookKey);

          set((state) => ({
            notebooks: [...state.notebooks, notebook],
            isLoading: false,
          }));

          return notebook;
        } catch (err) {
          set({
            error:
              err instanceof Error
                ? err.message
                : "Failed to create notebook",
            isLoading: false,
          });
          throw err;
        }
      },

      deleteCloudNotebook: async (id) => {
        set({ isLoading: true, error: null });
        try {
          const api = get().getApi();
          await api.deleteNotebook(id);
          notebookKeyCache.delete(id);
          set((state) => {
            const { [id]: _, ...restAutoSync } = state.autoSyncSettings;
            return {
              notebooks: state.notebooks.filter((n) => n.id !== id),
              autoSyncSettings: restAutoSync,
              isLoading: false,
            };
          });
        } catch (err) {
          set({
            error:
              err instanceof Error
                ? err.message
                : "Failed to delete notebook",
            isLoading: false,
          });
          throw err;
        }
      },

      // ─── Sync Operations ───────────────────────────────────────────────

      syncPage: async (cloudNotebookId, pageId, content) => {
        const key = await getNotebookKey(get, cloudNotebookId);
        const encrypted = await encryptJSON(key, content);

        const api = get().getApi();
        set((state) => ({
          syncStatus: { ...state.syncStatus, [cloudNotebookId]: "syncing" },
        }));

        try {
          const cacheKey = `${cloudNotebookId}:${pageId}`;
          const ifMatch = pageEtagCache.get(cacheKey);
          const newEtag = await api.uploadPage(cloudNotebookId, pageId, encrypted, ifMatch);
          if (newEtag) {
            pageEtagCache.set(cacheKey, newEtag);
          }
          set((state) => ({
            syncStatus: { ...state.syncStatus, [cloudNotebookId]: "idle" },
            lastSyncAt: {
              ...state.lastSyncAt,
              [cloudNotebookId]: new Date().toISOString(),
            },
          }));
        } catch (err) {
          if (err instanceof ETagConflictError) {
            // Server has a different version. Re-fetch ETag and retry —
            // syncPage is called with explicit local content, so local wins.
            const result = await api.downloadPage(cloudNotebookId, pageId);
            if (result?.etag) {
              pageEtagCache.set(`${cloudNotebookId}:${pageId}`, result.etag);
            }
            const newEtag = await api.uploadPage(
              cloudNotebookId, pageId, encrypted,
              result?.etag,
            );
            if (newEtag) {
              pageEtagCache.set(`${cloudNotebookId}:${pageId}`, newEtag);
            }
            set((state) => ({
              syncStatus: { ...state.syncStatus, [cloudNotebookId]: "idle" },
              lastSyncAt: {
                ...state.lastSyncAt,
                [cloudNotebookId]: new Date().toISOString(),
              },
            }));
            return;
          }
          const message =
            err instanceof Error ? err.message : "Sync failed";
          set((state) => ({
            syncStatus: { ...state.syncStatus, [cloudNotebookId]: "error" },
            syncErrors: { ...state.syncErrors, [cloudNotebookId]: message },
          }));
          throw err;
        }
      },

      downloadPage: async (cloudNotebookId, pageId) => {
        const api = get().getApi();
        const result = await api.downloadPage(cloudNotebookId, pageId);
        if (!result) return null;

        if (result.etag) {
          pageEtagCache.set(`${cloudNotebookId}:${pageId}`, result.etag);
        }

        const key = await getNotebookKey(get, cloudNotebookId);
        return decryptJSON(key, result.data);
      },

      syncMeta: async (cloudNotebookId, meta) => {
        const key = await getNotebookKey(get, cloudNotebookId);
        const encrypted = await encryptJSON(key, meta);

        const api = get().getApi();
        const ifMatch = metaEtagCache.get(cloudNotebookId);
        try {
          const newEtag = await api.uploadMeta(cloudNotebookId, encrypted, ifMatch);
          if (newEtag) {
            metaEtagCache.set(cloudNotebookId, newEtag);
          }
        } catch (err) {
          if (err instanceof ETagConflictError) {
            // Re-fetch to get fresh ETag, then retry
            const result = await api.downloadMeta(cloudNotebookId);
            if (result?.etag) {
              metaEtagCache.set(cloudNotebookId, result.etag);
            }
            const newEtag = await api.uploadMeta(
              cloudNotebookId, encrypted, result?.etag,
            );
            if (newEtag) {
              metaEtagCache.set(cloudNotebookId, newEtag);
            }
            return;
          }
          throw err;
        }
      },

      downloadMeta: async (cloudNotebookId) => {
        const api = get().getApi();
        const result = await api.downloadMeta(cloudNotebookId);
        if (!result) return null;

        if (result.etag) {
          metaEtagCache.set(cloudNotebookId, result.etag);
        }

        const key = await getNotebookKey(get, cloudNotebookId);
        return decryptJSON(key, result.data);
      },

      listRemotePageIds: async (cloudNotebookId) => {
        const api = get().getApi();
        return api.listPageIds(cloudNotebookId);
      },

      deleteRemotePage: async (cloudNotebookId, pageId) => {
        const api = get().getApi();
        await api.deletePage(cloudNotebookId, pageId);
      },

      // ─── Full Notebook Sync ────────────────────────────────────────────

      syncNotebook: async (localNotebookId, cloudNotebookId, onProgress) => {
        set((state) => ({
          syncStatus: { ...state.syncStatus, [cloudNotebookId]: "syncing" },
          syncErrors: { ...state.syncErrors, [cloudNotebookId]: "" },
        }));

        try {
          // Dynamic import to avoid circular deps with Tauri
          const { listPages, getPage, updatePage } = await import("../utils/api");

          // 1. Get notebook key
          const key = await getNotebookKey(get, cloudNotebookId);
          const api = get().getApi();

          // 2. Download server meta to get server-side timestamps
          onProgress?.(0, 1, "Checking server state...");
          const serverMeta = await get().downloadMeta(cloudNotebookId) as {
            pageSummaries?: Array<{ id: string; updatedAt?: string }>;
          } | null;
          const serverTimestamps = new Map<string, string>();
          if (serverMeta?.pageSummaries) {
            for (const ps of serverMeta.pageSummaries) {
              if (ps.updatedAt) {
                serverTimestamps.set(ps.id, ps.updatedAt);
              }
            }
          }

          // 3. Get all local pages
          const pages = await listPages(localNotebookId, true);
          const total = pages.length + 2; // +1 for meta, +1 for cleanup
          let current = 0;
          let pulled = 0;

          // 4. Sync each page (bidirectional)
          for (const page of pages) {
            current++;
            const serverUpdatedAt = serverTimestamps.get(page.id);
            const localUpdatedAt = page.updatedAt;

            // If server has a newer version, pull it down
            if (serverUpdatedAt && localUpdatedAt && serverUpdatedAt > localUpdatedAt) {
              onProgress?.(current, total, `Pulling page: ${page.title || page.id}`);
              const result = await api.downloadPage(cloudNotebookId, page.id);
              if (result) {
                if (result.etag) {
                  pageEtagCache.set(`${cloudNotebookId}:${page.id}`, result.etag);
                }
                const serverPage = await decryptJSON(key, result.data) as Record<string, unknown>;
                // Update local page with server content
                await updatePage(localNotebookId, page.id, {
                  title: serverPage.title as string | undefined,
                  content: serverPage.content as import("../types/page").EditorData | undefined,
                });
                pulled++;
              }
              continue;
            }

            // Otherwise, push local version to server
            onProgress?.(current, total, `Uploading page: ${page.title || page.id}`);
            const fullPage = await getPage(localNotebookId, page.id);
            const encrypted = await encryptJSON(key, fullPage);
            const cacheKey = `${cloudNotebookId}:${page.id}`;
            const ifMatch = pageEtagCache.get(cacheKey);
            try {
              const newEtag = await api.uploadPage(cloudNotebookId, page.id, encrypted, ifMatch);
              if (newEtag) {
                pageEtagCache.set(cacheKey, newEtag);
              }
            } catch (err) {
              if (err instanceof ETagConflictError) {
                // ETag mismatch but timestamps said local is newer —
                // re-fetch ETag and retry upload.
                const result = await api.downloadPage(cloudNotebookId, page.id);
                if (result?.etag) {
                  pageEtagCache.set(cacheKey, result.etag);
                }
                const newEtag = await api.uploadPage(
                  cloudNotebookId, page.id, encrypted, result?.etag,
                );
                if (newEtag) {
                  pageEtagCache.set(cacheKey, newEtag);
                }
              } else {
                throw err;
              }
            }
          }

          // 5. Upload notebook metadata
          current++;
          onProgress?.(current, total, "Uploading metadata...");

          // Re-read local pages if any were pulled from server
          const freshPages = pulled > 0
            ? await listPages(localNotebookId, true)
            : pages;

          const { listFolders, listSections } = await import("../utils/api");
          const [folders, sections] = await Promise.all([
            listFolders(localNotebookId).catch(() => []),
            listSections(localNotebookId).catch(() => []),
          ]);

          const meta = {
            syncedAt: new Date().toISOString(),
            pageIds: freshPages.map((p) => p.id),
            pageSummaries: freshPages.map((p) => ({
              id: p.id,
              title: p.title,
              folderId: p.folderId,
              sectionId: p.sectionId,
              parentPageId: p.parentPageId,
              position: p.position,
              isArchived: p.isArchived,
              pageType: p.pageType,
              updatedAt: p.updatedAt,
            })),
            folders: folders.map((f) => ({
              id: f.id,
              name: f.name,
              parentId: f.parentId ?? null,
              sectionId: f.sectionId ?? null,
              folderType: f.folderType,
              isArchived: f.isArchived,
              color: f.color ?? null,
              position: f.position,
            })),
            sections: sections.map((s) => ({
              id: s.id,
              name: s.name,
              color: s.color ?? null,
              position: s.position,
            })),
          };
          await get().syncMeta(cloudNotebookId, meta);

          // 6. Clean up remote pages that no longer exist locally
          current++;
          onProgress?.(current, total, "Cleaning up...");
          const localPageIds = new Set(freshPages.map((p) => p.id));
          const remotePageIds = await get().listRemotePageIds(cloudNotebookId);
          for (const remoteId of remotePageIds) {
            if (!localPageIds.has(remoteId)) {
              await get().deleteRemotePage(cloudNotebookId, remoteId);
            }
          }

          onProgress?.(total, total, `Sync complete${pulled > 0 ? ` (${pulled} page${pulled > 1 ? "s" : ""} pulled from server)` : ""}`);

          set((state) => ({
            syncStatus: { ...state.syncStatus, [cloudNotebookId]: "idle" },
            lastSyncAt: {
              ...state.lastSyncAt,
              [cloudNotebookId]: new Date().toISOString(),
            },
          }));
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Sync failed";
          set((state) => ({
            syncStatus: { ...state.syncStatus, [cloudNotebookId]: "error" },
            syncErrors: { ...state.syncErrors, [cloudNotebookId]: message },
          }));
          throw err;
        }
      },

      // ─── Helpers ────────────────────────────────────────────────────────

      getApi: () => {
        const { accessToken, refreshToken } = get();
        return getOrCreateApi(accessToken, refreshToken, (tokens) => {
          if (tokens) {
            set({
              accessToken: tokens.accessToken,
              refreshToken: tokens.refreshToken,
            });
          } else {
            // Token refresh failed — force logout
            masterKey = null;
            notebookKeyCache.clear();
            set({
              isAuthenticated: false,
              userId: null,
              email: null,
              accessToken: null,
              refreshToken: null,
              error: "Session expired. Please log in again.",
            });
          }
        });
      },

      setAutoSync: (cloudNotebookId, enabled, intervalMinutes) => {
        set((state) => {
          if (!enabled) {
            const { [cloudNotebookId]: _, ...rest } = state.autoSyncSettings;
            return { autoSyncSettings: rest };
          }
          return {
            autoSyncSettings: {
              ...state.autoSyncSettings,
              [cloudNotebookId]: { enabled, intervalMinutes },
            },
          };
        });
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: "nous-cloud",
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        userId: state.userId,
        email: state.email,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        hasEncryptionSetup: state.hasEncryptionSetup,
        masterKeySalt: state.masterKeySalt,
        autoSyncSettings: state.autoSyncSettings,
      }),
    },
  ),
);

/** Get (or unwrap from cache) the notebook's encryption key. */
async function getNotebookKey(
  get: () => CloudStore,
  cloudNotebookId: string,
): Promise<CryptoKey> {
  const cached = notebookKeyCache.get(cloudNotebookId);
  if (cached) return cached;

  if (!masterKey) throw new Error("Encryption not unlocked");

  const notebook = get().notebooks.find((n) => n.id === cloudNotebookId);
  if (!notebook?.encryptedNotebookKey) {
    throw new Error("Notebook has no encryption key");
  }

  const key = await unwrapNotebookKey(masterKey, notebook.encryptedNotebookKey);
  notebookKeyCache.set(cloudNotebookId, key);
  return key;
}
