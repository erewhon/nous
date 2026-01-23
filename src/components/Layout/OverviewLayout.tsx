import { useMemo, useCallback, useState, useEffect } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useFolderStore } from "../../stores/folderStore";
import { useSectionStore } from "../../stores/sectionStore";
import { useLinkStore } from "../../stores/linkStore";
import { useThemeStore } from "../../stores/themeStore";
import { NotebookOverview, NotebookDropdown } from "../NotebookOverview";
import { FolderTree } from "../Editor/FolderTree";
import { EditorPaneContent } from "../Editor/EditorPaneContent";
import { CoverPage } from "../CoverPage";
import { SectionList } from "../Sections";
import { ResizeHandle } from "./ResizeHandle";
import type { EditorData, Page } from "../../types/page";
import * as api from "../../utils/api";

export function OverviewLayout() {
  const { notebooks, selectedNotebookId, selectNotebook, createNotebook } = useNotebookStore();
  const {
    pages,
    selectedPageId,
    selectPage,
    openPageInNewPane,
    openTabInPane,
    updatePageContent,
    loadPages,
    movePageToSection,
    reorderPages,
    panes,
    activePaneId,
    setActivePane,
    closePane,
    splitPane,
  } = usePageStore();
  const { folders, loadFolders, showArchived, updateFolder } = useFolderStore();
  const {
    sections,
    selectedSectionId,
    selectSection,
    loadSections,
    clearSections,
    createSection,
    updateSection,
    deleteSection,
  } = useSectionStore();
  const { buildLinksFromPages } = useLinkStore();
  const panelWidths = useThemeStore((state) => state.panelWidths);
  const setPanelWidth = useThemeStore((state) => state.setPanelWidth);

  // Panel resize handlers
  const handleSectionsResize = useCallback(
    (delta: number) => {
      setPanelWidth("sections", panelWidths.sections + delta);
    },
    [panelWidths.sections, setPanelWidth]
  );

  const handleFolderTreeResize = useCallback(
    (delta: number) => {
      setPanelWidth("folderTree", panelWidths.folderTree + delta);
    },
    [panelWidths.folderTree, setPanelWidth]
  );

  // Cover page state
  const [coverPage, setCoverPage] = useState<Page | null>(null);
  const [showCover, setShowCover] = useState(false);

  const selectedNotebook = notebooks.find((n) => n.id === selectedNotebookId);

  // Load pages, folders, and sections when notebook selection changes
  useEffect(() => {
    if (selectedNotebookId) {
      loadPages(selectedNotebookId, showArchived);
      loadFolders(selectedNotebookId);
      // Load sections if enabled for this notebook
      if (selectedNotebook?.sectionsEnabled) {
        loadSections(selectedNotebookId);
      } else {
        clearSections();
      }
    } else {
      clearSections();
    }
  }, [selectedNotebookId, selectedNotebook?.sectionsEnabled, loadPages, loadFolders, loadSections, clearSections, showArchived]);

  // Load cover page when notebook changes
  useEffect(() => {
    if (selectedNotebookId) {
      api.getCoverPage(selectedNotebookId).then((cover) => {
        setCoverPage(cover);
        // Show cover on notebook open if it exists
        if (cover) {
          setShowCover(true);
        }
      });
    } else {
      setCoverPage(null);
      setShowCover(false);
    }
  }, [selectedNotebookId]);

  // Memoize filtered pages to prevent infinite re-renders
  const notebookPages = useMemo(
    () => pages.filter((p) => p.notebookId === selectedNotebookId),
    [pages, selectedNotebookId]
  );

  // Build links when pages change
  useEffect(() => {
    if (notebookPages.length > 0) {
      buildLinksFromPages(notebookPages);
    }
  }, [notebookPages, buildLinksFromPages]);

  // Handle page selection with optional new pane
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

  // Handle opening a page in a new tab within the active pane
  const handleOpenInTab = useCallback(
    (pageId: string, pageTitle: string) => {
      const paneId = activePaneId || panes[0]?.id;
      if (paneId) {
        openTabInPane(paneId, pageId, pageTitle);
      }
    },
    [activePaneId, panes, openTabInPane]
  );

  // Handle cover page save
  const handleCoverSave = useCallback(
    async (data: OutputData) => {
      if (!selectedNotebookId || !coverPage) return;

      const editorData: EditorData = {
        time: data.time,
        version: data.version,
        blocks: data.blocks.map((block) => ({
          id: block.id ?? crypto.randomUUID(),
          type: block.type,
          data: block.data as Record<string, unknown>,
        })),
      };

      await updatePageContent(selectedNotebookId, coverPage.id, editorData, false);
      setCoverPage((prev) => (prev ? { ...prev, content: editorData } : null));
    },
    [selectedNotebookId, coverPage, updatePageContent]
  );

  // Handle entering notebook from cover page
  const handleEnterNotebook = useCallback(() => {
    setShowCover(false);
  }, []);

  // Handle going back to overview
  const handleGoToOverview = useCallback(() => {
    selectNotebook(null);
  }, [selectNotebook]);

  // Handle creating a new notebook
  const handleCreateNotebook = useCallback(() => {
    createNotebook("New Notebook");
  }, [createNotebook]);

  // Show notebook overview if no notebook is selected
  if (!selectedNotebook) {
    return (
      <NotebookOverview
        notebooks={notebooks}
        onSelectNotebook={selectNotebook}
        onCreateNotebook={handleCreateNotebook}
      />
    );
  }

  // Show cover page if enabled
  if (showCover && coverPage) {
    return (
      <div className="flex h-full flex-col">
        {/* Header with back button */}
        <div
          className="flex items-center gap-4 border-b px-4 py-2"
          style={{
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <button
            onClick={handleGoToOverview}
            className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-secondary)" }}
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
              <polyline points="15 18 9 12 15 6" />
            </svg>
            All Notebooks
          </button>
        </div>
        <div className="flex-1">
          <CoverPage
            page={coverPage}
            notebook={selectedNotebook}
            onSave={handleCoverSave}
            onEnterNotebook={handleEnterNotebook}
            pages={notebookPages.map((p) => ({ id: p.id, title: p.title }))}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top header bar with notebook dropdown */}
      <header
        className="flex items-center justify-between border-b px-4 py-2"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <NotebookDropdown
          notebooks={notebooks}
          selectedNotebook={selectedNotebook}
          onSelectNotebook={selectNotebook}
          onGoToOverview={handleGoToOverview}
        />

        {/* Tool buttons */}
        <div className="flex items-center gap-1">
          {/* Search */}
          <button
            onClick={() => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "k",
                  metaKey: true,
                  bubbles: true,
                })
              );
            }}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Search (Cmd+K)"
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
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>

          {/* Settings */}
          <button
            onClick={() => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: ",",
                  metaKey: true,
                  bubbles: true,
                })
              );
            }}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[--color-bg-tertiary]"
            style={{ color: "var(--color-text-muted)" }}
            title="Settings (Cmd+,)"
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
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sections panel - shown when sections are enabled */}
        {selectedNotebook.sectionsEnabled && (
          <>
            <div
              className="flex-shrink-0 border-r"
              style={{
                width: `${panelWidths.sections}px`,
                backgroundColor: "var(--color-bg-secondary)",
                borderColor: "var(--color-border)",
              }}
            >
              <SectionList
                sections={sections}
                selectedSectionId={selectedSectionId}
                onSelectSection={selectSection}
                onCreateSection={(name, color) => createSection(selectedNotebook.id, name, color)}
                onUpdateSection={(sectionId, updates) => updateSection(selectedNotebook.id, sectionId, updates)}
                onDeleteSection={(sectionId, moveItemsTo) => deleteSection(selectedNotebook.id, sectionId, moveItemsTo)}
              />
            </div>
            <ResizeHandle direction="horizontal" onResize={handleSectionsResize} />
          </>
        )}

        {/* Page list panel with folder tree */}
        <div
          className="flex-shrink-0 border-r"
          style={{
            width: `${panelWidths.folderTree}px`,
            backgroundColor: "var(--color-bg-secondary)",
            borderColor: "var(--color-border)",
          }}
        >
          <FolderTree
            notebookId={selectedNotebook.id}
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
            hasCoverPage={coverPage !== null}
            onViewCover={() => setShowCover(true)}
            onReorderPages={(folderId, pageIds) => reorderPages(selectedNotebook.id, folderId, pageIds)}
          />
        </div>
        <ResizeHandle direction="horizontal" onResize={handleFolderTreeResize} />

        {/* Editor panel - multi-pane support */}
        <div
          className="flex flex-1 overflow-hidden"
          style={{ backgroundColor: "var(--color-bg-primary)" }}
        >
          {panes.map((pane) => (
            <EditorPaneContent
              key={pane.id}
              pane={pane}
              notebookId={selectedNotebook.id}
              notebookPages={notebookPages}
              isActive={pane.id === activePaneId}
              onActivate={() => setActivePane(pane.id)}
              onClose={() => closePane(pane.id)}
              onSplit={() => splitPane(pane.id, "horizontal")}
              canClose={panes.length > 1}
              showPaneControls={panes.length > 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
