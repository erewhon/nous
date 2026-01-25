import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
import { arrayMove } from "@dnd-kit/sortable";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Folder, Page, Section, FileStorageMode } from "../../types/page";
import { useFolderStore } from "../../stores/folderStore";
import { usePageStore } from "../../stores/pageStore";
import { useThemeStore, type PageSortOption } from "../../stores/themeStore";
import * as api from "../../utils/api";
import { FolderTreeItem, DraggablePageItem } from "./FolderTreeItem";
import { FileImportDialog } from "../Import/FileImportDialog";

const PAGE_SORT_OPTIONS: { value: PageSortOption; label: string }[] = [
  { value: "position", label: "Manual" },
  { value: "name-asc", label: "Name (A-Z)" },
  { value: "name-desc", label: "Name (Z-A)" },
  { value: "updated", label: "Recently updated" },
  { value: "created", label: "Recently created" },
];

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
  onSelectPage: (pageId: string, openInNewPane?: boolean) => void;
  onOpenInTab?: (pageId: string, pageTitle: string) => void;
  onOpenInNewPane?: (pageId: string) => void;
  // Section filtering (controlled by parent)
  sectionsEnabled?: boolean;
  selectedSectionId?: string | null;
  sections?: Section[];
  onMovePageToSection?: (pageId: string, sectionId: string | null) => void;
  onMoveFolderToSection?: (folderId: string, sectionId: string | null) => void;
  // Cover page props
  hasCoverPage?: boolean;
  onViewCover?: () => void;
  // Page reordering
  onReorderPages?: (folderId: string | null, pageIds: string[]) => void;
  // Move page to notebook
  onMoveToNotebook?: (pageId: string, pageTitle: string) => void;
}

export function FolderTree({
  notebookId,
  pages,
  folders,
  selectedPageId,
  onSelectPage,
  onOpenInTab,
  onOpenInNewPane,
  sectionsEnabled = false,
  selectedSectionId = null,
  sections = [],
  onMovePageToSection,
  onMoveFolderToSection,
  hasCoverPage = false,
  onViewCover,
  onReorderPages,
  onMoveToNotebook,
}: FolderTreeProps) {
  const { createPage, createSubpage, movePageToFolder, movePageToParent, loadPages } = usePageStore();
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
  const autoHidePanels = useThemeStore((state) => state.autoHidePanels);
  const setAutoHidePanels = useThemeStore((state) => state.setAutoHidePanels);
  const pageSortBy = useThemeStore((state) => state.pageSortBy);
  const setPageSortBy = useThemeStore((state) => state.setPageSortBy);

  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [showPageSortMenu, setShowPageSortMenu] = useState(false);
  const [showNewPageMenu, setShowNewPageMenu] = useState(false);

  // Helper function to sort pages based on current sort option
  const sortPages = useCallback((pagesToSort: Page[]) => {
    return [...pagesToSort].sort((a, b) => {
      switch (pageSortBy) {
        case "name-asc":
          return a.title.localeCompare(b.title);
        case "name-desc":
          return b.title.localeCompare(a.title);
        case "updated":
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case "created":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "position":
        default:
          return a.position - b.position;
      }
    });
  }, [pageSortBy]);
  const [newFolderName, setNewFolderName] = useState("");
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [overFolderId, setOverFolderId] = useState<string | null>(null);
  const [overSectionId, setOverSectionId] = useState<string | null>(null);
  const [showSectionDropZones, setShowSectionDropZones] = useState(false);
  const [expandedPageIds, setExpandedPageIds] = useState<Set<string>>(new Set());
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [pendingImportPath, setPendingImportPath] = useState<string | null>(null);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // Supported file extensions for import
  const SUPPORTED_EXTENSIONS = ["md", "pdf", "ipynb", "epub", "ics"];

  // Listen for Tauri file drop events
  useEffect(() => {
    const appWindow = getCurrentWindow();

    const handleFileDrop = (event: { payload: { paths: string[]; position: { x: number; y: number } } }) => {
      const { paths } = event.payload;
      if (paths && paths.length > 0) {
        // Find the first supported file
        const supportedFile = paths.find((path) => {
          const ext = path.split(".").pop()?.toLowerCase();
          return ext && SUPPORTED_EXTENSIONS.includes(ext);
        });

        if (supportedFile) {
          setPendingImportPath(supportedFile);
          setImportDialogOpen(true);
        }
      }
      setIsFileDragOver(false);
    };

    const handleDragEnter = () => {
      setIsFileDragOver(true);
    };

    const handleDragLeave = () => {
      setIsFileDragOver(false);
    };

    // Subscribe to Tauri window drag-drop events
    const unlistenDrop = appWindow.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        handleFileDrop({ payload: { paths: event.payload.paths, position: event.payload.position } });
      } else if (event.payload.type === "enter" || event.payload.type === "over") {
        handleDragEnter();
      } else if (event.payload.type === "leave") {
        handleDragLeave();
      }
    });

    return () => {
      unlistenDrop.then((unlisten) => unlisten());
    };
  }, []);

  // Toggle page expansion for nested pages
  const togglePageExpanded = useCallback((pageId: string) => {
    setExpandedPageIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(pageId)) {
        newSet.delete(pageId);
      } else {
        newSet.add(pageId);
      }
      return newSet;
    });
  }, []);

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
  // Note: selectedSectionId can be:
  //   - undefined: show all pages (no section filter)
  //   - null: show only unsorted pages (sectionId === null)
  //   - string: show pages in that specific section
  const visiblePages = useMemo(() => {
    let filtered = showArchived ? pages : pages.filter((p) => !p.isArchived);
    // Filter by section if sections are enabled
    if (sectionsEnabled && selectedSectionId !== undefined) {
      // null means "unsorted" - show pages with no section
      // string means a specific section
      filtered = filtered.filter((p) => (p.sectionId ?? null) === selectedSectionId);
    }
    // Deduplicate by ID (defensive - shouldn't happen but prevents React key errors)
    const seen = new Set<string>();
    const deduplicated = filtered.filter((p) => {
      if (seen.has(p.id)) {
        console.warn('[FolderTree] Duplicate page filtered out:', p.id, p.title);
        return false;
      }
      seen.add(p.id);
      return true;
    });
    return deduplicated;
  }, [pages, showArchived, sectionsEnabled, selectedSectionId]);

  // Filter folders by section
  const visibleFolders = useMemo(() => {
    if (!sectionsEnabled || selectedSectionId === undefined) {
      return folders;
    }
    // null means "unsorted" - show folders with no section
    return folders.filter((f) => (f.sectionId ?? null) === selectedSectionId);
  }, [folders, sectionsEnabled, selectedSectionId]);

  // Get top-level pages for a specific folder (pages without a parent page)
  const getPagesForFolder = useCallback(
    (folderId: string | null) => {
      const filtered = visiblePages.filter((p) => {
        const folderMatch = (p.folderId ?? null) === folderId;
        // Use a simple truthy check - if parentPageId has any value, it's a child page
        const noParent = !p.parentPageId;

        // Safety check: if this page has parentPageId but passed the noParent check, something is wrong
        if (p.parentPageId && noParent) {
          console.error('[getPagesForFolder] CRITICAL BUG - page has parentPageId but noParent is true:', {
            id: p.id,
            title: p.title,
            parentPageId: p.parentPageId,
            parentPageIdType: typeof p.parentPageId,
            parentPageIdValue: JSON.stringify(p.parentPageId),
            noParent,
          });
        }

        return folderMatch && noParent;
      });
      const sorted = sortPages(filtered);
      return sorted;
    },
    [visiblePages, sortPages]
  );

  // Get child pages for a specific parent page
  const getChildPagesForParent = useCallback(
    (parentPageId: string) => {
      // Only return pages that have this specific parentPageId (non-empty string)
      const filtered = visiblePages.filter((p) =>
        p.parentPageId && p.parentPageId === parentPageId
      );
      const sorted = sortPages(filtered);
      // Debug: Check for duplicates
      const ids = sorted.map(p => p.id);
      const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
      if (duplicates.length > 0) {
        console.error('[FolderTree] Duplicate IDs in getChildPagesForParent:', duplicates, 'parentPageId:', parentPageId);
      }
      return sorted;
    },
    [visiblePages, sortPages]
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
      createPage(notebookId, "Untitled", folderId, undefined, sectionId);
    },
    [notebookId, createPage, sectionsEnabled, selectedSectionId]
  );

  // Handle creating a chat page
  const handleCreateChatPage = useCallback(async () => {
    try {
      // Create a new page using the store (adds to local state and selects it)
      const title = "New Chat";
      const sectionId = sectionsEnabled && selectedSectionId ? selectedSectionId : undefined;
      const pageData = await createPage(notebookId, title, undefined, undefined, sectionId);
      if (!pageData) {
        console.error("Failed to create chat page");
        return;
      }
      // Update the page to have .chat extension which will set pageType to chat
      // Use the store's updatePage to keep local state in sync
      const { updatePage: storeUpdatePage } = usePageStore.getState();
      await storeUpdatePage(notebookId, pageData.id, {
        fileExtension: "chat",
        pageType: "chat",
      });
      // Initialize the chat content
      const defaultContent = JSON.stringify({
        version: 1,
        cells: [{
          id: crypto.randomUUID(),
          type: "prompt",
          content: "",
          status: "idle",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
        settings: {
          includePageContext: false,
          maxContextCells: 10,
        },
      }, null, 2);
      await api.updateFileContent(notebookId, pageData.id, defaultContent);
    } catch (err) {
      console.error("Failed to create chat page:", err);
    }
  }, [notebookId, sectionsEnabled, selectedSectionId, createPage]);

  // Handle creating a markdown page
  const handleCreateMarkdownPage = useCallback(async () => {
    try {
      const title = "New Document";
      const sectionId = sectionsEnabled && selectedSectionId ? selectedSectionId : undefined;
      const pageData = await createPage(notebookId, title, undefined, undefined, sectionId);
      if (!pageData) {
        console.error("Failed to create markdown page");
        return;
      }
      // Update the page to have .md extension which will set pageType to markdown
      const { updatePage: storeUpdatePage } = usePageStore.getState();
      await storeUpdatePage(notebookId, pageData.id, {
        fileExtension: "md",
        pageType: "markdown",
      });
      // Initialize with empty markdown content
      await api.updateFileContent(notebookId, pageData.id, `# ${title}\n\n`);
    } catch (err) {
      console.error("Failed to create markdown page:", err);
    }
  }, [notebookId, sectionsEnabled, selectedSectionId, createPage]);

  // Handle creating a calendar page
  const handleCreateCalendarPage = useCallback(async () => {
    try {
      const title = "New Calendar";
      const sectionId = sectionsEnabled && selectedSectionId ? selectedSectionId : undefined;
      const pageData = await createPage(notebookId, title, undefined, undefined, sectionId);
      if (!pageData) {
        console.error("Failed to create calendar page");
        return;
      }
      // Update the page to have .ics extension which will set pageType to calendar
      const { updatePage: storeUpdatePage } = usePageStore.getState();
      await storeUpdatePage(notebookId, pageData.id, {
        fileExtension: "ics",
        pageType: "calendar",
      });
      // Initialize with empty iCalendar content
      const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Katt//Katt Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:${title}
END:VCALENDAR`;
      await api.updateFileContent(notebookId, pageData.id, icsContent);
    } catch (err) {
      console.error("Failed to create calendar page:", err);
    }
  }, [notebookId, sectionsEnabled, selectedSectionId, createPage]);

  // Handle opening file picker for import
  const handleImportFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Supported Files",
            extensions: ["md", "pdf", "ipynb", "epub", "ics"],
          },
          { name: "Markdown", extensions: ["md"] },
          { name: "PDF", extensions: ["pdf"] },
          { name: "Jupyter Notebook", extensions: ["ipynb"] },
          { name: "EPUB", extensions: ["epub"] },
          { name: "Calendar", extensions: ["ics"] },
        ],
      });

      if (selected) {
        // Show dialog to choose storage mode
        setPendingImportPath(selected);
        setImportDialogOpen(true);
      }
    } catch (err) {
      console.error("Failed to open file picker:", err);
    }
  }, []);

  // Handle confirming the import with storage mode
  const handleConfirmImport = useCallback(
    async (storageMode: FileStorageMode) => {
      if (!pendingImportPath) return;

      try {
        const sectionId = sectionsEnabled && selectedSectionId ? selectedSectionId : undefined;
        await api.importFileAsPage(notebookId, pendingImportPath, storageMode, undefined, sectionId);
        // Refresh the page list to show the imported page
        await loadPages(notebookId);
      } catch (err) {
        console.error("Failed to import file:", err);
      } finally {
        setImportDialogOpen(false);
        setPendingImportPath(null);
      }
    },
    [notebookId, pendingImportPath, sectionsEnabled, selectedSectionId, loadPages]
  );

  // Handle canceling the import
  const handleCancelImport = useCallback(() => {
    setImportDialogOpen(false);
    setPendingImportPath(null);
  }, []);

  // Handle creating a subpage
  const handleCreateSubpage = useCallback(
    async (parentPageId: string) => {
      await createSubpage(notebookId, parentPageId, "Untitled");
      // Expand the parent page to show the new subpage
      setExpandedPageIds((prev) => {
        const newSet = new Set(prev);
        newSet.add(parentPageId);
        return newSet;
      });
    },
    [notebookId, createSubpage]
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

  // Handle deleting a page (moves to trash)
  const handleDeletePage = useCallback(
    async (pageId: string, pageTitle: string) => {
      const confirmed = window.confirm(`Move "${pageTitle}" to trash? You can restore it within 30 days.`);
      if (confirmed) {
        await api.deletePage(notebookId, pageId);
        await loadPages(notebookId);
      }
    },
    [notebookId, loadPages]
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
      const { active, over } = event;
      if (over) {
        const overId = over.id as string;
        const overData = over.data.current;

        // Check if we're over a section drop zone
        if (overData?.type === "section") {
          setOverSectionId(overData.section?.id ?? "unsorted");
          setOverFolderId(null);
          return;
        }

        // Check if we're over a page drop zone (for nesting)
        if (overData?.type === "page") {
          const targetPage = overData.page;
          // Don't allow dropping on self or own children
          const activeId = active.id as string;
          if (targetPage.id !== activeId && targetPage.parentPageId !== activeId) {
            setOverFolderId(null);
            setOverSectionId(null);
            // Expand the page when hovering to show children
            setExpandedPageIds((prev) => {
              const newSet = new Set(prev);
              newSet.add(targetPage.id);
              return newSet;
            });
            return;
          }
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

  // Helper to check if a page is a descendant of another
  const isDescendant = useCallback(
    (potentialDescendantId: string, ancestorId: string): boolean => {
      let currentId: string | null | undefined = potentialDescendantId;
      const visited = new Set<string>();
      while (currentId) {
        if (visited.has(currentId)) break; // Prevent infinite loops
        visited.add(currentId);
        const currentPage = pages.find((p) => p.id === currentId);
        if (!currentPage) break;
        if (currentPage.parentPageId === ancestorId) return true;
        currentId = currentPage.parentPageId;
      }
      return false;
    },
    [pages]
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

      // Check if dropped on a page
      // This could be for nesting OR reordering depending on context
      if (overData?.type === "page") {
        const targetPage = overData.page as Page;

        // Don't allow dropping on self
        if (targetPage.id === pageId) return;

        // Check if both pages are in the same folder/root AND same parent level
        const sameFolder = (page.folderId ?? null) === (targetPage.folderId ?? null);
        const sameParent = (page.parentPageId ?? null) === (targetPage.parentPageId ?? null);

        // If they're in the same folder and same parent level, this is a reorder operation
        if (sameFolder && sameParent && onReorderPages) {
          // Get all pages at this level (same folder, same parent)
          const pagesAtLevel = visiblePages
            .filter((p) =>
              (p.folderId ?? null) === (page.folderId ?? null) &&
              (p.parentPageId ?? null) === (page.parentPageId ?? null)
            )
            .sort((a, b) => a.position - b.position);

          const oldIndex = pagesAtLevel.findIndex((p) => p.id === pageId);
          const newIndex = pagesAtLevel.findIndex((p) => p.id === targetPage.id);

          if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
            const reorderedPages = arrayMove(pagesAtLevel, oldIndex, newIndex);
            const pageIds = reorderedPages.map((p) => p.id);
            onReorderPages(page.folderId ?? null, pageIds);
          }
          return;
        }

        // Otherwise, treat as nesting (dropping page onto another to make it a child)
        // Don't allow dropping on own descendants
        if (!isDescendant(targetPage.id, pageId)) {
          // Only move if parent is different
          if (page.parentPageId !== targetPage.id) {
            await movePageToParent(notebookId, pageId, targetPage.id);
          }
        }
        return;
      }

      // Determine target folder
      let targetFolderId: string | undefined = undefined;

      if (overId === "root") {
        // Moving to root (no folder, no parent)
        targetFolderId = undefined;
        // If page had a parent, remove it
        if (page.parentPageId) {
          await movePageToParent(notebookId, pageId, undefined);
          return;
        }
      } else {
        // Check if over is a folder
        const folder = visibleFolders.find((f) => f.id === overId);
        if (folder) {
          targetFolderId = folder.id;
          // If page had a parent, remove the parent relationship when moving to folder
          if (page.parentPageId) {
            await movePageToParent(notebookId, pageId, undefined);
          }
        }
      }

      // Only move to folder if the target folder is different
      if ((page.folderId ?? undefined) !== targetFolderId && !page.parentPageId) {
        await movePageToFolder(notebookId, pageId, targetFolderId);
      }
    },
    [pages, visiblePages, visibleFolders, notebookId, movePageToFolder, movePageToParent, onMovePageToSection, onMoveFolderToSection, isDescendant, onReorderPages]
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
          onOpenInTab={onOpenInTab}
          onOpenInNewPane={onOpenInNewPane}
          onCreatePage={handleCreatePage}
          onCreateSubpage={handleCreateSubpage}
          onDeletePage={handleDeletePage}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          renderFolder={renderFolder}
          getChildPages={getChildPagesForParent}
          expandedPageIds={expandedPageIds}
          onTogglePageExpand={togglePageExpanded}
          sections={sectionsEnabled ? sections : undefined}
          onMoveToSection={onMovePageToSection}
          onMoveFolderToSection={onMoveFolderToSection}
          onMoveToNotebook={onMoveToNotebook}
        />
      );
    },
    [
      expandedFolderIds,
      selectedPageId,
      overFolderId,
      getPagesForFolder,
      getChildFolders,
      getChildPagesForParent,
      expandedPageIds,
      togglePageExpanded,
      toggleFolderExpanded,
      onSelectPage,
      onOpenInTab,
      onOpenInNewPane,
      handleCreatePage,
      handleCreateSubpage,
      handleDeletePage,
      handleRenameFolder,
      handleDeleteFolder,
      sectionsEnabled,
      sections,
      onMovePageToSection,
      onMoveFolderToSection,
      onMoveToNotebook,
    ]
  );

  // Get root-level folders and pages
  const rootFolders = getChildFolders(null);
  const rootPages = getPagesForFolder(null);

  // Debug: Check for pages that incorrectly appear in rootPages
  useEffect(() => {
    // Check if any page with parentPageId is in rootPages (should never happen)
    const badPages = rootPages.filter(p => p.parentPageId);
    if (badPages.length > 0) {
      console.error('[FolderTree] BUG: Pages with parentPageId found in rootPages:', badPages.map(p => ({
        id: p.id,
        title: p.title,
        parentPageId: p.parentPageId,
      })));
    }
  }, [rootPages]);

  // Count archived pages
  const archivedCount = pages.filter((p) => p.isArchived).length;

  // Get active page for drag overlay
  const activePage = activePageId ? pages.find((p) => p.id === activePageId) : null;
  const activeFolder = activeFolderId ? folders.find((f) => f.id === activeFolderId) : null;

  return (
    <>
      <FileImportDialog
        isOpen={importDialogOpen}
        filePath={pendingImportPath || ""}
        onConfirm={handleConfirmImport}
        onCancel={handleCancelImport}
      />
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
            {/* Sort pages button */}
            <div className="relative">
              <button
                onClick={() => setShowPageSortMenu(!showPageSortMenu)}
                className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
                style={{ color: pageSortBy !== "position" ? "var(--color-accent)" : "var(--color-text-muted)" }}
                title={`Sort: ${PAGE_SORT_OPTIONS.find(o => o.value === pageSortBy)?.label}`}
              >
                <IconSort />
              </button>
              {showPageSortMenu && (
                <div
                  className="absolute right-0 top-full z-50 mt-1 min-w-36 rounded-lg border py-1 shadow-lg"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderColor: "var(--color-border)",
                  }}
                  onMouseLeave={() => setShowPageSortMenu(false)}
                >
                  {PAGE_SORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setPageSortBy(option.value);
                        setShowPageSortMenu(false);
                      }}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                      style={{
                        color: pageSortBy === option.value ? "var(--color-accent)" : "var(--color-text-primary)",
                      }}
                    >
                      {option.label}
                      {pageSortBy === option.value && <span className="text-[--color-accent]">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Auto-hide toggle */}
            <button
              onClick={() => setAutoHidePanels(!autoHidePanels)}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
              style={{ color: autoHidePanels ? "var(--color-accent)" : "var(--color-text-muted)" }}
              title={autoHidePanels ? "Disable auto-hide panels" : "Enable auto-hide panels"}
            >
              <IconPanelClose />
            </button>
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
            {/* Create page button with dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowNewPageMenu(!showNewPageMenu)}
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
              {showNewPageMenu && (
                <div
                  className="absolute right-0 top-full z-50 mt-1 min-w-40 rounded-lg border py-1 shadow-lg"
                  style={{
                    backgroundColor: "var(--color-bg-secondary)",
                    borderColor: "var(--color-border)",
                  }}
                  onMouseLeave={() => setShowNewPageMenu(false)}
                >
                  <button
                    onClick={() => {
                      handleCreatePage();
                      setShowNewPageMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary]"
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
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    Standard Page
                  </button>
                  <button
                    onClick={() => {
                      handleCreateChatPage();
                      setShowNewPageMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary]"
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
                      <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
                    </svg>
                    AI Chat Page
                  </button>
                  <button
                    onClick={() => {
                      handleCreateMarkdownPage();
                      setShowNewPageMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary]"
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
                      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                      <polyline points="14 2 14 8 20 8" />
                      <path d="M9 15v-3l2 2 2-2v3" />
                    </svg>
                    Markdown Page
                  </button>
                  <button
                    onClick={() => {
                      handleCreateCalendarPage();
                      setShowNewPageMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary]"
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
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                    Calendar Page
                  </button>
                  <div
                    className="my-1 mx-2 border-t"
                    style={{ borderColor: "var(--color-border)" }}
                  />
                  <button
                    onClick={() => {
                      handleImportFile();
                      setShowNewPageMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{ color: "var(--color-text-muted)" }}
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
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Import File...
                  </button>
                </div>
              )}
            </div>
            {/* Import file button */}
            <button
              onClick={handleImportFile}
              className="flex h-7 w-7 items-center justify-center rounded-lg transition-all"
              style={{ color: "var(--color-text-muted)" }}
              title="Import file (Markdown, PDF, Jupyter, EPUB, Calendar)"
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
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
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
        <div
          ref={treeContainerRef}
          className="flex-1 overflow-y-auto px-2 pb-4 text-left relative"
        >
          {/* File drop overlay */}
          {isFileDragOver && (
            <div
              className="absolute inset-2 z-40 flex flex-col items-center justify-center rounded-xl border-2 border-dashed"
              style={{
                backgroundColor: "rgba(139, 92, 246, 0.1)",
                borderColor: "var(--color-accent)",
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: "var(--color-accent)" }}
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <span
                className="mt-2 text-sm font-medium"
                style={{ color: "var(--color-accent)" }}
              >
                Drop to import
              </span>
              <span
                className="mt-1 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                MD, PDF, Jupyter, EPUB, ICS
              </span>
            </div>
          )}
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
                {sectionsEnabled && selectedSectionId !== undefined
                  ? selectedSectionId === null
                    ? "No unsorted pages"
                    : "No pages in this section"
                  : "No pages yet"}
              </span>
            </div>
          ) : (
            <ul className="w-full">
              {/* Root-level folders */}
              {rootFolders.map((folder) => renderFolder(folder, 0))}

              {/* Root-level pages (no folder) - use draggable version */}
              {rootPages.map((page) => (
                <DraggablePageItem
                  key={`root-${page.id}`}
                  page={page}
                  isSelected={selectedPageId === page.id}
                  depth={-1}
                  onSelect={(openInNewPane) => onSelectPage(page.id, openInNewPane)}
                  onSelectPage={onSelectPage}
                  onOpenInTab={onOpenInTab}
                  onOpenInNewPane={onOpenInNewPane}
                  onCreateSubpage={handleCreateSubpage}
                  onDeletePage={handleDeletePage}
                  sections={sectionsEnabled ? sections : undefined}
                  onMoveToSection={onMovePageToSection}
                  onMoveToNotebook={onMoveToNotebook}
                  getChildPages={getChildPagesForParent}
                  expandedPageIds={expandedPageIds}
                  onTogglePageExpand={togglePageExpanded}
                  selectedPageId={selectedPageId}
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
    </>
  );
}

function IconPanelClose() {
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      <path d="M16 15l-3-3 3-3" />
    </svg>
  );
}

function IconSort() {
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
      <path d="M11 5h10" />
      <path d="M11 9h7" />
      <path d="M11 13h4" />
      <path d="M3 17l3 3 3-3" />
      <path d="M6 18V4" />
    </svg>
  );
}
