import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useFolderStore } from "../../stores/folderStore";
import { useSectionStore } from "../../stores/sectionStore";
import { useThemeStore } from "../../stores/themeStore";
import { NotebookList } from "../NotebookList/NotebookList";
import { SectionList } from "../Sections";
import { FolderTree } from "../Editor/FolderTree";
import { MovePageDialog } from "../Move/MovePageDialog";
import { MoveFolderDialog } from "../Move/MoveFolderDialog";
import { SmartOrganizeDialog } from "../SmartOrganize/SmartOrganizeDialog";
import { ResizeHandle } from "../Layout/ResizeHandle";
import type { RailSection } from "./SidebarRail";

interface SidebarAccordionPanelProps {
  activeSection: RailSection;
}

type AccordionSection = "recent" | "favorites" | "notebooks" | "sections" | "pages";

export function SidebarAccordionPanel({ activeSection }: SidebarAccordionPanelProps) {
  const panelWidths = useThemeStore((s) => s.panelWidths);
  const setPanelWidth = useThemeStore((s) => s.setPanelWidth);
  const showRecentPages = useThemeStore((s) => s.showRecentPages);
  const showFavoritePages = useThemeStore((s) => s.showFavoritePages);
  const pinnedSections = useThemeStore((s) => s.pinnedSections);
  const removePinnedSection = useThemeStore((s) => s.removePinnedSection);

  const { selectedNotebookId, notebooks, selectNotebook, getVisibleNotebooks } = useNotebookStore();
  const {
    pages,
    selectedPageId,
    selectPage,
    openPageInNewPane,
    openTabInPane,
    getRecentPages,
    clearRecentPages,
    movePageToSection,
    reorderPages,
    loadPages,
    panes,
    activePaneId,
  } = usePageStore();
  const allFavoritePages = usePageStore((s) => s.allFavoritePages);
  const { folders, loadFolders, showArchived, updateFolder } = useFolderStore();
  const {
    sections,
    selectedSectionId,
    selectSection,
    createSection,
    updateSection,
    deleteSection,
    reorderSections,
  } = useSectionStore();

  const selectedNotebook = notebooks.find((n) => n.id === selectedNotebookId);
  const visibleNotebooks = getVisibleNotebooks();

  // Expanded accordion sections
  const [expandedSections, setExpandedSections] = useState<Set<AccordionSection>>(
    () => new Set(["notebooks", "pages"])
  );

  // Recent pages
  const [showAllRecent, setShowAllRecent] = useState(false);
  const recentPages = getRecentPages(showAllRecent ? 20 : 5);

  // Favorites
  const hasFavorites = pinnedSections.length > 0 || allFavoritePages.length > 0;

  // Scroll refs for each section
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Move page dialog state
  const [movePageDialogOpen, setMovePageDialogOpen] = useState(false);
  const [movePageTarget, setMovePageTarget] = useState<{ pageId: string; pageTitle: string } | null>(null);

  // Move folder dialog state
  const [moveFolderDialogOpen, setMoveFolderDialogOpen] = useState(false);
  const [moveFolderTarget, setMoveFolderTarget] = useState<{ folderId: string; folderName: string } | null>(null);

  // Smart Organize dialog state
  const [smartOrganizeOpen, setSmartOrganizeOpen] = useState(false);
  const [smartOrganizePageContext, setSmartOrganizePageContext] = useState<{ pageId?: string; pageTitle?: string } | null>(null);

  // Map rail sections to accordion sections
  const railToAccordion: Record<string, AccordionSection> = {
    notebooks: "notebooks",
    sections: "sections",
    pages: "pages",
  };

  // When activeSection changes, ensure that section is expanded and scroll it into view
  useEffect(() => {
    if (!activeSection) return;
    const accordionKey = railToAccordion[activeSection];
    if (!accordionKey) return;

    setExpandedSections((prev) => {
      if (prev.has(accordionKey)) return prev;
      const next = new Set(prev);
      next.add(accordionKey);
      return next;
    });

    // Scroll into view after a brief delay for expansion
    requestAnimationFrame(() => {
      const el = sectionRefs.current[accordionKey];
      if (el && scrollContainerRef.current) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
  }, [activeSection]);

  const toggleSection = useCallback((section: AccordionSection) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  const handleSearchClick = useCallback(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
    );
  }, []);

  // Notebook pages for FolderTree
  const notebookPages = useMemo(
    () => pages.filter((p) => p.notebookId === selectedNotebookId),
    [pages, selectedNotebookId]
  );

  const unassignedPagesCount = useMemo(
    () => notebookPages.filter((p) => !p.sectionId && !p.isArchived).length,
    [notebookPages]
  );

  // Handle page selection
  const handleSelectPage = useCallback(
    (pageId: string, openInNewPane?: boolean) => {
      if (openInNewPane) {
        openPageInNewPane(pageId);
      } else {
        selectPage(pageId);
      }
    },
    [selectPage, openPageInNewPane]
  );

  // Handle opening a page in a new tab
  const handleOpenInTab = useCallback(
    (pageId: string, pageTitle: string) => {
      const paneId = activePaneId || panes[0]?.id;
      if (paneId) {
        openTabInPane(paneId, pageId, pageTitle);
      }
    },
    [activePaneId, panes, openTabInPane]
  );

  const handlePanelResize = useCallback(
    (delta: number) => {
      setPanelWidth("sidebar", panelWidths.sidebar + delta);
    },
    [panelWidths.sidebar, setPanelWidth]
  );

  const width = panelWidths.sidebar;

  return (
    <>
      <div
        className="flex h-full flex-shrink-0 flex-col border-r"
        style={{
          width: `${width}px`,
          backgroundColor: "var(--color-bg-sidebar)",
          borderColor: "var(--color-border)",
        }}
      >
        {/* Search bar */}
        <div className="px-3 py-3">
          <button
            className="flex w-full items-center gap-2 rounded-md border text-left text-sm px-3 py-1.5"
            style={{
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
              color: "var(--color-text-muted)",
            }}
            onClick={handleSearchClick}
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
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span>Search...</span>
            <kbd className="ml-auto text-xs" style={{ color: "var(--color-text-muted)" }}>
              Cmd+K
            </kbd>
          </button>
        </div>

        {/* Scrollable accordion content */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          {/* Recent Pages */}
          {showRecentPages && recentPages.length > 0 && (
            <AccordionHeader
              ref={(el) => { sectionRefs.current.recent = el; }}
              title="Recent"
              expanded={expandedSections.has("recent")}
              onToggle={() => toggleSection("recent")}
              extra={
                expandedSections.has("recent") ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); clearRecentPages(); }}
                    className="rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Clear
                  </button>
                ) : undefined
              }
            >
              <ul className="space-y-0.5 px-3 pb-2">
                {recentPages.map((recent) => {
                  const notebook = visibleNotebooks.find((n) => n.id === recent.notebookId);
                  return (
                    <li key={recent.pageId}>
                      <button
                        onClick={() => {
                          if (notebook) selectNotebook(notebook.id);
                          selectPage(recent.pageId);
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                        style={{ color: "var(--color-text-secondary)" }}
                        title={`${recent.title} (${notebook?.name || "Unknown"})`}
                      >
                        <IconPage />
                        <span className="flex-1 truncate">{recent.title}</span>
                      </button>
                    </li>
                  );
                })}
                {recentPages.length >= 5 && !showAllRecent && (
                  <li>
                    <button
                      onClick={() => setShowAllRecent(true)}
                      className="flex w-full items-center justify-center rounded-md px-2 py-1 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Show more...
                    </button>
                  </li>
                )}
                {showAllRecent && (
                  <li>
                    <button
                      onClick={() => setShowAllRecent(false)}
                      className="flex w-full items-center justify-center rounded-md px-2 py-1 text-xs transition-colors hover:bg-[--color-bg-tertiary]"
                      style={{ color: "var(--color-text-muted)" }}
                    >
                      Show less
                    </button>
                  </li>
                )}
              </ul>
            </AccordionHeader>
          )}

          {/* Favorites */}
          {showFavoritePages && hasFavorites && (
            <AccordionHeader
              ref={(el) => { sectionRefs.current.favorites = el; }}
              title="Favorites"
              expanded={expandedSections.has("favorites")}
              onToggle={() => toggleSection("favorites")}
            >
              <ul className="space-y-0.5 px-3 pb-2">
                {pinnedSections.map((pinned) => (
                  <li key={`section-${pinned.sectionId}`}>
                    <button
                      onClick={() => {
                        selectNotebook(pinned.notebookId);
                        selectSection(pinned.sectionId);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        removePinnedSection(pinned.sectionId);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                      style={{ color: "var(--color-text-secondary)" }}
                      title={`${pinned.sectionName} — ${pinned.notebookName} (right-click to unpin)`}
                    >
                      <span
                        className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: pinned.sectionColor || "var(--color-text-muted)" }}
                      />
                      <span className="flex-1 truncate">{pinned.sectionName}</span>
                      <span className="truncate text-[10px]" style={{ color: "var(--color-text-muted)", maxWidth: "80px" }}>
                        {pinned.notebookName}
                      </span>
                    </button>
                  </li>
                ))}
                {allFavoritePages.map((fav) => (
                  <li key={fav.id}>
                    <button
                      onClick={() => {
                        selectNotebook(fav.notebookId);
                        selectPage(fav.id);
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-[--color-bg-tertiary]"
                      style={{ color: "var(--color-text-secondary)" }}
                      title={`${fav.title} — ${fav.notebookName}`}
                    >
                      <IconStarFilled />
                      <span className="flex-1 truncate">{fav.title}</span>
                      <span className="truncate text-[10px]" style={{ color: "var(--color-text-muted)", maxWidth: "80px" }}>
                        {fav.notebookName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </AccordionHeader>
          )}

          {/* Notebooks */}
          <AccordionHeader
            ref={(el) => { sectionRefs.current.notebooks = el; }}
            title="Notebooks"
            expanded={expandedSections.has("notebooks")}
            onToggle={() => toggleSection("notebooks")}
          >
            <div className="px-3 pb-2">
              <NotebookList
                notebooks={visibleNotebooks}
                selectedNotebookId={selectedNotebookId}
              />
            </div>
          </AccordionHeader>

          {/* Sections */}
          {selectedNotebook?.sectionsEnabled && (
            <AccordionHeader
              ref={(el) => { sectionRefs.current.sections = el; }}
              title="Sections"
              expanded={expandedSections.has("sections")}
              onToggle={() => toggleSection("sections")}
            >
              <div className="pb-2">
                <SectionList
                  sections={sections}
                  selectedSectionId={selectedSectionId}
                  onSelectSection={selectSection}
                  onCreateSection={(name, color) => createSection(selectedNotebook.id, name, color)}
                  onUpdateSection={(sectionId, updates) => updateSection(selectedNotebook.id, sectionId, updates)}
                  onDeleteSection={(sectionId, moveItemsTo) => deleteSection(selectedNotebook.id, sectionId, moveItemsTo)}
                  onReorderSections={(sectionIds) => reorderSections(selectedNotebook.id, sectionIds)}
                  unassignedPagesCount={unassignedPagesCount}
                  notebookId={selectedNotebook.id}
                  notebookName={selectedNotebook.name}
                />
              </div>
            </AccordionHeader>
          )}

          {/* Pages (Folder Tree) */}
          {selectedNotebook && (
            <AccordionHeader
              ref={(el) => { sectionRefs.current.pages = el; }}
              title="Pages"
              expanded={expandedSections.has("pages")}
              onToggle={() => toggleSection("pages")}
            >
              <div className="pb-2">
                <FolderTree
                  notebookId={selectedNotebook.id}
                  notebook={selectedNotebook}
                  pages={notebookPages}
                  folders={folders}
                  selectedPageId={selectedPageId}
                  onSelectPage={handleSelectPage}
                  onOpenInTab={handleOpenInTab}
                  onOpenInNewPane={openPageInNewPane}
                  sectionsEnabled={selectedNotebook.sectionsEnabled}
                  selectedSectionId={selectedSectionId}
                  sections={sections}
                  onMovePageToSection={(pageId, sectionId) => movePageToSection(selectedNotebook.id, pageId, sectionId)}
                  onMoveFolderToSection={async (folderId, sectionId) => {
                    await updateFolder(selectedNotebook.id, folderId, { sectionId });
                    await loadPages(selectedNotebook.id, showArchived);
                  }}
                  onReorderPages={(folderId, pageIds) => reorderPages(selectedNotebook.id, folderId, pageIds)}
                  onMoveToNotebook={(pageId, pageTitle) => {
                    setMovePageTarget({ pageId, pageTitle });
                    setMovePageDialogOpen(true);
                  }}
                  onSmartOrganize={(pageId, pageTitle) => {
                    setSmartOrganizePageContext({ pageId, pageTitle });
                    setSmartOrganizeOpen(true);
                  }}
                  onMoveFolderToNotebook={(folderId, folderName) => {
                    setMoveFolderTarget({ folderId, folderName });
                    setMoveFolderDialogOpen(true);
                  }}
                />
              </div>
            </AccordionHeader>
          )}
        </div>
      </div>

      <ResizeHandle direction="horizontal" onResize={handlePanelResize} />

      {/* Dialogs */}
      {selectedNotebook && movePageTarget && (
        <MovePageDialog
          isOpen={movePageDialogOpen}
          onClose={() => { setMovePageDialogOpen(false); setMovePageTarget(null); }}
          pageId={movePageTarget.pageId}
          pageTitle={movePageTarget.pageTitle}
          currentNotebookId={selectedNotebook.id}
          onMoved={() => { loadPages(selectedNotebook.id, showArchived); }}
        />
      )}

      {selectedNotebook && moveFolderTarget && (
        <MoveFolderDialog
          isOpen={moveFolderDialogOpen}
          onClose={() => { setMoveFolderDialogOpen(false); setMoveFolderTarget(null); }}
          folderId={moveFolderTarget.folderId}
          folderName={moveFolderTarget.folderName}
          currentNotebookId={selectedNotebook.id}
          onMoved={() => {
            loadPages(selectedNotebook.id, showArchived);
            loadFolders(selectedNotebook.id);
          }}
        />
      )}

      {selectedNotebook && (
        <SmartOrganizeDialog
          isOpen={smartOrganizeOpen}
          onClose={() => { setSmartOrganizeOpen(false); setSmartOrganizePageContext(null); }}
          currentNotebookId={selectedNotebook.id}
          currentPageId={smartOrganizePageContext?.pageId}
          currentPageTitle={smartOrganizePageContext?.pageTitle}
          currentSectionId={selectedSectionId}
          currentSectionName={sections.find((s) => s.id === selectedSectionId)?.name}
          sectionsEnabled={selectedNotebook.sectionsEnabled}
          allPageIds={notebookPages.filter((p) => !p.isArchived && !p.deletedAt).map((p) => p.id)}
          sectionPageIds={
            selectedSectionId
              ? notebookPages
                  .filter((p) => p.sectionId === selectedSectionId && !p.isArchived && !p.deletedAt)
                  .map((p) => p.id)
              : undefined
          }
          onCompleted={() => { loadPages(selectedNotebook.id, showArchived); }}
        />
      )}
    </>
  );
}

// --- Accordion Header ---

import { forwardRef } from "react";

const AccordionHeader = forwardRef<
  HTMLDivElement,
  {
    title: string;
    expanded: boolean;
    onToggle: () => void;
    extra?: React.ReactNode;
    children: React.ReactNode;
  }
>(function AccordionHeader({ title, expanded, onToggle, extra, children }, ref) {
  return (
    <div ref={ref}>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2"
      >
        <span
          className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--color-text-muted)" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
            }}
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          {title}
        </span>
        {extra && <div className="flex items-center gap-1">{extra}</div>}
      </button>
      {expanded && children}
    </div>
  );
});

// --- Icons ---

function IconPage() {
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
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14,2 14,8 20,8" />
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
      style={{ color: "var(--color-accent)" }}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
