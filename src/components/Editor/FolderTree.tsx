import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import type { Folder, Page } from "../../types/page";
import { useFolderStore } from "../../stores/folderStore";
import { usePageStore } from "../../stores/pageStore";
import { FolderTreeItem, DraggablePageItem } from "./FolderTreeItem";

interface FolderTreeProps {
  notebookId: string;
  pages: Page[];
  folders: Folder[];
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
}

export function FolderTree({
  notebookId,
  pages,
  folders,
  selectedPageId,
  onSelectPage,
}: FolderTreeProps) {
  const { createPage, movePageToFolder } = usePageStore();
  const {
    expandedFolderIds,
    toggleFolderExpanded,
    setFolderExpanded,
    showArchived,
    toggleShowArchived,
    createFolder,
    updateFolder,
    deleteFolder: deleteFolderApi,
  } = useFolderStore();

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [overFolderId, setOverFolderId] = useState<string | null>(null);

  // Configure DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Filter pages based on archive visibility
  const visiblePages = useMemo(
    () => (showArchived ? pages : pages.filter((p) => !p.isArchived)),
    [pages, showArchived]
  );

  // Get pages for a specific folder
  const getPagesForFolder = useCallback(
    (folderId: string | null) => {
      return visiblePages
        .filter((p) => (p.folderId ?? null) === folderId)
        .sort((a, b) => a.position - b.position);
    },
    [visiblePages]
  );

  // Get child folders for a parent
  const getChildFolders = useCallback(
    (parentId: string | null) => {
      return folders
        .filter((f) => (f.parentId ?? null) === parentId)
        .sort((a, b) => {
          // Archive folder always last
          if (a.folderType === "archive") return 1;
          if (b.folderType === "archive") return -1;
          return a.position - b.position;
        });
    },
    [folders]
  );

  // Handle creating a new page
  const handleCreatePage = useCallback(
    (folderId?: string) => {
      createPage(notebookId, "Untitled", folderId);
    },
    [notebookId, createPage]
  );

  // Handle creating a new folder
  const handleCreateFolder = useCallback(async () => {
    if (newFolderName.trim()) {
      await createFolder(notebookId, newFolderName.trim());
      setNewFolderName("");
      setIsCreatingFolder(false);
    }
  }, [notebookId, newFolderName, createFolder]);

  // Handle renaming a folder
  const handleRenameFolder = useCallback(
    async (folderId: string, newName: string) => {
      await updateFolder(notebookId, folderId, { name: newName });
    },
    [notebookId, updateFolder]
  );

  // Handle deleting a folder
  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      // Pages will be moved to root
      await deleteFolderApi(notebookId, folderId);
    },
    [notebookId, deleteFolderApi]
  );

  // DnD handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event;
    setActivePageId(active.id as string);
  }, []);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event;
      if (over) {
        const overId = over.id as string;
        // Check if we're over a folder
        const folder = folders.find((f) => f.id === overId);
        if (folder) {
          setOverFolderId(overId);
          // Expand folder when hovering
          setFolderExpanded(overId, true);
        } else if (overId === "root") {
          setOverFolderId(null);
        } else {
          setOverFolderId(null);
        }
      } else {
        setOverFolderId(null);
      }
    },
    [folders, setFolderExpanded]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      setActivePageId(null);
      setOverFolderId(null);

      if (!over) return;

      const pageId = active.id as string;
      const overId = over.id as string;

      // Find the page being dragged
      const page = pages.find((p) => p.id === pageId);
      if (!page) return;

      // Determine target folder
      let targetFolderId: string | undefined = undefined;

      if (overId === "root") {
        // Moving to root (no folder)
        targetFolderId = undefined;
      } else {
        // Check if over is a folder
        const folder = folders.find((f) => f.id === overId);
        if (folder) {
          targetFolderId = folder.id;
        } else {
          // Might be over another page - find its folder
          const overPage = pages.find((p) => p.id === overId);
          if (overPage) {
            targetFolderId = overPage.folderId ?? undefined;
          }
        }
      }

      // Only move if the target folder is different
      if ((page.folderId ?? undefined) !== targetFolderId) {
        await movePageToFolder(notebookId, pageId, targetFolderId);
      }
    },
    [pages, folders, notebookId, movePageToFolder]
  );

  // Render a folder recursively
  const renderFolder = useCallback(
    (folder: Folder, depth: number) => {
      const folderPages = getPagesForFolder(folder.id);
      const childFolders = getChildFolders(folder.id);

      return (
        <FolderTreeItem
          key={folder.id}
          folder={folder}
          pages={folderPages}
          childFolders={childFolders}
          isExpanded={expandedFolderIds.has(folder.id)}
          selectedPageId={selectedPageId}
          depth={depth}
          isDropTarget={overFolderId === folder.id}
          onToggleExpand={toggleFolderExpanded}
          onSelectPage={onSelectPage}
          onCreatePage={handleCreatePage}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          renderFolder={renderFolder}
        />
      );
    },
    [
      expandedFolderIds,
      selectedPageId,
      overFolderId,
      getPagesForFolder,
      getChildFolders,
      toggleFolderExpanded,
      onSelectPage,
      handleCreatePage,
      handleRenameFolder,
      handleDeleteFolder,
    ]
  );

  // Get root-level folders and pages
  const rootFolders = getChildFolders(null);
  const rootPages = getPagesForFolder(null);

  // Count archived pages
  const archivedCount = pages.filter((p) => p.isArchived).length;

  // Get active page for drag overlay
  const activePage = activePageId ? pages.find((p) => p.id === activePageId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5">
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "var(--color-text-muted)" }}
          >
            Pages
          </span>
          <div className="flex items-center gap-1">
            {/* Show archived toggle */}
            {archivedCount > 0 && (
              <button
                onClick={toggleShowArchived}
                className="flex h-7 items-center gap-1 rounded-lg px-2 transition-all text-xs"
                style={{
                  color: showArchived
                    ? "var(--color-accent)"
                    : "var(--color-text-muted)",
                  backgroundColor: showArchived
                    ? "rgba(139, 92, 246, 0.1)"
                    : "transparent",
                }}
                title={showArchived ? "Hide archived" : "Show archived"}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="4" width="20" height="5" rx="1" />
                  <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
                  <path d="M10 13h4" />
                </svg>
                <span>{archivedCount}</span>
              </button>
            )}
            {/* Create folder button */}
            <button
              onClick={() => setIsCreatingFolder(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
              style={{ color: "var(--color-text-muted)" }}
              title="Create folder"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <line x1="12" y1="11" x2="12" y2="17" />
                <line x1="9" y1="14" x2="15" y2="14" />
              </svg>
            </button>
            {/* Create page button */}
            <button
              onClick={() => handleCreatePage()}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
              style={{ color: "var(--color-text-muted)" }}
              title="Create page"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>

        {/* New folder input */}
        {isCreatingFolder && (
          <div className="mx-4 mb-3 flex items-center gap-2">
            <span
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center"
              style={{ color: "var(--color-accent)" }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </span>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") {
                  setIsCreatingFolder(false);
                  setNewFolderName("");
                }
              }}
              onBlur={() => {
                if (newFolderName.trim()) {
                  handleCreateFolder();
                } else {
                  setIsCreatingFolder(false);
                }
              }}
              placeholder="Folder name..."
              className="flex-1 min-w-0 rounded px-2 py-1 text-sm outline-none"
              style={{
                backgroundColor: "var(--color-bg-tertiary)",
                color: "var(--color-text-primary)",
              }}
              autoFocus
            />
          </div>
        )}

        {/* Tree content */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {folders.length === 0 && visiblePages.length === 0 ? (
            <div
              className="flex h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center mx-2"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="text-xl opacity-50">📄</div>
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                No pages yet
              </span>
            </div>
          ) : (
            <ul>
              {/* Root-level folders */}
              {rootFolders.map((folder) => renderFolder(folder, 0))}

              {/* Root-level pages (no folder) - use draggable version */}
              {rootPages.map((page) => (
                <DraggablePageItem
                  key={page.id}
                  page={page}
                  isSelected={selectedPageId === page.id}
                  depth={-1}
                  onSelect={() => onSelectPage(page.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activePage && (
          <div
            className="rounded-lg py-1.5 px-3 text-sm shadow-lg"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              color: "var(--color-text-primary)",
              border: "1px solid var(--color-accent)",
            }}
          >
            {activePage.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
