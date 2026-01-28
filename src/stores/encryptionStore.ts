/**
 * Encryption Store
 *
 * Manages encryption state for notebooks and libraries, including
 * unlock state, password verification, and auto-lock functionality.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  EncryptionConfig,
  EncryptionStats,
  UnlockResult,
} from "../types/encryption";

interface EncryptionState {
  // Unlocked notebook IDs
  unlockedNotebooks: Set<string>;

  // Unlocked library IDs
  unlockedLibraries: Set<string>;

  // Loading states
  isLoading: boolean;
  error: string | null;

  // Auto-lock timer
  autoLockTimeoutMinutes: number;
}

interface EncryptionActions {
  // Notebook encryption
  enableNotebookEncryption: (
    notebookId: string,
    password: string,
    hint?: string
  ) => Promise<EncryptionConfig>;
  disableNotebookEncryption: (
    notebookId: string,
    password: string
  ) => Promise<void>;
  unlockNotebook: (notebookId: string, password: string) => Promise<boolean>;
  lockNotebook: (notebookId: string) => Promise<void>;
  isNotebookUnlocked: (notebookId: string) => boolean;
  changeNotebookPassword: (
    notebookId: string,
    oldPassword: string,
    newPassword: string,
    newHint?: string
  ) => Promise<EncryptionConfig>;
  getNotebookPasswordHint: (notebookId: string) => Promise<string | null>;

  // Library encryption
  enableLibraryEncryption: (
    libraryId: string,
    password: string,
    hint?: string
  ) => Promise<EncryptionConfig>;
  disableLibraryEncryption: (
    libraryId: string,
    password: string
  ) => Promise<void>;
  unlockLibrary: (libraryId: string, password: string) => Promise<boolean>;
  lockLibrary: (libraryId: string) => Promise<void>;
  isLibraryUnlocked: (libraryId: string) => boolean;
  getLibraryPasswordHint: (libraryId: string) => Promise<string | null>;

  // Global actions
  lockAll: () => Promise<void>;
  loadUnlockedState: () => Promise<void>;
  getStats: () => Promise<EncryptionStats>;
  cleanupExpired: () => Promise<void>;

  // Error handling
  clearError: () => void;
}

type EncryptionStore = EncryptionState & EncryptionActions;

export const useEncryptionStore = create<EncryptionStore>((set, get) => ({
  // Initial state
  unlockedNotebooks: new Set(),
  unlockedLibraries: new Set(),
  isLoading: false,
  error: null,
  autoLockTimeoutMinutes: 60, // 1 hour default

  // Notebook encryption actions
  enableNotebookEncryption: async (notebookId, password, hint) => {
    set({ isLoading: true, error: null });
    try {
      const config = await invoke<EncryptionConfig>(
        "enable_notebook_encryption",
        {
          notebookId,
          password,
          passwordHint: hint,
        }
      );
      // Notebook is automatically unlocked after enabling encryption
      set((state) => ({
        unlockedNotebooks: new Set([...state.unlockedNotebooks, notebookId]),
        isLoading: false,
      }));
      return config;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to enable encryption";
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  disableNotebookEncryption: async (notebookId, password) => {
    set({ isLoading: true, error: null });
    try {
      await invoke("disable_notebook_encryption", { notebookId, password });
      set((state) => {
        const unlocked = new Set(state.unlockedNotebooks);
        unlocked.delete(notebookId);
        return { unlockedNotebooks: unlocked, isLoading: false };
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to disable encryption";
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  unlockNotebook: async (notebookId, password) => {
    set({ isLoading: true, error: null });
    try {
      const result = await invoke<UnlockResult>("unlock_notebook", {
        notebookId,
        password,
      });
      if (result.success) {
        set((state) => ({
          unlockedNotebooks: new Set([...state.unlockedNotebooks, notebookId]),
          isLoading: false,
        }));
        return true;
      } else {
        set({ error: result.error || "Invalid password", isLoading: false });
        return false;
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to unlock notebook";
      set({ error: message, isLoading: false });
      return false;
    }
  },

  lockNotebook: async (notebookId) => {
    try {
      await invoke("lock_notebook", { notebookId });
      set((state) => {
        const unlocked = new Set(state.unlockedNotebooks);
        unlocked.delete(notebookId);
        return { unlockedNotebooks: unlocked };
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to lock notebook";
      set({ error: message });
    }
  },

  isNotebookUnlocked: (notebookId) => {
    return get().unlockedNotebooks.has(notebookId);
  },

  changeNotebookPassword: async (
    notebookId,
    oldPassword,
    newPassword,
    newHint
  ) => {
    set({ isLoading: true, error: null });
    try {
      const config = await invoke<EncryptionConfig>(
        "change_notebook_password",
        {
          notebookId,
          oldPassword,
          newPassword,
          newHint,
        }
      );
      set({ isLoading: false });
      return config;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to change password";
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  getNotebookPasswordHint: async (notebookId) => {
    try {
      return await invoke<string | null>("get_notebook_password_hint", {
        notebookId,
      });
    } catch {
      return null;
    }
  },

  // Library encryption actions
  enableLibraryEncryption: async (libraryId, password, hint) => {
    set({ isLoading: true, error: null });
    try {
      const config = await invoke<EncryptionConfig>(
        "enable_library_encryption",
        {
          libraryId,
          password,
          passwordHint: hint,
        }
      );
      set((state) => ({
        unlockedLibraries: new Set([...state.unlockedLibraries, libraryId]),
        isLoading: false,
      }));
      return config;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to enable encryption";
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  disableLibraryEncryption: async (libraryId, password) => {
    set({ isLoading: true, error: null });
    try {
      await invoke("disable_library_encryption", { libraryId, password });
      set((state) => {
        const unlocked = new Set(state.unlockedLibraries);
        unlocked.delete(libraryId);
        return { unlockedLibraries: unlocked, isLoading: false };
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to disable encryption";
      set({ error: message, isLoading: false });
      throw new Error(message);
    }
  },

  unlockLibrary: async (libraryId, password) => {
    set({ isLoading: true, error: null });
    try {
      const result = await invoke<UnlockResult>("unlock_library", {
        libraryId,
        password,
      });
      if (result.success) {
        set((state) => ({
          unlockedLibraries: new Set([...state.unlockedLibraries, libraryId]),
          isLoading: false,
        }));
        return true;
      } else {
        set({ error: result.error || "Invalid password", isLoading: false });
        return false;
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to unlock library";
      set({ error: message, isLoading: false });
      return false;
    }
  },

  lockLibrary: async (libraryId) => {
    try {
      await invoke("lock_library", { libraryId });
      set((state) => {
        const unlocked = new Set(state.unlockedLibraries);
        unlocked.delete(libraryId);
        return { unlockedLibraries: unlocked };
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to lock library";
      set({ error: message });
    }
  },

  isLibraryUnlocked: (libraryId) => {
    return get().unlockedLibraries.has(libraryId);
  },

  getLibraryPasswordHint: async (libraryId) => {
    try {
      return await invoke<string | null>("get_library_password_hint", {
        libraryId,
      });
    } catch {
      return null;
    }
  },

  // Global actions
  lockAll: async () => {
    try {
      await invoke("lock_all");
      set({
        unlockedNotebooks: new Set(),
        unlockedLibraries: new Set(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to lock all";
      set({ error: message });
    }
  },

  loadUnlockedState: async () => {
    try {
      const notebookIds = await invoke<string[]>("get_unlocked_notebooks");
      set({
        unlockedNotebooks: new Set(notebookIds),
      });
    } catch (err) {
      console.error("Failed to load unlocked state:", err);
    }
  },

  getStats: async () => {
    return await invoke<EncryptionStats>("get_encryption_stats");
  },

  cleanupExpired: async () => {
    try {
      await invoke("cleanup_expired_sessions");
      // Reload state after cleanup
      await get().loadUnlockedState();
    } catch (err) {
      console.error("Failed to cleanup expired sessions:", err);
    }
  },

  clearError: () => {
    set({ error: null });
  },
}));

// Helper hook for checking if a notebook needs unlocking
export function useNotebookEncryption(notebookId: string | null) {
  const { unlockedNotebooks, unlockNotebook, lockNotebook } =
    useEncryptionStore();

  const isUnlocked = notebookId ? unlockedNotebooks.has(notebookId) : false;

  return {
    isUnlocked,
    unlock: (password: string) =>
      notebookId ? unlockNotebook(notebookId, password) : Promise.resolve(false),
    lock: () => (notebookId ? lockNotebook(notebookId) : Promise.resolve()),
  };
}

// Helper hook for checking if a library needs unlocking
export function useLibraryEncryption(libraryId: string | null) {
  const { unlockedLibraries, unlockLibrary, lockLibrary } =
    useEncryptionStore();

  const isUnlocked = libraryId ? unlockedLibraries.has(libraryId) : false;

  return {
    isUnlocked,
    unlock: (password: string) =>
      libraryId ? unlockLibrary(libraryId, password) : Promise.resolve(false),
    lock: () => (libraryId ? lockLibrary(libraryId) : Promise.resolve()),
  };
}
