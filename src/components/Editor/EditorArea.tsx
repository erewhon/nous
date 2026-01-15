import { useMemo, useCallback, useState, useEffect } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { useNotebookStore } from "../../stores/notebookStore";
import { usePageStore } from "../../stores/pageStore";
import { useFolderStore } from "../../stores/folderStore";
import { useSectionStore } from "../../stores/sectionStore";
import { useLinkStore } from "../../stores/linkStore";
import { usePDFStore } from "../../stores/pdfStore";
import { useVideoStore } from "../../stores/videoStore";
import { useDrawingStore } from "../../stores/drawingStore";
import { FolderTree } from "./FolderTree";
import { BlockEditor } from "./BlockEditor";
import { PageHeader } from "./PageHeader";
import { BacklinksPanel } from "./BacklinksPanel";
import { SimilarPagesPanel } from "./SimilarPagesPanel";
import { CoverPage } from "../CoverPage";
import { SectionList } from "../Sections";
import { PDFFullScreen } from "../PDF";
import { VideoFullScreen } from "../Video";
import { DrawingFullScreen, PageAnnotationOverlay } from "../Drawing";
import type { EditorData, Page } from "../../types/page";
import * as api from "../../utils/api";
import { calculatePageStats, type PageStats } from "../../utils/pageStats";
import { downloadTranscript } from "../../utils/videoApi";
import "./editor-styles.css";

export function EditorArea() {
  const { selectedNotebookId, notebooks } = useNotebookStore();
  const { pages, selectedPageId, selectPage, updatePageContent, loadPages, createPage, movePageToSection } =
    usePageStore();
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
  const { updatePageLinks, buildLinksFromPages } = useLinkStore();
  const { viewerState, closeViewer } = usePDFStore();
  const { viewerState: videoViewerState } = useVideoStore();
  const { annotationState } = useDrawingStore();
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

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
  const selectedPage = pages.find((p) => p.id === selectedPageId);

  // Build links when pages change
  useEffect(() => {
    if (notebookPages.length > 0) {
      buildLinksFromPages(notebookPages);
    }
  }, [notebookPages, buildLinksFromPages]);

  // Convert page content to Editor.js format
  const editorData: OutputData | undefined = useMemo(() => {
    if (!selectedPage?.content) return undefined;
    return {
      time: selectedPage.content.time,
      version: selectedPage.content.version,
      blocks: selectedPage.content.blocks.map((block) => ({
        id: block.id,
        type: block.type,
        data: block.data as Record<string, unknown>,
      })),
    };
  }, [selectedPage?.id, selectedPage?.content]);

  // Calculate page statistics
  const pageStats: PageStats | null = useMemo(() => {
    if (!selectedPage?.content?.blocks?.length) return null;
    return calculatePageStats(selectedPage.content.blocks);
  }, [selectedPage?.content?.blocks]);

  // Handle save
  const handleSave = useCallback(
    async (data: OutputData) => {
      if (!selectedNotebookId || !selectedPageId || !selectedPage) return;

      setIsSaving(true);
      try {
        const editorData: EditorData = {
          time: data.time,
          version: data.version,
          blocks: data.blocks.map((block) => ({
            id: block.id ?? crypto.randomUUID(),
            type: block.type,
            data: block.data as Record<string, unknown>,
          })),
        };

        await updatePageContent(selectedNotebookId, selectedPageId, editorData);

        // Update links after save
        updatePageLinks({
          ...selectedPage,
          content: editorData,
        });

        setLastSaved(new Date());
      } finally {
        setIsSaving(false);
      }
    },
    [
      selectedNotebookId,
      selectedPageId,
      selectedPage,
      updatePageContent,
      updatePageLinks,
    ]
  );

  // Handle wiki link clicks - navigate to page by title, or create if doesn't exist
  const handleLinkClick = useCallback(
    async (pageTitle: string) => {
      let targetPage = notebookPages.find(
        (p) => p.title.toLowerCase() === pageTitle.toLowerCase()
      );

      if (targetPage) {
        selectPage(targetPage.id);
        return;
      }

      // Page doesn't exist - create it
      if (selectedNotebookId) {
        await createPage(selectedNotebookId, pageTitle);
        // After creation, the new page should be selected automatically by createPage
        // and pages will be updated, so we need to find and select it
        // The createPage action sets selectedPageId to the new page
      }
    },
    [notebookPages, selectPage, selectedNotebookId, createPage]
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

      await updatePageContent(selectedNotebookId, coverPage.id, editorData);
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
            Welcome to Katt
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
      {/* Sections panel - shown when sections are enabled */}
      {selectedNotebook.sectionsEnabled && (
        <div
          className="w-48 flex-shrink-0 border-r"
          style={{
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
      )}

      {/* Page list panel with folder tree */}
      <div
        className="w-64 flex-shrink-0 border-r"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          borderColor: "var(--color-border)",
        }}
      >
        <FolderTree
          notebookId={selectedNotebook.id}
          pages={notebookPages}
          folders={folders}
          selectedPageId={selectedPageId}
          onSelectPage={selectPage}
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
        />
      </div>

      {/* Editor panel */}
      <div
        className="flex flex-1 flex-col overflow-hidden"
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        {selectedPage ? (
          <>
            <PageHeader
              page={selectedPage}
              isSaving={isSaving}
              lastSaved={lastSaved}
              stats={pageStats}
              pageText={pageStats?.text}
            />
            <div className="flex-1 overflow-y-auto px-16 py-10">
              <div
                className="mx-auto"
                style={{ maxWidth: "var(--editor-max-width)" }}
              >
                <BlockEditor
                  key={selectedPage.id}
                  initialData={editorData}
                  onSave={handleSave}
                  onLinkClick={handleLinkClick}
                  notebookId={selectedNotebook.id}
                  pages={notebookPages.map((p) => ({ id: p.id, title: p.title }))}
                  className="min-h-[calc(100vh-300px)]"
                />

                {/* Backlinks panel */}
                <BacklinksPanel
                  pageTitle={selectedPage.title}
                  notebookId={selectedNotebook.id}
                />

                {/* Similar Pages panel (AI-powered) */}
                <SimilarPagesPanel
                  page={selectedPage}
                  notebookId={selectedNotebook.id}
                  allPages={notebookPages}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center max-w-sm px-8">
              <div
                className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-xl"
                style={{ backgroundColor: "var(--color-bg-tertiary)" }}
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
                  style={{ color: "var(--color-text-muted)" }}
                >
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14,2 14,8 20,8" />
                </svg>
              </div>
              <p style={{ color: "var(--color-text-secondary)" }}>
                Select a page from the sidebar or create a new one
              </p>
            </div>
          </div>
        )}
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
    </div>
  );
}
