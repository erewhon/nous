import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { usePageStore, type EditorPane } from "../../stores/pageStore";
import { useLinkStore } from "../../stores/linkStore";
import { useThemeStore } from "../../stores/themeStore";
import { useUndoHistoryStore } from "../../stores/undoHistoryStore";
import { useTypewriterScroll } from "../../hooks/useTypewriterScroll";
import { useUndoHistory } from "../../hooks/useUndoHistory";
import { BlockEditor, type BlockEditorRef } from "./BlockEditor";
import { PageHeader } from "./PageHeader";
import { PaneTabBar } from "./PaneTabBar";
import { UndoHistoryPanel } from "./UndoHistoryPanel";
import { MarkdownEditor } from "../Markdown";
import { PDFPageViewer } from "../PDF";
import { JupyterViewer } from "../Jupyter";
import { EpubReader } from "../Epub";
import { CalendarViewer } from "../Calendar";
import { ChatEditor } from "../Chat";
import { CanvasEditor } from "../Canvas";
import { BacklinksPanel } from "./BacklinksPanel";
import { SimilarPagesPanel } from "./SimilarPagesPanel";
import type { EditorData, Page } from "../../types/page";
import { calculatePageStats, type PageStats } from "../../utils/pageStats";

interface EditorPaneContentProps {
  pane: EditorPane;
  notebookId: string;
  notebookPages: Page[];
  isActive: boolean;
  onActivate: () => void;
  onClose?: () => void;
  onSplit?: () => void;
  canClose: boolean;
  showPaneControls: boolean;
  zenMode?: boolean;
}

export function EditorPaneContent({
  pane,
  notebookId,
  notebookPages,
  isActive,
  onActivate,
  onClose,
  onSplit,
  canClose,
  showPaneControls,
  zenMode = false,
}: EditorPaneContentProps) {
  const {
    pages,
    updatePageContent,
    setPageContentLocal,
    createPage,
    pageDataVersion,
    openTabInPane,
    closeTabInPane,
    updateTabTitleInPane,
  } = usePageStore();
  const { updatePageLinks } = useLinkStore();
  const setZenMode = useThemeStore((state) => state.setZenMode);
  const zenModeSettings = useThemeStore((state) => state.zenModeSettings);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const editorScrollRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<BlockEditorRef>(null);

  const selectedPage = pages.find((p) => p.id === pane.pageId);
  const isStandardPage =
    selectedPage?.pageType === "standard" || !selectedPage?.pageType;
  const history = useUndoHistoryStore((state) =>
    state.getHistory(pane.pageId || "")
  );

  // Callback when undo/redo changes state - render new data in editor
  const handleUndoRedoStateChange = useCallback((data: OutputData) => {
    if (editorRef.current) {
      editorRef.current.render(data);
    }
  }, []);

  // Undo history hook
  const {
    captureState,
    captureStateNow,
    undo,
    redo,
    jumpTo,
    canUndo,
    canRedo,
  } = useUndoHistory({
    pageId: pane.pageId || "",
    enabled: isStandardPage && !!pane.pageId,
    onStateChange: handleUndoRedoStateChange,
  });

  // Typewriter scrolling for zen mode
  useTypewriterScroll({
    enabled: zenMode && zenModeSettings.typewriterScrolling && isStandardPage,
    containerRef: editorScrollRef,
    offset: 0.4,
  });

  // Handle ESC key to exit zen mode
  useEffect(() => {
    if (!zenMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only exit zen mode if no modal/menu is open
      // Check for common modal elements
      const hasOpenModal =
        document.querySelector('[role="dialog"]') ||
        document.querySelector("[data-radix-portal]") ||
        document.querySelector(".command-palette-backdrop");

      if (e.key === "Escape" && !hasOpenModal) {
        e.preventDefault();
        setZenMode(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [zenMode, setZenMode]);

  // Ensure current page is in tabs - replace non-pinned tab for "one page at a time" behavior
  useEffect(() => {
    if (selectedPage && !pane.tabs.find((t) => t.pageId === selectedPage.id)) {
      // Close the current non-pinned tab before opening new one (single-page mode)
      const currentNonPinnedTab = pane.tabs.find((t) => !t.isPinned);
      if (currentNonPinnedTab) {
        closeTabInPane(pane.id, currentNonPinnedTab.pageId);
      }
      openTabInPane(pane.id, selectedPage.id, selectedPage.title);
    }
  }, [selectedPage, pane.id, pane.tabs, openTabInPane, closeTabInPane]);

  // Update tab title when page title changes
  useEffect(() => {
    if (selectedPage) {
      const tab = pane.tabs.find((t) => t.pageId === selectedPage.id);
      if (tab && tab.title !== selectedPage.title) {
        updateTabTitleInPane(pane.id, selectedPage.id, selectedPage.title);
      }
    }
  }, [
    selectedPage?.title,
    selectedPage?.id,
    pane.id,
    pane.tabs,
    updateTabTitleInPane,
  ]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPage?.id, pageDataVersion]);

  // Calculate page statistics
  const pageStats: PageStats | null = useMemo(() => {
    if (!selectedPage?.content?.blocks?.length) return null;
    return calculatePageStats(selectedPage.content.blocks);
  }, [selectedPage?.content?.blocks]);

  // Capture initial state when page loads (for undo history)
  useEffect(() => {
    if (editorData && isStandardPage && pane.pageId) {
      captureStateNow(editorData, "Initial state");
    }
    // Only run when page changes, not on every editorData update
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.pageId]);

  // NOTE: We removed the effect that called editorRef.current.render(editorData) here.
  // It was causing duplicate block rendering because useEditor already has an effect
  // that renders when initialData changes (which is derived from editorData/pageDataVersion).
  // Having both effects caused Editor.js to render blocks twice, creating duplicates.

  // Handle content change (for undo history capture)
  const handleChange = useCallback(
    (data: OutputData) => {
      // Capture state for undo history (debounced)
      captureState(data);
    },
    [captureState]
  );

  // Handle auto-save
  const handleSave = useCallback(
    async (data: OutputData) => {
      if (!notebookId || !pane.pageId || !selectedPage) return;

      // Deduplicate blocks by ID — assign new IDs to duplicates rather than
      // removing them, since imported markdown can produce blocks with the same ID
      const seenIds = new Set<string>();

      const editorData: EditorData = {
        time: data.time,
        version: data.version,
        blocks: data.blocks.map((block) => {
          let id = block.id ?? crypto.randomUUID();
          if (seenIds.has(id)) {
            id = crypto.randomUUID();
          }
          seenIds.add(id);
          return {
            id,
            type: block.type,
            data: block.data as Record<string, unknown>,
          };
        }),
      };

      // Update local store immediately (optimistic update)
      // This ensures the cache is fresh even if backend save hasn't completed
      // Critical for flush-on-unmount to avoid race conditions when navigating back
      setPageContentLocal(pane.pageId, editorData);

      await updatePageContent(notebookId, pane.pageId, editorData, false);

      requestAnimationFrame(() => {
        updatePageLinks({
          ...selectedPage,
          content: editorData,
        });
        setLastSaved(new Date());
      });
    },
    [
      notebookId,
      pane.pageId,
      selectedPage,
      updatePageContent,
      setPageContentLocal,
      updatePageLinks,
    ]
  );

  // Handle jump to history state
  const handleJumpToState = useCallback(
    (entryId: string) => {
      const data = jumpTo(entryId);
      if (data && notebookId && pane.pageId && selectedPage) {
        // Deduplicate blocks by ID — assign new IDs to duplicates
        const seenIds = new Set<string>();

        // Also save the jumped-to state
        const editorData: EditorData = {
          time: data.time,
          version: data.version,
          blocks: data.blocks.map((block) => {
            let id = block.id ?? crypto.randomUUID();
            if (seenIds.has(id)) {
              id = crypto.randomUUID();
            }
            seenIds.add(id);
            return {
              id,
              type: block.type,
              data: block.data as Record<string, unknown>,
            };
          }),
        };
        updatePageContent(notebookId, pane.pageId, editorData, false);
        updatePageLinks({
          ...selectedPage,
          content: editorData,
        });
      }
      setShowHistoryPanel(false);
    },
    [
      jumpTo,
      notebookId,
      pane.pageId,
      selectedPage,
      updatePageContent,
      updatePageLinks,
    ]
  );

  // Handle explicit save
  const handleExplicitSave = useCallback(
    async (data: OutputData) => {
      if (!notebookId || !pane.pageId || !selectedPage) return;

      setIsSaving(true);
      try {
        // Deduplicate blocks by ID — assign new IDs to duplicates
        const seenIds = new Set<string>();

        const editorData: EditorData = {
          time: data.time,
          version: data.version,
          blocks: data.blocks.map((block) => {
            let id = block.id ?? crypto.randomUUID();
            if (seenIds.has(id)) {
              id = crypto.randomUUID();
            }
            seenIds.add(id);
            return {
              id,
              type: block.type,
              data: block.data as Record<string, unknown>,
            };
          }),
        };

        // Update local store immediately (optimistic update)
        setPageContentLocal(pane.pageId, editorData);

        await updatePageContent(notebookId, pane.pageId, editorData, true);
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
      notebookId,
      pane.pageId,
      selectedPage,
      updatePageContent,
      setPageContentLocal,
      updatePageLinks,
    ]
  );

  // Handle block reference clicks — navigate to the target page and scroll to block
  const handleBlockRefClick = useCallback(
    (blockId: string, pageId: string) => {
      const scrollToBlock = () => {
        const el = document.querySelector(
          `[data-block-id="${CSS.escape(blockId)}"]`
        );
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("block-ref-highlight");
          setTimeout(() => el.classList.remove("block-ref-highlight"), 2000);
        }
      };

      const isCurrentPage = pane.pageId === pageId;
      if (isCurrentPage) {
        // Already on the target page — scroll immediately
        scrollToBlock();
      } else {
        // Navigate to the target page, then scroll after editor renders
        usePageStore.getState().openPageInPane(pane.id, pageId);
        setTimeout(scrollToBlock, 500);
      }
    },
    [pane.id, pane.pageId]
  );

  // Handle wiki link clicks
  const handleLinkClick = useCallback(
    async (pageTitle: string) => {
      // Find page by title
      const targetPage = notebookPages.find(
        (p) => p.title.toLowerCase() === pageTitle.toLowerCase()
      );

      if (targetPage) {
        // Open in this pane
        usePageStore.getState().openPageInPane(pane.id, targetPage.id);
      } else {
        // Create new page
        const newPage = await createPage(notebookId, pageTitle);
        if (newPage) {
          usePageStore.getState().openPageInPane(pane.id, newPage.id);
        }
      }
    },
    [notebookPages, notebookId, pane.id, createPage]
  );

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{
        backgroundColor: "var(--color-bg-primary)",
        borderLeft: isActive
          ? "2px solid var(--color-accent)"
          : "1px solid var(--color-border)",
      }}
      onClick={onActivate}
    >
      {/* Pane controls header */}
      {showPaneControls && (
        <div
          className="flex items-center justify-between px-2 py-1 border-b"
          style={{
            backgroundColor: isActive
              ? "var(--color-bg-secondary)"
              : "var(--color-bg-tertiary)",
            borderColor: "var(--color-border)",
          }}
        >
          <span
            className="text-xs truncate"
            style={{ color: "var(--color-text-muted)" }}
          >
            {selectedPage?.title || "No page selected"}
          </span>
          <div className="flex items-center gap-1">
            {/* Split button */}
            {onSplit && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSplit();
                }}
                className="p-1 rounded hover:bg-[--color-bg-elevated] transition-colors"
                style={{ color: "var(--color-text-muted)" }}
                title="Split pane"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="12" y1="3" x2="12" y2="21" />
                </svg>
              </button>
            )}
            {/* Close button */}
            {canClose && onClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="p-1 rounded hover:bg-[--color-bg-elevated] transition-colors"
                style={{ color: "var(--color-text-muted)" }}
                title="Close pane"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tab bar for this pane - hidden in zen mode */}
      {!zenMode && (
        <PaneTabBar
          paneId={pane.id}
          tabs={pane.tabs}
          activePageId={pane.pageId}
        />
      )}

      {selectedPage ? (
        <>
          {selectedPage.pageType === "canvas" ? (
            /* Canvas gets full-bleed layout without scroll constraints */
            <CanvasEditor
              key={selectedPage.id}
              page={selectedPage}
              notebookId={notebookId}
              className="flex-1"
              onNavigateToPage={(pageId) => {
                usePageStore.getState().openPageInPane(pane.id, pageId);
              }}
            />
          ) : (
            <>
              <div className="relative">
                <PageHeader
                  page={selectedPage}
                  isSaving={isSaving}
                  lastSaved={lastSaved}
                  stats={zenMode ? null : pageStats}
                  pageText={pageStats?.text}
                  zenMode={zenMode}
                  onExitZenMode={() => setZenMode(false)}
                  onEnterZenMode={() => setZenMode(true)}
                  onToggleHistory={
                    isStandardPage
                      ? () => setShowHistoryPanel(!showHistoryPanel)
                      : undefined
                  }
                  historyCount={history?.entries.length || 0}
                  canUndo={canUndo()}
                  canRedo={canRedo()}
                  onUndo={undo}
                  onRedo={redo}
                />
                {/* Undo History Panel */}
                {isStandardPage && pane.pageId && (
                  <UndoHistoryPanel
                    pageId={pane.pageId}
                    isOpen={showHistoryPanel}
                    onClose={() => setShowHistoryPanel(false)}
                    onJumpToState={handleJumpToState}
                  />
                )}
              </div>
              <div
                ref={editorScrollRef}
                className={`flex-1 overflow-y-auto ${zenMode ? "zen-editor-scroll" : "px-8 py-6"}`}
                style={zenMode ? { padding: "4rem 2rem" } : undefined}
              >
                <div
                  className={`mx-auto ${zenMode ? "zen-editor-container" : ""}`}
                  style={{
                    maxWidth: zenMode ? "720px" : "var(--editor-max-width)",
                  }}
                >
                  {/* Conditional rendering based on page type */}
                  {selectedPage.pageType === "markdown" && (
                    <MarkdownEditor
                      key={selectedPage.id}
                      page={selectedPage}
                      notebookId={notebookId}
                      className="min-h-[calc(100vh-300px)]"
                    />
                  )}
                  {selectedPage.pageType === "pdf" && (
                    <PDFPageViewer
                      key={selectedPage.id}
                      page={selectedPage}
                      notebookId={notebookId}
                      className="min-h-[calc(100vh-300px)]"
                    />
                  )}
                  {selectedPage.pageType === "jupyter" && (
                    <JupyterViewer
                      key={selectedPage.id}
                      page={selectedPage}
                      notebookId={notebookId}
                      className="min-h-[calc(100vh-300px)]"
                    />
                  )}
                  {selectedPage.pageType === "epub" && (
                    <EpubReader
                      key={selectedPage.id}
                      page={selectedPage}
                      notebookId={notebookId}
                      className="min-h-[calc(100vh-300px)]"
                    />
                  )}
                  {selectedPage.pageType === "calendar" && (
                    <CalendarViewer
                      key={selectedPage.id}
                      page={selectedPage}
                      notebookId={notebookId}
                      className="min-h-[calc(100vh-300px)]"
                    />
                  )}
                  {selectedPage.pageType === "chat" && (
                    <ChatEditor
                      key={selectedPage.id}
                      page={selectedPage}
                      notebookId={notebookId}
                      className="min-h-[calc(100vh-300px)]"
                    />
                  )}
                  {(selectedPage.pageType === "standard" ||
                    !selectedPage.pageType) && (
                    <BlockEditor
                      ref={editorRef}
                      key={selectedPage.id}
                      initialData={editorData}
                      onChange={handleChange}
                      onSave={handleSave}
                      onExplicitSave={handleExplicitSave}
                      onLinkClick={handleLinkClick}
                      onBlockRefClick={handleBlockRefClick}
                      notebookId={notebookId}
                      pages={notebookPages.map((p) => ({
                        id: p.id,
                        title: p.title,
                      }))}
                      className="min-h-[calc(100vh-300px)]"
                    />
                  )}

                  {/* Backlinks panel - only for standard pages */}
                  {(selectedPage.pageType === "standard" ||
                    !selectedPage.pageType) && (
                    <BacklinksPanel
                      pageTitle={selectedPage.title}
                      pageId={selectedPage.id}
                      notebookId={notebookId}
                      onBlockRefClick={handleBlockRefClick}
                    />
                  )}

                  {/* Similar Pages panel - only for standard pages */}
                  {(selectedPage.pageType === "standard" ||
                    !selectedPage.pageType) && (
                    <SimilarPagesPanel
                      page={selectedPage}
                      notebookId={notebookId}
                      allPages={notebookPages}
                    />
                  )}
                </div>
              </div>
            </>
          )}
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
              Select a page from the sidebar
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
