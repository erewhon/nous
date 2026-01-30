import { useState, memo, useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Folder, Page, PageType, Section } from "../../types/page";

// Icon component for different page types
function PageTypeIcon({ pageType }: { pageType: PageType }) {
  switch (pageType) {
    case "chat":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
          <path d="M19 13l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z" />
        </svg>
      );
    case "markdown":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
          <path d="M9 15v-3l2 2 2-2v3" />
        </svg>
      );
    case "pdf":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
          <path d="M10 12h4" />
          <path d="M10 16h4" />
        </svg>
      );
    case "jupyter":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case "calendar":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      );
    case "epub":
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
      );
    default:
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
        </svg>
      );
  }
}

interface FolderTreeItemProps {
  folder: Folder;
  pages: Page[];
  childFolders: Folder[];
  isExpanded: boolean;
  selectedPageId: string | null;
  depth: number;
  isDropTarget?: boolean;
  onToggleExpand: (folderId: string) => void;
  onSelectPage: (pageId: string, openInNewPane?: boolean) => void;
  onOpenInTab?: (pageId: string, pageTitle: string) => void;
  onOpenInNewPane?: (pageId: string) => void;
  onCreatePage: (folderId?: string) => void;
  onCreateSubpage?: (parentPageId: string) => void;
  onDeletePage?: (pageId: string, pageTitle: string) => void;
  onToggleFavorite?: (pageId: string) => void;
  onRenameFolder: (folderId: string, newName: string) => void;
  onDeleteFolder: (folderId: string) => void;
  renderFolder: (folder: Folder, depth: number) => React.ReactNode;
  getChildPages?: (parentPageId: string) => Page[];
  expandedPageIds?: Set<string>;
  onTogglePageExpand?: (pageId: string) => void;
  sections?: Section[];
  onMoveToSection?: (pageId: string, sectionId: string | null) => void;
  onMoveFolderToSection?: (folderId: string, sectionId: string | null) => void;
  onMoveToNotebook?: (pageId: string, pageTitle: string) => void;
}

export const FolderTreeItem = memo(function FolderTreeItem({
  folder,
  pages,
  childFolders,
  isExpanded,
  selectedPageId,
  depth,
  isDropTarget = false,
  onToggleExpand,
  onSelectPage,
  onOpenInTab,
  onOpenInNewPane,
  onCreatePage,
  onCreateSubpage,
  onDeletePage,
  onToggleFavorite,
  onRenameFolder,
  onDeleteFolder,
  renderFolder,
  getChildPages,
  expandedPageIds,
  onTogglePageExpand,
  sections,
  onMoveToSection,
  onMoveFolderToSection,
  onMoveToNotebook,
}: FolderTreeItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [showActions, setShowActions] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  const isArchive = folder.folderType === "archive";

  // Make folder a drop target
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: folder.id,
    data: { type: "folder", folder },
  });

  // Make folder draggable (except archive folder)
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDraggableRef,
    transform: dragTransform,
    isDragging,
  } = useDraggable({
    id: `folder-${folder.id}`,
    data: { type: "folder", folder },
    disabled: isArchive,
  });

  // Draggable ref goes on the <li> (entire folder subtree moves when dragged).
  // Droppable ref goes on just the header row so closestCenter targets the
  // compact header, not the entire expanded subtree.
  const draggableRef = useCallback(
    (node: HTMLLIElement | null) => {
      setDraggableRef(node);
    },
    [setDraggableRef]
  );

  const hasChildren = childFolders.length > 0 || pages.length > 0;
  const paddingLeft = 12 + depth * 16;
  const showDropHighlight = isDropTarget || isOver;

  const dragStyle = dragTransform
    ? {
        transform: `translate3d(${dragTransform.x}px, ${dragTransform.y}px, 0)`,
        zIndex: 100,
      }
    : undefined;

  const handleSubmitRename = useCallback(() => {
    if (editName.trim() && editName !== folder.name) {
      onRenameFolder(folder.id, editName.trim());
    }
    setIsEditing(false);
  }, [editName, folder.id, folder.name, onRenameFolder]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmitRename();
    } else if (e.key === "Escape") {
      setEditName(folder.name);
      setIsEditing(false);
    }
  }, [handleSubmitRename, folder.name]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (sections && sections.length > 0 && onMoveFolderToSection && !isArchive) {
      e.preventDefault();
      setContextMenuPos({ x: e.clientX, y: e.clientY });
      setShowContextMenu(true);
    }
  }, [sections, onMoveFolderToSection, isArchive]);

  const handleMoveFolderToSection = useCallback((sectionId: string | null) => {
    if (onMoveFolderToSection) {
      onMoveFolderToSection(folder.id, sectionId);
    }
    setShowContextMenu(false);
  }, [onMoveFolderToSection, folder.id]);

  const handleToggleExpand = useCallback(() => {
    onToggleExpand(folder.id);
  }, [onToggleExpand, folder.id]);

  const handleCreatePage = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onCreatePage(folder.id);
  }, [onCreatePage, folder.id]);

  const handleDeleteFolder = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteFolder(folder.id);
  }, [onDeleteFolder, folder.id]);

  const handleMouseEnter = useCallback(() => setShowActions(true), []);
  const handleMouseLeave = useCallback(() => setShowActions(false), []);

  return (
    <>
    <li
      ref={draggableRef}
      style={dragStyle}
      className={isDragging ? "opacity-50" : ""}
    >
      {/* Folder row — also the drop target so closestCenter hits the header, not the subtree */}
      <div
        ref={setDroppableRef}
        className="group flex min-w-0 items-center gap-1 rounded-lg py-1.5 transition-all cursor-pointer"
        style={{
          paddingLeft: `${paddingLeft}px`,
          paddingRight: "8px",
          backgroundColor: showDropHighlight
            ? "rgba(139, 92, 246, 0.15)"
            : isDragging
            ? "var(--color-bg-tertiary)"
            : "transparent",
          border: showDropHighlight
            ? "1px dashed var(--color-accent)"
            : "1px solid transparent",
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleToggleExpand}
        onContextMenu={handleContextMenu}
      >
        {/* Expand/collapse chevron */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleToggleExpand();
          }}
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors"
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
            style={{
              transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {/* Folder icon - also serves as drag handle */}
        <span
          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center ${!isArchive ? "cursor-grab active:cursor-grabbing" : ""}`}
          style={{
            color: isArchive
              ? "var(--color-text-muted)"
              : folder.color || "var(--color-accent)",
          }}
          {...(isArchive ? {} : dragListeners)}
          {...(isArchive ? {} : dragAttributes)}
        >
          {isArchive ? (
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
          ) : isExpanded ? (
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
              <path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2" />
              <path d="M5 19h14" />
            </svg>
          ) : (
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
          )}
        </span>

        {/* Folder name or edit input */}
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleSubmitRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 rounded px-1 py-0.5 text-sm font-medium outline-none"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-primary)",
            }}
            autoFocus
          />
        ) : (
          <span
            className="flex-1 min-w-0 truncate text-sm font-medium"
            style={{
              color: isArchive
                ? "var(--color-text-muted)"
                : "var(--color-text-secondary)",
            }}
            onDoubleClick={(e) => {
              if (!isArchive) {
                e.stopPropagation();
                setIsEditing(true);
              }
            }}
          >
            {folder.name}
          </span>
        )}

        {/* Page count badge */}
        {pages.length > 0 && (
          <span
            className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-xs"
            style={{
              backgroundColor: "var(--color-bg-tertiary)",
              color: "var(--color-text-muted)",
            }}
          >
            {pages.length}
          </span>
        )}

        {/* Action buttons (visible on hover) */}
        {showActions && !isArchive && (
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {/* Add page in folder */}
            <button
              onClick={handleCreatePage}
              className="flex h-5 w-5 items-center justify-center rounded transition-colors"
              style={{ color: "var(--color-text-muted)" }}
              title="Add page in folder"
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
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            {/* Delete folder */}
            <button
              onClick={handleDeleteFolder}
              className="flex h-5 w-5 items-center justify-center rounded transition-colors"
              style={{ color: "var(--color-text-muted)" }}
              title="Delete folder"
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
                <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
              </svg>
            </button>
          </div>
        )}
      </div>

      {/* Children (expanded) */}
      {isExpanded && hasChildren && (
        <ul className="w-full">
          {/* Child folders */}
          {childFolders.map((childFolder) => renderFolder(childFolder, depth + 1))}

          {/* Pages in folder - use draggable version with nested support */}
          {pages.map((page) => (
            <DraggablePageItem
              key={`folder-${folder.id}-${page.id}`}
              page={page}
              isSelected={selectedPageId === page.id}
              depth={depth + 1}
              onSelect={(openInNewPane) => onSelectPage(page.id, openInNewPane)}
              onSelectPage={onSelectPage}
              onOpenInTab={onOpenInTab}
              onOpenInNewPane={onOpenInNewPane}
              onCreateSubpage={onCreateSubpage}
              onDeletePage={onDeletePage}
              onToggleFavorite={onToggleFavorite}
              sections={sections}
              onMoveToSection={onMoveToSection}
              onMoveToNotebook={onMoveToNotebook}
              getChildPages={getChildPages}
              expandedPageIds={expandedPageIds}
              onTogglePageExpand={onTogglePageExpand}
              selectedPageId={selectedPageId}
            />
          ))}
        </ul>
      )}
    </li>

    {/* Context menu for moving folder to section */}
    {showContextMenu && sections && (
      <div
        className="fixed z-50 min-w-40 rounded-lg border py-1 shadow-lg"
        style={{
          left: contextMenuPos.x,
          top: contextMenuPos.y,
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
        onClick={(e) => e.stopPropagation()}
        onMouseLeave={() => setShowContextMenu(false)}
      >
        <div
          className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
          style={{ color: "var(--color-text-muted)" }}
        >
          Move to Section
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleMoveFolderToSection(null);
          }}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
          style={{
            color: folder.sectionId === null ? "var(--color-accent)" : "var(--color-text-primary)",
          }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "var(--color-text-muted)" }}
          />
          No Section
        </button>
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={(e) => {
              e.stopPropagation();
              handleMoveFolderToSection(section.id);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
            style={{
              color: folder.sectionId === section.id ? "var(--color-accent)" : "var(--color-text-primary)",
            }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: section.color || "var(--color-accent)" }}
            />
            {section.name}
          </button>
        ))}
      </div>
    )}
    </>
  );
});

// Page item component (non-draggable, for display in drag overlay etc)
interface PageItemProps {
  page: Page;
  isSelected: boolean;
  depth: number;
  onSelect: (openInNewPane?: boolean) => void;
}

const PageItem = memo(function PageItem({ page, isSelected, depth, onSelect }: PageItemProps) {
  const paddingLeft = 12 + (depth + 1) * 16;

  const handleClick = (e: React.MouseEvent) => {
    // Cmd+click (Mac) or Ctrl+click (Windows/Linux) opens in new pane
    const openInNewPane = e.metaKey || e.ctrlKey;
    onSelect(openInNewPane);
  };

  return (
    <li>
      <button
        onClick={handleClick}
        className="flex w-full min-w-0 items-center gap-2 rounded-lg py-1.5 text-left transition-all"
        style={{
          paddingLeft: `${paddingLeft}px`,
          paddingRight: "8px",
          backgroundColor: isSelected ? "var(--color-bg-tertiary)" : "transparent",
          color: isSelected
            ? "var(--color-text-primary)"
            : "var(--color-text-secondary)",
        }}
      >
        <span
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center"
          style={{
            color: isSelected ? "var(--color-accent)" : "var(--color-text-muted)",
          }}
        >
          <PageTypeIcon pageType={page.pageType} />
        </span>
        <span className="flex-1 min-w-0 truncate text-sm">{page.title}</span>
        {page.isArchived && (
          <span
            className="flex-shrink-0 rounded px-1 py-0.5 text-xs"
            style={{
              backgroundColor: "rgba(255, 193, 7, 0.15)",
              color: "rgb(255, 193, 7)",
            }}
          >
            Archived
          </span>
        )}
      </button>
    </li>
  );
});

// Draggable page item with nested pages support
interface DraggablePageItemProps {
  page: Page;
  isSelected: boolean;
  depth: number;
  isDropTarget?: boolean;
  onSelect: (openInNewPane?: boolean) => void;
  onSelectPage?: (pageId: string, openInNewPane?: boolean) => void; // For recursive child selection
  onOpenInTab?: (pageId: string, pageTitle: string) => void; // Open page in a new tab
  onOpenInNewPane?: (pageId: string) => void; // Open page in a new split pane
  onCreateSubpage?: (parentPageId: string) => void;
  onDeletePage?: (pageId: string, pageTitle: string) => void; // Delete the page
  onToggleFavorite?: (pageId: string) => void; // Toggle favorite status
  sections?: Section[];
  onMoveToSection?: (pageId: string, sectionId: string | null) => void;
  onMoveToNotebook?: (pageId: string, pageTitle: string) => void; // Move page to another notebook
  getChildPages?: (parentPageId: string) => Page[];
  expandedPageIds?: Set<string>;
  onTogglePageExpand?: (pageId: string) => void;
  selectedPageId?: string | null;
}

const DraggablePageItem = memo(function DraggablePageItem({
  page,
  isSelected,
  depth,
  isDropTarget = false,
  onSelect,
  onSelectPage,
  onOpenInTab,
  onOpenInNewPane,
  onCreateSubpage,
  onDeletePage,
  onToggleFavorite,
  sections,
  onMoveToSection,
  onMoveToNotebook,
  getChildPages,
  expandedPageIds,
  onTogglePageExpand,
  selectedPageId,
}: DraggablePageItemProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  // Make page draggable
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableRef,
    transform,
    isDragging,
  } = useDraggable({
    id: page.id,
    data: { type: "page", page },
  });

  // Make page a drop target for nesting
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `page-drop-${page.id}`,
    data: { type: "page", page },
  });

  // Combine refs
  const combinedRef = useCallback(
    (node: HTMLLIElement | null) => {
      setDraggableRef(node);
      setDroppableRef(node);
    },
    [setDraggableRef, setDroppableRef]
  );

  const paddingLeft = 12 + (depth + 1) * 16;
  const childPages = getChildPages ? getChildPages(page.id) : [];
  const hasChildren = childPages.length > 0;
  const isExpanded = expandedPageIds?.has(page.id) ?? false;
  const showDropHighlight = isDropTarget || isOver;

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleMoveToSection = useCallback((sectionId: string | null) => {
    if (onMoveToSection) {
      onMoveToSection(page.id, sectionId);
    }
    setShowContextMenu(false);
  }, [onMoveToSection, page.id]);

  const handleCreateSubpage = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onCreateSubpage) {
      onCreateSubpage(page.id);
    }
    setShowContextMenu(false);
  }, [onCreateSubpage, page.id]);

  const handleOpenInTab = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenInTab) {
      onOpenInTab(page.id, page.title);
    }
    setShowContextMenu(false);
  }, [onOpenInTab, page.id, page.title]);

  const handleOpenInNewPane = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenInNewPane) {
      onOpenInNewPane(page.id);
    }
    setShowContextMenu(false);
  }, [onOpenInNewPane, page.id]);

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePageExpand?.(page.id);
  }, [onTogglePageExpand, page.id]);

  const handleToggleFavorite = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleFavorite) {
      onToggleFavorite(page.id);
    }
    setShowContextMenu(false);
  }, [onToggleFavorite, page.id]);

  return (
    <>
      <li
        ref={combinedRef}
        style={style}
        {...listeners}
        {...attributes}
        className={isDragging ? "opacity-50" : ""}
        onContextMenu={handleContextMenu}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div
          className="flex w-full min-w-0 items-center gap-1 rounded-lg py-1.5 text-left transition-all"
          style={{
            paddingLeft: `${paddingLeft}px`,
            paddingRight: "8px",
            backgroundColor: showDropHighlight
              ? "rgba(139, 92, 246, 0.15)"
              : isSelected
              ? "var(--color-bg-tertiary)"
              : "transparent",
            border: showDropHighlight
              ? "1px dashed var(--color-accent)"
              : "1px solid transparent",
            color: isSelected
              ? "var(--color-text-primary)"
              : "var(--color-text-secondary)",
          }}
        >
          {/* Expand/collapse toggle for pages with children */}
          {hasChildren ? (
            <button
              onClick={handleToggleExpand}
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded hover:bg-[var(--color-bg-tertiary)]"
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
                style={{
                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 0.15s ease",
                }}
              >
                <polyline points="9,18 15,12 9,6" />
              </svg>
            </button>
          ) : (
            <span className="w-5" />
          )}

          {/* Page button */}
          <button
            onClick={(e) => {
              const openInNewPane = e.metaKey || e.ctrlKey;
              onSelect(openInNewPane);
            }}
            className="flex flex-1 min-w-0 items-center gap-2 text-left cursor-grab active:cursor-grabbing"
          >
            <span
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center"
              style={{
                color: isSelected ? "var(--color-accent)" : "var(--color-text-muted)",
              }}
            >
              <PageTypeIcon pageType={page.pageType} />
            </span>
            <span className="flex-1 min-w-0 truncate text-sm">{page.title}</span>
            {page.isFavorite && !isHovered && (
              <span
                className="flex-shrink-0"
                style={{ color: "var(--color-accent)" }}
                title="Favorite"
              >
                <IconStarFilled />
              </span>
            )}
            {hasChildren && (
              <span
                className="flex-shrink-0 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                {childPages.length}
              </span>
            )}
            {page.isArchived && (
              <span
                className="flex-shrink-0 rounded px-1 py-0.5 text-xs"
                style={{
                  backgroundColor: "rgba(255, 193, 7, 0.15)",
                  color: "rgb(255, 193, 7)",
                }}
              >
                Archived
              </span>
            )}
          </button>
          {/* Star button on hover */}
          {isHovered && onToggleFavorite && (
            <button
              onClick={handleToggleFavorite}
              className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--color-bg-tertiary)]"
              style={{ color: page.isFavorite ? "var(--color-accent)" : "var(--color-text-muted)" }}
              title={page.isFavorite ? "Remove from favorites" : "Add to favorites"}
            >
              {page.isFavorite ? <IconStarFilled /> : <IconStar />}
            </button>
          )}
        </div>

        {/* Child pages */}
        {hasChildren && isExpanded && onSelectPage && (
          <ul className="w-full">
            {childPages.map((childPage) => (
              <DraggablePageItem
                key={`child-${page.id}-${childPage.id}`}
                page={childPage}
                isSelected={selectedPageId === childPage.id}
                depth={depth + 1}
                onSelect={(openInNewPane) => onSelectPage(childPage.id, openInNewPane)}
                onSelectPage={onSelectPage}
                onOpenInTab={onOpenInTab}
                onOpenInNewPane={onOpenInNewPane}
                onCreateSubpage={onCreateSubpage}
                onDeletePage={onDeletePage}
                onToggleFavorite={onToggleFavorite}
                sections={sections}
                onMoveToSection={onMoveToSection}
                onMoveToNotebook={onMoveToNotebook}
                getChildPages={getChildPages}
                expandedPageIds={expandedPageIds}
                onTogglePageExpand={onTogglePageExpand}
                selectedPageId={selectedPageId}
              />
            ))}
          </ul>
        )}
      </li>

      {/* Context menu */}
      {showContextMenu && (
        <div
          className="fixed z-50 min-w-40 rounded-lg border py-1 shadow-lg"
          style={{
            left: contextMenuPos.x,
            top: contextMenuPos.y,
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={() => setShowContextMenu(false)}
        >
          {/* Open in Tab option */}
          {onOpenInTab && (
            <button
              onClick={handleOpenInTab}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
              style={{ color: "var(--color-text-primary)" }}
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
                <path d="M12 5v14M5 12h14" />
              </svg>
              Open in Tab
            </button>
          )}

          {/* Open in Split Pane option */}
          {onOpenInNewPane && (
            <button
              onClick={handleOpenInNewPane}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
              style={{ color: "var(--color-text-primary)" }}
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
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="12" y1="3" x2="12" y2="21" />
              </svg>
              Open in Split Pane
            </button>
          )}

          {/* Create Subpage option */}
          {onCreateSubpage && (
            <>
              {onOpenInNewPane && (
                <div
                  className="my-1 border-t"
                  style={{ borderColor: "var(--color-border)" }}
                />
              )}
              <button
                onClick={handleCreateSubpage}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: "var(--color-text-primary)" }}
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
                  <path d="M12 5v14M5 12h14" />
                </svg>
                Create Subpage
              </button>
            </>
          )}

          {/* Favorite option */}
          {onToggleFavorite && (
            <>
              {(onCreateSubpage || onOpenInNewPane) && (
                <div
                  className="my-1 border-t"
                  style={{ borderColor: "var(--color-border)" }}
                />
              )}
              <button
                onClick={handleToggleFavorite}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: page.isFavorite ? "var(--color-accent)" : "var(--color-text-primary)" }}
              >
                {page.isFavorite ? <IconStarFilled /> : <IconStar />}
                {page.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
              </button>
            </>
          )}

          {/* Section options */}
          {sections && sections.length > 0 && onMoveToSection && (
            <>
              {(onCreateSubpage || onOpenInNewPane) && (
                <div
                  className="my-1 border-t"
                  style={{ borderColor: "var(--color-border)" }}
                />
              )}
              <div
                className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--color-text-muted)" }}
              >
                Move to Section
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleMoveToSection(null);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{
                  color: page.sectionId === null ? "var(--color-accent)" : "var(--color-text-primary)",
                }}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: "var(--color-text-muted)" }}
                />
                No Section
              </button>
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMoveToSection(section.id);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
                  style={{
                    color: page.sectionId === section.id ? "var(--color-accent)" : "var(--color-text-primary)",
                  }}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: section.color || "var(--color-accent)" }}
                  />
                  {section.name}
                </button>
              ))}
            </>
          )}

          {/* Move to Notebook option */}
          {onMoveToNotebook && (
            <>
              <div
                className="my-1 border-t"
                style={{ borderColor: "var(--color-border)" }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowContextMenu(false);
                  onMoveToNotebook(page.id, page.title);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-bg-tertiary)]"
                style={{ color: "var(--color-text-primary)" }}
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
                  <path d="M12 3v12M9 9l3-3 3 3" />
                  <path d="M4 11v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                </svg>
                Move to Notebook...
              </button>
            </>
          )}

          {/* Delete page option */}
          {onDeletePage && (
            <>
              <div
                className="my-1 border-t"
                style={{ borderColor: "var(--color-border)" }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowContextMenu(false);
                  onDeletePage(page.id, page.title);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-red-500/10"
                style={{ color: "var(--color-error, #ef4444)" }}
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
                  <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                </svg>
                Delete
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
});

function IconStar() {
  return (
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
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

function IconStarFilled() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

export { PageItem, DraggablePageItem };
