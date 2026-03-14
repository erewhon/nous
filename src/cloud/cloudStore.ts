/**
 * Cloud Store
 *
 * Manages Nous Cloud authentication, encryption keys, and sync state.
 * Tokens are persisted to localStorage; master key stays in memory only.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CloudAPI } from "./api";
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

  // Helpers
  getApi: () => CloudAPI;
  clearError: () => void;
}

type CloudStore = CloudState & CloudActions;

// In-memory only — never persisted
let masterKey: CryptoKey | null = null;
const notebookKeyCache = new Map<string, CryptoKey>();
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
          set((state) => ({
            notebooks: state.notebooks.filter((n) => n.id !== id),
            isLoading: false,
          }));
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
          await api.uploadPage(cloudNotebookId, pageId, encrypted);
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

      downloadPage: async (cloudNotebookId, pageId) => {
        const api = get().getApi();
        const encrypted = await api.downloadPage(cloudNotebookId, pageId);
        if (!encrypted) return null;

        const key = await getNotebookKey(get, cloudNotebookId);
        return decryptJSON(key, encrypted);
      },

      syncMeta: async (cloudNotebookId, meta) => {
        const key = await getNotebookKey(get, cloudNotebookId);
        const encrypted = await encryptJSON(key, meta);

        const api = get().getApi();
        await api.uploadMeta(cloudNotebookId, encrypted);
      },

      downloadMeta: async (cloudNotebookId) => {
        const api = get().getApi();
        const encrypted = await api.downloadMeta(cloudNotebookId);
        if (!encrypted) return null;

        const key = await getNotebookKey(get, cloudNotebookId);
        return decryptJSON(key, encrypted);
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
          const { listPages, getPage } = await import("../utils/api");

          // 1. Get all local pages
          const pages = await listPages(localNotebookId, true);
          const total = pages.length + 2; // +1 for meta, +1 for cleanup
          let current = 0;

          onProgress?.(current, total, "Starting sync...");

          // 2. Get notebook key
          const key = await getNotebookKey(get, cloudNotebookId);

          // 3. Upload each page
          for (const page of pages) {
            current++;
            onProgress?.(current, total, `Uploading page: ${page.title || page.id}`);

            const fullPage = await getPage(localNotebookId, page.id);
            const encrypted = await encryptJSON(key, fullPage);
            const api = get().getApi();
            await api.uploadPage(cloudNotebookId, page.id, encrypted);
          }

          // 4. Upload notebook metadata (page list, sections, folders, etc.)
          current++;
          onProgress?.(current, total, "Uploading metadata...");
          const meta = {
            syncedAt: new Date().toISOString(),
            pageIds: pages.map((p) => p.id),
            pageSummaries: pages.map((p) => ({
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
          };
          await get().syncMeta(cloudNotebookId, meta);

          // 5. Clean up remote pages that no longer exist locally
          current++;
          onProgress?.(current, total, "Cleaning up...");
          const localPageIds = new Set(pages.map((p) => p.id));
          const remotePageIds = await get().listRemotePageIds(cloudNotebookId);
          for (const remoteId of remotePageIds) {
            if (!localPageIds.has(remoteId)) {
              await get().deleteRemotePage(cloudNotebookId, remoteId);
            }
          }

          onProgress?.(total, total, "Sync complete");

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
