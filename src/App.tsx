import { useState, useCallback, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Layout } from "./components/Layout/Layout";
import { CommandPalette } from "./components/CommandPalette/CommandPalette";
import { GraphView } from "./components/Graph/GraphView";
import { AIChatPanel } from "./components/AI";
import { WebResearchPanel } from "./components/WebResearch";
import { SettingsDialog } from "./components/Settings";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { TemplateDialog } from "./components/TemplateDialog";
import { TagManager } from "./components/Tags";
import { BackupDialog } from "./components/Backup";
import { PublishDialog } from "./components/Publish";
import { ActionLibrary, ActionEditor } from "./components/Actions";
import { QuickCapture, InboxPanel } from "./components/Inbox";
import { FlashcardPanel } from "./components/Flashcards";
import { GoalsPanel, GoalsDashboard } from "./components/Goals";
import { DailyNotesPanel } from "./components/DailyNotes";
import { TasksPanel } from "./components/Tasks";
import { PeoplePanel } from "./components/People";
import { ToastContainer } from "./components/Toast";
import { WebClipperDialog } from "./components/WebClipper/WebClipperDialog";
import { SmartCollectionsPanel } from "./components/SmartCollections/SmartCollectionsPanel";
import { DropZoneOverlay } from "./components/Import/DropZoneOverlay";
import { FileImportDialog, type ImportConfig, type ImportProgress } from "./components/Import/FileImportDialog";
import { useAppInit } from "./hooks/useAppInit";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useMainThreadWatchdog, getWatchdogLog, clearWatchdogLog } from "./hooks/useMainThreadWatchdog";
import { readCrumbs } from "./utils/breadcrumbs";
import { classifyFile, ALL_SUPPORTED_EXTENSIONS } from "./utils/fileImport";
import * as api from "./utils/api";
import { useNotebookStore } from "./stores/notebookStore";
import { usePageStore } from "./stores/pageStore";
import { useThemeStore } from "./stores/themeStore";
import { useActionStore } from "./stores/actionStore";
import { useInboxStore } from "./stores/inboxStore";
import { useAIStore } from "./stores/aiStore";
import { useFlashcardStore } from "./stores/flashcardStore";
import { useDailyNotesStore } from "./stores/dailyNotesStore";
import { useTasksStore } from "./stores/tasksStore";
import { useSectionStore } from "./stores/sectionStore";
import { useToastStore } from "./stores/toastStore";
import { useWindowLibrary } from "./contexts/WindowContext";
import { exportPageToFile } from "./utils/api";
import { save } from "@tauri-apps/plugin-dialog";

function App() {
  useAppInit();
  useMainThreadWatchdog({ thresholdMs: 500 });

  // On startup, dump diagnostics from the previous session
  useEffect(() => {
    const log = getWatchdogLog();
    if (log.length > 0) {
      console.warn(`[Watchdog] ${log.length} lockup(s) recorded from previous session:`);
      console.table(log);
      clearWatchdogLog();
    }
    const crumbs = readCrumbs();
    if (crumbs.length > 0) {
      console.warn(`[Breadcrumbs] Last page-switch trail from previous session (freeze point):`);
      console.table(crumbs);
      // Don't clear — let selectPage:start clear it on next switch
    }
  }, []);

  // Get window library context
  const { library, isSecondaryWindow } = useWindowLibrary();

  // Apply theme on mount
  const applyTheme = useThemeStore((state) => state.applyTheme);
  const toggleZenMode = useThemeStore((state) => state.toggleZenMode);
  useEffect(() => {
    applyTheme();
  }, [applyTheme]);

  // Task reminders check
  useEffect(() => {
    useTasksStore.getState().checkReminders();
    const interval = setInterval(() => {
      useTasksStore.getState().checkReminders();
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Set window title based on library
  useEffect(() => {
    if (library) {
      const title = isSecondaryWindow ? `Nous - ${library.name}` : "Nous";
      getCurrentWindow().setTitle(title).catch(console.error);
    }
  }, [library, isSecondaryWindow]);

  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [showPublish, setShowPublish] = useState(false);

  // Listen for custom event to open backup dialog
  useEffect(() => {
    const handleOpenBackup = () => setShowBackup(true);
    window.addEventListener("open-backup-dialog", handleOpenBackup);
    return () => window.removeEventListener("open-backup-dialog", handleOpenBackup);
  }, []);

  // Listen for custom event to open publish dialog
  useEffect(() => {
    const handleOpenPublish = () => setShowPublish(true);
    window.addEventListener("open-publish-dialog", handleOpenPublish);
    return () => window.removeEventListener("open-publish-dialog", handleOpenPublish);
  }, []);

  // Listen for custom event to open web clipper (optionally with a URL)
  const [clipperUrl, setClipperUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    const handleOpenClipper = (e: Event) => {
      const detail = (e as CustomEvent<{ url?: string }>).detail;
      setClipperUrl(detail?.url);
      setShowWebClipper(true);
    };
    window.addEventListener("open-web-clipper", handleOpenClipper);
    return () => window.removeEventListener("open-web-clipper", handleOpenClipper);
  }, []);
  const [showSmartCollections, setShowSmartCollections] = useState(false);

  // Listen for custom event to open smart collections
  useEffect(() => {
    const handleOpenCollections = () => setShowSmartCollections(true);
    window.addEventListener("open-smart-collections", handleOpenCollections);
    return () => window.removeEventListener("open-smart-collections", handleOpenCollections);
  }, []);

  const [showGraph, setShowGraph] = useState(false);
  const [showWebResearch, setShowWebResearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"ai" | "web-research">("ai");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [showWebClipper, setShowWebClipper] = useState(false);

  const { selectedNotebookId, createNotebook } = useNotebookStore();
  const {
    showActionLibrary,
    showActionEditor,
    editingActionId,
    openActionLibrary,
    closeActionLibrary,
    closeActionEditor,
  } = useActionStore();
  const {
    openQuickCapture,
    openInboxPanel,
  } = useInboxStore();
  const {
    panel: aiPanel,
    togglePanel: toggleAIPanel,
    closePanel: closeAIPanel,
  } = useAIStore();
  const toggleFlashcardPanel = useFlashcardStore((state) => state.togglePanel);
  const openTodayNote = useDailyNotesStore((state) => state.openTodayNote);
  const pages = usePageStore((s) => s.pages);
  const selectedPageId = usePageStore((s) => s.selectedPageId);
  const selectPage = usePageStore((s) => s.selectPage);
  const deletePage = usePageStore((s) => s.deletePage);
  const duplicatePage = usePageStore((s) => s.duplicatePage);
  const toggleFavorite = usePageStore((s) => s.toggleFavorite);

  // Get the selected page
  const selectedPage = pages.find((p) => p.id === selectedPageId);

  const handleNewPage = useCallback(() => {
    if (selectedNotebookId) {
      setShowTemplateDialog(true);
    }
  }, [selectedNotebookId]);

  const handleNewNotebook = useCallback(() => {
    createNotebook("New Notebook");
  }, [createNotebook]);

  const handleGraphNodeClick = useCallback(
    (pageId: string) => {
      selectPage(pageId);
      setShowGraph(false);
    },
    [selectPage]
  );

  const handleOpenSettings = useCallback((tab?: "ai" | "web-research") => {
    if (tab) setSettingsTab(tab);
    setShowSettings(true);
  }, []);

  // Export current page to markdown
  const handleExportPage = useCallback(async () => {
    if (!selectedPage || !selectedNotebookId) return;

    const suggestedName = selectedPage.title?.replace(/[/\\?%*:|"<>]/g, "-") || "page";
    const path = await save({
      defaultPath: `${suggestedName}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (path) {
      await exportPageToFile(selectedNotebookId, selectedPage.id, path);
    }
  }, [selectedPage, selectedNotebookId]);

  // Duplicate current page
  const handleDuplicatePage = useCallback(() => {
    if (!selectedPage || !selectedNotebookId) return;
    duplicatePage(selectedNotebookId, selectedPage.id);
  }, [selectedPage, selectedNotebookId, duplicatePage]);

  // Delete current page (shows confirmation first)
  const handleDeletePage = useCallback(() => {
    if (!selectedPage) return;
    setShowDeleteConfirm(true);
  }, [selectedPage]);

  // Open today's daily note
  const handleDailyNote = useCallback(async () => {
    if (!selectedNotebookId) return;
    try {
      const note = await openTodayNote(selectedNotebookId);
      selectPage(note.id);
    } catch (err) {
      console.error("Failed to open daily note:", err);
    }
  }, [selectedNotebookId, openTodayNote, selectPage]);

  // Toggle favorite on current page
  const handleToggleFavorite = useCallback(() => {
    if (!selectedPage || !selectedNotebookId) return;
    toggleFavorite(selectedNotebookId, selectedPage.id);
  }, [selectedPage, selectedNotebookId, toggleFavorite]);

  // Confirm delete
  const handleConfirmDelete = useCallback(() => {
    if (!selectedPage || !selectedNotebookId) return;
    deletePage(selectedNotebookId, selectedPage.id);
    setShowDeleteConfirm(false);
  }, [selectedPage, selectedNotebookId, deletePage]);

  // File import state
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [pendingImportPaths, setPendingImportPaths] = useState<string[]>([]);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);

  const currentSectionId = useSectionStore((s) => s.selectedSectionId);
  const loadPages = usePageStore((s) => s.loadPages);

  // Listen for Tauri file drop events (full-window)
  useEffect(() => {
    const appWindow = getCurrentWindow();

    const unlistenDrop = appWindow.onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const { paths } = event.payload;
        if (paths && paths.length > 0) {
          const supported = paths.filter((path) => {
            const ext = path.split(".").pop()?.toLowerCase() ?? "";
            return (ALL_SUPPORTED_EXTENSIONS as readonly string[]).includes(ext);
          });
          if (supported.length > 0) {
            setPendingImportPaths(supported);
            setImportDialogOpen(true);
          }
        }
        setIsFileDragOver(false);
      } else if (event.payload.type === "enter" || event.payload.type === "over") {
        setIsFileDragOver(true);
      } else if (event.payload.type === "leave") {
        setIsFileDragOver(false);
      }
    });

    return () => {
      unlistenDrop.then((unlisten) => unlisten());
    };
  }, []);

  // Listen for custom "import-files" event from FolderTree Import button
  useEffect(() => {
    const handleImportFiles = (e: Event) => {
      const detail = (e as CustomEvent<{ paths: string[] }>).detail;
      if (detail?.paths?.length > 0) {
        setPendingImportPaths(detail.paths);
        setImportDialogOpen(true);
      }
    };
    window.addEventListener("import-files", handleImportFiles);
    return () => window.removeEventListener("import-files", handleImportFiles);
  }, []);

  // Import orchestration
  const handleConfirmImport = useCallback(
    async (config: ImportConfig) => {
      const { storageMode, notebookId, folderId, sectionId } = config;
      const files = pendingImportPaths;
      const errors: string[] = [];
      let completed = 0;

      for (const filePath of files) {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;
        setImportProgress({ total: files.length, completed, currentFile: fileName });

        try {
          const classification = classifyFile(filePath);
          if (!classification.supported) {
            errors.push(`${fileName}: unsupported file type`);
            completed++;
            continue;
          }

          if (classification.action === "native") {
            await api.importFileAsPage(notebookId, filePath, storageMode, folderId, sectionId);
          } else {
            // Convert then import as markdown
            const result = await api.convertDocument(filePath);
            await api.importMarkdown(notebookId, result.content, fileName, folderId, sectionId);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${fileName}: ${msg}`);
        }
        completed++;
      }

      setImportProgress(null);
      setImportDialogOpen(false);
      setPendingImportPaths([]);

      // Refresh pages if we imported to the current notebook
      if (notebookId === selectedNotebookId) {
        loadPages(notebookId);
      }

      // Show toast summary
      const successCount = completed - errors.length;
      if (errors.length === 0) {
        useToastStore.getState().success(
          `Imported ${successCount} file${successCount !== 1 ? "s" : ""} successfully`
        );
      } else if (successCount > 0) {
        useToastStore.getState().warning(
          `Imported ${successCount} file${successCount !== 1 ? "s" : ""}, ${errors.length} failed`
        );
      } else {
        useToastStore.getState().error(`Import failed: ${errors[0]}`);
      }
    },
    [pendingImportPaths, selectedNotebookId, loadPages]
  );

  const handleCancelImport = useCallback(() => {
    setImportDialogOpen(false);
    setPendingImportPaths([]);
  }, []);

  // Global keyboard shortcuts
  useKeyboardShortcuts({
    onCommandPalette: () => setShowCommandPalette(true),
    onNewPage: handleNewPage,
    onNewNotebook: handleNewNotebook,
    onGraph: () => setShowGraph(true),
    onAI: toggleAIPanel,
    onWebResearch: () => setShowWebResearch((prev) => !prev),
    onSettings: () => setShowSettings((prev) => !prev),
    onExportPage: handleExportPage,
    onDuplicatePage: handleDuplicatePage,
    onDeletePage: handleDeletePage,
    onTagManager: () => setShowTagManager((prev) => !prev),
    onActions: openActionLibrary,
    onQuickCapture: openQuickCapture,
    onInbox: openInboxPanel,
    onFlashcards: toggleFlashcardPanel,
    onZenMode: toggleZenMode,
    onDailyNote: handleDailyNote,
    onToggleFavorite: handleToggleFavorite,
    onWebClipper: () => setShowWebClipper(true),
  });

  return (
    <>
      <Layout />

      {/* Command Palette */}
      <CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onOpenGraph={() => setShowGraph(true)}
        onNewPage={handleNewPage}
        onOpenBackup={() => setShowBackup(true)}
      />

      {/* Graph View */}
      {showGraph && (
        <GraphView
          onClose={() => setShowGraph(false)}
          onNodeClick={handleGraphNodeClick}
        />
      )}

      {/* AI Chat Panel */}
      <AIChatPanel
        isOpen={aiPanel.isOpen}
        onClose={closeAIPanel}
        onOpenSettings={() => handleOpenSettings("ai")}
      />

      {/* Web Research Panel */}
      <WebResearchPanel
        isOpen={showWebResearch}
        onClose={() => setShowWebResearch(false)}
        onOpenSettings={() => handleOpenSettings("web-research")}
      />

      {/* Settings Dialog */}
      <SettingsDialog
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        initialTab={settingsTab}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Page"
        message={`Are you sure you want to delete "${selectedPage?.title || "this page"}"? This action cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* Template Selection Dialog */}
      <TemplateDialog
        isOpen={showTemplateDialog}
        onClose={() => setShowTemplateDialog(false)}
        notebookId={selectedNotebookId}
      />

      {/* Tag Manager Dialog */}
      <TagManager
        isOpen={showTagManager}
        onClose={() => setShowTagManager(false)}
        notebookId={selectedNotebookId}
      />

      {/* Backup Dialog */}
      <BackupDialog
        isOpen={showBackup}
        onClose={() => setShowBackup(false)}
      />

      {/* Publish Dialog */}
      <PublishDialog
        isOpen={showPublish}
        onClose={() => setShowPublish(false)}
      />

      {/* Action Library */}
      <ActionLibrary
        isOpen={showActionLibrary}
        onClose={closeActionLibrary}
        currentNotebookId={selectedNotebookId ?? undefined}
      />

      {/* Action Editor */}
      <ActionEditor
        isOpen={showActionEditor}
        onClose={closeActionEditor}
        editingActionId={editingActionId}
      />

      {/* Quick Capture */}
      <QuickCapture />

      {/* Inbox Panel */}
      <InboxPanel />

      {/* Flashcard Panel */}
      <FlashcardPanel />

      {/* Goals Panel */}
      <GoalsPanel />

      {/* Goals Dashboard */}
      <GoalsDashboard />

      {/* Daily Notes Panel */}
      <DailyNotesPanel />

      {/* Tasks Panel */}
      <TasksPanel />

      {/* People Panel */}
      <PeoplePanel />

      {/* Web Clipper */}
      <WebClipperDialog
        isOpen={showWebClipper}
        onClose={() => {
          setShowWebClipper(false);
          setClipperUrl(undefined);
        }}
        initialUrl={clipperUrl}
      />

      {/* Smart Collections */}
      <SmartCollectionsPanel
        isOpen={showSmartCollections}
        onClose={() => setShowSmartCollections(false)}
      />

      {/* File Import Drop Zone Overlay */}
      <DropZoneOverlay isVisible={isFileDragOver} />

      {/* File Import Dialog */}
      <FileImportDialog
        isOpen={importDialogOpen}
        filePaths={pendingImportPaths}
        currentNotebookId={selectedNotebookId}
        currentSectionId={currentSectionId}
        onConfirm={handleConfirmImport}
        onCancel={handleCancelImport}
        importProgress={importProgress}
      />

      {/* Toast Notifications */}
      <ToastContainer />
    </>
  );
}

export default App;
