import { create } from "zustand";
import { persist } from "zustand/middleware";
import { CloudAPI } from "./api";
import type { CloudNotebook, NotebookShareInfo, SavedShareInfo } from "./api";
import {
  deriveMasterKey,
  unwrapNotebookKey,
  decryptJSON,
  exportKeyAsBase64,
  generateShareSalt,
  deriveShareKey,
  wrapKeyForShare,
} from "./crypto";

export interface PageSummary {
  id: string;
  title: string;
  folderId?: string | null;
  sectionId?: string | null;
  parentPageId?: string | null;
  position?: number;
  isArchived?: boolean;
  pageType?: string;
  updatedAt?: string;
}

export interface FolderSummary {
  id: string;
  name: string;
  parentId: string | null;
  sectionId: string | null;
  folderType: string;
  isArchived: boolean;
  color: string | null;
  position: number;
}

export interface SectionSummary {
  id: string;
  name: string;
  color: string | null;
  position: number;
}

export interface NotebookMeta {
  syncedAt: string;
  pageIds: string[];
  pageSummaries: PageSummary[];
  folders?: FolderSummary[];
  sections?: SectionSummary[];
}

interface WebState {
  // Auth
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
  accessToken: string | null;
  refreshToken: string | null;

  // Encryption
  hasEncryptionSetup: boolean;
  masterKeySalt: string | null;
  isUnlocked: boolean;

  // Data
  notebooks: CloudNotebook[];
  savedShares: SavedShareInfo[];

  // UI
  isLoading: boolean;
  error: string | null;
}

interface WebActions {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  unlockEncryption: (masterPassword: string) => Promise<boolean>;
  lockEncryption: () => void;
  loadNotebooks: () => Promise<void>;
  loadNotebookMeta: (notebookId: string) => Promise<NotebookMeta | null>;
  loadPage: (notebookId: string, pageId: string) => Promise<unknown | null>;
  createShare: (
    notebookId: string,
    mode: "public" | "password",
    sharePassword?: string,
    label?: string,
  ) => Promise<{ shareId: string; shareUrl: string }>;
  listShares: (notebookId: string) => Promise<NotebookShareInfo[]>;
  revokeShare: (notebookId: string, shareId: string) => Promise<void>;
  saveShareToLibrary: (shareId: string, notebookKey: CryptoKey) => Promise<void>;
  loadSavedShares: () => Promise<void>;
  removeSavedShare: (shareId: string) => Promise<void>;
  loadSavedShareMeta: (shareId: string) => Promise<NotebookMeta | null>;
  loadSavedSharePage: (
    shareId: string,
    pageId: string,
  ) => Promise<unknown | null>;
  clearError: () => void;
}

type WebStore = WebState & WebActions;

let masterKey: CryptoKey | null = null;
const notebookKeyCache = new Map<string, CryptoKey>();
let apiInstance: CloudAPI | null = null;

function getApi(state: WebState): CloudAPI {
  if (!apiInstance) {
    apiInstance = new CloudAPI({
      accessToken: state.accessToken ?? undefined,
      refreshToken: state.refreshToken ?? undefined,
      onTokensChanged: (tokens) => {
        if (tokens) {
          useWebStore.setState({
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
          });
        } else {
          masterKey = null;
          notebookKeyCache.clear();
          useWebStore.setState({
            isAuthenticated: false,
            userId: null,
            email: null,
            accessToken: null,
            refreshToken: null,
            isUnlocked: false,
            error: "Session expired. Please log in again.",
          });
        }
      },
    });
  } else {
    apiInstance.updateTokens(state.accessToken, state.refreshToken);
  }
  return apiInstance;
}

async function getNotebookKey(
  api: CloudAPI,
  notebooks: CloudNotebook[],
  notebookId: string,
): Promise<CryptoKey> {
  const cached = notebookKeyCache.get(notebookId);
  if (cached) return cached;

  if (!masterKey) throw new Error("Encryption not unlocked");

  const notebook = notebooks.find((n) => n.id === notebookId);
  if (!notebook?.encryptedNotebookKey) {
    throw new Error("Notebook has no encryption key");
  }

  const key = await unwrapNotebookKey(masterKey, notebook.encryptedNotebookKey);
  notebookKeyCache.set(notebookId, key);
  return key;
}

export const useWebStore = create<WebStore>()(
  persist(
    (set, get) => ({
      isAuthenticated: false,
      userId: null,
      email: null,
      accessToken: null,
      refreshToken: null,
      hasEncryptionSetup: false,
      masterKeySalt: null,
      isUnlocked: false,
      notebooks: [],
      savedShares: [],
      isLoading: false,
      error: null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const api = getApi(get());
          const result = await api.login(email, password);
          set({
            isAuthenticated: true,
            userId: result.user.id,
            email: result.user.email,
            accessToken: result.accessToken,
            refreshToken: result.refreshToken,
            isLoading: false,
          });

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

      logout: () => {
        const api = getApi(get());
        api.logout().catch(() => {});
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
          isUnlocked: false,
          notebooks: [],
          savedShares: [],
          error: null,
        });
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
          set({ isUnlocked: true });
          return true;
        } catch {
          set({ error: "Failed to derive master key" });
          return false;
        }
      },

      lockEncryption: () => {
        masterKey = null;
        notebookKeyCache.clear();
        set({ isUnlocked: false });
      },

      loadNotebooks: async () => {
        set({ isLoading: true, error: null });
        try {
          const api = getApi(get());
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

      loadNotebookMeta: async (notebookId) => {
        // Ensure notebooks are loaded (race with sidebar)
        let { notebooks } = get();
        if (notebooks.length === 0) {
          await get().loadNotebooks();
          notebooks = get().notebooks;
        }
        const api = getApi(get());
        const encrypted = await api.downloadMeta(notebookId);
        if (!encrypted) return null;

        const key = await getNotebookKey(api, notebooks, notebookId);
        return decryptJSON<NotebookMeta>(key, encrypted);
      },

      loadPage: async (notebookId, pageId) => {
        let { notebooks } = get();
        if (notebooks.length === 0) {
          await get().loadNotebooks();
          notebooks = get().notebooks;
        }
        const api = getApi(get());
        const encrypted = await api.downloadPage(notebookId, pageId);
        if (!encrypted) return null;

        const key = await getNotebookKey(api, notebooks, notebookId);
        return decryptJSON(key, encrypted);
      },

      createShare: async (notebookId, mode, sharePassword, label) => {
        const state = get();
        const api = getApi(state);
        const nbKey = await getNotebookKey(api, state.notebooks, notebookId);

        if (mode === "public") {
          const result = await api.createShare(notebookId, {
            mode: "public",
            label,
          });
          const keyBase64 = await exportKeyAsBase64(nbKey);
          return {
            shareId: result.id,
            shareUrl: `${window.location.origin}/s/${result.id}#key=${keyBase64}`,
          };
        } else {
          if (!sharePassword) throw new Error("Password required");
          const salt = generateShareSalt();
          const shareKey = await deriveShareKey(sharePassword, salt);
          const wrappedKey = await wrapKeyForShare(shareKey, nbKey);
          const result = await api.createShare(notebookId, {
            mode: "password",
            passwordSalt: salt,
            wrappedKey,
            label,
          });
          return {
            shareId: result.id,
            shareUrl: `${window.location.origin}/s/${result.id}`,
          };
        }
      },

      listShares: async (notebookId) => {
        const api = getApi(get());
        return api.listShares(notebookId);
      },

      revokeShare: async (notebookId, shareId) => {
        const api = getApi(get());
        await api.revokeShare(notebookId, shareId);
      },

      saveShareToLibrary: async (shareId, notebookKey) => {
        if (!masterKey) throw new Error("Encryption not unlocked");
        const wrapped = await wrapKeyForShare(masterKey, notebookKey);
        const api = getApi(get());
        await api.saveShareToLibrary(shareId, wrapped);
        await get().loadSavedShares();
      },

      loadSavedShares: async () => {
        try {
          const api = getApi(get());
          const savedShares = await api.listSavedShares();
          set({ savedShares });
        } catch {
          // Non-fatal
        }
      },

      removeSavedShare: async (shareId) => {
        const api = getApi(get());
        await api.removeSavedShare(shareId);
        set((state) => ({
          savedShares: state.savedShares.filter((s) => s.shareId !== shareId),
        }));
      },

      loadSavedShareMeta: async (shareId) => {
        if (!masterKey) throw new Error("Encryption not unlocked");
        const saved = get().savedShares.find((s) => s.shareId === shareId);
        if (!saved) throw new Error("Saved share not found");

        const { ShareAPI } = await import("./api");
        const shareApi = new ShareAPI();
        const encrypted = await shareApi.downloadMeta(shareId);
        if (!encrypted) return null;

        const cached = notebookKeyCache.get(`share:${shareId}`);
        const key =
          cached ?? await unwrapNotebookKey(masterKey, saved.wrappedNotebookKey);
        if (!cached) notebookKeyCache.set(`share:${shareId}`, key);

        return decryptJSON<NotebookMeta>(key, encrypted);
      },

      loadSavedSharePage: async (shareId, pageId) => {
        if (!masterKey) throw new Error("Encryption not unlocked");
        const saved = get().savedShares.find((s) => s.shareId === shareId);
        if (!saved) throw new Error("Saved share not found");

        const { ShareAPI } = await import("./api");
        const shareApi = new ShareAPI();
        const encrypted = await shareApi.downloadPage(shareId, pageId);
        if (!encrypted) return null;

        const cached = notebookKeyCache.get(`share:${shareId}`);
        const key =
          cached ?? await unwrapNotebookKey(masterKey, saved.wrappedNotebookKey);
        if (!cached) notebookKeyCache.set(`share:${shareId}`, key);

        return decryptJSON(key, encrypted);
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: "nous-web",
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
