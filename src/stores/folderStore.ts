import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Folder, Page, FolderTreeNode, PageTreeRoot } from "../types/page";
import * as api from "../utils/api";

interface FolderState {
  folders: Folder[];
  expandedFolderIds: Set<string>;
  showArchived: boolean;
  isLoading: boolean;
  error: string | null;
}

interface FolderActions {
  // Data loading
  loadFolders: (notebookId: string) => Promise<void>;
  clearFolders: () => void;

  // Folder CRUD
  createFolder: (
    notebookId: string,
    name: string,
    parentId?: string,
    sectionId?: string
  ) => Promise<Folder | null>;
  updateFolder: (
    notebookId: string,
    folderId: string,
    updates: { name?: string; parentId?: string | null; color?: string | null; sectionId?: string | null }
  ) => Promise<void>;
  deleteFolder: (
    notebookId: string,
    folderId: string,
    movePagesTo?: string
  ) => Promise<void>;

  // Folder expansion
  toggleFolderExpanded: (folderId: string) => void;
  setFolderExpanded: (folderId: string, expanded: boolean) => void;
  expandAllFolders: () => void;
  collapseAllFolders: () => void;

  // Archive visibility
  setShowArchived: (show: boolean) => void;
  toggleShowArchived: () => void;

  // Folder archiving
  archiveFolder: (notebookId: string, folderId: string) => Promise<void>;
  unarchiveFolder: (notebookId: string, folderId: string) => Promise<void>;

  // Tree building
  buildFolderTree: (pages: Page[]) => PageTreeRoot;

  // Reordering
  reorderFolders: (
    notebookId: string,
    parentId: string | null,
    folderIds: string[]
  ) => Promise<void>;

  // Error handling
  clearError: () => void;
}

type FolderStore = FolderState & FolderActions;

// Helper to build tree structure
function buildTreeRecursive(
  folders: Folder[],
  pages: Page[],
  parentId: string | null,
  expandedIds: Set<string>
): FolderTreeNode[] {
  return folders
    .filter((f) => (f.parentId ?? null) === parentId)
    .sort((a, b) => {
      // Archive folder always last
      if (a.folderType === "archive") return 1;
      if (b.folderType === "archive") return -1;
      return a.position - b.position;
    })
    .map((folder) => ({
      folder,
      children: buildTreeRecursive(folders, pages, folder.id, expandedIds),
      pages: pages
        .filter((p) => p.folderId === folder.id)
        .sort((a, b) => a.position - b.position),
      isExpanded: expandedIds.has(folder.id),
    }));
}

export const useFolderStore = create<FolderStore>()(
  persist(
    (set, get) => ({
      // Initial state
      folders: [],
      expandedFolderIds: new Set<string>(),
      showArchived: false,
      isLoading: false,
      error: null,

      // Actions
      loadFolders: async (notebookId) => {
        set({ isLoading: true, error: null });
        try {
          const folders = await api.listFolders(notebookId);
          set({ folders, isLoading: false });
        } catch (err) {
          set({
            error:
              err instanceof Error ? err.message : "Failed to load folders",
            isLoading: false,
          });
        }
      },

      clearFolders: () => {
        set({ folders: [] });
      },

      createFolder: async (notebookId, name, parentId, sectionId) => {
        set({ error: null });
        try {
          const folder = await api.createFolder(notebookId, name, parentId, sectionId);
          set((state) => ({
            folders: [...state.folders, folder],
          }));
          return folder;
        } catch (err) {
          set({
            error:
              err instanceof Error ? err.message : "Failed to create folder",
          });
          return null;
        }
      },

      updateFolder: async (notebookId, folderId, updates) => {
        set({ error: null });
        try {
          const folder = await api.updateFolder(notebookId, folderId, updates);
          set((state) => ({
            folders: state.folders.map((f) => (f.id === folderId ? folder : f)),
          }));
        } catch (err) {
          set({
            error:
              err instanceof Error ? err.message : "Failed to update folder",
          });
        }
      },

      deleteFolder: async (notebookId, folderId, movePagesTo) => {
        set({ error: null });
        try {
          await api.deleteFolder(notebookId, folderId, movePagesTo);
          set((state) => ({
            folders: state.folders.filter((f) => f.id !== folderId),
            expandedFolderIds: new Set(
              [...state.expandedFolderIds].filter((id) => id !== folderId)
            ),
          }));
        } catch (err) {
          set({
            error:
              err instanceof Error ? err.message : "Failed to delete folder",
          });
        }
      },

      toggleFolderExpanded: (folderId) => {
        set((state) => {
          const newSet = new Set(state.expandedFolderIds);
          if (newSet.has(folderId)) {
            newSet.delete(folderId);
          } else {
            newSet.add(folderId);
          }
          return { expandedFolderIds: newSet };
        });
      },

      setFolderExpanded: (folderId, expanded) => {
        set((state) => {
          const newSet = new Set(state.expandedFolderIds);
          if (expanded) {
            newSet.add(folderId);
          } else {
            newSet.delete(folderId);
          }
          return { expandedFolderIds: newSet };
        });
      },

      expandAllFolders: () => {
        set((state) => ({
          expandedFolderIds: new Set(state.folders.map((f) => f.id)),
        }));
      },

      collapseAllFolders: () => {
        set({ expandedFolderIds: new Set() });
      },

      setShowArchived: (show) => {
        set({ showArchived: show });
      },

      toggleShowArchived: () => {
        set((state) => ({ showArchived: !state.showArchived }));
      },

      archiveFolder: async (notebookId, folderId) => {
        set({ error: null });
        try {
          await api.archiveFolder(notebookId, folderId);
          // Reload all folders to pick up descendant changes
          const folders = await api.listFolders(notebookId);
          set({ folders });
        } catch (err) {
          set({
            error:
              err instanceof Error ? err.message : "Failed to archive folder",
          });
        }
      },

      unarchiveFolder: async (notebookId, folderId) => {
        set({ error: null });
        try {
          await api.unarchiveFolder(notebookId, folderId);
          // Reload all folders to pick up descendant changes
          const folders = await api.listFolders(notebookId);
          set({ folders });
        } catch (err) {
          set({
            error:
              err instanceof Error ? err.message : "Failed to unarchive folder",
          });
        }
      },

      buildFolderTree: (pages) => {
        const state = get();
        const { folders, expandedFolderIds, showArchived } = state;

        // Filter pages based on archive visibility
        const visiblePages = showArchived
          ? pages
          : pages.filter((p) => !p.isArchived);

        // Filter folders based on archive visibility
        const visibleFolders = showArchived
          ? folders
          : folders.filter((f) => !f.isArchived);

        // Build tree structure
        const folderNodes = buildTreeRecursive(
          visibleFolders,
          visiblePages,
          null,
          expandedFolderIds
        );

        // Get root-level pages (no folder)
        const rootPages = visiblePages
          .filter((p) => !p.folderId)
          .sort((a, b) => a.position - b.position);

        return {
          folders: folderNodes,
          pages: rootPages,
        };
      },

      reorderFolders: async (notebookId, parentId, folderIds) => {
        set({ error: null });
        try {
          await api.reorderFolders(notebookId, parentId, folderIds);
          // Update local state with new positions
          set((state) => {
            const updatedFolders = state.folders.map((f) => {
              const idx = folderIds.indexOf(f.id);
              if (idx !== -1 && (f.parentId ?? null) === parentId) {
                return { ...f, position: idx };
              }
              return f;
            });
            return { folders: updatedFolders };
          });
        } catch (err) {
          set({
            error:
              err instanceof Error ? err.message : "Failed to reorder folders",
          });
        }
      },

      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: "folder-store",
      partialize: (state) => ({
        expandedFolderIds: Array.from(state.expandedFolderIds),
        showArchived: state.showArchived,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<FolderState>),
        expandedFolderIds: new Set(
          (persisted as { expandedFolderIds?: string[] })?.expandedFolderIds ||
            []
        ),
      }),
    }
  )
);
