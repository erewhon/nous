import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import type { Folder, Page, Section } from "../../types/page";
import { useFolderStore } from "../../stores/folderStore";
import { usePageStore } from "../../stores/pageStore";
import { FolderTreeItem, DraggablePageItem } from "./FolderTreeItem";

// Droppable section component for drag-and-drop to sections
function DroppableSection({
  section,
  isOver,
  children,
}: {
  section: Section;
  isOver: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: `section-${section.id}`,
    data: { type: "section", section },
  });

  return (
    <div
      ref={setNodeRef}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-all"
      style={{
        backgroundColor: isOver
          ? section.color
            ? `${section.color}30`
            : "var(--color-bg-elevated)"
          : "transparent",
        border: isOver ? `2px dashed ${section.color || "var(--color-accent)"}` : "2px solid transparent",
      }}
    >
      {children}
    </div>
  );
}

// Droppable "Unsorted" zone for removing section from page
function DroppableUnsorted({ isOver }: { isOver: boolean }) {
  const { setNodeRef } = useDroppable({
    id: "section-unsorted",
    data: { type: "section", section: null },
  });

  return (
    <div
      ref={setNodeRef}
      className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-all"
      style={{
        backgroundColor: isOver ? "var(--color-bg-elevated)" : "transparent",
        border: isOver ? "2px dashed var(--color-text-muted)" : "2px solid transparent",
      }}
    >
      <span
        className="flex h-4 w-4 items-center justify-center"
        style={{ color: "var(--color-text-muted)" }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      </span>
      <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        Unsorted
      </span>
    </div>
  );
}

interface FolderTreeProps {
  notebookId: string;
  pages: Page[];
  folders: Folder[];
  selectedPageId: string | null;
  onSelectPage: (pageId: string) => void;
  // Section filtering (controlled by parent)
  sectionsEnabled?: boolean;
  selectedSectionId?: string | null;
  sections?: Section[];
  onMovePageToSection?: (pageId: string, sectionId: string | null) => void;
  onMoveFolderToSection?: (folderId: string, sectionId: string | null) => void;
  // Cover page props
  hasCoverPage?: boolean;
  onViewCover?: () => void;
}

export function FolderTree({
  notebookId,
  pages,
  folders,
  selectedPageId,
  onSelectPage,
  sectionsEnabled = false,
  selectedSectionId = null,
  sections = [],
  onMovePageToSection,
  onMoveFolderToSection,
  hasCoverPage = false,
  onViewCover,
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
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [overFolderId, setOverFolderId] = useState<string | null>(null);
  const [overSectionId, setOverSectionId] = useState<string | null>(null);
  const [showSectionDropZones, setShowSectionDropZones] = useState(false);

  // Configure DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  // Filter pages based on archive visibility and section
  const visiblePages = useMemo(() => {
    let filtered = showArchived ? pages : pages.filter((p) => !p.isArchived);
    // Filter by section if a section is selected
    if (sectionsEnabled && selectedSectionId !== null) {
      filtered = filtered.filter((p) => p.sectionId === selectedSectionId);
    }
    return filtered;
  }, [pages, showArchived, sectionsEnabled, selectedSectionId]);

  // Filter folders by section
  const visibleFolders = useMemo(() => {
    if (!sectionsEnabled || selectedSectionId === null) {
      return folders;
    }
    return folders.filter((f) => f.sectionId === selectedSectionId);
  }, [folders, sectionsEnabled, selectedSectionId]);

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
      return visibleFolders
        .filter((f) => (f.parentId ?? null) === parentId)
        .sort((a, b) => {
          // Archive folder always last
          if (a.folderType === "archive") return 1;
          if (b.folderType === "archive") return -1;
          return a.position - b.position;
        });
    },
    [visibleFolders]
  );

  // Handle creating a new page
  const handleCreatePage = useCallback(
    (folderId?: string) => {
      // Pass the current section if sections are enabled and a section is selected
      const sectionId = sectionsEnabled && selectedSectionId ? selectedSectionId : undefined;
      createPage(notebookId, "Untitled", folderId, sectionId);
    },
    [notebookId, createPage, sectionsEnabled, selectedSectionId]
  );

  // Handle creating a new folder
  const handleCreateFolder = useCallback(async () => {
    if (newFolderName.trim()) {
      // Pass the current section if sections are enabled and a section is selected
      const sectionId = sectionsEnabled && selectedSectionId ? selectedSectionId : undefined;
      await createFolder(notebookId, newFolderName.trim(), undefined, sectionId);
      setNewFolderName("");
      setIsCreatingFolder(false);
    }
  }, [notebookId, newFolderName, createFolder, sectionsEnabled, selectedSectionId]);

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
    const activeData = active.data.current;

    if (activeData?.type === "folder") {
      setActiveFolderId(activeData.folder.id);
      setActivePageId(null);
    } else {
      setActivePageId(active.id as string);
      setActiveFolderId(null);
    }

    // Show section drop zones when dragging starts (if sections are enabled)
    if (sectionsEnabled && sections.length > 0) {
      setShowSectionDropZones(true);
    }
  }, [sectionsEnabled, sections.length]);

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { over } = event;
      if (over) {
        const overId = over.id as string;
        const overData = over.data.current;

        // Check if we're over a section drop zone
        if (overData?.type === "section") {
          setOverSectionId(overData.section?.id ?? "unsorted");
          setOverFolderId(null);
          return;
        }

        // Check if we're over a folder
        const folder = visibleFolders.find((f) => f.id === overId);
        if (folder) {
          setOverFolderId(overId);
          setOverSectionId(null);
          // Expand folder when hovering
          setFolderExpanded(overId, true);
        } else if (overId === "root") {
          setOverFolderId(null);
          setOverSectionId(null);
        } else {
          setOverFolderId(null);
          setOverSectionId(null);
        }
      } else {
        setOverFolderId(null);
        setOverSectionId(null);
      }
    },
    [visibleFolders, setFolderExpanded]
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      const activeData = active.data.current;

      setActivePageId(null);
      setActiveFolderId(null);
      setOverFolderId(null);
      setOverSectionId(null);
      setShowSectionDropZones(false);

      if (!over) return;

      const overId = over.id as string;
      const overData = over.data.current;

      // Handle folder being dragged
      if (activeData?.type === "folder") {
        const folder = activeData.folder;
        // Check if dropped on a section
        if (overData?.type === "section" && onMoveFolderToSection) {
          const targetSectionId = overData.section?.id ?? null;
          // Only move if section is different
          if ((folder.sectionId ?? null) !== targetSectionId) {
            onMoveFolderToSection(folder.id, targetSectionId);
          }
        }
        return;
      }

      // Handle page being dragged
      const pageId = active.id as string;

      // Find the page being dragged
      const page = pages.find((p) => p.id === pageId);
      if (!page) return;

      // Check if dropped on a section
      if (overData?.type === "section" && onMovePageToSection) {
        const targetSectionId = overData.section?.id ?? null;
        // Only move if section is different
        if ((page.sectionId ?? null) !== targetSectionId) {
          onMovePageToSection(pageId, targetSectionId);
        }
        return;
      }

      // Determine target folder
      let targetFolderId: string | undefined = undefined;

      if (overId === "root") {
        // Moving to root (no folder)
        targetFolderId = undefined;
      } else {
        // Check if over is a folder
        const folder = visibleFolders.find((f) => f.id === overId);
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
    [pages, visibleFolders, notebookId, movePageToFolder, onMovePageToSection, onMoveFolderToSection]
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
          sections={sectionsEnabled ? sections : undefined}
          onMoveToSection={onMovePageToSection}
          onMoveFolderToSection={onMoveFolderToSection}
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
      sectionsEnabled,
      sections,
      onMovePageToSection,
      onMoveFolderToSection,
    ]
  );

  // Get root-level folders and pages
  const rootFolders = getChildFolders(null);
  const rootPages = getPagesForFolder(null);

  // Count archived pages
  const archivedCount = pages.filter((p) => p.isArchived).length;

  // Get active page for drag overlay
  const activePage = activePageId ? pages.find((p) => p.id === activePageId) : null;
  const activeFolder = activeFolderId ? folders.find((f) => f.id === activeFolderId) : null;

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
            {/* View cover page button */}
            {hasCoverPage && onViewCover && (
              <button
                onClick={onViewCover}
                className="flex h-7 items-center gap-1 rounded-lg px-2 transition-all text-xs"
                style={{ color: "var(--color-text-muted)" }}
                title="View cover page"
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
                  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
                </svg>
              </button>
            )}
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

        {/* Section drop zones - shown when dragging */}
        {showSectionDropZones && sectionsEnabled && (
          <div
            className="mx-2 mb-2 rounded-lg p-2"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div
              className="mb-1.5 text-xs font-medium"
              style={{ color: "var(--color-text-muted)" }}
            >
              Drop to move to section:
            </div>
            <div className="flex flex-col gap-1">
              <DroppableUnsorted isOver={overSectionId === "unsorted"} />
              {sections.map((section) => (
                <DroppableSection
                  key={section.id}
                  section={section}
                  isOver={overSectionId === section.id}
                >
                  <span
                    className="h-3 w-3 flex-shrink-0 rounded-full"
                    style={{
                      backgroundColor: section.color || "var(--color-text-muted)",
                    }}
                  />
                  <span className="text-xs truncate" style={{ color: "var(--color-text-primary)" }}>
                    {section.name}
                  </span>
                </DroppableSection>
              ))}
            </div>
          </div>
        )}

        {/* Tree content */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {visibleFolders.length === 0 && visiblePages.length === 0 ? (
            <div
              className="flex h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-4 text-center mx-2"
              style={{ borderColor: "var(--color-border)" }}
            >
              <div className="text-xl opacity-50">📄</div>
              <span
                className="text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {sectionsEnabled && selectedSectionId !== null
                  ? "No pages in this section"
                  : "No pages yet"}
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
                  sections={sectionsEnabled ? sections : undefined}
                  onMoveToSection={onMovePageToSection}
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
        {activeFolder && (
          <div
            className="flex items-center gap-2 rounded-lg py-1.5 px-3 text-sm shadow-lg"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              color: "var(--color-text-primary)",
              border: `1px solid ${activeFolder.color || "var(--color-accent)"}`,
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={activeFolder.color || "var(--color-accent)"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            {activeFolder.name}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
