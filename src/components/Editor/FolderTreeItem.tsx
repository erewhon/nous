import { useState, memo, useCallback } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Folder, Page, Section } from "../../types/page";

interface FolderTreeItemProps {
  folder: Folder;
  pages: Page[];
  childFolders: Folder[];
  isExpanded: boolean;
  selectedPageId: string | null;
  depth: number;
  isDropTarget?: boolean;
  onToggleExpand: (folderId: string) => void;
  onSelectPage: (pageId: string) => void;
  onCreatePage: (folderId?: string) => void;
  onRenameFolder: (folderId: string, newName: string) => void;
  onDeleteFolder: (folderId: string) => void;
  renderFolder: (folder: Folder, depth: number) => React.ReactNode;
  sections?: Section[];
  onMoveToSection?: (pageId: string, sectionId: string | null) => void;
  onMoveFolderToSection?: (folderId: string, sectionId: string | null) => void;
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
  onCreatePage,
  onRenameFolder,
  onDeleteFolder,
  renderFolder,
  sections,
  onMoveToSection,
  onMoveFolderToSection,
}: FolderTreeItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [showActions, setShowActions] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });

  // Make folder a drop target
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: folder.id,
    data: { type: "folder", folder },
  });

  const isArchive = folder.folderType === "archive";
  const hasChildren = childFolders.length > 0 || pages.length > 0;
  const paddingLeft = 12 + depth * 16;
  const showDropHighlight = isDropTarget || isOver;

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
    <li ref={setDroppableRef}>
      {/* Folder row */}
      <div
        className="group flex items-center gap-1 rounded-lg py-1.5 transition-all cursor-pointer"
        style={{
          paddingLeft: `${paddingLeft}px`,
          paddingRight: "8px",
          backgroundColor: showDropHighlight
            ? "rgba(139, 92, 246, 0.15)"
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

        {/* Folder icon */}
        <span
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center"
          style={{
            color: isArchive
              ? "var(--color-text-muted)"
              : folder.color || "var(--color-accent)",
          }}
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
        <ul>
          {/* Child folders */}
          {childFolders.map((childFolder) => renderFolder(childFolder, depth + 1))}

          {/* Pages in folder - use draggable version */}
          {pages.map((page) => (
            <DraggablePageItem
              key={page.id}
              page={page}
              isSelected={selectedPageId === page.id}
              depth={depth + 1}
              onSelect={() => onSelectPage(page.id)}
              sections={sections}
              onMoveToSection={onMoveToSection}
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
  onSelect: () => void;
}

const PageItem = memo(function PageItem({ page, isSelected, depth, onSelect }: PageItemProps) {
  const paddingLeft = 12 + (depth + 1) * 16;

  return (
    <li>
      <button
        onClick={onSelect}
        className="flex w-full items-center gap-2 rounded-lg py-1.5 text-left transition-all"
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
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14,2 14,8 20,8" />
          </svg>
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

// Draggable page item
interface DraggablePageItemProps {
  page: Page;
  isSelected: boolean;
  depth: number;
  onSelect: () => void;
  sections?: Section[];
  onMoveToSection?: (pageId: string, sectionId: string | null) => void;
}

const DraggablePageItem = memo(function DraggablePageItem({
  page,
  isSelected,
  depth,
  onSelect,
  sections,
  onMoveToSection,
}: DraggablePageItemProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: page.id,
    data: { type: "page", page },
  });

  const paddingLeft = 12 + (depth + 1) * 16;

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (sections && sections.length > 0 && onMoveToSection) {
      e.preventDefault();
      setContextMenuPos({ x: e.clientX, y: e.clientY });
      setShowContextMenu(true);
    }
  }, [sections, onMoveToSection]);

  const handleMoveToSection = useCallback((sectionId: string | null) => {
    if (onMoveToSection) {
      onMoveToSection(page.id, sectionId);
    }
    setShowContextMenu(false);
  }, [onMoveToSection, page.id]);

  return (
    <>
      <li
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        className={isDragging ? "opacity-50" : ""}
        onContextMenu={handleContextMenu}
      >
        <button
          onClick={onSelect}
          className="flex w-full items-center gap-2 rounded-lg py-1.5 text-left transition-all cursor-grab active:cursor-grabbing"
          style={{
            paddingLeft: `${paddingLeft}px`,
            paddingRight: "8px",
            backgroundColor: isSelected ? "var(--color-bg-tertiary)" : "transparent",
            color: isSelected
              ? "var(--color-text-primary)"
              : "var(--color-text-secondary)",
          }}
        >
          {/* Drag handle indicator */}
          <span
            className="flex h-5 w-5 flex-shrink-0 items-center justify-center"
            style={{
              color: isSelected ? "var(--color-accent)" : "var(--color-text-muted)",
            }}
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
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14,2 14,8 20,8" />
            </svg>
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

      {/* Context menu for moving to section */}
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
        </div>
      )}
    </>
  );
});

export { PageItem, DraggablePageItem };
