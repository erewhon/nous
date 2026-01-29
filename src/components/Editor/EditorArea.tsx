import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useFolderStore } from "../../stores/folderStore";
import { useSectionStore } from "../../stores/sectionStore";
import { useLinkStore } from "../../stores/linkStore";
import { usePDFStore } from "../../stores/pdfStore";
import { useVideoStore } from "../../stores/videoStore";
import { useDrawingStore } from "../../stores/drawingStore";
import { useThemeStore } from "../../stores/themeStore";
import { FolderTree } from "./FolderTree";
import { EditorPaneContent } from "./EditorPaneContent";
import { PDFFullScreen } from "../PDF";
import { CoverPage } from "../CoverPage";
import { SectionList } from "../Sections";
import { VideoFullScreen } from "../Video";
import { DrawingFullScreen, PageAnnotationOverlay } from "../Drawing";
import { ResizeHandle } from "../Layout/ResizeHandle";
import { MovePageDialog } from "../Move/MovePageDialog";
import type { EditorData, Page } from "../../types/page";
import * as api from "../../utils/api";
import { downloadTranscript } from "../../utils/videoApi";
import "./editor-styles.css";

export function EditorArea() {
  const { selectedNotebookId, notebooks } = useNotebookStore();
  const {
    pages,
    selectedPageId,
    selectPage,
    openPageInNewPane,
    openTabInPane,
    closeAllTabsInPane,
    updatePageContent,
    loadPages,
    createPage,
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
    reorderSections,
  } = useSectionStore();
  const { buildLinksFromPages } = useLinkStore();
  const { viewerState, closeViewer } = usePDFStore();
  const { viewerState: videoViewerState } = useVideoStore();
  const { annotationState } = useDrawingStore();
  const panelWidths = useThemeStore((state) => state.panelWidths);
  const setPanelWidth = useThemeStore((state) => state.setPanelWidth);
  const autoHidePanels = useThemeStore((state) => state.autoHidePanels);
  const panelsHovered = useThemeStore((state) => state.panelsHovered);
  const setPanelsHovered = useThemeStore((state) => state.setPanelsHovered);
  const zenMode = useThemeStore((state) => state.zenMode);

  // Auto-hide panel state
  const [panelsTransitioning, setPanelsTransitioning] = useState(false);
  const hideTimeoutRef = useRef<number | null>(null);

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

  // Auto-hide hover handlers for inner panels (unified with sidebar)
  const handlePanelsMouseEnter = useCallback(() => {
    if (!autoHidePanels) return;
    if (hideTimeoutRef.current) {
      window.clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, [autoHidePanels]);

  const handlePanelsMouseLeave = useCallback(() => {
    if (!autoHidePanels) return;
    hideTimeoutRef.current = window.setTimeout(() => {
      setPanelsHovered(false);
      setPanelsTransitioning(true);
    }, 300);
  }, [autoHidePanels, setPanelsHovered]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  // Cover page state
  const [coverPage, setCoverPage] = useState<Page | null>(null);
  const [showCover, setShowCover] = useState(false);

  // Move page dialog state
  const [movePageDialogOpen, setMovePageDialogOpen] = useState(false);
  const [movePageTarget, setMovePageTarget] = useState<{ pageId: string; pageTitle: string } | null>(null);

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

  // Track previous section ID to detect actual section changes
  const prevSectionIdRef = useRef(selectedSectionId);

  // Clear non-pinned tabs when switching sections
  useEffect(() => {
    if (prevSectionIdRef.current !== selectedSectionId) {
      // Clear tabs in all panes when section changes
      panes.forEach((pane) => {
        closeAllTabsInPane(pane.id);
      });
      prevSectionIdRef.current = selectedSectionId;
    }
  }, [selectedSectionId, closeAllTabsInPane, panes]);

  // Memoize filtered pages to prevent infinite re-renders
  const notebookPages = useMemo(
    () => pages.filter((p) => p.notebookId === selectedNotebookId),
    [pages, selectedNotebookId]
  );

  // Count pages without a section assigned (for hiding "All" in section list)
  const unassignedPagesCount = useMemo(
    () => notebookPages.filter((p) => !p.sectionId && !p.isArchived).length,
    [notebookPages]
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
        // Tab replacement is handled in EditorPaneContent
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


  // Handle cover page save (auto-save, no git commit)
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

  // Handle extracting PDF highlights to a new page
  const handleExtractHighlights = useCallback(async () => {
    if (!selectedNotebookId || !viewerState.pdfData) return;

    const pdfData = viewerState.pdfData;
    const highlights = pdfData.highlights;

    if (highlights.length === 0) return;

    // Create page title
    const title = `Highlights: ${pdfData.originalName || "PDF"}`;

    // Create page with highlights as quote blocks
    const newPage = await createPage(selectedNotebookId, title);

    // Build content blocks
    const blocks: Array<{ id: string; type: string; data: Record<string, unknown> }> = [
      {
        id: crypto.randomUUID(),
        type: "header",
        data: { text: title, level: 2 },
      },
      {
        id: crypto.randomUUID(),
        type: "paragraph",
        data: { text: `Extracted from: ${pdfData.originalName || "PDF document"}` },
      },
    ];

    // Group highlights by page
    const byPage = highlights.reduce(
      (acc, h) => {
        (acc[h.pageNumber] ||= []).push(h);
        return acc;
      },
      {} as Record<number, typeof highlights>
    );

    // Add highlights grouped by page
    for (const [pageNum, pageHighlights] of Object.entries(byPage).sort(
      ([a], [b]) => Number(a) - Number(b)
    )) {
      blocks.push({
        id: crypto.randomUUID(),
        type: "header",
        data: { text: `Page ${pageNum}`, level: 3 },
      });

      for (const highlight of pageHighlights) {
        blocks.push({
          id: crypto.randomUUID(),
          type: "quote",
          data: {
            text: highlight.selectedText,
            caption: highlight.note || "",
          },
        });
      }
    }

    if (!newPage) return;

    // Update the new page with content
    const contentData: EditorData = {
      time: Date.now(),
      version: "2.28.2",
      blocks,
    };

    await updatePageContent(selectedNotebookId, newPage.id, contentData);

    // Close the PDF viewer and select the new page
    closeViewer();
    selectPage(newPage.id);
  }, [selectedNotebookId, viewerState.pdfData, createPage, updatePageContent, closeViewer, selectPage]);

  // Handle video transcript export
  const handleExportVideoTranscript = useCallback(
    (format: "txt" | "srt" | "vtt") => {
      if (!videoViewerState.videoData?.transcription) return;

      downloadTranscript(
        videoViewerState.videoData.transcription,
        format,
        `${videoViewerState.videoData.originalName || "video"}_transcript`
      );
    },
    [videoViewerState.videoData]
  );

  if (!selectedNotebook) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        <div className="text-center max-w-md px-8">
          <div
            className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl shadow-lg"
            style={{
              background: "linear-gradient(to bottom right, var(--color-accent), var(--color-accent-tertiary))",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
          </div>
          <h2
            className="mb-3 text-2xl font-bold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Welcome to Nous
          </h2>
          <p
            className="leading-relaxed"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Your personal notebook for capturing ideas, organizing thoughts, and building knowledge.
          </p>
          <p
            className="mt-4 text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            Select a notebook from the sidebar or create a new one to get started.
          </p>
        </div>
      </div>
    );
  }

  // Show cover page if enabled
  if (showCover && coverPage) {
    return (
      <CoverPage
        page={coverPage}
        notebook={selectedNotebook}
        onSave={handleCoverSave}
        onEnterNotebook={handleEnterNotebook}
        pages={notebookPages.map((p) => ({ id: p.id, title: p.title }))}
      />
    );
  }

  return (
    <div className="flex h-full">
      {/* Sections panel - shown when sections are enabled, hidden in zen mode */}
      {selectedNotebook.sectionsEnabled && !zenMode && (
        <>
          <div
            className="flex-shrink-0 border-r overflow-hidden"
            style={{
              width: autoHidePanels && !panelsHovered ? 0 : `${panelWidths.sections}px`,
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
              transition: autoHidePanels ? "width 0.2s ease-in-out" : "none",
            }}
            onMouseEnter={handlePanelsMouseEnter}
            onMouseLeave={handlePanelsMouseLeave}
            onTransitionEnd={() => setPanelsTransitioning(false)}
          >
            {((!autoHidePanels || panelsHovered) || panelsTransitioning) && (
              <div style={{ width: `${panelWidths.sections}px` }}>
                <SectionList
                  sections={sections}
                  selectedSectionId={selectedSectionId}
                  onSelectSection={selectSection}
                  onCreateSection={(name, color) => createSection(selectedNotebook.id, name, color)}
                  onUpdateSection={(sectionId, updates) => updateSection(selectedNotebook.id, sectionId, updates)}
                  onDeleteSection={(sectionId, moveItemsTo) => deleteSection(selectedNotebook.id, sectionId, moveItemsTo)}
                  onReorderSections={(sectionIds) => reorderSections(selectedNotebook.id, sectionIds)}
                  unassignedPagesCount={unassignedPagesCount}
                />
              </div>
            )}
          </div>
          {!autoHidePanels && (
            <ResizeHandle direction="horizontal" onResize={handleSectionsResize} />
          )}
        </>
      )}

      {/* Page list panel with folder tree - hidden in zen mode */}
      {!zenMode && (
        <>
          <div
            className="flex-shrink-0 border-r overflow-hidden"
            style={{
              width: autoHidePanels && !panelsHovered ? 0 : `${panelWidths.folderTree}px`,
              backgroundColor: "var(--color-bg-secondary)",
              borderColor: "var(--color-border)",
              transition: autoHidePanels ? "width 0.2s ease-in-out" : "none",
            }}
            onMouseEnter={handlePanelsMouseEnter}
            onMouseLeave={handlePanelsMouseLeave}
            onTransitionEnd={() => setPanelsTransitioning(false)}
          >
            {((!autoHidePanels || panelsHovered) || panelsTransitioning) && (
              <div style={{ width: `${panelWidths.folderTree}px` }}>
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
                    // Reload pages since folder section change also updates page sections
                    await loadPages(selectedNotebook.id, showArchived);
                  }}
                  hasCoverPage={coverPage !== null}
                  onViewCover={() => setShowCover(true)}
                  onReorderPages={(folderId, pageIds) => reorderPages(selectedNotebook.id, folderId, pageIds)}
                  onMoveToNotebook={(pageId, pageTitle) => {
                    setMovePageTarget({ pageId, pageTitle });
                    setMovePageDialogOpen(true);
                  }}
                />
              </div>
            )}
          </div>
          {!autoHidePanels && (
            <ResizeHandle direction="horizontal" onResize={handleFolderTreeResize} />
          )}
        </>
      )}

      {/* Editor panel - multi-pane support (only active pane shown in zen mode) */}
      <div
        className="flex flex-1 overflow-hidden"
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        {(zenMode ? panes.filter(pane => pane.id === activePaneId) : panes).map((pane) => (
          <EditorPaneContent
            key={pane.id}
            pane={pane}
            notebookId={selectedNotebook.id}
            notebookPages={notebookPages}
            isActive={pane.id === activePaneId}
            onActivate={() => setActivePane(pane.id)}
            onClose={() => closePane(pane.id)}
            onSplit={() => splitPane(pane.id, "horizontal")}
            canClose={panes.length > 1 && !zenMode}
            showPaneControls={panes.length > 1 && !zenMode}
            zenMode={zenMode}
          />
        ))}
      </div>

      {/* PDF Full Screen Viewer */}
      <PDFFullScreen onExtractHighlights={handleExtractHighlights} />

      {/* Video Full Screen Viewer */}
      <VideoFullScreen onExportTranscript={handleExportVideoTranscript} />

      {/* Drawing Full Screen Viewer */}
      <DrawingFullScreen />

      {/* Page Annotation Overlay */}
      {annotationState.isActive && annotationState.pageId && annotationState.notebookId && (
        <PageAnnotationOverlay
          pageId={annotationState.pageId}
          notebookId={annotationState.notebookId}
        />
      )}

      {/* Move Page Dialog */}
      {selectedNotebook && movePageTarget && (
        <MovePageDialog
          isOpen={movePageDialogOpen}
          onClose={() => {
            setMovePageDialogOpen(false);
            setMovePageTarget(null);
          }}
          pageId={movePageTarget.pageId}
          pageTitle={movePageTarget.pageTitle}
          currentNotebookId={selectedNotebook.id}
          onMoved={() => {
            // Reload pages after moving
            loadPages(selectedNotebook.id, showArchived);
          }}
        />
      )}
    </div>
  );
}
