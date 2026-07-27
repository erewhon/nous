import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Folder, Page } from "../../types/page";
import type { Notebook } from "../../types/notebook";
import { usePageStore } from "../../stores/pageStore";
import { useFolderStore } from "../../stores/folderStore";
import { useSectionStore } from "../../stores/sectionStore";
import { useThemeStore, type PageSortOption } from "../../stores/themeStore";
import { sortFolders } from "../Editor/folderTreeUtils";
import {
  PAGE_ICON,
  FOLDER_ICON,
  StudyChevron,
  StudyRow,
  StudyRowIcon,
} from "./studyPrimitives";

// The inline folder/page tree rendered under the expanded notebook in the
// Study sidebar. This is the compact replacement for the classic Sections +
// Folders/Pages panels (hidden in study mode — see EditorArea's
// showInlinePanels): a section chip switcher plus a lightweight,
// navigation-first tree. Deliberately no drag-and-drop — heavy reorganizing
// lives in the classic full sidebar; here a context menu covers the basics.

interface StudyTreeProps {
  notebook: Notebook;
}

type MenuTarget =
  | { kind: "page"; page: Page }
  | { kind: "folder"; folder: Folder };

interface MenuState {
  target: MenuTarget;
  x: number;
  y: number;
}

export function StudyTree({ notebook }: StudyTreeProps) {
  const pages = usePageStore((s) => s.pages);
  const selectedPageId = usePageStore((s) => s.selectedPageId);
  const selectPage = usePageStore((s) => s.selectPage);
  const openPageInNewPane = usePageStore((s) => s.openPageInNewPane);
  const createPage = usePageStore((s) => s.createPage);
  const movePageToFolder = usePageStore((s) => s.movePageToFolder);
  const toggleFavorite = usePageStore((s) => s.toggleFavorite);
  const deletePage = usePageStore((s) => s.deletePage);

  const folders = useFolderStore((s) => s.folders);
  const expandedFolderIds = useFolderStore((s) => s.expandedFolderIds);
  const toggleFolderExpanded = useFolderStore((s) => s.toggleFolderExpanded);
  const setFolderExpanded = useFolderStore((s) => s.setFolderExpanded);
  const updateFolder = useFolderStore((s) => s.updateFolder);
  const deleteFolder = useFolderStore((s) => s.deleteFolder);

  const sections = useSectionStore((s) => s.sections);
  const selectedSectionId = useSectionStore((s) => s.selectedSectionId);
  const selectSection = useSectionStore((s) => s.selectSection);

  const globalPageSortBy = useThemeStore((s) => s.pageSortBy);
  const sectionSortBy = useThemeStore((s) => s.sectionSortBy);

  const [expandedPageIds, setExpandedPageIds] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuView, setMenuView] = useState<"main" | "move">("main");
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  // Stores hold the SELECTED notebook's data, but briefly hold the previous
  // notebook's during a switch — scope everything to this notebook explicitly.
  const notebookSections = useMemo(
    () => sections.filter((s) => s.notebookId === notebook.id),
    [sections, notebook.id]
  );
  const sectionsOn = notebook.sectionsEnabled && notebookSections.length > 0;

  const sortedSections = useMemo(() => {
    if (sectionSortBy === "manual") return notebookSections;
    return [...notebookSections].sort((a, b) => {
      switch (sectionSortBy) {
        case "name-asc": return a.name.localeCompare(b.name);
        case "name-desc": return b.name.localeCompare(a.name);
        case "created-desc": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "created-asc": return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "modified-desc": return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        default: return 0;
      }
    });
  }, [notebookSections, sectionSortBy]);

  // Per-section → per-notebook → global sort fallback, same as FolderTree.
  const selectedSection = useMemo(
    () => notebookSections.find((s) => s.id === selectedSectionId) ?? null,
    [notebookSections, selectedSectionId]
  );
  const pageSortBy = (selectedSection?.pageSortBy ??
    notebook.pageSortBy ??
    globalPageSortBy) as PageSortOption;

  const sortPages = useCallback(
    (list: Page[]) =>
      [...list].sort((a, b) => {
        switch (pageSortBy) {
          case "name-asc": return a.title.localeCompare(b.title);
          case "name-desc": return b.title.localeCompare(a.title);
          case "updated": return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          case "created": return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          case "position":
          default:
            return a.position - b.position;
        }
      }),
    [pageSortBy]
  );

  const visiblePages = useMemo(() => {
    let filtered = pages.filter(
      (p) => p.notebookId === notebook.id && !p.isArchived && !p.isCover && !p.deletedAt
    );
    if (sectionsOn) {
      filtered = filtered.filter((p) => (p.sectionId ?? null) === selectedSectionId);
    }
    return filtered;
  }, [pages, notebook.id, sectionsOn, selectedSectionId]);

  const visibleFolders = useMemo(() => {
    const unarchived = folders.filter(
      (f) => f.notebookId === notebook.id && !f.isArchived && f.folderType !== "archive"
    );
    if (!sectionsOn) return unarchived;
    // Section-matched folders plus the ancestors needed to reach them
    // (a sectioned folder under an unsectioned parent must stay reachable).
    const matched = unarchived.filter((f) => (f.sectionId ?? null) === selectedSectionId);
    const matchedIds = new Set(matched.map((f) => f.id));
    const folderMap = new Map(unarchived.map((f) => [f.id, f]));
    for (const f of matched) {
      let parentId = f.parentId ?? null;
      while (parentId && !matchedIds.has(parentId)) {
        const parent = folderMap.get(parentId);
        if (!parent) break;
        matchedIds.add(parentId);
        parentId = parent.parentId ?? null;
      }
    }
    return unarchived.filter((f) => matchedIds.has(f.id));
  }, [folders, notebook.id, sectionsOn, selectedSectionId]);

  const visibleFolderIds = useMemo(
    () => new Set(visibleFolders.map((f) => f.id)),
    [visibleFolders]
  );

  const getChildFolders = useCallback(
    (parentId: string | null) =>
      sortFolders(
        visibleFolders.filter((f) => (f.parentId ?? null) === parentId),
        pageSortBy
      ),
    [visibleFolders, pageSortBy]
  );

  const getPagesForFolder = useCallback(
    (folderId: string | null) =>
      sortPages(
        visiblePages.filter((p) => {
          if (p.parentPageId) return false;
          if (folderId === null) {
            // Root also catches pages whose folder isn't visible — the same
            // orphan safety net the classic tree has.
            const pageFolder = p.folderId ?? null;
            return pageFolder === null || !visibleFolderIds.has(pageFolder);
          }
          return (p.folderId ?? null) === folderId;
        })
      ),
    [visiblePages, visibleFolderIds, sortPages]
  );

  const getChildPages = useCallback(
    (parentPageId: string) =>
      sortPages(visiblePages.filter((p) => p.parentPageId === parentPageId)),
    [visiblePages, sortPages]
  );

  // Flat folder list (with depth) for the "Move to folder" menu view.
  const flatFolders = useMemo(() => {
    const out: { folder: Folder; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const f of getChildFolders(parentId)) {
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [getChildFolders]);

  // ---- Context menu plumbing ----

  const openMenu = useCallback((e: React.MouseEvent, target: MenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuView("main");
    setMenu({ target, x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  // Keep the menu on-screen.
  useEffect(() => {
    if (!menu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - rect.width - 8);
    const y = Math.min(menu.y, window.innerHeight - rect.height - 8);
    if (x !== menu.x || y !== menu.y) setMenu((m) => (m ? { ...m, x, y } : m));
  }, [menu, menuView]);

  const togglePageExpanded = useCallback((pageId: string) => {
    setExpandedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  }, []);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    if (renamingFolderId && name) {
      await updateFolder(notebook.id, renamingFolderId, { name });
    }
    setRenamingFolderId(null);
  }, [renamingFolderId, renameValue, updateFolder, notebook.id]);

  // ---- Rendering ----

  const renderPage = (page: Page, depth: number): React.ReactNode => {
    const children = getChildPages(page.id);
    const isOpen = expandedPageIds.has(page.id);
    const isSelected = page.id === selectedPageId;
    return (
      <div key={page.id}>
        <StudyRow
          depth={depth}
          selected={isSelected}
          title={page.title || "Untitled"}
          onClick={() => selectPage(page.id)}
          onContextMenu={(e) => openMenu(e, { kind: "page", page })}
        >
          {children.length > 0 ? (
            <span
              role="button"
              aria-label={isOpen ? "Collapse subpages" : "Expand subpages"}
              onClick={(e) => {
                e.stopPropagation();
                togglePageExpanded(page.id);
              }}
            >
              <StudyChevron open={isOpen} />
            </span>
          ) : null}
          <StudyRowIcon selected={isSelected}>{PAGE_ICON}</StudyRowIcon>
          <span className="flex-1 truncate">{page.title || "Untitled"}</span>
        </StudyRow>
        {isOpen && children.map((child) => renderPage(child, depth + 1))}
      </div>
    );
  };

  const renderFolder = (folder: Folder, depth: number): React.ReactNode => {
    const isOpen = expandedFolderIds.has(folder.id);
    const childFolders = getChildFolders(folder.id);
    const folderPages = getPagesForFolder(folder.id);
    return (
      <div key={folder.id}>
        {renamingFolderId === folder.id ? (
          <div style={{ padding: `2px 8px 2px ${8 + depth * 14}px` }}>
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setRenamingFolderId(null);
              }}
              className="w-full"
              style={{
                fontSize: 13,
                padding: "3px 6px",
                borderRadius: "var(--radius-xs)",
                border: "1px solid var(--color-accent)",
                backgroundColor: "var(--color-bg-secondary)",
                color: "var(--color-text-primary)",
                outline: "none",
              }}
            />
          </div>
        ) : (
          <StudyRow
            depth={depth}
            title={folder.name}
            onClick={() => toggleFolderExpanded(folder.id)}
            onContextMenu={(e) => openMenu(e, { kind: "folder", folder })}
          >
            <StudyChevron open={isOpen} />
            <StudyRowIcon>{FOLDER_ICON}</StudyRowIcon>
            <span className="flex-1 truncate">{folder.name}</span>
          </StudyRow>
        )}
        {isOpen && (
          <>
            {childFolders.map((child) => renderFolder(child, depth + 1))}
            {folderPages.map((page) => renderPage(page, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const rootFolders = getChildFolders(null);
  const rootPages = getPagesForFolder(null);
  const isEmpty = rootFolders.length === 0 && rootPages.length === 0;

  return (
    <div>
      {sectionsOn && (
        <div
          className="flex flex-wrap items-center gap-1"
          style={{ padding: "4px 8px 6px 22px" }}
        >
          {sortedSections.map((section) => (
            <SectionChip
              key={section.id}
              label={section.name}
              color={section.color}
              active={section.id === selectedSectionId}
              onClick={() => selectSection(section.id)}
            />
          ))}
          <SectionChip
            label="Unsorted"
            active={selectedSectionId === null}
            onClick={() => selectSection(null)}
          />
        </div>
      )}

      {rootFolders.map((folder) => renderFolder(folder, 1))}
      {rootPages.map((page) => renderPage(page, 1))}

      {isEmpty && (
        <div
          style={{
            padding: "5px 8px 5px 22px",
            fontSize: 12.5,
            color: "var(--color-text-muted)",
          }}
        >
          No pages here yet
        </div>
      )}

      {menu && (
        <>
          <div
            className="fixed inset-0 z-[90]"
            onMouseDown={closeMenu}
            onContextMenu={(e) => {
              e.preventDefault();
              closeMenu();
            }}
          />
          <div
            ref={menuRef}
            className="fixed z-[100] py-1"
            style={{
              left: menu.x,
              top: menu.y,
              minWidth: 176,
              backgroundColor: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              boxShadow: "var(--shadow-3)",
            }}
          >
            {menu.target.kind === "page" && menuView === "main" && (
              <>
                <MenuItem
                  label="Open in new pane"
                  onClick={() => {
                    openPageInNewPane(menu.target.kind === "page" ? menu.target.page.id : null);
                    closeMenu();
                  }}
                />
                <MenuItem
                  label={menu.target.page.isFavorite ? "Remove from favorites" : "Add to favorites"}
                  onClick={() => {
                    if (menu.target.kind === "page") {
                      toggleFavorite(notebook.id, menu.target.page.id);
                    }
                    closeMenu();
                  }}
                />
                <MenuItem label="Move to folder…" onClick={() => setMenuView("move")} />
                <MenuDivider />
                <MenuItem
                  label="Delete page"
                  danger
                  onClick={() => {
                    if (menu.target.kind !== "page") return;
                    const { page } = menu.target;
                    closeMenu();
                    if (window.confirm(`Delete "${page.title || "Untitled"}"?`)) {
                      deletePage(notebook.id, page.id);
                    }
                  }}
                />
              </>
            )}

            {menu.target.kind === "page" && menuView === "move" && (
              <>
                <MenuItem
                  label="No folder"
                  onClick={() => {
                    if (menu.target.kind === "page") {
                      movePageToFolder(notebook.id, menu.target.page.id, undefined);
                    }
                    closeMenu();
                  }}
                />
                {flatFolders.map(({ folder, depth }) => (
                  <MenuItem
                    key={folder.id}
                    label={folder.name}
                    indent={depth}
                    onClick={() => {
                      if (
                        menu.target.kind === "page" &&
                        (menu.target.page.folderId ?? null) !== folder.id
                      ) {
                        movePageToFolder(notebook.id, menu.target.page.id, folder.id);
                      }
                      closeMenu();
                    }}
                  />
                ))}
              </>
            )}

            {menu.target.kind === "folder" && (
              <>
                <MenuItem
                  label="New page inside"
                  onClick={() => {
                    if (menu.target.kind !== "folder") return;
                    const { folder } = menu.target;
                    createPage(
                      notebook.id,
                      "Untitled",
                      folder.id,
                      undefined,
                      sectionsOn && selectedSectionId ? selectedSectionId : undefined
                    );
                    setFolderExpanded(folder.id, true);
                    closeMenu();
                  }}
                />
                <MenuItem
                  label="Rename folder"
                  onClick={() => {
                    if (menu.target.kind === "folder") {
                      setRenameValue(menu.target.folder.name);
                      setRenamingFolderId(menu.target.folder.id);
                    }
                    closeMenu();
                  }}
                />
                <MenuDivider />
                <MenuItem
                  label="Delete folder"
                  danger
                  onClick={() => {
                    if (menu.target.kind !== "folder") return;
                    const { folder } = menu.target;
                    closeMenu();
                    if (
                      window.confirm(
                        `Delete folder "${folder.name}"? Pages inside move to the notebook root.`
                      )
                    ) {
                      deleteFolder(notebook.id, folder.id);
                    }
                  }}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function SectionChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 transition-colors"
      style={{
        fontSize: 11,
        fontWeight: 500,
        padding: "2px 8px",
        borderRadius: "var(--radius-full)",
        border: `1px solid ${active ? "transparent" : "var(--color-border-muted)"}`,
        color: active ? "var(--color-text-primary)" : "var(--color-text-secondary)",
        backgroundColor: active ? "var(--color-selection)" : "transparent",
      }}
    >
      {color && (
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: color }}
        />
      )}
      <span className="truncate" style={{ maxWidth: 110 }}>{label}</span>
    </button>
  );
}

function MenuItem({
  label,
  onClick,
  danger = false,
  indent = 0,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  indent?: number;
}) {
  const restColor = danger ? "var(--color-danger)" : "var(--color-text-secondary)";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center text-left transition-colors"
      style={{
        fontSize: 12.5,
        padding: `5px 12px 5px ${12 + indent * 12}px`,
        color: restColor,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = "var(--color-bg-tertiary)";
        if (!danger) e.currentTarget.style.color = "var(--color-text-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = "transparent";
        e.currentTarget.style.color = restColor;
      }}
    >
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function MenuDivider() {
  return (
    <div
      className="mx-2 my-1"
      style={{ borderTop: "1px solid var(--color-border-muted)" }}
    />
  );
}
