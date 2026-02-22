import { useMemo, useCallback, useState, useEffect, useRef } from "react";
import type { OutputData } from "@editorjs/editorjs";
import { usePageStore, type EditorPane } from "../../stores/pageStore";
import { useLinkStore } from "../../stores/linkStore";
import { useThemeStore } from "../../stores/themeStore";
import { useUndoHistoryStore } from "../../stores/undoHistoryStore";
import { useTypewriterScroll } from "../../hooks/useTypewriterScroll";
import { useFocusHighlight } from "../../hooks/useFocusHighlight";
import { useUndoHistory } from "../../hooks/useUndoHistory";
import { BlockEditor, type BlockEditorRef } from "./BlockEditor";
import * as api from "../../utils/api";
import { crumb } from "../../utils/breadcrumbs";
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
import { DatabaseEditor, type DatabaseUndoRedoState } from "../Database";
import { HtmlViewer } from "../Html";
import { OutlinePanel } from "./OutlinePanel";
import { PomodoroTimer } from "./PomodoroTimer";
import { BacklinksPanel } from "./BacklinksPanel";
import { SimilarPagesPanel } from "./SimilarPagesPanel";
import type { EditorData, Page } from "../../types/page";
import { calculatePageStats, type PageStats } from "../../utils/pageStats";
import { useWritingGoalsStore } from "../../stores/writingGoalsStore";

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
  const pages = usePageStore((s) => s.pages);
  const updatePageContent = usePageStore((s) => s.updatePageContent);
  const setPageContentLocal = usePageStore((s) => s.setPageContentLocal);
  const createPage = usePageStore((s) => s.createPage);
  const pageDataVersion = usePageStore((s) => s.pageDataVersion);
  const openTabInPane = usePageStore((s) => s.openTabInPane);
  const closeTabInPane = usePageStore((s) => s.closeTabInPane);
  const updateTabTitleInPane = usePageStore((s) => s.updateTabTitleInPane);
  const updatePageLinks = useLinkStore((s) => s.updatePageLinks);
  const setZenMode = useThemeStore((state) => state.setZenMode);
  const zenModeSettings = useThemeStore((state) => state.zenModeSettings);
  const showOutline = useThemeStore((state) => state.showOutline);
  const toggleOutline = useThemeStore((state) => state.toggleOutline);
  const [isSaving, setIsSaving] = useState(false);
  const lastSavedRef = useRef<Date | null>(null);
  // Separate state for explicit save indicator only (Ctrl+S) — NOT updated during auto-save
  const [lastSavedDisplay, setLastSavedDisplay] = useState<Date | null>(null);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [dbUndoState, setDbUndoState] = useState<DatabaseUndoRedoState | null>(null);
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

  // Focus highlight for zen mode (paragraph/sentence dimming)
  useFocusHighlight({
    enabled: zenMode && zenModeSettings.focusHighlight !== "none" && isStandardPage,
    mode: zenModeSettings.focusHighlight,
    containerRef: editorScrollRef,
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

  // Register/unregister this pane with the CRDT store for multi-pane merge
  useEffect(() => {
    if (notebookId && pane.pageId) {
      api.openPageInPaneCrdt(notebookId, pane.pageId, pane.id).catch((e) => {
        console.warn("Failed to open page in CRDT store:", e);
      });
    }
    return () => {
      if (pane.pageId) {
        api.closePaneForPage(pane.pageId, pane.id).catch(() => {});
      }
    };
  }, [notebookId, pane.pageId, pane.id]);

  // Memoize the pages list for BlockEditor so it doesn't create a new array
  // reference on every render (which would tear down and recreate MutationObservers)
  const blockEditorPages = useMemo(
    () => notebookPages.map((p) => ({ id: p.id, title: p.title })),
    [notebookPages]
  );

  // Convert page content to Editor.js format
  const editorData: OutputData | undefined = useMemo(() => {
    if (!selectedPage?.content) return undefined;
    let migrated = false;
    const blocks = selectedPage.content.blocks.map((block) => {
      // Migrate list blocks with checklist style to the custom ChecklistTool.
      // The @editorjs/list checklist variant uses a different data format
      // (content/meta.checked/nested items) and lacks the CSS order sorting
      // that moves checked items to the bottom.
      if (
        block.type === "list" &&
        (block.data as Record<string, unknown>).style === "checklist"
      ) {
        const listItems = (block.data as Record<string, unknown>).items as
          | Array<{ content?: string; meta?: { checked?: boolean }; items?: unknown[] }>
          | undefined;
        if (listItems) {
          migrated = true;
          // Flatten nested list-checklist items into flat checklist items
          const flatItems: Array<{ text: string; checked: boolean }> = [];
          const flatten = (
            items: Array<{ content?: string; meta?: { checked?: boolean }; items?: unknown[] }>,
          ) => {
            for (const item of items) {
              flatItems.push({
                text: item.content ?? "",
                checked: item.meta?.checked ?? false,
              });
              if (item.items && Array.isArray(item.items) && item.items.length > 0) {
                flatten(item.items as typeof items);
              }
            }
          };
          flatten(listItems);
          return {
            id: block.id,
            type: "checklist",
            data: { items: flatItems },
          };
        }
      }
      return {
        id: block.id,
        type: block.type,
        data: block.data as Record<string, unknown>,
      };
    });

    // Persist migrated data so the conversion is permanent
    if (migrated && notebookId && pane.pageId) {
      const migratedContent: EditorData = {
        time: selectedPage.content.time,
        version: selectedPage.content.version,
        blocks: blocks.map((b) => ({
          id: b.id,
          type: b.type,
          data: b.data as Record<string, unknown>,
        })),
      };
      updatePageContent(notebookId, pane.pageId, migratedContent, false, pane.id);
    }

    return {
      time: selectedPage.content.time,
      version: selectedPage.content.version,
      blocks,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPage?.id, pageDataVersion]);

  // Calculate page statistics — only recalculate on page switch or explicit refresh,
  // not on every auto-save (which changes the blocks array reference)
  const pageStats: PageStats | null = useMemo(() => {
    if (!selectedPage?.content?.blocks?.length) return null;
    return calculatePageStats(selectedPage.content.blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPage?.id, pageDataVersion]);

  // Update writing goals progress when word count changes
  const writingGoalsEnabled = useWritingGoalsStore((s) => s.enabled);
  const updateWritingProgress = useWritingGoalsStore((s) => s.updateProgress);
  useEffect(() => {
    if (writingGoalsEnabled && pageStats) {
      updateWritingProgress(pageStats.words);
    }
  }, [writingGoalsEnabled, pageStats?.words, updateWritingProgress]);

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
    (data?: OutputData) => {
      // Capture state for undo history — only when data is provided
      // (at debounce-save time or after structural changes, not per-keystroke)
      if (data) captureState(data);
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

      // NOTE: We intentionally do NOT call setPageContentLocal here.
      // Updating the local store during auto-save triggers a React re-render
      // cascade (pages array new reference → EditorPaneContent + BacklinksPanel +
      // sidebar all re-render) which causes WebKitGTK's rendering pipeline to
      // freeze for 10-260+ seconds.  The local store is updated on unmount
      // (via onUnmountSave in BlockEditor) and on explicit save (Ctrl+S).

      crumb("pane:updatePageContent:start");
      await updatePageContent(notebookId, pane.pageId, editorData, false, pane.id);
      crumb("pane:updatePageContent:done");

      // NOTE: We intentionally do NOT call updatePageLinks or setLastSaved here.
      // ANY React state update during auto-save triggers re-renders near the
      // contenteditable editor, which causes WebKitGTK's rendering pipeline to
      // freeze for 10-260+ seconds.  Links and timestamps are updated on
      // unmount (page switch) and explicit save (Ctrl+S) only.
      lastSavedRef.current = new Date();
    },
    [
      notebookId,
      pane.pageId,
      selectedPage,
      updatePageContent,
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
        updatePageContent(notebookId, pane.pageId, editorData, false, pane.id);
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

        await updatePageContent(notebookId, pane.pageId, editorData, true, pane.id);
        updatePageLinks({
          ...selectedPage,
          content: editorData,
        });
        lastSavedRef.current = new Date();
        setLastSavedDisplay(new Date());
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

  // Handle blockembed:navigate and livequery:navigate custom events
  useEffect(() => {
    const handleEmbedNav = (e: Event) => {
      const detail = (e as CustomEvent<{ pageId: string }>).detail;
      if (detail?.pageId) {
        usePageStore.getState().openPageInPane(pane.id, detail.pageId);
      }
    };

    // These events bubble from Editor.js block tools through the DOM
    document.addEventListener("blockembed:navigate", handleEmbedNav);
    document.addEventListener("livequery:navigate", handleEmbedNav);
    return () => {
      document.removeEventListener("blockembed:navigate", handleEmbedNav);
      document.removeEventListener("livequery:navigate", handleEmbedNav);
    };
  }, [pane.id]);

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
          ) : selectedPage.pageType === "database" ? (
            /* Database gets its own scrollable container */
            <>
              <div className="relative">
                <PageHeader
                  page={selectedPage}
                  isSaving={false}
                  lastSaved={null}
                  stats={null}
                  zenMode={zenMode}
                  onExitZenMode={() => setZenMode(false)}
                  onEnterZenMode={() => setZenMode(true)}
                  historyCount={dbUndoState?.historyCount ?? 0}
                  canUndo={dbUndoState?.canUndo ?? false}
                  canRedo={dbUndoState?.canRedo ?? false}
                  onUndo={dbUndoState?.onUndo ?? (() => {})}
                  onRedo={dbUndoState?.onRedo ?? (() => {})}
                />
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-6">
                <DatabaseEditor
                  key={selectedPage.id}
                  page={selectedPage}
                  notebookId={notebookId}
                  className="min-h-[calc(100vh-300px)]"
                  onUndoRedoStateChange={setDbUndoState}
                />
              </div>
            </>
          ) : (
            <>
              <div className="relative">
                <PageHeader
                  page={selectedPage}
                  isSaving={isSaving}
                  lastSaved={lastSavedDisplay}
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
                  onToggleOutline={toggleOutline}
                  showOutline={showOutline}
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
              <div className="flex flex-1 overflow-hidden">
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
                    {selectedPage.pageType === "html" && (
                      <HtmlViewer
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
                        pageId={selectedPage.id}
                        paneId={pane.id}
                        pages={blockEditorPages}
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
                {showOutline && isStandardPage && !zenMode && (
                  <OutlinePanel
                    blocks={selectedPage.content.blocks}
                    editorScrollRef={editorScrollRef}
                  />
                )}
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

      {/* Pomodoro Timer */}
      {isActive && <PomodoroTimer />}
    </div>
  );
}
