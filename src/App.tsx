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
import { ActionLibrary, ActionEditor } from "./components/Actions";
import { QuickCapture, InboxPanel } from "./components/Inbox";
import { FlashcardPanel } from "./components/Flashcards";
import { GoalsPanel, GoalsDashboard } from "./components/Goals";
import { DailyNotesPanel } from "./components/DailyNotes";
import { ToastContainer } from "./components/Toast";
import { useAppInit } from "./hooks/useAppInit";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useNotebookStore } from "./stores/notebookStore";
import { usePageStore } from "./stores/pageStore";
import { useThemeStore } from "./stores/themeStore";
import { useActionStore } from "./stores/actionStore";
import { useInboxStore } from "./stores/inboxStore";
import { useAIStore } from "./stores/aiStore";
import { useFlashcardStore } from "./stores/flashcardStore";
import { useDailyNotesStore } from "./stores/dailyNotesStore";
import { useWindowLibrary } from "./contexts/WindowContext";
import { exportPageToFile } from "./utils/api";
import { save } from "@tauri-apps/plugin-dialog";

function App() {
  useAppInit();

  // Get window library context
  const { library, isSecondaryWindow } = useWindowLibrary();

  // Apply theme on mount
  const applyTheme = useThemeStore((state) => state.applyTheme);
  const toggleZenMode = useThemeStore((state) => state.toggleZenMode);
  useEffect(() => {
    applyTheme();
  }, [applyTheme]);

  // Set window title based on library
  useEffect(() => {
    if (library) {
      const title = isSecondaryWindow ? `Nous - ${library.name}` : "Nous";
      getCurrentWindow().setTitle(title).catch(console.error);
    }
  }, [library, isSecondaryWindow]);

  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showBackup, setShowBackup] = useState(false);

  // Listen for custom event to open backup dialog
  useEffect(() => {
    const handleOpenBackup = () => setShowBackup(true);
    window.addEventListener("open-backup-dialog", handleOpenBackup);
    return () => window.removeEventListener("open-backup-dialog", handleOpenBackup);
  }, []);
  const [showGraph, setShowGraph] = useState(false);
  const [showWebResearch, setShowWebResearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"ai" | "web-research">("ai");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);

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
  const { pages, selectedPageId, selectPage, deletePage, duplicatePage, toggleFavorite } = usePageStore();

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

      {/* Toast Notifications */}
      <ToastContainer />
    </>
  );
}

export default App;
